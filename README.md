# Physio Raffle Hub

Build a live raffle ticket booking website for a college event called "Physio Day Celebration."

TECH: React frontend, Supabase backend (Postgres), with database-level concurrency protection (unique constraints + transactions), not just frontend checks.

STEP 1 — Landing page

Big branded "Physio Day Celebration" hero, festive animations, live countdown to 8 September 2026, 3:00 PM IST. After that time, booking auto-disables and shows "Booking Closed."

STEP 2 — Ticket grid

"Book Your Raffle Ticket" button opens a live grid of numbers 1–100. Taken/held numbers appear greyed out for everyone in real time (Supabase realtime, no manual refresh). Student can select 1–6 numbers total, enforced on both frontend and backend.

STEP 3 — Student details

Before confirming, student enters their name and phone number.

STEP 4 — Hold the number(s)

The instant a student selects numbers, mark them "held" (reserved) for 15 minutes using a unique constraint + transaction on ticket_number, so two people can never lock the same number even if they click simultaneously. If not confirmed as paid within 15 minutes, auto-release back to "available."

STEP 5 — Payment screen

Show ONE static payment QR code image (I will upload it) — the same QR every time, tied to one bank account. Below it, a field for the student to enter their UPI transaction/reference ID after paying, then submit.

STEP 6 — Pending state

After submitting the transaction ID, ticket status becomes "pending confirmation." Show the student a "Waiting for confirmation" screen. The ticket is NOT final yet — it does not count as sold, and the student cannot download it yet.

STEP 7 — Admin confirms manually

Admin panel at /admin (password protected) lists all pending tickets with student name, phone, numbers, and transaction ID entered. Admin manually checks their own bank/UPI app and clicks "Confirm Payment" to flip status to "sold," or "Reject" to release the hold if payment wasn't actually received.

STEP 8 — Ticket download

Once "sold," student can download/print their ticket as PDF or JPG showing their name, ticket number(s), and Physio Day Celebration branding. No QR needed on the ticket itself.

STEP 9 — Batch expansion

Once all 100 numbers in the current batch are "sold" (not just held), automatically open the next batch (101–200), then repeat in batches of 100 indefinitely.

STEP 10 — Admin dashboard stats

Top of admin panel: total sold, total remaining in current batch, total money collected (sold × price), count of pending confirmations awaiting review. Include search by name or ticket number.

DESIGN: Bright, festive, playful fonts and subtle animations, mobile-first but also looks good full-screen on a projector/monitor.

CONCURRENCY: Expect many students booking simultaneously from their own phones plus a shared screen. Use database transactions and unique constraints so duplicate number claims are structurally impossible, not just prevented by UI checks.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/0b9d092f-bc9a-4277-8947-9e99f900e586).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
