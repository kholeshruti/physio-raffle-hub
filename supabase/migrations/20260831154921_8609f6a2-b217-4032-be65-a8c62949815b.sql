
create type public.booking_status as enum ('held','pending','sold','rejected','expired');

create table public.app_settings (
  id integer primary key default 1,
  ticket_price integer not null default 200,
  batch_size integer not null default 100,
  booking_closes_at timestamptz not null default '2026-09-08 09:30:00+00',
  constraint app_settings_single_row check (id = 1)
);
insert into public.app_settings (id) values (1);
grant select on public.app_settings to anon, authenticated;
grant all on public.app_settings to service_role;
alter table public.app_settings enable row level security;
create policy "settings are public" on public.app_settings for select to anon, authenticated using (true);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  student_name text not null,
  phone text not null,
  txn_ref text,
  amount integer not null default 0,
  status public.booking_status not null default 'held',
  held_until timestamptz not null default now() + interval '15 minutes',
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);
grant all on public.bookings to service_role;
alter table public.bookings enable row level security;
create index bookings_status_idx on public.bookings (status, created_at desc);

create table public.tickets (
  ticket_number integer primary key,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  status public.booking_status not null default 'held',
  held_until timestamptz,
  created_at timestamptz not null default now()
);
grant select on public.tickets to anon, authenticated;
grant all on public.tickets to service_role;
alter table public.tickets enable row level security;
create policy "taken numbers are public" on public.tickets for select to anon, authenticated using (true);
create index tickets_booking_idx on public.tickets (booking_id);
create index tickets_status_idx on public.tickets (status);

alter publication supabase_realtime add table public.tickets;

create or replace function public.release_expired_holds()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.tickets where status = 'held' and held_until is not null and held_until < now();
  update public.bookings set status = 'expired' where status = 'held' and held_until < now();
end $$;

create or replace function public.raffle_state()
returns json language plpgsql stable security definer set search_path = public as $$
declare
  s public.app_settings%rowtype;
  v_sold integer;
  v_start integer;
begin
  select * into s from public.app_settings where id = 1;
  select count(*) into v_sold from public.tickets where status = 'sold';
  v_start := (v_sold / s.batch_size) * s.batch_size + 1;
  return json_build_object(
    'ticket_price', s.ticket_price,
    'batch_size', s.batch_size,
    'booking_closes_at', s.booking_closes_at,
    'total_sold', v_sold,
    'batch_start', v_start,
    'batch_end', v_start + s.batch_size - 1,
    'batch_number', (v_sold / s.batch_size) + 1
  );
end $$;

create or replace function public.hold_tickets(p_name text, p_phone text, p_numbers integer[])
returns json language plpgsql security definer set search_path = public as $$
declare
  s public.app_settings%rowtype;
  v_booking_id uuid;
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
  returning id into v_booking_id;

  insert into public.tickets (ticket_number, booking_id, status, held_until)
  select x, v_booking_id, 'held', v_expires from unnest(p_numbers) x;

  return json_build_object(
    'booking_id', v_booking_id,
    'expires_at', v_expires,
    'amount', s.ticket_price * v_count,
    'numbers', p_numbers
  );
exception
  when unique_violation then
    raise exception 'NUMBER_TAKEN';
end $$;

create or replace function public.submit_payment(p_booking_id uuid, p_txn_ref text)
returns json language plpgsql security definer set search_path = public as $$
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
end $$;

create or replace function public.cancel_booking(p_booking_id uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  delete from public.tickets where booking_id = p_booking_id and status = 'held';
  update public.bookings set status = 'expired' where id = p_booking_id and status = 'held';
  return json_build_object('ok', true);
end $$;

create or replace function public.get_booking(p_booking_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  b public.bookings%rowtype;
  v_numbers integer[];
begin
  select * into b from public.bookings where id = p_booking_id;
  if not found then
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
end $$;

grant execute on function public.release_expired_holds() to anon, authenticated;
grant execute on function public.raffle_state() to anon, authenticated;
grant execute on function public.hold_tickets(text, text, integer[]) to anon, authenticated;
grant execute on function public.submit_payment(uuid, text) to anon, authenticated;
grant execute on function public.cancel_booking(uuid) to anon, authenticated;
grant execute on function public.get_booking(uuid) to anon, authenticated;
