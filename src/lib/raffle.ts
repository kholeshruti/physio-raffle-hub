import { supabase } from "@/integrations/supabase/client";

export const EVENT_NAME = "Physio Day Celebration";
export const MAX_PER_STUDENT = 6;

export type TicketStatus = "held" | "pending" | "sold" | "rejected" | "expired";

export type RaffleState = {
  ticket_price: number;
  batch_size: number;
  booking_closes_at: string;
  total_sold: number;
  batch_start: number;
  batch_end: number;
  batch_number: number;
};

export type Booking = {
  id: string;
  student_name: string;
  phone: string;
  txn_ref: string | null;
  amount: number;
  status: TicketStatus;
  held_until: string;
  created_at: string;
  numbers: number[];
};

export const BOOKING_KEY = "physioday.booking_id";
export const BOOKING_TOKEN_KEY = "physioday.booking_token";

export function getBookingToken(): string {
  if (typeof localStorage === "undefined") return "";
  return localStorage.getItem(BOOKING_TOKEN_KEY) ?? "";
}

export function saveBookingToken(token: string) {
  localStorage.setItem(BOOKING_TOKEN_KEY, token);
}

export function clearBookingToken() {
  localStorage.removeItem(BOOKING_TOKEN_KEY);
}

export async function fetchRaffleState(): Promise<RaffleState> {
  const { data, error } = await supabase.rpc("raffle_state");
  if (error) throw error;
  return data as unknown as RaffleState;
}

export async function fetchTakenNumbers(): Promise<Record<number, TicketStatus>> {
  const { data, error } = await supabase.from("tickets").select("ticket_number, status");
  if (error) throw error;
  const map: Record<number, TicketStatus> = {};
  for (const row of data ?? []) map[row.ticket_number] = row.status as TicketStatus;
  return map;
}

export async function holdTickets(input: { name: string; phone: string; numbers: number[] }) {
  const { data, error } = await supabase.rpc("hold_tickets", {
    p_name: input.name,
    p_phone: input.phone,
    p_numbers: input.numbers,
  });
  if (error) throw new Error(friendlyError(error.message));
  const res = data as unknown as {
    booking_id: string;
    access_token: string;
    expires_at: string;
    amount: number;
    numbers: number[];
  };
  saveBookingToken(res.access_token);
  return res;
}

export async function submitPayment(bookingId: string, txnRef: string) {
  const { error } = await supabase.rpc("submit_payment", {
    p_booking_id: bookingId,
    p_token: getBookingToken(),
    p_txn_ref: txnRef,
  });
  if (error) throw new Error(friendlyError(error.message));
}

export async function cancelBooking(bookingId: string) {
  await supabase.rpc("cancel_booking", {
    p_booking_id: bookingId,
    p_token: getBookingToken(),
  });
}

export async function fetchBooking(bookingId: string): Promise<Booking | null> {
  const { data, error } = await supabase.rpc("get_booking", {
    p_booking_id: bookingId,
    p_token: getBookingToken(),
  });
  if (error) throw error;
  return (data as unknown as Booking) ?? null;
}


export function friendlyError(raw: string): string {
  if (raw.includes("NUMBER_TAKEN"))
    return "Someone just grabbed one of those numbers. Pick again.";
  if (raw.includes("BOOKING_CLOSED")) return "Booking is closed for this event.";
  if (raw.includes("INVALID_SELECTION")) return "Pick between 1 and 6 different numbers.";
  if (raw.includes("INVALID_NAME")) return "Please enter your full name.";
  if (raw.includes("INVALID_PHONE")) return "Please enter a valid phone number.";
  if (raw.includes("OUT_OF_BATCH")) return "That number is no longer in the open batch.";
  if (raw.includes("HOLD_EXPIRED")) return "Your 15 minute hold expired. Please book again.";
  if (raw.includes("INVALID_TXN")) return "Enter the UPI transaction / reference ID.";
  if (raw.includes("INVALID_STATE")) return "This booking can no longer be updated.";
  return "Something went wrong. Please try again.";
}

export function rupees(value: number): string {
  return `₹${value.toLocaleString("en-IN")}`;
}
