import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/lib/db/prisma';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/projects/:id — load a specific project
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;

  const project = await prisma.project.findUnique({
    where: { id },
  });

  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json(project);
}

// PUT /api/projects/:id — update project name and/or graphJSON
export async function PUT(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const body = await req.json();

  const data: Record<string, unknown> = {};
  if (typeof body.name === 'string') data.name = body.name;
  if (body.graphJSON !== undefined) data.graphJSON = body.graphJSON;
  if (typeof body.schemaVersion === 'string') data.schemaVersion = body.schemaVersion;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  try {
    const project = await prisma.project.update({
      where: { id },
      data,
    });
    return NextResponse.json(project);
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}
