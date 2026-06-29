# Lendo

Staff-only lending management app for a Tanzania-based money-lending operation.
Built with Next.js 16 (App Router), TypeScript, Tailwind v4, Prisma 7 (Postgres),
Auth.js v5. Currency: TZS. Timezone: Africa/Dar_es_Salaam.

## Loan rules (v1)

- Principal `P` per loan, 15% simple interest per 30-day cycle.
- Up to 3 cycles (day 30 / 60 / 90).
- At each cycle the customer can either pay interest-only (`0.15P`) and roll, or settle (`P + 0.15P`).
- Day 90 is mandatory full settlement; otherwise the loan is `DEFAULTED`.

## Stack

- Next.js 16 (App Router, Turbopack) + React 19 + TypeScript
- Tailwind CSS v4 (`@utility`-based design tokens in `app/globals.css`)
- Prisma 7 with the `@prisma/adapter-pg` Postgres adapter
- Auth.js v5 (NextAuth, JWT sessions, credentials provider)
- decimal.js for all money math; `Decimal(14,2)` columns in DB
- date-fns / date-fns-tz
- Twilio WhatsApp for customer reminders (falls back to `console.log` in dev)
- Vitest for unit tests

## Setup

```bash
npm install --ignore-scripts   # @prisma/engines postinstall can be flaky behind some proxies
cp .env.example .env           # fill in DATABASE_URL etc
npx prisma migrate dev         # apply schema
npx tsx prisma/seed.ts         # seed initial ADMIN (admin@lendo.local / admin123 by default)
npm run dev                    # http://localhost:3000
```

## Scripts

| Command                | What it does                          |
| ---------------------- | ------------------------------------- |
| `npm run dev`          | Dev server                            |
| `npm run build`        | Production build                      |
| `npm start`            | Run the production build              |
| `npm run typecheck`    | `tsc --noEmit`                        |
| `npm run test`         | Vitest unit tests (schedule, money)   |
| `npm run prisma:migrate` | `prisma migrate dev`                |
| `npm run prisma:seed`  | Seed initial admin                    |
| `tsx scripts/smoke.ts` | End-to-end DB smoke test              |

## Roles

- **ADMIN** — manage users plus everything below.
- **LOAN_OFFICER** — customers, loans, payments, flags, ad-hoc reminders.
- **ACCOUNTANT** — read-only ledger and reports.

## Cron

`/api/cron/daily` (protected by `CRON_SECRET`) recomputes overdue status, queues
WhatsApp reminders (`due_in_3_days`, `due_today`, `overdue_1d`, `overdue_7d`),
and dispatches them. On Vercel, wire it to Vercel Cron.

```bash
curl "http://localhost:3000/api/cron/daily?token=$CRON_SECRET"
```

## Deployment notes

- Target: Vercel + Neon Postgres. Set env vars in Vercel project settings.
- Twilio creds can be empty in non-production — messages are logged to stdout
  and marked SENT so the flow can be exercised end-to-end.
- The deprecated `middleware.ts` was renamed to `proxy.ts` per Next.js 16.

## Out of scope (v1, deferred)

Customer-facing portal, KYC document uploads, M-Pesa integration, mobile native
app, compound / reducing-balance rates, multi-branch.
