import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

const DEFAULT_TEMPLATES: { key: string; body: string }[] = [
  {
    key: "due_in_3_days",
    body: "Hello {{customerName}}, this is a reminder that your loan payment of {{amount}} is due on {{dueDate}}. Please prepare to pay on time. — Lendo",
  },
  {
    key: "due_today",
    body: "Hello {{customerName}}, your loan payment of {{amount}} is due TODAY ({{dueDate}}). Kindly settle to avoid penalties. — Lendo",
  },
  {
    key: "overdue_1d",
    body: "Hello {{customerName}}, your loan payment of {{amount}} was due on {{dueDate}} and is now overdue. Please pay as soon as possible. — Lendo",
  },
  {
    key: "overdue_7d",
    body: "Hello {{customerName}}, your loan payment of {{amount}} is 7 days overdue (was due {{dueDate}}). Please contact our office immediately. — Lendo",
  },
];

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
  console.log("✔ Default settings ready");

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
