import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Prisma 7 uses a driver adapter (no bundled Rust query engine). We connect to
// Postgres (Neon) through node-postgres. The client is cached on globalThis in
// development to survive Next.js hot reloads.
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

/**
 * node-postgres already treats sslmode=require/prefer/verify-ca as the strict
 * "verify-full" and logs a warning on every cold start saying so. Spell it out
 * so the behaviour stays exactly the same and the log stays clean.
 */
export function explicitSslMode(url: string): string {
  return url.replace(/([?&]sslmode=)(require|prefer|verify-ca)(?=&|$)/, "$1verify-full");
}

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const adapter = new PrismaPg({ connectionString: explicitSslMode(connectionString) });
  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
