This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Deploys and database changes

- `npm run build` (what Vercel runs) applies database migrations with `scripts/db-deploy.ts`, on **production builds only**: Vercel previews use the production database, so they never change it and never run the seed.
- To change the schema: edit `prisma/schema.prisma`, then run `npm run migrate -- --name what-changed` against a development database. Commit the new folder in `prisma/migrations`; the next production deploy applies it. Never use `prisma db push` against production.
- The seed (`prisma/seed.ts`) creates the first admin only when `SEED_ADMIN_PASSWORD` (12+ characters) is set, and never prints it.

## Evelyn and nightly upkeep

- `GET /api/evelyn/summary` (header `Authorization: Bearer <EVELYN_API_SECRET>`): a read-only summary for Evelyn, the owner's assistant: payments due in the next 7 days, overdue loans, this week's figures, cash available and tithes. Names, references, dates and amounts only. See `src/lib/evelyn/summary.ts`.
- `GET /api/cron/nightly` (Vercel Cron, see `vercel.json`, authenticated with `CRON_SECRET`): adds the cycles running loans need and refreshes statuses and risk scores.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
