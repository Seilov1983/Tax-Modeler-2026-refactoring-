import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/lib/db/prisma';

// GET /api/projects — list all projects for a user
export async function GET(req: NextRequest) {
  const userId = req.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const projects = await prisma.project.findMany({
    where: { userId },
    select: { id: true, name: true, schemaVersion: true, createdAt: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  });

  return NextResponse.json(projects);
}

// POST /api/projects — create a new project
export async function POST(req: NextRequest) {
  const userId = req.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const name = typeof body.name === 'string' ? body.name : 'Untitled Project';
  const graphJSON = body.graphJSON ?? {};

  const project = await prisma.project.create({
    data: {
      name,
      userId,
      graphJSON,
      schemaVersion: typeof body.schemaVersion === 'string' ? body.schemaVersion : '2.4.1',
    },
  });

  return NextResponse.json(project, { status: 201 });
}
