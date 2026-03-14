/**
 * Imperative actions for project serialization and canvas export.
 *
 * These are plain functions (not Jotai atoms) because they perform
 * side-effects (file download, FileReader) that don't belong in the
 * reactive state graph.
 */

import { toPng } from 'html-to-image';
import type { Project } from '@shared/types';

// ─── Save project as JSON file ──────────────────────────────────────────────

export function downloadProjectJson(project: Project, filename = 'tax-structure.json'): void {
  const json = JSON.stringify(project, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ─── Load project from JSON file ────────────────────────────────────────────

export function importProjectJson(file: File): Promise<Project> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (!parsed || !parsed.schemaVersion || !Array.isArray(parsed.nodes)) {
          reject(new Error('Invalid project file: missing required fields'));
          return;
        }
        resolve(parsed as Project);
      } catch {
        reject(new Error('Invalid JSON'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

// ─── Export canvas to PNG ───────────────────────────────────────────────────

export async function exportCanvasToPng(
  elementId: string,
  filename = 'structure.png',
): Promise<void> {
  const node = document.getElementById(elementId);
  if (!node) {
    console.error(`exportCanvasToPng: element #${elementId} not found`);
    return;
  }

  try {
    const dataUrl = await toPng(node, {
      quality: 0.95,
      backgroundColor: '#f9fafb',
      filter: (domNode: HTMLElement) => !domNode.classList?.contains('exclude-from-export'),
    });
    const link = document.createElement('a');
    link.download = filename;
    link.href = dataUrl;
    link.click();
  } catch (err) {
    console.error('Failed to export image', err);
  }
}
