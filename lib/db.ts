import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

declare global {

  var __prisma: PrismaClient | undefined;
}

function sanitizeUrl(url: string | undefined): string | undefined {
  if (!url) return url;

  return url.replace(/([?&])channel_binding=[^&]*/g, '$1').replace(/[?&]$/, '');
}

function makeClient() {
  const adapter = new PrismaPg({ connectionString: sanitizeUrl(process.env.DATABASE_URL) });
  return new PrismaClient({ adapter });
}

export const prisma = global.__prisma ?? makeClient();

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}
