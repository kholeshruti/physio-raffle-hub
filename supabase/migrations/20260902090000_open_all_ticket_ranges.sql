-- Allow students to hold any ticket number from the capped 1-400 pool.
create or replace function public.hold_tickets(p_name text, p_phone text, p_numbers integer[])
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.app_settings%rowtype;
  v_booking_id uuid;
  v_token text;
  v_sold integer;
  v_total_capacity integer;
  v_count integer;
  v_expires timestamptz;
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
  if exists (select 1 from unnest(p_numbers) x where x < 1 or x > 400) then
    raise exception 'INVALID_SELECTION';
  end if;

  perform public.release_expired_holds();

  if exists (
    select 1
    from public.tickets
    where ticket_number = any(p_numbers)
      and status in ('held', 'pending', 'sold')
  ) then
    raise exception 'NUMBER_TAKEN';
  end if;

  v_total_capacity := s.batch_size * 4;
  select count(*) into v_sold from public.tickets where status = 'sold';
  if v_sold >= v_total_capacity then
    raise exception 'ALL_TICKETS_SOLD';
  end if;

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
end $$;

revoke all on function public.hold_tickets(text, text, integer[]) from public;
grant execute on function public.hold_tickets(text, text, integer[]) to anon, authenticated, service_role;
