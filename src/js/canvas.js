import { escapeHtml, fmtMoney, toast } from './utils.js';
import { state, uiState, save, auditAppend } from './state.js';
import { getZone, getNode, isZoneEnabled, detectZoneId, clampToZoneExclusive, zoneArea, pointInZone, recomputeRisks } from './engine.js';
import { render, openFlowInspector, openRightDrawer } from './ui.js';

export const boardState = { x: -2000, y: -2000, scale: 1, isPanning: false, startX: 0, startY: 0 };

let previousCameraState = null;
let cameraAnimationId = null;

export function saveCameraState() { previousCameraState = { x: boardState.x, y: boardState.y, scale: boardState.scale }; }
export function getSavedCameraState() { return previousCameraState; }

function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

export function animateCameraTo(targetX, targetY, targetScale, duration, callback) {
    if (cameraAnimationId) cancelAnimationFrame(cameraAnimationId);
    const startX = boardState.x, startY = boardState.y, startScale = boardState.scale, startTime = performance.now();
    function step(now) {
        const progress = Math.min((now - startTime) / duration, 1), eased = easeInOutCubic(progress);
        boardState.x = startX + (targetX - startX) * eased; boardState.y = startY + (targetY - startY) * eased; boardState.scale = startScale + (targetScale - startScale) * eased;
        updateBoardTransform();
        if (progress < 1) cameraAnimationId = requestAnimationFrame(step); else { cameraAnimationId = null; if (callback) callback(); }
    }
    cameraAnimationId = requestAnimationFrame(step);
}

export function animateCameraToZone(zone) {
    const viewport = document.getElementById('viewport');
    if (!viewport || !zone) return;
    const rect = viewport.getBoundingClientRect(), padding = 80;
    const targetScale = Math.min((rect.width - padding * 2) / zone.w, (rect.height - padding * 2) / zone.h, 2.5);
    const targetX = rect.width / 2 - (zone.x + zone.w / 2) * targetScale, targetY = rect.height / 2 - (zone.y + zone.h / 2) * targetScale;
    animateCameraTo(targetX, targetY, targetScale, 400);
}

export function animateCameraRestore(callback) {
    if (!previousCameraState) { if (callback) callback(); return; }
    const saved = previousCameraState; previousCameraState = null;
    animateCameraTo(saved.x, saved.y, saved.scale, 400, callback);
}

export function findZoneAtPoint(project, x, y) {
    const hits = project.zones.filter(z => isZoneEnabled(project, z) && pointInZone(x, y, z));
    if (hits.length === 0) return null;
    hits.sort((a, b) => (zoneArea(a) - zoneArea(b)) || ((b.zIndex || 0) - (a.zIndex || 0)));
    return hits[0];
}

export function updateBoardTransform() {
    const board = document.getElementById('canvas-board');
    if (board) board.style.transform = `translate(${boardState.x}px, ${boardState.y}px) scale(${boardState.scale})`;
}

// --- ЕДИНЫЙ КОНТРОЛЛЕР ХОЛСТА ---
export function initBoardInteractions() {
    const viewport = document.getElementById('viewport');
    const board = document.getElementById('canvas-board');
    if (!viewport || !board) return;

    // 1. PANNING (Перемещение камеры)
    viewport.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.node') || e.target.closest('.zone-header') || e.target.closest('.zone-resize-handle')) return;
        e.preventDefault();
        boardState.isPanning = true;
        boardState.startX = e.clientX - boardState.x;
        boardState.startY = e.clientY - boardState.y;
        viewport.setPointerCapture(e.pointerId);
        viewport.style.cursor = 'grabbing';
    });

    viewport.addEventListener('pointermove', (e) => {
        if (boardState.isPanning) {
            boardState.x = e.clientX - boardState.startX;
            boardState.y = e.clientY - boardState.startY;
            updateBoardTransform();
        }
    });

    const stopPan = (e) => {
        if (boardState.isPanning) {
            boardState.isPanning = false;
            viewport.releasePointerCapture(e.pointerId);
            viewport.style.cursor = 'grab';
        }
    };
    viewport.addEventListener('pointerup', stopPan);
    viewport.addEventListener('pointercancel', stopPan);

    // 2. ZOOM
    viewport.addEventListener('wheel', (e) => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const rect = viewport.getBoundingClientRect();
            const mx = e.clientX - rect.left, my = e.clientY - rect.top;
            const bx = (mx - boardState.x) / boardState.scale, by = (my - boardState.y) / boardState.scale;
            boardState.scale = Math.max(0.2, Math.min(boardState.scale + (e.deltaY > 0 ? -0.05 : 0.05), 3));
            boardState.x = mx - bx * boardState.scale; boardState.y = my - by * boardState.scale;
            updateBoardTransform();
        }
    }, { passive: false });

    // 3. УМНЫЙ ДВОЙНОЙ КЛИК
    board.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const project = state.project;
        if (project.readOnly) return;
        const pt = pointerToCanvas(e);
        const hitZone = findZoneAtPoint(project, pt.x, pt.y);
        
        if (!hitZone) openRightDrawer('COUNTRIES');
        else if (hitZone.kind === 'country' || !hitZone.kind) openRightDrawer('REGIMES', hitZone.jurisdiction);
        else if (hitZone.kind === 'regime') openRightDrawer('NODES', hitZone.id);
    });

    updateBoardTransform();
}

