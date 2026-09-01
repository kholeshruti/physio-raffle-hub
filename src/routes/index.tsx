import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import {
  BOOKING_KEY,
  EVENT_NAME,
  MAX_PER_STUDENT,
  cancelBooking,
  fetchBooking,
  fetchRaffleState,
  fetchTakenNumbers,
  holdTickets,
  rupees,
  submitPayment,
} from "@/lib/raffle";
import { Countdown, useCountdown } from "@/components/raffle/Countdown";
import { TicketGrid } from "@/components/raffle/TicketGrid";
import { TicketPass } from "@/components/raffle/TicketPass";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Physio Day Celebration — Live Raffle Ticket Booking" },
      {
        name: "description",
        content:
          "Book your raffle number for the Physio Day Celebration on 8 September 2026. Live number grid, UPI payment, instant ticket download.",
      },
      { property: "og:title", content: "Physio Day Celebration — Live Raffle Ticket Booking" },
      {
        property: "og:description",
        content:
          "Pick up to six raffle numbers, pay by UPI and lock your spot at the Physio Day Celebration.",
      },
    ],
  }),
  component: HomePage,
});

const CONFETTI = [
  { top: "18%", left: "8%", size: "size-3.5", color: "bg-tomato", r: "12deg", delay: "0s" },
  { top: "30%", left: "88%", size: "size-3", color: "bg-marigold", r: "-8deg", delay: "0.4s" },
  { top: "58%", left: "14%", size: "size-2.5", color: "bg-teal", r: "20deg", delay: "0.8s" },
  { top: "72%", left: "84%", size: "size-3", color: "bg-tomato", r: "-14deg", delay: "1.2s" },
  { top: "44%", left: "46%", size: "size-2", color: "bg-marigold", r: "0deg", delay: "1.6s" },
  { top: "82%", left: "30%", size: "size-2.5", color: "bg-teal", r: "10deg", delay: "2s" },
];

