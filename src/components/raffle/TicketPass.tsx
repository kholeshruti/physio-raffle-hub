import { forwardRef } from "react";
import { EVENT_NAME } from "@/lib/raffle";

type Props = {
  name: string;
  numbers: number[];
  bookingId: string;
};

export const TicketPass = forwardRef<HTMLDivElement, Props>(function TicketPass(
  { name, numbers, bookingId },
  ref,
) {
  return (
    <div
      ref={ref}
      className="w-[720px] bg-cream text-foreground p-10 rounded-3xl ring-1 ring-foreground/10"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className="grid place-items-center size-12 rounded-xl bg-tomato text-tomato-foreground font-display font-black text-lg -rotate-6">
            PD
          </span>
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Official raffle ticket
            </p>
            <h2 className="font-display font-black text-3xl tracking-tight leading-tight">
              {EVENT_NAME}
            </h2>
          </div>
        </div>
        <div className="text-right">
          <p className="font-display font-semibold italic text-lg text-teal">8 Sep 2026</p>
          <p className="font-mono text-[11px] text-muted-foreground">3:00 PM IST</p>
        </div>
      </div>

      <div className="mt-8 border-t border-dashed border-foreground/25 pt-6">
        <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          Issued to
        </p>
        <p className="font-display font-black text-4xl tracking-tight mt-1">{name}</p>
      </div>

      <div className="mt-6">
        <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          Your lucky {numbers.length === 1 ? "number" : "numbers"}
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          {numbers.map((n) => (
            <span
              key={n}
              className="grid place-items-center min-w-20 h-20 px-4 rounded-2xl bg-ink text-ink-foreground font-display font-black text-4xl tabular-nums"
            >
              {n}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-8 flex items-end justify-between border-t border-dashed border-foreground/25 pt-5">
        <p className="font-mono text-[10px] text-muted-foreground">
          Ref {bookingId.slice(0, 8).toUpperCase()} · Payment confirmed
        </p>
        <p className="font-display font-semibold italic text-lg text-tomato">
          Good luck at the draw!
        </p>
      </div>
    </div>
  );
});
