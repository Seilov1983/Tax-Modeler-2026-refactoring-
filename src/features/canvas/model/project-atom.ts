/**
 * Root project atom — single source of truth.
 *
 * Hydrated from Server Component / localStorage on mount,
 * then managed via Jotai on the client.
 */

import { atom } from 'jotai';
import type { Project, FXConfig, AuditLog } from '@shared/types';

export const projectAtom = atom<Project | null>(null);

// Derived read-only slices
export const fxConfigAtom = atom<FXConfig | null>((get) => get(projectAtom)?.fx ?? null);
export const baseCurrencyAtom = atom((get) => get(projectAtom)?.baseCurrency ?? 'USD');
export const auditLogAtom = atom<AuditLog | null>((get) => get(projectAtom)?.audit ?? null);
export const projectRiskFlagsAtom = atom((get) => get(projectAtom)?.projectRiskFlags ?? []);

// Active tab for UI
export const activeTabAtom = atom<string>('flows');