export function calculateOrthogonalPath(a, b, totalFlows, flowIdx, allNodes) {
    const pad = 20, spread = (flowIdx - (totalFlows - 1) / 2) * 14;
    const cA = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, cB = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const dx = cB.x - cA.x, dy = cB.y - cA.y;
    let p1 = {x:0, y:0}, p2 = {x:0, y:0}, p3 = {x:0, y:0}, p4 = {x:0, y:0};

    if (Math.abs(dx) > Math.abs(dy)) {
        p1.y = Math.max(a.y + 15, Math.min(a.y + a.h - 15, cA.y + spread)); p4.y = Math.max(b.y + 15, Math.min(b.y + b.h - 15, cB.y + spread));
        if (dx > 0) { p1.x = a.x + a.w; p4.x = b.x - 4; } else { p1.x = a.x; p4.x = b.x + b.w + 4; }
        let midX = (p1.x + p4.x) / 2;
        p2 = { x: midX, y: p1.y }; p3 = { x: midX, y: p4.y };
    } else {
        p1.x = Math.max(a.x + 15, Math.min(a.x + a.w - 15, cA.x + spread)); p4.x = Math.max(b.x + 15, Math.min(b.x + b.w - 15, cB.x + spread));
        if (dy > 0) { p1.y = a.y + a.h; p4.y = b.y - 4; } else { p1.y = a.y; p4.y = b.y + b.h + 4; }
        let midY = (p1.y + p4.y) / 2;
        p2 = { x: p1.x, y: midY }; p3 = { x: p4.x, y: midY };
    }
    return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} L ${p3.x} ${p3.y} L ${p4.x} ${p4.y}`;
}

export function isNodeVisible(n) {
    const project = state.project;
    const zid = (n && n.type === 'txa') ? (n.zoneId || (String(n.id||'').startsWith('txa_') ? String(n.id).slice(4) : null)) : (n ? n.zoneId : null);
    const z = zid ? getZone(project, zid) : null;
    if (n && n.type === 'txa') return !!(z && isZoneEnabled(project, z));
    if (n && n.zoneId && z && !isZoneEnabled(project, z)) return false;
    return true;
}

export function updateCanvasArrows() {
    const project = state.project, svg = document.getElementById('arrows-layer');
    if (!svg) return;
    const board = document.getElementById('canvas-board');
    const W = board?.dataset?.w || 5000, H = board?.dataset?.h || 5000;
    const svgNS = "http://www.w3.org/2000/svg";

    svg.querySelectorAll('.flowLine').forEach(p => p.remove());
    if (!svg.querySelector('defs')) {
        const defs = document.createElementNS(svgNS, "defs");
        const marker = document.createElementNS(svgNS, "marker");
        marker.setAttribute("id", "arrow"); marker.setAttribute("markerWidth", "10"); marker.setAttribute("markerHeight", "10");
        marker.setAttribute("refX", "9"); marker.setAttribute("refY", "3"); marker.setAttribute("orient", "auto");
        const mpath = document.createElementNS(svgNS, "path"); mpath.setAttribute("d", "M0,0 L9,3 L0,6 Z");
        mpath.setAttribute("fill", "rgba(160,180,255,.9)"); marker.appendChild(mpath); defs.appendChild(marker); svg.appendChild(defs);
    }
    svg.setAttribute("width", String(W)); svg.setAttribute("height", String(H));

    const pairs = {};
    const legendCfg = project.ui?.flowLegend || { show:true, mode:"ALL", selectedTypes:[] };
    if (legendCfg.show === false) return;
    const allTypes = (project.catalogs?.flowTypes || []).filter(ft=>ft.enabled !== false).map(ft=>ft.id);
    const visibleTypes = new Set(legendCfg.mode === "ALL" ? allTypes : legendCfg.selectedTypes);

    project.flows.filter(f=>visibleTypes.has(f.flowType)).forEach(f=>{
        const key = [f.fromId, f.toId].sort().join('-'); pairs[key] = pairs[key] || []; pairs[key].push(f);
    });

    Object.values(pairs).forEach(flows => {
        flows.forEach((f, idx) => {
            const a = getNode(project, f.fromId), b = getNode(project, f.toId);
            if (!a || !b || !isNodeVisible(a) || !isNodeVisible(b)) return;
            const pathData = calculateOrthogonalPath(a, b, flows.length, idx, project.nodes);
            const line = document.createElementNS(svgNS, "path");
            line.setAttribute("d", pathData); line.setAttribute("marker-end", "url(#arrow)");
            line.setAttribute("class", "flowLine" + (f.status === "pending" ? " flowPending" : ""));
            line.setAttribute("stroke", "#8ab4ff"); line.setAttribute("fill", "none"); line.setAttribute("stroke-width", "2");
            line.style.cursor = 'pointer';
            line.addEventListener('click', (e) => { e.stopPropagation(); openFlowInspector(f.id); });
            svg.appendChild(line);

            let labelText = `${fmtMoney(f.grossAmount)} ${f.currency}` + (f.dealTag ? ` | 🏷 ${f.dealTag}` : '');
            const textEl = document.createElementNS(svgNS, "text");
            textEl.setAttribute("class", "flowLine"); textEl.setAttribute("fill", "var(--text, #ccc)");
            textEl.setAttribute("font-size", "10"); textEl.setAttribute("pointer-events", "none");
            const midA = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, midB = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
            textEl.setAttribute("x", String((midA.x + midB.x) / 2)); textEl.setAttribute("y", String((midA.y + midB.y) / 2 - 6));
            textEl.setAttribute("text-anchor", "middle"); textEl.textContent = labelText;
            svg.appendChild(textEl);
        });
    });
}

export function pointerToCanvas(ev) {
  const viewport = document.getElementById('viewport'), rect = viewport.getBoundingClientRect();
  return { x: (ev.clientX - rect.left - boardState.x) / boardState.scale, y: (ev.clientY - rect.top - boardState.y) / boardState.scale };
}

// Узлы (Компании)
export function onPointerDown(ev, nodeId) {
  const project = state.project, n = getNode(project, nodeId);
  if (!n || project.readOnly || (n.type === "company" && n.frozen)) return;
  uiState.drag.active = true; uiState.drag.nodeId = nodeId; uiState.drag.lockZone = (n.type === "txa");
  const pt = pointerToCanvas(ev); uiState.drag.offX = pt.x - n.x; uiState.drag.offY = pt.y - n.y;
  document.getElementById('canvas-board').setPointerCapture(ev.pointerId); ev.preventDefault();
}
export function onPointerMove(ev) {
  if (!uiState.drag.active) return;
  const project = state.project, n = getNode(project, uiState.drag.nodeId);
  if (!n) return;
  const pt = pointerToCanvas(ev);
  n.x = pt.x - uiState.drag.offX; n.y = pt.y - uiState.drag.offY;
  const el = document.querySelector('.node[data-node-id="'+n.id+'"]');
  if (el){ el.style.left = n.x + "px"; el.style.top = n.y + "px"; }
  updateCanvasArrows();
}
export function onPointerUp(ev) {
  if (!uiState.drag.active) return;
  const project = state.project, n = getNode(project, uiState.drag.nodeId);
  uiState.drag.active = false;
  if (n) { n.zoneId = detectZoneId(project, n); save(); }
  try { document.getElementById('canvas-board').releasePointerCapture(ev.pointerId); } catch(e){}
}

export function renderCanvas() {
  const project = state.project;
  const board = document.getElementById('canvas-board'), zonesLayer = document.getElementById('zones-layer'), nodesLayer = document.getElementById('nodes-layer');
  if (!board || !zonesLayer || !nodesLayer) return;

  zonesLayer.innerHTML = ""; nodesLayer.innerHTML = "";
  board.dataset.w = "5000"; board.dataset.h = "5000"; board.style.width = "5000px"; board.style.height = "5000px";

  // РЕНДЕР ЗОН (С ИЗОЛИРОВАННЫМ ЗАХВАТОМ МЫШИ)
  project.zones.filter(z=>isZoneEnabled(project,z)).forEach(z=>{
    const el = document.createElement('div');
    el.className = 'zone'; el.dataset.zoneId = z.id;
    el.style.left = z.x + "px"; el.style.top = z.y + "px"; el.style.width = z.w + "px"; el.style.height = z.h + "px";
    
    const flag = project.catalogs?.jurisdictions?.find(j => j.id === z.jurisdiction)?.flag || '';
    const titleText = z.kind === 'country' ? `${flag} ${z.name}` : z.name;

    el.innerHTML = `<div class="zone-header">${escapeHtml(titleText)}</div><div class="zone-resize-handle"></div>`;
    const header = el.querySelector('.zone-header'), resize = el.querySelector('.zone-resize-handle');

    // Логика перетаскивания зоны (Drag)
    if (header) {
        header.addEventListener('pointerdown', (ev) => {
            if (project.readOnly) return;
            ev.preventDefault(); ev.stopPropagation();
            const startPt = pointerToCanvas(ev), origX = z.x, origY = z.y;
            header.setPointerCapture(ev.pointerId);

            const onMove = (mEv) => {
                const pt = pointerToCanvas(mEv); z.x = origX + (pt.x - startPt.x); z.y = origY + (pt.y - startPt.y);
                el.style.left = z.x + "px"; el.style.top = z.y + "px"; updateCanvasArrows();
            };
            const onUp = (uEv) => {
                header.releasePointerCapture(uEv.pointerId);
                header.removeEventListener('pointermove', onMove); header.removeEventListener('pointerup', onUp);
                project.nodes.filter(n => n.type !== 'txa').forEach(n => n.zoneId = detectZoneId(project, n)); // Привязываем узлы
                save();
            };
            header.addEventListener('pointermove', onMove); header.addEventListener('pointerup', onUp);
        });
    }

    // Логика изменения размера (Resize)
    if (resize) {
        resize.addEventListener('pointerdown', (ev) => {
            if (project.readOnly) return;
            ev.preventDefault(); ev.stopPropagation();
            const startPt = pointerToCanvas(ev), origW = z.w, origH = z.h;
            resize.setPointerCapture(ev.pointerId);

            const onMove = (mEv) => {
                const pt = pointerToCanvas(mEv); z.w = Math.max(200, origW + (pt.x - startPt.x)); z.h = Math.max(150, origH + (pt.y - startPt.y));
                el.style.width = z.w + "px"; el.style.height = z.h + "px"; updateCanvasArrows();
            };
            const onUp = (uEv) => {
                resize.releasePointerCapture(uEv.pointerId);
                resize.removeEventListener('pointermove', onMove); resize.removeEventListener('pointerup', onUp); save();
            };
            resize.addEventListener('pointermove', onMove); resize.addEventListener('pointerup', onUp);
        });
    }
    zonesLayer.appendChild(el);
  });

  updateCanvasArrows();

  // РЕНДЕР УЗЛОВ (КОМПАНИЙ)
  project.nodes.forEach(n=>{
      if (!isNodeVisible(n)) return;
      const el = document.createElement('div');
      el.className = 'node' + (n.type==="txa" ? ' txa' : ''); el.dataset.nodeId = n.id;
      el.style.left = n.x + "px"; el.style.top = n.y + "px"; el.style.width = n.w + "px"; el.style.height = n.h + "px";
      el.innerHTML = `<div class="nTitle">${escapeHtml(n.name)}</div><div class="nSub">${escapeHtml(n.type)}</div>`;
      el.style.cursor = "grab";
      el.addEventListener('pointerdown', (ev)=>onPointerDown(ev, n.id));
      nodesLayer.appendChild(el);
  });

  // Логика мыши для перемещения компаний
  board.onpointermove = (ev) => { onPointerMove(ev); };
  board.onpointerup = (ev) => { onPointerUp(ev); };
}
