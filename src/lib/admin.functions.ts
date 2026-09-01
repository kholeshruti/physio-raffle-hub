import { createServerFn } from "@tanstack/react-start";
import { createHash, timingSafeEqual } from "node:crypto";

export type AdminBooking = {
  id: string;
  student_name: string;
  phone: string;
  txn_ref: string | null;
  amount: number;
  status: string;
  created_at: string;
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

async function loadAdmin(search: string): Promise<AdminData> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  await supabaseAdmin.rpc("release_expired_holds");
  const { data: stateRaw } = await supabaseAdmin.rpc("raffle_state");
  const state = stateRaw as unknown as {
    ticket_price: number;
    batch_size: number;
    total_sold: number;
    batch_start: number;
    batch_end: number;
    batch_number: number;
  };

  const { data: rows, error } = await supabaseAdmin
    .from("bookings")
    .select("id, student_name, phone, txn_ref, amount, status, created_at, tickets(ticket_number)")
    .in("status", ["pending", "sold", "held", "rejected"])
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);

  let bookings: AdminBooking[] = (rows ?? []).map((r) => ({
    id: r.id,
    student_name: r.student_name,
    phone: r.phone,
    txn_ref: r.txn_ref,
    amount: r.amount,
    status: r.status,
    created_at: r.created_at,
    numbers: ((r.tickets ?? []) as { ticket_number: number }[])
      .map((t) => t.ticket_number)
      .sort((a, b) => a - b),
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

  const { count: soldCount } = await supabaseAdmin
    .from("tickets")

    .select("ticket_number", { count: "exact", head: true })
    .eq("status", "sold");

  const { count: soldInCurrentBatch } = await supabaseAdmin
    .from("tickets")
    .select("ticket_number", { count: "exact", head: true })
    .eq("status", "sold")
    .gte("ticket_number", state.batch_start)
    .lte("ticket_number", state.batch_end);

  return {
    stats: {
      sold: soldCount ?? 0,
      remaining: state.batch_size - (soldInCurrentBatch ?? 0),
      collected: (soldCount ?? 0) * state.ticket_price,
      pending: pendingTotal,

      batch_number: state.batch_number,
      batch_start: state.batch_start,
      batch_end: state.batch_end,
      ticket_price: state.ticket_price,
    },
    bookings,
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
    const { error } = await supabaseAdmin
      .from("bookings")
      .update({ status: "sold", confirmed_at: new Date().toISOString() })
      .eq("id", data.bookingId);
    if (error) throw new Error(error.message);
    const { error: tErr } = await supabaseAdmin
      .from("tickets")
      .update({ status: "sold", held_until: null })
      .eq("booking_id", data.bookingId);
    if (tErr) throw new Error(tErr.message);
    return { ok: true as const };
  });

export const adminReject = createServerFn({ method: "POST" })
  .inputValidator((data: { password: string; bookingId: string }) => data)
  .handler(async ({ data }) => {
    checkPassword(data.password);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("tickets")
      .delete()
      .eq("booking_id", data.bookingId);
    if (error) throw new Error(error.message);
    const { error: bErr } = await supabaseAdmin
      .from("bookings")
      .update({ status: "rejected" })
      .eq("id", data.bookingId);
    if (bErr) throw new Error(bErr.message);
    return { ok: true as const };
  });
