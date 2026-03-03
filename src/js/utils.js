export const nowIso = () => new Date().toISOString();
export const isoDate = (d) => (new Date(d)).toISOString().slice(0,10);

export const bankersRound2 = (n) => {
  const x = Number(n || 0);
  const scaled = x * 100;
  const f = Math.floor(scaled);
  const diff = scaled - f;
  let r;
  if (diff > 0.5) r = f + 1;
  else if (diff < 0.5) r = f;
  else r = (f % 2 === 0) ? f : f + 1;
  return r / 100;
};

export const numOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const fmtMoney = (n) => {
  const v = bankersRound2(n);
  try {
    return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  } catch (e) {
    return (Math.round(v * 100) / 100).toFixed(2);
  }
};

export const uid = () => Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);

export function stableStringify(obj){
  const seen = new WeakSet();
  const sorter = (a,b) => a.localeCompare(b);
  const rec = (v) => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v)) return "[Circular]";
    seen.add(v);
    if (Array.isArray(v)) return v.map(rec);
    const out = {};
    Object.keys(v).sort(sorter).forEach(k => out[k] = rec(v[k]));
    return out;
  };
  return JSON.stringify(rec(obj));
}

export async function sha256(str){
  const enc = new TextEncoder();
  const data = enc.encode(str);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const arr = Array.from(new Uint8Array(buf));
  return arr.map(b => b.toString(16).padStart(2,'0')).join('');
}

export function toast(msg){
  const wrap = document.getElementById('toasts');
  if(!wrap) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(()=>{ el.style.opacity = '0'; el.style.transition='opacity .4s'; }, 1800);
  setTimeout(()=>{ el.remove(); }, 2400);
}

export function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, (c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

export function formatMoney(n){
  const x = Number(n || 0);
  if (!isFinite(x)) return "0";
  return x.toLocaleString('ru-RU', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
}

export function toLocalDateTimeInput(iso){
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (x)=>String(x).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalDateTimeInput(v){
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function deepMerge(base, override){
  if (override === undefined) return JSON.parse(JSON.stringify(base));
  if (base === null || typeof base !== "object") return JSON.parse(JSON.stringify(override));
  if (override === null || typeof override !== "object") return JSON.parse(JSON.stringify(override));
  if (Array.isArray(base) || Array.isArray(override)) return JSON.parse(JSON.stringify(override));
  const out = { ...base };
  for (const k of Object.keys(override)){
    out[k] = deepMerge(base[k], override[k]);
  }
  return out;
}

export function diffPatch(before, after){
  const ops = [];
  for (const k of Object.keys(after)){
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])){
      ops.push({ op: "replace", path: "/" + k, value: after[k] });
    }
  }
  return ops;
}
