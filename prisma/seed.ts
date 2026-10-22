import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { MESSAGE_TEMPLATES } from "../src/lib/message-templates";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

const DEFAULT_TEMPLATES = MESSAGE_TEMPLATES.map((t) => ({
  key: t.key,
  body: t.body,
}));

async function main() {
  // Vercel previews share the production database, so only production builds
  // (and local runs) may seed it.
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv && vercelEnv !== "production") {
    console.log(`Skipping the seed: this is a ${vercelEnv} build.`);
    return;
  }

  // The first admin account. Never created with a default password, and the
  // password is never printed.
  const email = (process.env.SEED_ADMIN_EMAIL || "admin@lendo.co.tz").toLowerCase();
  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    console.log("✔ Admin account already exists (password unchanged)");
  } else {
    const password = process.env.SEED_ADMIN_PASSWORD ?? "";
    if (password.length < 12) {
      console.warn(
        "⚠ No admin account created: set SEED_ADMIN_PASSWORD (12 characters or more) to create one.",
      );
    } else {
      await db.user.create({
        data: {
          name: process.env.SEED_ADMIN_NAME?.trim() || "System Administrator",
          email,
          passwordHash: await bcrypt.hash(password, 10),
          role: "ADMIN",
        },
      });
      console.log("✔ Admin account created");
    }
  }

  for (const t of DEFAULT_TEMPLATES) {
    await db.notificationTemplate.upsert({
      where: { key: t.key },
      update: { body: t.body },
      create: { key: t.key, body: t.body },
    });
  }
  console.log(`✔ ${DEFAULT_TEMPLATES.length} WhatsApp templates ready`);

  await db.setting.upsert({
    where: { key: "default_interest_rate_pct" },
    update: {},
    create: { key: "default_interest_rate_pct", value: "15" },
  });
  await db.setting.upsert({
    where: { key: "reminder_days_before_due" },
    update: {},
    create: { key: "reminder_days_before_due", value: "3" },
  });
  await db.setting.upsert({
    where: { key: "tithe_rate_pct" },
    update: {},
    create: { key: "tithe_rate_pct", value: "10" },
  });
  // Bank details customers should pay into — shown in every reminder message
  // and PDF. Configurable in Settings.
  await db.setting.upsert({
    where: { key: "payment_bank" },
    update: {},
    create: { key: "payment_bank", value: "CRDB BANK" },
  });
  await db.setting.upsert({
    where: { key: "payment_account_name" },
    update: {},
    create: { key: "payment_account_name", value: "Kathleen Kube" },
  });
  await db.setting.upsert({
    where: { key: "payment_account_number" },
    update: {},
    create: { key: "payment_account_number", value: "10327855568" },
  });
  console.log("✔ Default settings ready");

  // Backfill saved Referral contacts from any inline referral data on
  // customers (from before referrals became reusable records).
  const withInline = await db.customer.findMany({
    where: { referralId: null, referralPhone: { not: null } },
    select: {
      id: true,
      referralName: true,
      referralPhone: true,
      referralRelationship: true,
      createdById: true,
    },
  });
  let linked = 0;
  for (const c of withInline) {
    if (!c.referralPhone) continue;
    const r = await db.referral.upsert({
      where: { phone: c.referralPhone },
      update: {},
      create: {
        name: c.referralName ?? "Referral",
        phone: c.referralPhone,
        relationship: c.referralRelationship ?? null,
        createdById: c.createdById,
      },
    });
    await db.customer.update({ where: { id: c.id }, data: { referralId: r.id } });
    linked++;
  }
  if (linked > 0) console.log(`✔ Linked ${linked} customer(s) to saved referrals`);

  // Recompute the risk meter for everyone so scores are correct after deploy.
  try {
    const { recomputeAllRisk } = await import("../src/lib/customer-risk");
    const n = await recomputeAllRisk();
    console.log(`✔ Risk scores recomputed for ${n} customer(s)`);
  } catch (e) {
    console.error("Risk recompute skipped:", e);
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
