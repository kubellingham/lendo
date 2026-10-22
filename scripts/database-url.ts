/**
 * The connection string Prisma's command-line tools use (migrations, diffs).
 *
 * Prisma Migrate takes a lock that needs a direct connection, not Neon's connection
 * pooler. So the CLI uses DIRECT_DATABASE_URL when it's set, or DATABASE_URL with
 * Neon's "-pooler" host swapped for the direct one. The app itself keeps using
 * DATABASE_URL as it is (src/lib/db.ts).
 */
export function cliDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const explicit = env.DIRECT_DATABASE_URL?.trim();
  if (explicit) return explicit;
  const url = env.DATABASE_URL?.trim();
  if (!url) return undefined;
  return url.replace(/@([^/?#@]+?)-pooler\./, "@$1.");
}
