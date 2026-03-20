'use client';

/**
 * ProjectDashboard — Liquid Glass modal for managing saved projects.
 * List / Create / Open / Delete with offline-first fallback.
 */

import { useState, useEffect, useCallback } from 'react';
import { useSetAtom } from 'jotai';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { hydrateProjectAtom } from '@features/canvas';
import { defaultProject } from '@entities/project';
import {
  ensureMasterData, ensureZoneTaxDefaults,
  bootstrapNormalizeZones, recomputeRisks, recomputeFrozen,
  ensureCountriesAndRegimes,
} from '@shared/lib/engine';
import { SCHEMA_VERSION } from '@shared/lib/engine/engine-core';
import type { Project } from '@shared/types';
import { FolderOpen, Plus, Trash2, Loader2 } from 'lucide-react';

interface ProjectSummary {
  id: string;
  name: string;
  schemaVersion: string;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a project is loaded/created so the parent can track the remote ID */
  onProjectLoaded?: (remoteId: string) => void;
}

const USER_ID = 'local-user';

function prepareProject(p: Project): Project {
  ensureMasterData(p);
  ensureCountriesAndRegimes(p);
  ensureZoneTaxDefaults(p);
  bootstrapNormalizeZones(p);
  recomputeFrozen(p);
  recomputeRisks(p);
  return p;
}

export function ProjectDashboard({ open, onOpenChange, onProjectLoaded }: Props) {
  const hydrate = useSetAtom(hydrateProjectAtom);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/projects', {
        headers: { 'x-user-id': USER_ID },
      });
      if (res.status === 503) {
        setError('Database offline. Projects saved locally only.');
        setProjects([]);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setProjects(Array.isArray(data) ? data : []);
    } catch {
      setError('Cannot reach server. Working in offline mode.');
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchProjects();
  }, [open, fetchProjects]);

  const handleOpen = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${id}`);
      if (!res.ok) throw new Error('Failed to load project');
      const record = await res.json();
      if (record.graphJSON && typeof record.graphJSON === 'object') {
        const graph = record.graphJSON as Project;
        graph.readOnly = false;
        prepareProject(graph);
        hydrate(graph);
        onProjectLoaded?.(record.id);
        onOpenChange(false);
      }
    } catch {
      setError('Failed to load project.');
    } finally {
      setLoading(false);
    }
  }, [hydrate, onOpenChange, onProjectLoaded]);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    try {
      const p = defaultProject() as Project;
      prepareProject(p);

      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': USER_ID },
        body: JSON.stringify({
          name: p.title || 'Untitled Project',
          schemaVersion: SCHEMA_VERSION,
          graphJSON: p,
        }),
      });
      if (!res.ok) throw new Error('Create failed');
      const created = await res.json();

      hydrate(p);
      onProjectLoaded?.(created.id);
      onOpenChange(false);
    } catch {
      setError('Failed to create project.');
    } finally {
      setCreating(false);
    }
  }, [hydrate, onOpenChange, onProjectLoaded]);

  const handleDelete = useCallback(async (id: string, name: string) => {
    if (!confirm(`Delete project "${name}"? This cannot be undone.`)) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setProjects(prev => prev.filter(p => p.id !== id));
    } catch {
      setError('Failed to delete project.');
    } finally {
      setDeletingId(null);
    }
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl bg-white/72 backdrop-blur-[40px] backdrop-saturate-[180%] dark:bg-black/60 dark:text-white border-white/25">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold tracking-tight">
            Project Dashboard
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-500 dark:text-slate-400">
            Manage your tax structure projects
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-300 text-xs">
            {error}
          </div>
        )}

        <div className="flex justify-end">
          <button
            onClick={handleCreate}
            disabled={creating}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors disabled:opacity-50"
          >
            {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            New Project
          </button>
        </div>

        <div className="max-h-[360px] overflow-y-auto space-y-2">
          {loading && projects.length === 0 && (
            <div className="flex items-center justify-center py-8 text-slate-400">
              <Loader2 size={20} className="animate-spin mr-2" />
              Loading...
            </div>
          )}

          {!loading && projects.length === 0 && !error && (
            <div className="text-center py-8 text-slate-400 text-sm">
              No saved projects yet. Create one to get started.
            </div>
          )}

          {projects.map(p => (
            <div
              key={p.id}
              className="flex items-center justify-between p-3 rounded-xl bg-white/50 dark:bg-white/10 border border-white/30 dark:border-white/10 hover:bg-white/70 dark:hover:bg-white/15 transition-colors group"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-900 dark:text-white truncate">
                  {p.name}
                </div>
                <div className="text-xs text-slate-400 mt-0.5">
                  v{p.schemaVersion} &middot; {new Date(p.updatedAt).toLocaleDateString()} {new Date(p.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>

              <div className="flex items-center gap-1.5 ml-3">
                <button
                  onClick={() => handleOpen(p.id)}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-colors"
                >
                  <FolderOpen size={12} />
                  Open
                </button>
                <button
                  onClick={() => handleDelete(p.id, p.name)}
                  disabled={deletingId === p.id}
                  className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                >
                  {deletingId === p.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
