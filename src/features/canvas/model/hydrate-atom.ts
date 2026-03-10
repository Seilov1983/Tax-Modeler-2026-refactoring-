/**
 * Action atom: batched project hydration.
 *
 * All set() calls within a single atom write function are batched by Jotai
 * into ONE React re-render cycle. This eliminates the React 19 warning
 * "Detected a large number of updates inside startTransition".
 */

import { atom } from 'jotai';
import { projectAtom } from './project-atom';
import { nodesAtom } from '@entities/node';
import { zonesAtom } from '@entities/zone';
import { flowsAtom } from '@entities/flow';
import { ownershipAtom } from '@entities/ownership';
import { taxEntriesAtom } from '@features/tax-calculator';
import type { Project } from '@shared/types';

/**
 * Write-only atom that commits a fully computed Project to all entity atoms
 * in a single Jotai batch (one React re-render).
 */
export const hydrateProjectAtom = atom(
  null,
  (_get, set, project: Project) => {
    set(projectAtom, project);
    set(nodesAtom, project.nodes);
    set(zonesAtom, project.zones);
    set(flowsAtom, project.flows);
    set(ownershipAtom, project.ownership);
    set(taxEntriesAtom, project.taxes);
  },
);
