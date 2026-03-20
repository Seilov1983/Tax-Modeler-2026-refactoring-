import { PrismaClient } from '../../../../generated/prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function makePrisma(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set.');
  }
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
