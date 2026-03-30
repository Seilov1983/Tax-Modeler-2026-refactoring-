import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';

function getPrisma() {
  if (!process.env.DATABASE_URL) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { prisma } = require('@shared/lib/db/prisma') as { prisma: import('../../../../../generated/prisma/client').PrismaClient };
  return prisma;
}

const SyncPayloadSchema = z.object({
  projectId: z.string().optional(),
  name: z.string().min(1).max(200),
  schemaVersion: z.string().max(20),
  graphJSON: z.unknown(),
});

/**
 * POST /api/projects/sync — upsert project state from debounced cloud sync.
 *
 * If projectId is provided and found, updates the existing record.
 * Otherwise creates a new record and returns the new ID.
 */
export async function POST(req: NextRequest) {
  const prisma = getPrisma();
  if (!prisma) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const userId = req.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = SyncPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }

  const { projectId, name, schemaVersion, graphJSON } = parsed.data;

  try {
    if (projectId) {
      // Upsert: update if exists, create if not
      const existing = await prisma.project.findUnique({ where: { id: projectId } });
      if (existing) {
        const updated = await prisma.project.update({
          where: { id: projectId },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: { name, schemaVersion, graphJSON: graphJSON as any },
        });
        return NextResponse.json({ id: updated.id, synced: true });
      }
    } else {
      // No projectId — find user's most recent project to prevent orphaned records
      const mostRecent = await prisma.project.findFirst({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
      });
      if (mostRecent) {
        const updated = await prisma.project.update({
          where: { id: mostRecent.id },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: { name, schemaVersion, graphJSON: graphJSON as any },
        });
        return NextResponse.json({ id: updated.id, synced: true });
      }
    }

    // Create new (only when truly no existing project for this user)
    const created = await prisma.project.create({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { name, userId, schemaVersion, graphJSON: graphJSON as any },
    });
    return NextResponse.json({ id: created.id, synced: true }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Database error' }, { status: 503 });
  }
}
