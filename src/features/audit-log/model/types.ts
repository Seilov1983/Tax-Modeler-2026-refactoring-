import type { AuditEntry, AuditLog } from '@shared/types';

export interface AuditAppendPayload {
  projectId: string;
  userId: string;
  action: string;
  entityRef: Record<string, unknown>;
  beforeObj: unknown;
  afterObj: unknown;
  metadata?: Record<string, unknown>;
  prevHash: string;
}

export interface AuditAppendResult {
  entry: AuditEntry;
  newLastHash: string;
}

export type { AuditEntry, AuditLog };
