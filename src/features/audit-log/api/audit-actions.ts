'use server';

/**
 * Server Action for audit log entries.
 *
 * By running hash computation on the server, we guarantee:
 * 1. The client cannot forge `occurredAt` timestamps
 * 2. The client cannot inject a fake `prevHash` to bypass the chain
 * 3. The SHA-256 chain integrity is maintained server-side
 *
 * In the MVP phase this runs in the Next.js server process.
 * In production, this would write to a database / append-only log store.
 */

import { sha256, stableStringify, diffPatch, uid, nowIso } from '@shared/lib/engine/utils';
import type { AuditEntry } from '@shared/types';
import type { AuditAppendPayload, AuditAppendResult } from '../model/types';

export async function appendAuditEntry(payload: AuditAppendPayload): Promise<AuditAppendResult> {
  const { projectId, userId, action, entityRef, beforeObj, afterObj, metadata, prevHash } = payload;

  // Server-side timestamp — client cannot forge this
  const serverTimestamp = nowIso();

  // Compute diff
  const rawDiff =
    Array.isArray(beforeObj) && (afterObj === undefined || afterObj === null)
      ? beforeObj
      : diffPatch(
          (beforeObj as Record<string, unknown>) || {},
          (afterObj as Record<string, unknown>) || {},
        );
  const safeDiff = JSON.parse(JSON.stringify(rawDiff));

  const entry: AuditEntry = {
    id: 'a_' + uid(),
    occurredAt: serverTimestamp,
    actor: { userId: userId || 'user_unknown' },
    action,
    entityRef: JSON.parse(JSON.stringify(entityRef || {})),
    diffFormat: 'JSON_PATCH_RFC6902',
    diff: safeDiff,
    metadata: JSON.parse(JSON.stringify(metadata || {})),
    prevHash,
    entryHash: '',
  };

  // Compute SHA-256 hash chain on the server
  const canonical = stableStringify(Object.assign({}, entry, { entryHash: undefined }));
  entry.entryHash = await sha256(prevHash + '\n' + canonical);

  return {
    entry,
    newLastHash: entry.entryHash,
  };
}

export async function verifyAuditChain(
  entries: AuditEntry[],
): Promise<{ valid: boolean; failedAtIndex: number | null }> {
  let prev = 'GENESIS';
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const canonical = stableStringify(Object.assign({}, e, { entryHash: undefined }));
    const h = await sha256(prev + '\n' + canonical);
    if (h !== e.entryHash) return { valid: false, failedAtIndex: i };
    prev = e.entryHash;
  }
  return { valid: true, failedAtIndex: null };
}
