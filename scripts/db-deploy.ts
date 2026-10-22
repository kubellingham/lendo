/**
 * Brings the database schema up to date during a deploy, without ever losing data.
 *
 *  - Preview builds do nothing: Vercel previews use the production database, so only
 *    production builds may change it.
 *  - A database that was managed with `prisma db push` (no migration history yet) is
 *    "baselined" once: the live schema must match prisma/schema.prisma exactly, and then
 *    the first migration (0_init) is recorded as already applied. Nothing else changes.
 *    If anything differs, the build stops here, before touching the database, and the
 *    running version stays live.
 *  - Then `prisma migrate deploy` applies only the reviewed files in prisma/migrations.
 *
 * Run by `npm run build`; also available as `npm run db:deploy`.
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { cliDatabaseUrl } from "./database-url";

const BASELINE = "0_init";

function prisma(args: string[], capture = false) {
  const result = spawnSync("npx", ["prisma", ...args], {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  return result;
}

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

async function inspect(
  url: string,
): Promise<{ hasHistory: boolean; tables: number }> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const history = await client.query<{ present: boolean }>(
      "select to_regclass('public._prisma_migrations') is not null as present",
    );
    const tables = await client.query<{ n: number }>(
      `select count(*)::int as n from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    return { hasHistory: history.rows[0].present, tables: tables.rows[0].n };
  } finally {
    await client.end();
  }
}

async function main() {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv && vercelEnv !== "production") {
    console.log(`Skipping database changes: this is a ${vercelEnv} build.`);
    return;
  }

  const url = cliDatabaseUrl();
  if (!url) fail("DATABASE_URL is not set.");

  const { hasHistory, tables } = await inspect(url);

  if (!hasHistory && tables > 0) {
    console.log(
      "No migration history yet: checking the live schema matches prisma/schema.prisma…",
    );
    const diff = prisma(
      [
        "migrate",
        "diff",
        "--from-config-datasource",
        "--to-schema",
        "prisma/schema.prisma",
        "--exit-code",
      ],
      true,
    );
    if (diff.status === 2) {
      console.error(diff.stdout);
      fail(
        "The live database doesn't match prisma/schema.prisma, so nothing was changed. " +
          "Compare the differences above before deploying again.",
      );
    }
    if (diff.status !== 0) {
      console.error(diff.stderr || diff.stdout);
      fail(
        "Couldn't compare the live database with the schema; nothing was changed.",
      );
    }
    const resolved = prisma(["migrate", "resolve", "--applied", BASELINE]);
    if (resolved.status !== 0) fail(`Couldn't record ${BASELINE} as applied.`);
    console.log(
      `✔ Baseline ${BASELINE} recorded; the existing data was not touched.`,
    );
  }

  const deployed = prisma(["migrate", "deploy"]);
  if (deployed.status !== 0) fail("prisma migrate deploy failed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
