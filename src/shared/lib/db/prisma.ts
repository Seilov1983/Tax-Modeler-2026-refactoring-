import { PrismaClient } from '../../../../generated/prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Detect DATABASE_URL format and create the appropriate adapter.
 * - postgres:// or postgresql:// → PrismaPg (Pool from pg)
 * - file: → PrismaBetterSqlite3
 */
function makePrisma(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set.');
  }

  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require('pg') as typeof import('pg');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaPg } = require('@prisma/adapter-pg') as typeof import('@prisma/adapter-pg');
    const pool = new Pool({ connectionString: url });
    const adapter = new PrismaPg(pool);
    return new PrismaClient({ adapter });
  }

  // SQLite fallback (local dev: file:./prisma/dev.db)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3') as typeof import('@prisma/adapter-better-sqlite3');
  const adapter = new PrismaBetterSqlite3({ url });
  return new PrismaClient({ adapter });
}

/** Lazy singleton — only created on first access, never crashes at import time. */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const instance = globalForPrisma.prisma ?? (globalForPrisma.prisma = makePrisma());
    return Reflect.get(instance, prop, receiver);
  },
});
