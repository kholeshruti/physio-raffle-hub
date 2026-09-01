import { createServerFn } from "@tanstack/react-start";
import { createHash, timingSafeEqual } from "node:crypto";

export type AdminBooking = {
  id: string;
  student_name: string;
  phone: string;
  txn_ref: string | null;
  amount: number;
  status: string;
  numbers: number[];
};

export type AdminData = {
  stats: {
    sold: number;
    remaining: number;
    collected: number;
    pending: number;
    batch_number: number;
    batch_start: number;
    batch_end: number;
    ticket_price: number;
  };
  bookings: AdminBooking[];
};

function checkPassword(input: string) {
  const expected = process.env["ADMIN_PASSWORD"];
  if (!expected) throw new Error("Admin password is not configured.");
  const a = createHash("sha256").update(input ?? "", "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  if (!timingSafeEqual(a, b)) throw new Error("Incorrect password.");
}

type AdminTicketRow = {
  ticket_number: number;
  batch_number: number;
  status: string;
  held_until: string | null;
  student_name: string | null;
  student_phone: string | null;
  transaction_id: string | null;
  confirmed_at: string | null;
};

async function loadAdmin(search: string): Promise<AdminData> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  await supabaseAdmin.rpc("release_expired_holds");

  const { data: settingsRows } = await supabaseAdmin
    .from("app_settings")
    .select("key, value");
  const settings: Record<string, string> = {};
  for (const row of settingsRows ?? []) settings[row.key] = row.value;
  const ticketPrice = parseInt(settings["ticket_price"] ?? "10", 10);
  const batchSize = parseInt(settings["batch_size"] ?? "100", 10);

  const { data: ticketRows, error } = await supabaseAdmin.rpc("get_admin_tickets");
  if (error) throw new Error(error.message);
  const rows = (ticketRows ?? []) as AdminTicketRow[];

  const maxBatch = rows.reduce((m, r) => Math.max(m, r.batch_number), 1);
  const batchStart = (maxBatch - 1) * batchSize + 1;
  const batchEnd = maxBatch * batchSize;

  const soldCount = rows.filter((r) => r.status === "sold").length;
  const soldInCurrentBatch = rows.filter(
    (r) => r.status === "sold" && r.ticket_number >= batchStart && r.ticket_number <= batchEnd,
  ).length;

  const byHolder: Record<
    string,
    {
      student_name: string;
      student_phone: string;
      transaction_id: string | null;
      confirmed_at: string | null;
      status: string;
      numbers: number[];
    }
  > = {};

  for (const r of rows) {
    if (r.status === "available") continue;
    if (!r.student_name) continue;
    const key = `${r.student_name}::${r.student_phone}`;
    if (!byHolder[key]) {
      byHolder[key] = {
        student_name: r.student_name,
        student_phone: r.student_phone,
        transaction_id: r.transaction_id,
        confirmed_at: r.confirmed_at,
        status: r.status,
        numbers: [],
      };
    }
    byHolder[key].numbers.push(r.ticket_number);
    if (r.status === "pending") byHolder[key].status = "pending";
    else if (r.status === "sold" && byHolder[key].status !== "pending")
      byHolder[key].status = "sold";
    else if (r.status === "held" && byHolder[key].status === "available")
      byHolder[key].status = "held";
    if (r.transaction_id) byHolder[key].transaction_id = r.transaction_id;
    if (r.confirmed_at) byHolder[key].confirmed_at = r.confirmed_at;
  }

  let bookings: AdminBooking[] = Object.values(byHolder).map((h) => ({
    id: h.numbers.sort((a, b) => a - b).join(","),
    student_name: h.student_name,
    phone: h.student_phone,
    txn_ref: h.transaction_id,
    amount: h.numbers.length * ticketPrice,
    status: h.status,
    numbers: h.numbers.sort((a, b) => a - b),
  }));

  const pendingTotal = bookings.filter((b) => b.status === "pending").length;

  const q = search.trim().toLowerCase();
  if (q) {
    bookings = bookings.filter(
      (b) =>
        b.student_name.toLowerCase().includes(q) ||
        b.phone.includes(q) ||
        (b.txn_ref ?? "").toLowerCase().includes(q) ||
        b.numbers.some((n) => String(n) === q),
    );
  }

  return {
    stats: {
      sold: soldCount,
      remaining: batchSize - soldInCurrentBatch,
      collected: soldCount * ticketPrice,
      pending: pendingTotal,
      batch_number: maxBatch,
      batch_start: batchStart,
      batch_end: batchEnd,
      ticket_price: ticketPrice,
    },
    bookings: bookings.sort((a, b) => (a.status === "pending" ? -1 : 0) - (b.status === "pending" ? -1 : 0)),
  };
}

export const adminLoad = createServerFn({ method: "POST" })
  .inputValidator((data: { password: string; search?: string }) => data)
  .handler(async ({ data }) => {
    checkPassword(data.password);
    return loadAdmin(data.search ?? "");
  });

export const adminConfirm = createServerFn({ method: "POST" })
  .inputValidator((data: { password: string; bookingId: string }) => data)
  .handler(async ({ data }) => {
    checkPassword(data.password);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const numbers = parseNumbersFromId(data.bookingId);
    const { error } = await supabaseAdmin.rpc("admin_confirm", { p_numbers: numbers });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const adminReject = createServerFn({ method: "POST" })
  .inputValidator((data: { password: string; bookingId: string }) => data)
  .handler(async ({ data }) => {
    checkPassword(data.password);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const numbers = parseNumbersFromId(data.bookingId);
    const { error } = await supabaseAdmin.rpc("admin_reject", { p_numbers: numbers });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

function parseNumbersFromId(id: string): number[] {
  return id
    .split(",")
    .map((n) => parseInt(n.trim(), 10))
    .filter((n) => !isNaN(n));
}
