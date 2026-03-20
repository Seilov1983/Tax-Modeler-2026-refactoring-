import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';

function getPrisma() {
  if (!process.env.DATABASE_URL) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { prisma } = require('@shared/lib/db/prisma') as { prisma: import('../../../../generated/prisma/client').PrismaClient };
  return prisma;
}

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional().default('Untitled Project'),
  schemaVersion: z.string().max(20).optional().default('2.4.1'),
  graphJSON: z.unknown().optional().default({}),
});

// GET /api/projects — list all projects for a user
export async function GET(req: NextRequest) {
  const prisma = getPrisma();
  if (!prisma) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const userId = req.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const projects = await prisma.project.findMany({
      where: { userId },
      select: { id: true, name: true, schemaVersion: true, createdAt: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    });
    return NextResponse.json(projects);
  } catch {
    return NextResponse.json({ error: 'Database unreachable' }, { status: 503 });
  }
}

// POST /api/projects — create a new project
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

  const parsed = CreateProjectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }

  const { name, schemaVersion, graphJSON } = parsed.data;

  try {
    const project = await prisma.project.create({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { name, userId, graphJSON: graphJSON as any, schemaVersion },
    });
    return NextResponse.json(project, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Database error' }, { status: 503 });
  }
}