function HomePage() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<number[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [txnRef, setTxnRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const passRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setBookingId(localStorage.getItem(BOOKING_KEY));
  }, []);

  const stateQuery = useQuery({ queryKey: ["raffle-state"], queryFn: fetchRaffleState });
  const takenQuery = useQuery({ queryKey: ["taken"], queryFn: fetchTakenNumbers });
  const bookingQuery = useQuery({
    queryKey: ["booking", bookingId],
    queryFn: () => fetchBooking(bookingId as string),
    enabled: !!bookingId,
    refetchInterval: 8000,
  });

  useEffect(() => {
    const channel = supabase
      .channel("tickets-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, () => {
        queryClient.invalidateQueries({ queryKey: ["taken"] });
        queryClient.invalidateQueries({ queryKey: ["raffle-state"] });
        queryClient.invalidateQueries({ queryKey: ["booking"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const state = stateQuery.data;
  const taken = takenQuery.data ?? {};
  const booking = bookingQuery.data ?? null;
  const closing = useCountdown(state?.booking_closes_at ?? null);
  const bookingClosed = closing.ready && closing.closed;

  const soldInBatch = state
    ? Object.entries(taken).filter(
        ([n, s]) => s === "sold" && Number(n) >= state.batch_start && Number(n) <= state.batch_end,
      ).length
    : 0;
  const remaining = state ? state.batch_size - soldInBatch : 0;
  const price = state?.ticket_price ?? 200;

  const activeBooking =
    booking && (booking.status === "held" || booking.status === "pending" || booking.status === "sold")
      ? booking
      : null;

  function toggle(n: number) {
    setSelected((prev) => {
      if (prev.includes(n)) return prev.filter((x) => x !== n);
      if (prev.length >= MAX_PER_STUDENT) {
        toast.error(`You can book at most ${MAX_PER_STUDENT} numbers.`);
        return prev;
      }
      return [...prev, n].sort((a, b) => a - b);
    });
  }

  async function onHold() {
    if (selected.length === 0) return;
    setBusy(true);
    try {
      const res = await holdTickets({ name, phone, numbers: selected });
      localStorage.setItem(BOOKING_KEY, res.booking_id);
      setBookingId(res.booking_id);
      setSelected([]);
      toast.success("Numbers held for 15 minutes — complete your payment.");
      queryClient.invalidateQueries({ queryKey: ["taken"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not hold those numbers.");
      queryClient.invalidateQueries({ queryKey: ["taken"] });
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitPayment() {
    if (!activeBooking) return;
    setBusy(true);
    try {
      await submitPayment(activeBooking.id, txnRef);
      setTxnRef("");
      toast.success("Sent for confirmation.");
      bookingQuery.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not submit.");
    } finally {
      setBusy(false);
    }
  }

  async function onCancel() {
    if (!activeBooking) return;
    await cancelBooking(activeBooking.id);
    localStorage.removeItem(BOOKING_KEY);
    clearBookingToken();
    setBookingId(null);
    queryClient.invalidateQueries({ queryKey: ["taken"] });
  }

  function startOver() {
    localStorage.removeItem(BOOKING_KEY);
    clearBookingToken();
    setBookingId(null);
  }


  async function download(kind: "jpg" | "pdf") {
    if (!passRef.current) return;
    const dataUrl = await toPng(passRef.current, { pixelRatio: 2, cacheBust: true });
    if (kind === "jpg") {
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = "physio-day-ticket.png";
      a.click();
      return;
    }
    const pdf = new jsPDF({ orientation: "landscape", unit: "px", format: [860, 560] });
    pdf.addImage(dataUrl, "PNG", 30, 40, 800, 480, undefined, "FAST");
    pdf.save("physio-day-ticket.pdf");
  }

  return (
    <div className="min-h-screen bg-background text-foreground relative overflow-x-hidden">
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        {CONFETTI.map((c, i) => (
          <span
            key={i}
            className={`absolute rounded-full animate-float ${c.size} ${c.color}`}
            style={
              {
                top: c.top,
                left: c.left,
                "--r": c.r,
                animationDelay: c.delay,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      <nav className="sticky top-0 z-20 bg-background/85 backdrop-blur-sm border-b border-foreground/10">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="grid place-items-center size-9 rounded-lg bg-tomato text-tomato-foreground font-display font-black text-base -rotate-6">
              PD
            </span>
            <span className="font-display font-black text-lg tracking-tight">
              Physio Day <span className="text-tomato">Celebration</span>
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="hidden sm:flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
              <span className="size-2 rounded-full bg-teal animate-pulse-live" /> LIVE · Batch{" "}
              {String(state?.batch_number ?? 1).padStart(2, "0")}
            </span>
            <Link
              to="/admin"
              className="rounded-full border border-foreground/15 px-3.5 py-2 font-semibold text-[13px] hover:bg-foreground/5 transition-colors"
            >
              Admin
            </Link>
          </div>
        </div>
      </nav>

      <header className="max-w-6xl mx-auto px-5 pt-10 md:pt-16 pb-8 relative">
        <div className="animate-rise">
          <div className="inline-flex items-center gap-2 rounded-full bg-cream border border-foreground/10 px-3 py-1.5 text-[12px] font-mono uppercase tracking-wider text-muted-foreground">
            <span className="size-2 rounded-full bg-tomato animate-pulse-live" /> Live raffle book ·{" "}
            {state?.batch_size ?? 100} tickets
          </div>
          <h1 className="mt-5 font-display font-black text-5xl md:text-7xl leading-[0.9] tracking-tight text-balance">
            Tear a number.
            <br />
            <span className="italic font-semibold text-tomato">Win the big day.</span>
          </h1>
          <p className="mt-5 max-w-[46ch] text-pretty text-muted-foreground text-base md:text-lg">
            {state?.batch_size ?? 100} numbered raffle tickets for the {EVENT_NAME}. Pick up to six,
            pay by UPI, and your number is locked in. No refresh — it updates live.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <a
              href="#grid"
              className="inline-flex items-center gap-2 rounded-full bg-tomato text-tomato-foreground font-semibold px-6 py-3.5 hover:bg-tomato/90 active:translate-y-0.5 transition"
            >
              Book Your Raffle Ticket <span aria-hidden="true">→</span>
            </a>
            <span className="inline-flex items-center gap-2 rounded-full bg-cream border border-foreground/10 px-4 py-3.5 font-mono text-[13px]">
              {rupees(price)} / ticket
            </span>
            <span className="inline-flex items-center gap-2 rounded-full bg-cream border border-foreground/10 px-4 py-3.5 font-mono text-[13px]">
              {remaining} left in this batch
            </span>
          </div>
        </div>

        <div className="mt-9 animate-rise [animation-delay:120ms]">
          <Countdown target={state?.booking_closes_at ?? null} />
        </div>
      </header>

      {activeBooking ? (
        <PaymentSection
          booking={activeBooking}
          txnRef={txnRef}
          setTxnRef={setTxnRef}
          busy={busy}
          onSubmit={onSubmitPayment}
          onCancel={onCancel}
          onStartOver={startOver}
          onDownload={download}
          passRef={passRef}
        />
      ) : (
        <section id="grid" className="max-w-6xl mx-auto px-5 pb-16 animate-rise [animation-delay:220ms]">
          <div className="bg-cream rounded-3xl ring-1 ring-foreground/10 p-5 md:p-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="font-display font-black text-3xl md:text-4xl tracking-tight">
                  Pick your numbers
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Choose 1–{MAX_PER_STUDENT}. Held &amp; sold are locked for everyone, live.
                </p>
              </div>
              <div className="flex items-center gap-5">
                <span className="flex items-center gap-2 text-[12px] font-mono">
                  <span className="size-3 rounded bg-cream ring-1 ring-inset ring-foreground/25" />
                  Available
                </span>
                <span className="flex items-center gap-2 text-[12px] font-mono">
                  <span className="size-3 rounded bg-tomato/25" />
                  Held
                </span>
                <span className="flex items-center gap-2 text-[12px] font-mono">
                  <span className="size-3 rounded bg-parchment" />
                  Sold
                </span>
              </div>
            </div>

            {bookingClosed ? (
              <div className="mt-8 rounded-2xl bg-ink text-ink-foreground p-8 text-center">
                <p className="font-display font-black text-3xl">Booking Closed</p>
                <p className="mt-2 text-sm text-ink-foreground/70">
                  The raffle counter shut at 3:00 PM IST on 8 September 2026.
                </p>
              </div>
            ) : (
              <>
                <TicketGrid
                  start={state?.batch_start ?? 1}
                  end={state?.batch_end ?? 100}
                  taken={taken}
                  selected={selected}
                  onToggle={toggle}
                />
                <p className="mt-4 text-center font-mono text-[12px] text-muted-foreground">
                  Batch {String(state?.batch_number ?? 1).padStart(2, "0")} ·{" "}
                  {state?.batch_start ?? 1}–{state?.batch_end ?? 100} · a new batch of{" "}
                  {state?.batch_size ?? 100} opens when this one sells out
                </p>
              </>
            )}
          </div>

          {!bookingClosed && (
            <div className="mt-4 grid md:grid-cols-12 gap-4">
              <div className="md:col-span-7 bg-cream rounded-3xl ring-1 ring-foreground/10 p-6">
                <h3 className="font-display font-black text-2xl tracking-tight">
                  Tell us who you are
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  We hold your numbers for 15 minutes while you pay.
                </p>
                <div className="mt-5 space-y-3">
                  <label className="block">
                    <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                      Full name
                    </span>
                    <input
                      type="text"
                      value={name}
                      maxLength={80}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your name"
                      className="mt-1.5 w-full rounded-xl bg-background px-4 py-3 text-sm ring-1 ring-inset ring-foreground/15 focus:ring-2 focus:ring-tomato outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                      Phone
                    </span>
                    <input
                      type="tel"
                      value={phone}
                      maxLength={20}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+91 90000 00000"
                      className="mt-1.5 w-full rounded-xl bg-background px-4 py-3 text-sm font-mono ring-1 ring-inset ring-foreground/15 focus:ring-2 focus:ring-tomato outline-none"
                    />
                  </label>
                </div>
              </div>

              <div className="md:col-span-5 bg-ink text-ink-foreground rounded-3xl p-6 flex flex-col">
                <span className="font-mono text-[12px] uppercase tracking-wider text-ink-foreground/70">
                  Your stubs
                </span>
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  {Array.from({ length: MAX_PER_STUDENT }).map((_, i) => {
                    const n = selected[i];
                    return n !== undefined ? (
                      <button
                        key={n}
                        type="button"
                        onClick={() => toggle(n)}
                        className="grid place-items-center size-10 rounded-lg bg-tomato text-tomato-foreground font-mono font-semibold"
                      >
                        {n}
                      </button>
                    ) : (
                      <span
                        key={`empty-${i}`}
                        className="grid place-items-center size-10 rounded-lg bg-ink-foreground/15 font-mono text-lg leading-none text-ink-foreground/50"
                      >
                        ·
                      </span>
                    );
                  })}
                </div>
                <p className="mt-4 font-mono text-[12px] text-ink-foreground/70">
                  <span className="font-semibold text-ink-foreground">{selected.length}</span> /{" "}
                  {MAX_PER_STUDENT} · {rupees(selected.length * price)}
                </p>
                <button
                  type="button"
                  disabled={busy || selected.length === 0}
                  onClick={onHold}
                  className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-full bg-marigold text-marigold-foreground font-semibold px-4 py-3 text-sm hover:bg-marigold/90 active:translate-y-0.5 transition disabled:opacity-50 disabled:pointer-events-none"
                >
                  {busy ? "Holding…" : "Hold my numbers →"}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      <footer className="border-t border-foreground/10 bg-cream/40">
        <div className="max-w-6xl mx-auto px-5 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="grid place-items-center size-8 rounded-lg bg-tomato text-tomato-foreground font-display font-black text-sm -rotate-6">
              PD
            </span>
            <span className="font-display font-bold text-foreground">{EVENT_NAME}</span>
          </div>
          <p className="font-mono text-[12px]">
            Batch expands by {state?.batch_size ?? 100} numbers when the current one sells out.
          </p>
        </div>
      </footer>
    </div>
  );
}

type PaymentProps = {
  booking: NonNullable<Awaited<ReturnType<typeof fetchBooking>>>;
  txnRef: string;
  setTxnRef: (v: string) => void;
  busy: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  onStartOver: () => void;
  onDownload: (kind: "jpg" | "pdf") => void;
  passRef: React.RefObject<HTMLDivElement | null>;
};

function PaymentSection({
  booking,
  txnRef,
  setTxnRef,
  busy,
  onSubmit,
  onCancel,
  onStartOver,
  onDownload,
  passRef,
}: PaymentProps) {
  const hold = useCountdown(booking.status === "held" ? booking.held_until : null);

  return (
    <section id="grid" className="max-w-6xl mx-auto px-5 pb-16 animate-rise">
      <div className="grid md:grid-cols-12 gap-5">
        <div className="md:col-span-7 bg-cream rounded-3xl ring-1 ring-foreground/10 p-6">
          {booking.status === "sold" ? (
            <>
              <span className="inline-flex items-center gap-2 rounded-full bg-teal/15 text-teal px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider">
                Confirmed · Sold
              </span>
              <h2 className="mt-4 font-display font-black text-3xl tracking-tight">
                You&apos;re in the draw!
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Download or print your ticket and bring it on the day.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => onDownload("pdf")}
                  className="rounded-full bg-tomato text-tomato-foreground font-semibold px-5 py-3 text-sm hover:bg-tomato/90 transition"
                >
                  Download PDF
                </button>
                <button
                  type="button"
                  onClick={() => onDownload("jpg")}
                  className="rounded-full bg-ink text-ink-foreground font-semibold px-5 py-3 text-sm hover:opacity-90 transition"
                >
                  Download image
                </button>
                <button
                  type="button"
                  onClick={onStartOver}
                  className="rounded-full border border-foreground/15 px-5 py-3 text-sm font-semibold hover:bg-foreground/5 transition"
                >
                  Book more numbers
                </button>
              </div>
              <div className="mt-6 overflow-x-auto">
                <div className="origin-top-left scale-[0.62] sm:scale-75 w-fit">
                  <TicketPass
                    ref={passRef}
                    name={booking.student_name}
                    numbers={booking.numbers}
                    bookingId={booking.id}
                  />
                </div>
              </div>
            </>
          ) : booking.status === "pending" ? (
            <>
              <span className="inline-flex items-center gap-2 rounded-full bg-marigold/25 text-foreground px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider">
                <span className="size-2 rounded-full bg-tomato animate-pulse-live" /> Pending
                confirmation
              </span>
              <h2 className="mt-4 font-display font-black text-3xl tracking-tight">
                Waiting for confirmation
              </h2>
              <p className="mt-2 text-sm text-muted-foreground max-w-[46ch]">
                We received reference <span className="font-mono">{booking.txn_ref}</span>. An
                organiser is checking the bank account. Your ticket is not final and cannot be
                downloaded until it is confirmed. Keep this page open — it updates by itself.
              </p>
              <button
                type="button"
                onClick={onStartOver}
                className="mt-5 rounded-full border border-foreground/15 px-5 py-3 text-sm font-semibold hover:bg-foreground/5 transition"
              >
                Not your booking? Start over
              </button>
            </>
          ) : (
            <>
              <h2 className="font-display font-black text-3xl tracking-tight">Pay &amp; confirm</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Scan the QR with any UPI app, then paste the transaction / reference ID below.
              </p>
              <div className="mt-5 flex flex-col sm:flex-row gap-5 items-start">
                <img
                  src="/payment-qr.png"
                  alt="UPI payment QR code for the Physio Day Celebration raffle"
                  width={768}
                  height={768}
                  className="size-56 rounded-2xl bg-background p-2 ring-1 ring-foreground/10"
                />
                <div className="flex-1 w-full">
                  <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                    Amount to pay
                  </p>
                  <p className="font-display font-black text-4xl tabular-nums">
                    {rupees(booking.amount)}
                  </p>
                  <label className="block mt-4">
                    <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                      UPI transaction / reference ID
                    </span>
                    <input
                      value={txnRef}
                      onChange={(e) => setTxnRef(e.target.value)}
                      maxLength={60}
                      placeholder="e.g. 4183920XXXXX"
                      className="mt-1.5 w-full rounded-xl bg-background px-4 py-3 text-sm font-mono ring-1 ring-inset ring-foreground/15 focus:ring-2 focus:ring-tomato outline-none"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy || txnRef.trim().length < 4}
                    onClick={onSubmit}
                    className="mt-3 w-full rounded-full bg-tomato text-tomato-foreground font-semibold py-3 text-sm hover:bg-tomato/90 transition disabled:opacity-50 disabled:pointer-events-none"
                  >
                    {busy ? "Submitting…" : "Submit for confirmation"}
                  </button>
                  <button
                    type="button"
                    onClick={onCancel}
                    className="mt-2 w-full rounded-full border border-foreground/15 py-3 text-sm font-semibold hover:bg-foreground/5 transition"
                  >
                    Release my numbers
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="md:col-span-5 bg-ink text-ink-foreground rounded-3xl p-6 relative overflow-hidden">
          <h3 className="font-display font-black text-2xl tracking-tight">Your booking</h3>
          <dl className="mt-5 space-y-2 text-sm">
            <div className="flex justify-between border-b border-ink-foreground/15 pb-2">
              <dt className="text-ink-foreground/60">Student</dt>
              <dd className="font-semibold">{booking.student_name}</dd>
            </div>
            <div className="flex justify-between border-b border-ink-foreground/15 pb-2">
              <dt className="text-ink-foreground/60">Numbers</dt>
              <dd className="font-mono font-semibold">{booking.numbers.join(" · ")}</dd>
            </div>
            <div className="flex justify-between border-b border-ink-foreground/15 pb-2">
              <dt className="text-ink-foreground/60">Amount</dt>
              <dd className="font-semibold">{rupees(booking.amount)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-foreground/60">Status</dt>
              <dd className="font-semibold capitalize text-marigold">{booking.status}</dd>
            </div>
          </dl>
          {booking.status === "held" && (
            <div className="mt-6">
              <p className="font-mono text-[11px] uppercase tracking-wider text-ink-foreground/60">
                Held for
              </p>
              <p className="font-display font-black text-4xl tabular-nums">
                {hold.closed
                  ? "00:00"
                  : `${String(hold.mins + hold.hours * 60).padStart(2, "0")}:${String(hold.secs).padStart(2, "0")}`}
              </p>
              <p className="text-[12px] text-ink-foreground/60">then auto-released</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
