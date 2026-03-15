'use client';

/**
 * useKeyboardShortcuts — global keyboard shortcuts for the canvas.
 *
 * - Ctrl/Cmd + Z: Undo
 * - Ctrl/Cmd + Y / Ctrl/Cmd + Shift + Z: Redo
 * - Ctrl/Cmd + C: Copy selected nodes (+ internal edges)
 * - Ctrl/Cmd + V: Paste from internal clipboard
 * - Ctrl/Cmd + D: Duplicate (copy + paste)
 * - Delete / Backspace: Delete selected entity
 * - Escape: Deselect
 *
 * All shortcuts are suppressed when the user is typing in an input/textarea/select.
 */

import { useEffect } from 'react';
import { useSetAtom, useAtomValue } from 'jotai';
import { undoAtom, redoAtom } from '@features/project-management/model/history-atoms';
import { selectionAtom } from '@features/entity-editor/model/atoms';
import { deleteNodesAtom, deleteFlowAtom, deleteOwnershipAtom } from '../model/graph-actions-atom';
import { copyAtom, pasteAtom, duplicateAtom } from '../model/clipboard-atoms';

export function useKeyboardShortcuts() {
  const undo = useSetAtom(undoAtom);
  const redo = useSetAtom(redoAtom);
  const selection = useAtomValue(selectionAtom);
  const setSelection = useSetAtom(selectionAtom);
  const deleteNodes = useSetAtom(deleteNodesAtom);
  const deleteFlow = useSetAtom(deleteFlowAtom);
  const deleteOwnership = useSetAtom(deleteOwnershipAtom);
  const copy = useSetAtom(copyAtom);
  const paste = useSetAtom(pasteAtom);
  const duplicate = useSetAtom(duplicateAtom);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const mod = e.ctrlKey || e.metaKey;

      // Undo: Ctrl+Z / Cmd+Z (without Shift)
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      // Redo: Ctrl+Y / Cmd+Y  OR  Ctrl+Shift+Z / Cmd+Shift+Z
      if (
        (mod && e.key.toLowerCase() === 'y') ||
        (mod && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        e.preventDefault();
        redo();
        return;
      }

      // Copy: Ctrl+C / Cmd+C
      if (mod && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        copy();
        return;
      }

      // Paste: Ctrl+V / Cmd+V
      if (mod && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        paste();
        return;
      }

      // Duplicate: Ctrl+D / Cmd+D
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicate();
        return;
      }

      // Delete / Backspace: delete selected entity (supports multi-select for nodes)
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!selection) return;
        e.preventDefault();
        if (selection.type === 'node') deleteNodes(selection.ids);
        else if (selection.type === 'flow') deleteFlow(selection.id);
        else if (selection.type === 'ownership') deleteOwnership(selection.id);
        return;
      }

      // Escape: deselect
      if (e.key === 'Escape') {
        setSelection(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, selection, setSelection, deleteNodes, deleteFlow, deleteOwnership, copy, paste, duplicate]);
}
