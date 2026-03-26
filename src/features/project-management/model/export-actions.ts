/**
 * Imperative actions for project serialization and canvas export.
 *
 * These are plain functions (not Jotai atoms) because they perform
 * side-effects (file download, FileReader) that don't belong in the
 * reactive state graph.
 *
 * Split workflow:
 * - "Save / Save As" → internal DB persistence (handled by useDebouncedCloudSync)
 * - "Export JSON"     → File System Access API with native OS overwrite prompt
 */

import Konva from 'konva';
import { uid } from '@shared/lib/engine/utils';
import type { Project } from '@shared/types';

// ─── Legacy: download project as JSON via <a> fallback ──────────────────────

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

// ─── Export JSON via File System Access API ──────────────────────────────────

/**
 * Export project as a JSON file using the File System Access API.
 * Uses showSaveFilePicker for native OS "Save As" dialog with overwrite prompts.
 * Falls back to <a download> on browsers without showSaveFilePicker support.
 */
export async function exportProjectJson(project: Project): Promise<void> {
  const json = JSON.stringify(project, null, 2);
  const sanitizedName = project.title.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim() || 'project';
  const suggestedName = `${sanitizedName}.json`;

  // Try File System Access API (Chrome, Edge, Opera)
  if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: 'JSON Files',
            accept: { 'application/json': ['.json'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(new Blob([json], { type: 'application/json' }));
      await writable.close();
      return;
    } catch (err: any) {
      // User cancelled the picker — not an error
      if (err?.name === 'AbortError') return;
      // Fall through to legacy download on other errors
      console.warn('[Export] showSaveFilePicker failed, falling back to <a download>:', err);
    }
  }

  // Fallback: standard <a download>
  downloadProjectJson(project, suggestedName);
}

// ─── Duplicate Project (Save As — Internal Clone) ───────────────────────────

/**
 * Create a deep clone of the project with a new ID and title.
 * Returns the cloned project — caller is responsible for hydrating it into Jotai.
 */
export function duplicateProject(project: Project): Project {
  const clone: Project = JSON.parse(JSON.stringify(project));
  clone.projectId = 'proj_' + uid();
  clone.title = `${project.title} (Copy)`;
  clone.createdAt = new Date().toISOString();
  clone.updatedAt = new Date().toISOString();
  return clone;
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

// ─── Export canvas to PNG (native Konva — no DOM-to-image overhead) ─────────

export function exportCanvasToPng(
  elementId: string,
  filename = 'structure.png',
): void {
  const container = document.getElementById(elementId);
  if (!container) {
    console.error(`exportCanvasToPng: element #${elementId} not found`);
    return;
  }

  // Find the Konva Stage whose container lives inside our wrapper
  const stage = Konva.stages.find(
    (s) => container.contains(s.container()),
  );

  if (!stage) {
    console.error('exportCanvasToPng: no Konva Stage found inside #' + elementId);
    return;
  }

  try {
    const dataUrl = stage.toDataURL({ pixelRatio: 2 });
    const link = document.createElement('a');
    link.download = filename;
    link.href = dataUrl;
    link.click();
  } catch (err) {
    console.error('Failed to export image', err);
  }
}
