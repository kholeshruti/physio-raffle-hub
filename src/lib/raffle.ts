import { supabase } from "@/integrations/supabase/client";

export const EVENT_NAME = "Physio Day Celebration";
export const MAX_PER_STUDENT = 6;

export type TicketStatus = "available" | "held" | "pending" | "sold";

export type RaffleState = {
  ticket_price: number;
  batch_size: number;
  booking_closes_at: string;
  total_sold: number;
  batch_start: number;
  batch_end: number;
  batch_number: number;
  taken: Record<string, TicketStatus>;
};

export const MY_NUMBERS_KEY = "physioday.my_numbers";
export const MY_NAME_KEY = "physioday.my_name";

export function getMyNumbers(): number[] {
  if (typeof localStorage === "undefined") return [];
  const raw = localStorage.getItem(MY_NUMBERS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as number[];
  } catch {
    return [];
  }
}

export function saveMyNumbers(numbers: number[]) {
  localStorage.setItem(MY_NUMBERS_KEY, JSON.stringify(numbers));
}

export function clearMyNumbers() {
  localStorage.removeItem(MY_NUMBERS_KEY);
  localStorage.removeItem(MY_NAME_KEY);
}

export function getMyName(): string {
  if (typeof localStorage === "undefined") return "";
  return localStorage.getItem(MY_NAME_KEY) ?? "";
}

export function saveMyName(name: string) {
  localStorage.setItem(MY_NAME_KEY, name);
}

export async function fetchRaffleState(): Promise<RaffleState> {
  const { data, error } = await supabase.rpc("get_raffle_state");
  if (error) throw error;
  return data as unknown as RaffleState;
}

export async function holdTickets(input: {
  name: string;
  phone: string;
  numbers: number[];
}) {
  const { data, error } = await supabase.rpc("hold_tickets", {
    p_numbers: input.numbers,
    p_name: input.name,
    p_phone: input.phone,
  });
  if (error) throw new Error(friendlyError(error.message));
  const rows = (data ?? []) as { held_until: string | null }[];
  saveMyNumbers(input.numbers);
  saveMyName(input.name);
  return {
    numbers: input.numbers,
    expires_at: rows[0]?.held_until ?? null,
  };
}

export async function submitPayment(numbers: number[], txnRef: string) {
  const { error } = await supabase.rpc("submit_payment", {
    p_numbers: numbers,
    p_transaction_id: txnRef,
  });
  if (error) throw new Error(friendlyError(error.message));
}

export async function cancelHold(numbers: number[]) {
  const { error } = await supabase.rpc("cancel_hold", {
    p_numbers: numbers,
  });
  if (error) throw new Error(friendlyError(error.message));
}

export function friendlyError(raw: string): string {
  if (raw.includes("just taken") || raw.includes("NUMBER_TAKEN"))
    return "Someone just grabbed one of those numbers. Pick again.";
  if (raw.includes("Booking is closed") || raw.includes("BOOKING_CLOSED"))
    return "Booking is closed for this event.";
  if (raw.includes("Select between") || raw.includes("INVALID_SELECTION"))
    return "Pick between 1 and 6 different numbers.";
  if (raw.includes("no longer held") || raw.includes("HOLD_EXPIRED"))
    return "Your 15 minute hold expired. Please book again.";
  if (raw.includes("INVALID_TXN"))
    return "Enter the UPI transaction / reference ID.";
  return "Something went wrong. Please try again.";
}

export function rupees(value: number): string {
  return `₹${value.toLocaleString("en-IN")}`;
}
