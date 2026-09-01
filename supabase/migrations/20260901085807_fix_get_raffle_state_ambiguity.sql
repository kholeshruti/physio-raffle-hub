/*
# Fix get_raffle_state — qualify column references to avoid ambiguity
*/

DROP FUNCTION IF EXISTS public.get_raffle_state();

CREATE OR REPLACE FUNCTION public.get_raffle_state()
RETURNS TABLE(
  ticket_price int,
  batch_size int,
  booking_closes_at timestamptz,
  total_sold int,
  batch_start int,
  batch_end int,
  batch_number int,
  taken json
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_ticket_price int;
  v_batch_size int;
  v_deadline timestamptz;
  v_max_batch int;
  v_sold_count int;
  v_batch_start int;
  v_batch_end int;
  v_taken json;
begin
  select
    (select value::int from app_settings where key = 'ticket_price'),
    (select value::int from app_settings where key = 'batch_size'),
    (select value::timestamptz from app_settings where key = 'booking_deadline')
  into v_ticket_price, v_batch_size, v_deadline;

  perform release_expired_holds();

  select max(t.batch_number) into v_max_batch from tickets t;
  if v_max_batch is null then
    v_max_batch := 1;
  end if;

  v_batch_start := (v_max_batch - 1) * v_batch_size + 1;
  v_batch_end := v_max_batch * v_batch_size;

  select count(*) into v_sold_count from tickets t2 where t2.status = 'sold';

  select coalesce(json_object_agg(t3.ticket_number, t3.status), '{}'::json)
  into v_taken
  from tickets t3 where t3.status <> 'available';

  return next;
  return query select
    v_ticket_price,
    v_batch_size,
    v_deadline,
    v_sold_count,
    v_batch_start,
    v_batch_end,
    v_max_batch,
    v_taken;
end;
$function$;

REVOKE ALL ON FUNCTION public.get_raffle_state() FROM public;
GRANT EXECUTE ON FUNCTION public.get_raffle_state() TO anon, authenticated, service_role;
