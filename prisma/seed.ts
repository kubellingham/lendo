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
  const email = (process.env.SEED_ADMIN_EMAIL || "admin@lendo.co.tz").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || "ChangeMe123!";
  const passwordHash = await bcrypt.hash(password, 10);

  const admin = await db.user.upsert({
    where: { email },
    update: {},
    create: {
      name: "System Administrator",
      email,
      passwordHash,
      role: "ADMIN",
    },
  });
  console.log(`✔ Admin user ready: ${admin.email}`);

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

  console.log("\nSeed complete. Login with:");
  console.log(`  email:    ${email}`);
  console.log(`  password: ${password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
