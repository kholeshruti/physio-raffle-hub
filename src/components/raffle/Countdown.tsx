import { useEffect, useState } from "react";

export function useCountdown(target: string | null) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!target || now === null) {
    return { ready: false, closed: false, days: 0, hours: 0, mins: 0, secs: 0 };
  }
  const diff = new Date(target).getTime() - now;
  if (diff <= 0) return { ready: true, closed: true, days: 0, hours: 0, mins: 0, secs: 0 };
  const secs = Math.floor(diff / 1000);
  return {
    ready: true,
    closed: false,
    days: Math.floor(secs / 86400),
    hours: Math.floor((secs % 86400) / 3600),
    mins: Math.floor((secs % 3600) / 60),
    secs: secs % 60,
  };
}

function Unit({ value, label }: { value: number; label: string }) {
  return (
    <div className="text-center">
      <div className="font-display font-black text-5xl md:text-6xl tabular-nums leading-none">
        {String(value).padStart(2, "0")}
      </div>
      <div className="mt-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

export function Countdown({ target }: { target: string | null }) {
  const c = useCountdown(target);

  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
        {c.closed ? "Booking closed" : "Booking closes in"}
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2 md:gap-3">
        {c.closed ? (
          <p className="font-display font-black text-4xl md:text-5xl text-tomato">
            Booking Closed
          </p>
        ) : (
          <>
            <Unit value={c.days} label="Days" />
            <span className="font-display font-black text-4xl md:text-5xl text-tomato self-start pb-1">
              :
            </span>
            <Unit value={c.hours} label="Hours" />
            <span className="font-display font-black text-4xl md:text-5xl text-tomato self-start pb-1">
              :
            </span>
            <Unit value={c.mins} label="Mins" />
            <span className="font-display font-black text-4xl md:text-5xl text-tomato self-start pb-1">
              :
            </span>
            <Unit value={c.secs} label="Secs" />
          </>
        )}
        <div className="ml-auto self-end text-right">
          <div className="font-display font-semibold italic text-xl text-teal">8 Sep 2026</div>
          <div className="font-mono text-[11px] text-muted-foreground">3:00 PM IST</div>
        </div>
      </div>
    </div>
  );
}
