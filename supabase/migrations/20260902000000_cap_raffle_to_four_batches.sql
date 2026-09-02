create or replace function public.raffle_state()
returns json language plpgsql stable security definer set search_path = public as $$
declare
  s public.app_settings%rowtype;
  v_sold integer;
  v_total_capacity integer;
  v_start integer;
  v_end integer;
  v_batch_number integer;
begin
  select * into s from public.app_settings where id = 1;
  v_total_capacity := s.batch_size * 4;
  select count(*) into v_sold from public.tickets where status = 'sold';

  if v_sold >= v_total_capacity then
    v_start := (s.batch_size * 3) + 1;
    v_end := v_total_capacity;
    v_batch_number := 4;
  else
    v_start := (v_sold / s.batch_size) * s.batch_size + 1;
    v_end := v_start + s.batch_size - 1;
    v_batch_number := (v_sold / s.batch_size) + 1;
  end if;

  return json_build_object(
    'ticket_price', s.ticket_price,
    'batch_size', s.batch_size,
    'booking_closes_at', s.booking_closes_at,
    'total_sold', v_sold,
    'batch_start', v_start,
    'batch_end', v_end,
    'batch_number', v_batch_number
  );
end $$;

create or replace function public.hold_tickets(p_name text, p_phone text, p_numbers integer[])
returns json language plpgsql security definer set search_path = public as $$
declare
  s public.app_settings%rowtype;
  v_booking_id uuid;
  v_token text;
  v_sold integer;
  v_total_capacity integer;
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

  v_total_capacity := s.batch_size * 4;
  select count(*) into v_sold from public.tickets where status = 'sold';
  if v_sold >= v_total_capacity then
    raise exception 'ALL_TICKETS_SOLD';
  end if;

  v_start := (v_sold / s.batch_size) * s.batch_size + 1;
  if v_start > (s.batch_size * 3) + 1 then
    v_start := (s.batch_size * 3) + 1;
  end if;
  v_end := v_start + s.batch_size - 1;
  if v_end > v_total_capacity then
    v_end := v_total_capacity;
  end if;

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
end $$;
