import { nowIso, sha256, stableStringify, diffPatch } from './utils.js';

export const SCHEMA_VERSION = "2.4.1";
export const ENGINE_VERSION = "0.10.0";
export const STORAGE_KEY = "tsm26_onefile_project_v2";

// Глобальное состояние данных проекта
export const state = {
  project: null
};

// Глобальное состояние UI (перенесено из app.js)
export const uiState = {
  activeTab: "flows",
  settingsSubTab: "jurisdictions",
  settingsExpanded: {},
  settingsSelectedZoneId: null,
  catalogsExpanded: {},
  drag: { active:false, nodeId:null, startX:0, startY:0, offX:0, offY:0, lockZone:false, lockZoneId:null, lastValidX:0, lastValidY:0 },
  dragZone: { active:false, zoneId:null, mode:null, handle:null, startX:0, startY:0, orig:null, parentId:null },
  hoverZoneId: null,
  editingFlow: null
};

export function save(){
  if (!state.project) return;
  state.project.updatedAt = nowIso();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.project));
}

export async function load(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try{
    const obj = JSON.parse(raw);
    if (obj.schemaVersion !== SCHEMA_VERSION) return null;
    const ok = await verifyAudit(obj);
    obj.readOnly = !ok;
    return obj;
  }catch(e){
    return null;
  }
}

export async function verifyAudit(p){
  let prev = "GENESIS";
  for (const e of p.audit.entries){
    const canonical = stableStringify(Object.assign({}, e, { entryHash: undefined }));
    const h = await sha256(prev + "\n" + canonical);
    if (h !== e.entryHash) return false;
    prev = e.entryHash;
  }
  return true;
}

export async function auditAppend(p, action, entityRef, beforeObj, afterObj, metadata){
  const prevHash = p.audit.lastHash || "GENESIS";
  const entry = {
    id: "a_" + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2),
    occurredAt: nowIso(),
    actor: { userId: p.userId },
    action,
    entityRef,
    diffFormat: "JSON_PATCH_RFC6902",
    diff: (Array.isArray(beforeObj) && (afterObj === undefined || afterObj === null)) ? beforeObj : diffPatch(beforeObj || {}, afterObj || {}),
    metadata: metadata || {},
    prevHash,
    entryHash: ""
  };
  const canonical = stableStringify(Object.assign({}, entry, { entryHash: undefined }));
  entry.entryHash = await sha256(prevHash + "\n" + canonical);
  p.audit.entries.push(entry);
  p.audit.lastHash = entry.entryHash;
}
