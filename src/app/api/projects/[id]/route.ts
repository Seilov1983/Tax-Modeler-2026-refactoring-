import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';

function getPrisma() {
  if (!process.env.DATABASE_URL) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { prisma } = require('@shared/lib/db/prisma') as { prisma: import('../../../../../generated/prisma/client').PrismaClient };
  return prisma;
}

const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  schemaVersion: z.string().max(20).optional(),
  graphJSON: z.unknown().optional(),
}).refine(d => d.name || d.schemaVersion || d.graphJSON, { message: 'At least one field required' });

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/projects/:id — load a specific project
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const prisma = getPrisma();
  if (!prisma) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const { id } = await ctx.params;

  try {
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(project);
  } catch {
    return NextResponse.json({ error: 'Database error' }, { status: 503 });
  }
}

// PUT /api/projects/:id — update project name and/or graphJSON
export async function PUT(req: NextRequest, ctx: RouteContext) {
  const prisma = getPrisma();
  if (!prisma) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = UpdateProjectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }

  try {
    const data = parsed.data as Record<string, unknown>;
    const project = await prisma.project.update({ where: { id }, data });
    return NextResponse.json(project);
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}

// DELETE /api/projects/:id — delete a project
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const prisma = getPrisma();
  if (!prisma) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const { id } = await ctx.params;

  try {
    await prisma.project.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}
