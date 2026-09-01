-- 1. Hide booking_id from public ticket reads (column-level grants)
revoke select on public.tickets from anon, authenticated;
grant select (ticket_number, status, held_until, created_at) on public.tickets to anon, authenticated;

-- 2. Per-booking secret token
alter table public.bookings add column if not exists access_token text not null default encode(gen_random_bytes(24), 'hex');

-- 3. hold_tickets returns the token
create or replace function public.hold_tickets(p_name text, p_phone text, p_numbers integer[])
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  s public.app_settings%rowtype;
  v_booking_id uuid;
  v_token text;
  v_sold integer;
  v_start integer;
  v_end integer;
  v_count integer;
  v_expires timestamptz;
  n integer;
begin
  select * into s from public.app_settings where id = 1;
  if now() >= s.booking_closes_at then
    raise exception 'BOOKING_CLOSED';
  end if;

  v_count := coalesce(array_length(p_numbers, 1), 0);
  if v_count < 1 or v_count > 6 then
    raise exception 'INVALID_SELECTION';
  end if;
  if (select count(distinct x) from unnest(p_numbers) x) <> v_count then
    raise exception 'INVALID_SELECTION';
  end if;
  if length(btrim(coalesce(p_name, ''))) < 2 or length(btrim(coalesce(p_name, ''))) > 80 then
    raise exception 'INVALID_NAME';
  end if;
  if btrim(coalesce(p_phone, '')) !~ '^[0-9+][0-9 ()+-]{6,19}$' then
    raise exception 'INVALID_PHONE';
  end if;

  perform public.release_expired_holds();

  select count(*) into v_sold from public.tickets where status = 'sold';
  v_start := (v_sold / s.batch_size) * s.batch_size + 1;
  v_end := v_start + s.batch_size - 1;
  foreach n in array p_numbers loop
    if n < v_start or n > v_end then
      raise exception 'OUT_OF_BATCH';
    end if;
  end loop;

  v_expires := now() + interval '15 minutes';

  insert into public.bookings (student_name, phone, amount, held_until)
  values (btrim(p_name), btrim(p_phone), s.ticket_price * v_count, v_expires)
  returning id, access_token into v_booking_id, v_token;

  insert into public.tickets (ticket_number, booking_id, status, held_until)
  select x, v_booking_id, 'held', v_expires from unnest(p_numbers) x;

  return json_build_object(
    'booking_id', v_booking_id,
    'access_token', v_token,
    'expires_at', v_expires,
    'amount', s.ticket_price * v_count,
    'numbers', p_numbers
  );
exception
  when unique_violation then
    raise exception 'NUMBER_TAKEN';
end $function$;

-- 4. Token-gated reads/mutations
drop function if exists public.get_booking(uuid);
create or replace function public.get_booking(p_booking_id uuid, p_token text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  b public.bookings%rowtype;
  v_numbers integer[];
begin
  select * into b from public.bookings where id = p_booking_id;
  if not found then
    return null;
  end if;
  if p_token is null or b.access_token is distinct from p_token then
    return null;
  end if;
  select coalesce(array_agg(ticket_number order by ticket_number), '{}')
    into v_numbers from public.tickets where booking_id = b.id;
  return json_build_object(
    'id', b.id,
    'student_name', b.student_name,
    'phone', b.phone,
    'txn_ref', b.txn_ref,
    'amount', b.amount,
    'status', b.status,
    'held_until', b.held_until,
    'created_at', b.created_at,
    'numbers', v_numbers
  );
end $function$;

drop function if exists public.cancel_booking(uuid);
create or replace function public.cancel_booking(p_booking_id uuid, p_token text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.bookings where id = p_booking_id and access_token = p_token) then
    raise exception 'NOT_FOUND';
  end if;
  delete from public.tickets where booking_id = p_booking_id and status = 'held';
  update public.bookings set status = 'expired' where id = p_booking_id and status = 'held';
  return json_build_object('ok', true);
end $function$;

drop function if exists public.submit_payment(uuid, text);
create or replace function public.submit_payment(p_booking_id uuid, p_token text, p_txn_ref text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  b public.bookings%rowtype;
begin
  if length(btrim(coalesce(p_txn_ref, ''))) < 4 or length(btrim(coalesce(p_txn_ref, ''))) > 60 then
    raise exception 'INVALID_TXN';
  end if;

  select * into b from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if p_token is null or b.access_token is distinct from p_token then
    raise exception 'NOT_FOUND';
  end if;
  if b.status = 'held' and b.held_until < now() then
    perform public.release_expired_holds();
    raise exception 'HOLD_EXPIRED';
  end if;
  if b.status not in ('held', 'pending') then
    raise exception 'INVALID_STATE';
  end if;

  update public.bookings
    set txn_ref = btrim(p_txn_ref), status = 'pending'
    where id = p_booking_id;
  update public.tickets
    set status = 'pending', held_until = null
    where booking_id = p_booking_id;

  return json_build_object('ok', true);
end $function$;

-- 5. Least-privilege execute grants
revoke all on function public.release_expired_holds() from public, anon, authenticated;
grant execute on function public.release_expired_holds() to service_role;

revoke all on function public.hold_tickets(text, text, integer[]) from public;
revoke all on function public.get_booking(uuid, text) from public;
revoke all on function public.cancel_booking(uuid, text) from public;
revoke all on function public.submit_payment(uuid, text, text) from public;
revoke all on function public.raffle_state() from public;

grant execute on function public.hold_tickets(text, text, integer[]) to anon, authenticated, service_role;
grant execute on function public.get_booking(uuid, text) to anon, authenticated, service_role;
grant execute on function public.cancel_booking(uuid, text) to anon, authenticated, service_role;
grant execute on function public.submit_payment(uuid, text, text) to anon, authenticated, service_role;
grant execute on function public.raffle_state() to anon, authenticated, service_role;