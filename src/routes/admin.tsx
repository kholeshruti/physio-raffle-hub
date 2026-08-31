import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { adminConfirm, adminLoad, adminReject, type AdminData } from "@/lib/admin.functions";
import { rupees } from "@/lib/raffle";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Organiser Panel — Physio Day Celebration Raffle" },
      {
        name: "description",
        content:
          "Password protected organiser panel to confirm UPI payments and track raffle sales for the Physio Day Celebration.",
      },
      { property: "og:title", content: "Organiser Panel — Physio Day Celebration Raffle" },
      {
        property: "og:description",
        content: "Confirm payments, release holds and track raffle sales.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminPage,
});

const PW_KEY = "physioday.admin_pw";

function AdminPage() {
  const load = useServerFn(adminLoad);
  const confirm = useServerFn(adminConfirm);
  const reject = useServerFn(adminReject);

  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [search, setSearch] = useState("");
  const [data, setData] = useState<AdminData | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(
    async (pw: string, q: string) => {
      const res = await load({ data: { password: pw, search: q } });
      setData(res);
      setUnlocked(true);
    },
    [load],
  );

  useEffect(() => {
    const saved = sessionStorage.getItem(PW_KEY);
    if (!saved) return;
    setPassword(saved);
    refresh(saved, "").catch(() => sessionStorage.removeItem(PW_KEY));
  }, [refresh]);

  useEffect(() => {
    if (!unlocked) return;
    const id = setInterval(() => {
      refresh(password, search).catch(() => undefined);
    }, 10000);
    return () => clearInterval(id);
  }, [unlocked, password, search, refresh]);

  async function onUnlock(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await refresh(password, "");
      sessionStorage.setItem(PW_KEY, password);
    } catch {
      toast.error("Incorrect password.");
    } finally {
      setBusy(false);
    }
  }

  async function act(kind: "confirm" | "reject", bookingId: string) {
    setBusy(true);
    try {
      if (kind === "confirm") await confirm({ data: { password, bookingId } });
      else await reject({ data: { password, bookingId } });
      toast.success(kind === "confirm" ? "Payment confirmed — ticket sold." : "Hold released.");
      await refresh(password, search);
    } catch {
      toast.error("Action failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!unlocked) {
    return (
      <div className="min-h-screen grid place-items-center px-5 bg-background">
        <form
          onSubmit={onUnlock}
          className="w-full max-w-sm bg-cream rounded-3xl ring-1 ring-foreground/10 p-7"
        >
          <span className="grid place-items-center size-11 rounded-xl bg-tomato text-tomato-foreground font-display font-black -rotate-6">
            PD
          </span>
          <h1 className="mt-4 font-display font-black text-2xl tracking-tight">Organiser panel</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter the organiser password to review payments.
          </p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="Password"
            className="mt-5 w-full rounded-xl bg-background px-4 py-3 text-sm ring-1 ring-inset ring-foreground/15 focus:ring-2 focus:ring-tomato outline-none"
          />
          <button
            type="submit"
            disabled={busy || !password}
            className="mt-3 w-full rounded-full bg-tomato text-tomato-foreground font-semibold py-3 text-sm disabled:opacity-50"
          >
            {busy ? "Checking…" : "Unlock"}
          </button>
          <Link
            to="/"
            className="mt-4 block text-center text-sm text-muted-foreground hover:text-foreground"
          >
            Back to the raffle
          </Link>
        </form>
      </div>
    );
  }

  const stats = data?.stats;
  const bookings = data?.bookings ?? [];
  const pending = bookings.filter((b) => b.status === "pending");
  const others = bookings.filter((b) => b.status !== "pending");

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b border-foreground/10 bg-background/85 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="grid place-items-center size-9 rounded-lg bg-tomato text-tomato-foreground font-display font-black -rotate-6">
              PD
            </span>
            <span className="font-display font-black text-lg tracking-tight">
              Organiser panel · Batch {String(stats?.batch_number ?? 1).padStart(2, "0")}
            </span>
          </div>
          <Link to="/" className="text-sm font-semibold hover:text-tomato">
            View raffle
          </Link>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-5 py-8 space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Tickets sold" value={String(stats?.sold ?? 0)} />
          <Stat
            label={`Remaining in ${stats?.batch_start ?? 1}–${stats?.batch_end ?? 100}`}
            value={String(stats?.remaining ?? 0)}
          />
          <Stat label="Money collected" value={rupees(stats?.collected ?? 0)} />
          <Stat label="Pending review" value={String(stats?.pending ?? 0)} accent />
        </div>

        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            refresh(password, e.target.value).catch(() => undefined);
          }}
          placeholder="Search by name, phone, ticket number or reference"
          className="w-full rounded-xl bg-cream px-4 py-3 text-sm ring-1 ring-inset ring-foreground/15 focus:ring-2 focus:ring-tomato outline-none"
        />

        <Section title="Pending confirmations" rows={pending} onAct={act} busy={busy} />
        <Section title="All bookings" rows={others} onAct={act} busy={busy} />
      </main>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-cream rounded-2xl ring-1 ring-foreground/10 p-4">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 font-display font-black text-3xl tabular-nums ${accent ? "text-tomato" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}

function Section({
  title,
  rows,
  onAct,
  busy,
}: {
  title: string;
  rows: AdminData["bookings"];
  onAct: (kind: "confirm" | "reject", id: string) => void;
  busy: boolean;
}) {
  return (
    <div className="rounded-3xl bg-teal/10 ring-1 ring-teal/20 p-5">
      <h2 className="font-display font-bold text-lg tracking-tight">{title}</h2>
      <div className="mt-3 bg-cream rounded-2xl ring-1 ring-foreground/10 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground border-b border-foreground/10">
              <th className="px-4 py-2.5">Student</th>
              <th className="px-4 py-2.5">Phone</th>
              <th className="px-4 py-2.5">Numbers</th>
              <th className="px-4 py-2.5">Txn ref</th>
              <th className="px-4 py-2.5">Amount</th>
              <th className="px-4 py-2.5 text-right">Status / action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-foreground/5">
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                  Nothing here yet.
                </td>
              </tr>
            )}
            {rows.map((b) => (
              <tr key={b.id}>
                <td className="px-4 py-3 font-medium">{b.student_name}</td>
                <td className="px-4 py-3 font-mono text-muted-foreground">{b.phone}</td>
                <td className="px-4 py-3 font-mono">{b.numbers.join(", ")}</td>
                <td className="px-4 py-3 font-mono text-muted-foreground">{b.txn_ref ?? "—"}</td>
                <td className="px-4 py-3 font-mono">{rupees(b.amount)}</td>
                <td className="px-4 py-3 text-right">
                  {b.status === "pending" ? (
                    <span className="inline-flex gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onAct("confirm", b.id)}
                        className="rounded-full bg-teal text-teal-foreground text-[12px] font-semibold px-3 py-1.5 hover:opacity-90 disabled:opacity-50"
                      >
                        Confirm payment
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onAct("reject", b.id)}
                        className="rounded-full border border-foreground/20 text-[12px] font-semibold px-3 py-1.5 hover:bg-foreground/5 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </span>
                  ) : (
                    <span className="font-mono text-[12px] capitalize text-muted-foreground">
                      {b.status}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
