-- tickets: only expose ticket_number + status publicly, read-only
REVOKE ALL ON TABLE public.tickets FROM anon, authenticated;
GRANT SELECT (ticket_number, status) ON public.tickets TO anon, authenticated;
GRANT ALL ON TABLE public.tickets TO service_role;

DROP POLICY IF EXISTS "taken numbers are public" ON public.tickets;
CREATE POLICY "taken numbers are public"
ON public.tickets FOR SELECT
TO anon, authenticated
USING (true);

-- bookings: no direct API access at all (PII + access_token)
REVOKE ALL ON TABLE public.bookings FROM anon, authenticated, PUBLIC;
GRANT ALL ON TABLE public.bookings TO service_role;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings FORCE ROW LEVEL SECURITY;
