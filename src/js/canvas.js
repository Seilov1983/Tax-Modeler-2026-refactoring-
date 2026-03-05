import { escapeHtml, fmtMoney, toast } from './utils.js';
import { state, uiState, save, auditAppend } from './state.js';
import { getZone, getNode, isZoneEnabled, detectZoneId, clampToZoneExclusive, zoneArea, pointInZone, recomputeRisks } from './engine.js';
import { render, openFlowInspector, openRightDrawer } from './ui.js';

// Глобальное состояние виртуальной камеры
export const boardState = {
    x: -2000, // Смотрим в центр!
    y: -2000,
    scale: 1,
    isPanning: false,
    startX: 0,
    startY: 0
};

// ── Smart Focus: Сохранение/восстановление камеры для DnD анимации ──
let previousCameraState = null;
let cameraAnimationId = null;

export function saveCameraState() {
    previousCameraState = {
        x: boardState.x,
        y: boardState.y,
        scale: boardState.scale
    };
}

export function getSavedCameraState() {
    return previousCameraState;
}

function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function animateCameraTo(targetX, targetY, targetScale, duration, callback) {
    if (cameraAnimationId) cancelAnimationFrame(cameraAnimationId);

    const startX = boardState.x;
    const startY = boardState.y;
    const startScale = boardState.scale;
    const startTime = performance.now();

    function step(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = easeInOutCubic(progress);

        boardState.x = startX + (targetX - startX) * eased;
        boardState.y = startY + (targetY - startY) * eased;
        boardState.scale = startScale + (targetScale - startScale) * eased;
        updateBoardTransform();

        if (progress < 1) {
            cameraAnimationId = requestAnimationFrame(step);
        } else {
            cameraAnimationId = null;
            if (callback) callback();
        }
    }

    cameraAnimationId = requestAnimationFrame(step);
}

export function animateCameraToZone(zone) {
    const viewport = document.getElementById('viewport');
    if (!viewport || !zone) return;
    const rect = viewport.getBoundingClientRect();

    // Рассчитываем масштаб чтобы зона заполнила viewport с отступами
    const padding = 80;
    const scaleX = (rect.width - padding * 2) / zone.w;
    const scaleY = (rect.height - padding * 2) / zone.h;
    const targetScale = Math.min(scaleX, scaleY, 2.5);

    // Центрируем зону в viewport
    const targetX = rect.width / 2 - (zone.x + zone.w / 2) * targetScale;
    const targetY = rect.height / 2 - (zone.y + zone.h / 2) * targetScale;

    animateCameraTo(targetX, targetY, targetScale, 400);
}

export function animateCameraRestore(callback) {
    if (!previousCameraState) {
        if (callback) callback();
        return;
    }
    const saved = previousCameraState;
    previousCameraState = null;
    animateCameraTo(saved.x, saved.y, saved.scale, 400, callback);
}

// ── Smart Focus: Обнаружение зоны под точкой (для валидации drop) ──
export function findZoneAtPoint(project, x, y) {
    const hits = project.zones
        .filter(z => isZoneEnabled(project, z) && pointInZone(x, y, z));
    if (hits.length === 0) return null;
    // Наименьшая по площади (самая вложенная) с наибольшим zIndex
    hits.sort((a, b) => (zoneArea(a) - zoneArea(b)) || ((b.zIndex || 0) - (a.zIndex || 0)));
    return hits[0];
}

// Применить текущий transform к доске
export function updateBoardTransform() {
    const board = document.getElementById('canvas-board');
    if (board) {
        board.style.transform = `translate(${boardState.x}px, ${boardState.y}px) scale(${boardState.scale})`;
    }
}

// Инициализация движка навигации (pan & zoom)
export function initBoardInteractions() {
    const viewport = document.getElementById('viewport');
    const board = document.getElementById('canvas-board');
    if (!viewport || !board) return;

    // Pan: хватаем полотно (клик по пустому месту)
    viewport.addEventListener('mousedown', (e) => {
        if (e.target.closest('.node') || e.target.closest('.zone')) return;
        e.preventDefault();
        boardState.isPanning = true;
        boardState.startX = e.clientX - boardState.x;
        boardState.startY = e.clientY - boardState.y;
        viewport.style.cursor = 'grabbing';
    });

    // Pan: тащим полотно
    window.addEventListener('mousemove', (e) => {
        if (!boardState.isPanning) return;
        boardState.x = e.clientX - boardState.startX;
        boardState.y = e.clientY - boardState.startY;
        updateBoardTransform();
    });

    // Pan: отпускаем полотно
    window.addEventListener('mouseup', () => {
        if (boardState.isPanning) {
            boardState.isPanning = false;
            viewport.style.cursor = 'grab';
        }
    });

    // Zoom: Ctrl/Cmd + колесико (зум к курсору)
    viewport.addEventListener('wheel', (e) => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const rect = viewport.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            // Точка на доске под курсором ДО зума
            const bx = (mx - boardState.x) / boardState.scale;
            const by = (my - boardState.y) / boardState.scale;

            const delta = e.deltaY > 0 ? -0.05 : 0.05;
            const newScale = Math.max(0.2, Math.min(boardState.scale + delta, 3));

            // Сдвигаем так, чтобы точка под курсором осталась на месте
            boardState.x = mx - bx * newScale;
            boardState.y = my - by * newScale;
            boardState.scale = newScale;

            updateBoardTransform();
        }
    }, { passive: false });

    // --- УМНЫЙ ДВОЙНОЙ КЛИК ПО ХОЛСТУ ---
    board.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        if (uiState.editMode !== 'zones' && uiState.editMode !== 'nodes') return;

        const pt = pointerToCanvas(e);
        const project = state.project;
        const hitZone = findZoneAtPoint(project, pt.x, pt.y);

        if (!hitZone) {
            // Клик в пустоту -> Предлагаем Страны
            openRightDrawer('COUNTRIES');
        } else if (hitZone.kind === 'country' || !hitZone.kind) {
            // Клик по стране -> Предлагаем Режимы этой страны
            openRightDrawer('REGIMES', hitZone.jurisdiction);
        } else if (hitZone.kind === 'regime') {
            // Клик по режиму -> Предлагаем Юрлицо/Физлицо
            openRightDrawer('NODES', hitZone.id);
        }
    });

    // --- ПЕРЕТАСКИВАНИЕ ЗОН ЗА ЗАГОЛОВОК И РЕСАЙЗ ЗА УГОЛОК ---
    board.addEventListener('pointerdown', (ev) => {
      const project = state.project;
      if (project.readOnly) return;

      const headerHit = ev.target.closest('.zone-header');
      const resizeHit = ev.target.closest('.zone-resize-handle');

      if (headerHit || resizeHit) {
        ev.stopPropagation();
        const pt = pointerToCanvas(ev);
        const zoneId = (headerHit || resizeHit).getAttribute('data-id');
        const z = project.zones.find(x => x.id === zoneId);
        if (z) {
          uiState.dragZone = {
            active: true, zoneId,
            mode: resizeHit ? 'resize' : 'move',
            handle: 'br', // bottom-right для ресайза
            startX: pt.x, startY: pt.y,
            orig: { x: z.x, y: z.y, w: z.w, h: z.h }
          };
          board.setPointerCapture(ev.pointerId);
          ev.preventDefault();
        }
        return;
      }
    });

    // Применяем стартовую позицию
    updateBoardTransform();
}

export function calculateOrthogonalPath(a, b, totalFlows, flowIdx, allNodes) {
    const pad = 20; 
    const spread = (flowIdx - (totalFlows - 1) / 2) * 14; 
    const cA = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
    const cB = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const dx = cB.x - cA.x, dy = cB.y - cA.y;
    let p1 = {x:0, y:0}, p2 = {x:0, y:0}, p3 = {x:0, y:0}, p4 = {x:0, y:0};

    if (Math.abs(dx) > Math.abs(dy)) { 
        p1.y = Math.max(a.y + 15, Math.min(a.y + a.h - 15, cA.y + spread));
        p4.y = Math.max(b.y + 15, Math.min(b.y + b.h - 15, cB.y + spread));
        if (dx > 0) { p1.x = a.x + a.w; p4.x = b.x - 4; } else { p1.x = a.x; p4.x = b.x + b.w + 4; }
        let midX = (p1.x + p4.x) / 2;
        const obstacles = allNodes.filter(n => n.id !== a.id && n.id !== b.id && isNodeVisible(n));
        for(let n of obstacles) {
            if (midX > n.x - pad && midX < n.x + n.w + pad) {
                const minY = Math.min(p1.y, p4.y), maxY = Math.max(p1.y, p4.y);
                if (n.y < maxY && n.y + n.h > minY) midX = (Math.abs(midX - n.x) < Math.abs(midX - (n.x + n.w))) ? n.x - pad : n.x + n.w + pad;
            }
        }
        p2 = { x: midX, y: p1.y }; p3 = { x: midX, y: p4.y };
    } else { 
        p1.x = Math.max(a.x + 15, Math.min(a.x + a.w - 15, cA.x + spread));
        p4.x = Math.max(b.x + 15, Math.min(b.x + b.w - 15, cB.x + spread));
        if (dy > 0) { p1.y = a.y + a.h; p4.y = b.y - 4; } else { p1.y = a.y; p4.y = b.y + b.h + 4; }
        let midY = (p1.y + p4.y) / 2;
        const obstacles = allNodes.filter(n => n.id !== a.id && n.id !== b.id && isNodeVisible(n));
        for(let n of obstacles) {
            if (midY > n.y - pad && midY < n.y + n.h + pad) {
                const minX = Math.min(p1.x, p4.x), maxX = Math.max(p1.x, p4.x);
                if (n.x < maxX && n.x + n.w > minX) midY = (Math.abs(midY - n.y) < Math.abs(midY - (n.y + n.h))) ? n.y - pad : n.y + n.h + pad;
            }
        }
        p2 = { x: p1.x, y: midY }; p3 = { x: p4.x, y: midY };
    }
    return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} L ${p3.x} ${p3.y} L ${p4.x} ${p4.y}`;
}

export function isNodeVisible(n){
    const project = state.project;
    const zid = (n && n.type === 'txa') ? (n.zoneId || (String(n.id||'').startsWith('txa_') ? String(n.id).slice(4) : null)) : (n ? n.zoneId : null);
    const z = zid ? getZone(project, zid) : null;
    if (n && n.type === 'txa') return !!(z && isZoneEnabled(project, z));
    if (n && n.zoneId && z && !isZoneEnabled(project, z)) return false;
    return true;
}

export function updateCanvasArrows() {
    const project = state.project;
    const svg = document.getElementById('arrows-layer');
    if (!svg) return;
    const board = document.getElementById('canvas-board');
    const W = board?.dataset?.w || 5000, H = board?.dataset?.h || 5000;
    const svgNS = "http://www.w3.org/2000/svg";

    // Очищаем старые линии, но сохраняем defs
    svg.querySelectorAll('.flowLine').forEach(p => p.remove());

    // Создаем defs с маркером-стрелкой если ещё нет
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
        const key = [f.fromId, f.toId].sort().join('-');
        pairs[key] = pairs[key] || [];
        pairs[key].push(f);
    });

    function colorForType(t){
        const palette = ["#8ab4ff","#7fe0c3","#ffb86b","#ff7aa2","#b58bff","#ffd66b","#64d2ff","#a4ff7a"];
        let h=0; for(let i=0;i<t.length;i++) h = (h*31 + t.charCodeAt(i))>>>0;
        return palette[h % palette.length];
    }

    Object.values(pairs).forEach(flows => {
        flows.forEach((f, idx) => {
            const a = getNode(project, f.fromId), b = getNode(project, f.toId);
            if (!a || !b || !isNodeVisible(a) || !isNodeVisible(b)) return;

            const pathData = calculateOrthogonalPath(a, b, flows.length, idx, project.nodes);
            const line = document.createElementNS(svgNS, "path");
            line.setAttribute("d", pathData);
            line.setAttribute("marker-end", "url(#arrow)");
            line.setAttribute("class", "flowLine" + (f.status === "pending" ? " flowPending" : ""));
            line.setAttribute("stroke", colorForType(f.flowType));
            line.setAttribute("fill", "none");
            line.setAttribute("stroke-width", "2");

            // Делаем стрелку кликабельной
            line.style.cursor = 'pointer';
            line.addEventListener('click', (e) => {
                e.stopPropagation();
                openFlowInspector(f.id);
            });

            const title = document.createElementNS(svgNS, "title");
            title.textContent = `${f.flowType} • ${f.status} • ${fmtMoney(f.grossAmount)} ${f.currency}`;
            line.appendChild(title);
            svg.appendChild(line);

            // Выводим подпись с суммой и тегом сделки на стрелку
            let labelText = `${fmtMoney(f.grossAmount)} ${f.currency}`;
            if (f.dealTag) {
                labelText += ` | 🏷 ${f.dealTag}`;
            }
            const textEl = document.createElementNS(svgNS, "text");
            textEl.setAttribute("class", "flowLine");
            textEl.setAttribute("fill", "var(--text, #ccc)");
            textEl.setAttribute("font-size", "10");
            textEl.setAttribute("pointer-events", "none");
            // Позиционируем текст посередине пути
            const midA = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
            const midB = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
            textEl.setAttribute("x", String((midA.x + midB.x) / 2));
            textEl.setAttribute("y", String((midA.y + midB.y) / 2 - 6));
            textEl.setAttribute("text-anchor", "middle");
            textEl.textContent = labelText;
            svg.appendChild(textEl);
        });
    });
}

export function pointerToCanvas(ev){
  const viewport = document.getElementById('viewport');
  const rect = viewport.getBoundingClientRect();
  return {
    x: (ev.clientX - rect.left - boardState.x) / boardState.scale,
    y: (ev.clientY - rect.top - boardState.y) / boardState.scale
  };
}
export function getCanvasBounds(){ return { W: Number(document.getElementById("canvas-board")?.dataset?.w || 5000), H: Number(document.getElementById("canvas-board")?.dataset?.h || 5000) }; }
export function findParentZoneId(p, z){
  if (!z) return null;
  let pid = (z.parentId || null);
  if (!pid){ if (z.id === 'KZ_AIFC' || z.id === 'KZ_HUB') pid = 'KZ_STD'; }
  if (!pid) return null;
  const par = getZone(p, pid);
  if (!par || !isZoneEnabled(p, par) || par.jurisdiction !== z.jurisdiction) return null;
  return pid;
}
export function getZoneMinSize(p, z, parentId){ return parentId ? { minW: 240, minH: 200 } : { minW: 320, minH: 260 }; }
export function getZoneBounds(p, parentId){
  const { W, H } = getCanvasBounds();
  let minX = 0, minY = 0, maxX = W, maxY = H;
  if (parentId){ const par = getZone(p, parentId); if (par){ minX = par.x; minY = par.y; maxX = par.x + par.w; maxY = par.y + par.h; } }
  return { minX, minY, maxX, maxY, W, H };
}
export function clampRect(rect, bounds){
  let { x, y, w, h } = rect; const { minX, minY, maxX, maxY } = bounds;
  if (w > (maxX - minX)) w = (maxX - minX); if (h > (maxY - minY)) h = (maxY - minY);
  x = Math.max(minX, Math.min(maxX - w, x)); y = Math.max(minY, Math.min(maxY - h, y));
  return { x, y, w, h };
}
export function normalizeOneZone(p, zoneId){
  const z = getZone(p, zoneId);
  if (!z || !isZoneEnabled(p, z)) return;
  const parentId = findParentZoneId(p, z);
  const bounds = getZoneBounds(p, parentId), ms = getZoneMinSize(p, z, parentId);
  z.w = Math.max(ms.minW, z.w); z.h = Math.max(ms.minH, z.h);
  const clamped = clampRect({ x:z.x, y:z.y, w:z.w, h:z.h }, bounds);
  z.x = clamped.x; z.y = clamped.y; z.w = clamped.w; z.h = clamped.h;
}
export function listChildZoneIds(p, parentId){ return p.zones.filter(z=>isZoneEnabled(p, z) && findParentZoneId(p, z) === parentId).map(z=>z.id); }
export function normalizeZoneCascade(p, rootZoneId){
  const seen = new Set(), q = [rootZoneId];
  while (q.length){
    const id = q.shift();
    if (!id || seen.has(id)) continue;
    seen.add(id); normalizeOneZone(p, id);
    listChildZoneIds(p, id).forEach(k=>q.push(k));
  }
}
export function syncTXANodes(p){
  for (const z of p.zones){
    const txa = getNode(p, 'txa_' + z.id);
    if (!txa) continue;
    txa.zoneId = z.id;
    const c = clampToZoneExclusive(p, txa, z, txa.x, txa.y, 14);
    txa.x = c.x; txa.y = c.y;
  }
}

export function onZonePointerDown(ev, zoneId, mode, handle){
  const project = state.project;
  if (project.readOnly || (project.ui?.editMode || 'nodes') !== 'zones') return;
  const z = getZone(project, zoneId);
  if (!z) return;
  uiState.dragZone.active = true; uiState.dragZone.zoneId = zoneId; uiState.dragZone.mode = mode; uiState.dragZone.handle = handle || null;
  uiState.dragZone.orig = { x:z.x, y:z.y, w:z.w, h:z.h }; uiState.dragZone.parentId = findParentZoneId(project, z);
  const pt = pointerToCanvas(ev); uiState.dragZone.startX = pt.x; uiState.dragZone.startY = pt.y;
  document.getElementById('canvas-board').setPointerCapture(ev.pointerId); ev.preventDefault(); ev.stopPropagation();
}

export function onPointerDown(ev, nodeId){
  const project = state.project;
  const n = getNode(project, nodeId);
  if (!n || project.readOnly || (n.type === "company" && n.frozen)) return;
  uiState.drag.active = true; uiState.drag.nodeId = nodeId; uiState.drag.lockZone = (n.type === "txa");
  uiState.drag.lockZoneId = uiState.drag.lockZone ? (n.zoneId || (String(n.id||"").startsWith("txa_") ? String(n.id).slice(4) : null) || null) : null;
  if (uiState.drag.lockZone){ uiState.drag.lastValidX = n.x; uiState.drag.lastValidY = n.y; }
  const pt = pointerToCanvas(ev); uiState.drag.offX = pt.x - n.x; uiState.drag.offY = pt.y - n.y;
  document.getElementById('canvas-board').setPointerCapture(ev.pointerId); ev.preventDefault();
}

export function onPointerMove(ev){
  const project = state.project;
  const board = document.getElementById("canvas-board");
  const W = Number(board?.dataset?.w || 5000);
  const H = Number(board?.dataset?.h || 5000);
  const pt = pointerToCanvas(ev);
  
  if (uiState.dragZone.active){
    const z = getZone(project, uiState.dragZone.zoneId);
    if (!z) return;
    const dx = pt.x - uiState.dragZone.startX;
    const dy = pt.y - uiState.dragZone.startY;
    const bounds = getZoneBounds(project, uiState.dragZone.parentId);
    const ms = getZoneMinSize(project, z, uiState.dragZone.parentId);
    let x = uiState.dragZone.orig.x, y = uiState.dragZone.orig.y, w = uiState.dragZone.orig.w, h = uiState.dragZone.orig.h;
    if (uiState.dragZone.mode === "move"){
      x = uiState.dragZone.orig.x + dx;
      y = uiState.dragZone.orig.y + dy;
    } else {
      const handle = uiState.dragZone.handle || "se";
      if (handle.includes("e")) w = uiState.dragZone.orig.w + dx;
      if (handle.includes("s")) h = uiState.dragZone.orig.h + dy;
      if (handle.includes("w")){ w = uiState.dragZone.orig.w - dx; x = uiState.dragZone.orig.x + dx; }
      if (handle.includes("n")){ h = uiState.dragZone.orig.h - dy; y = uiState.dragZone.orig.y + dy; }
      if (w < ms.minW){ if (handle.includes("w")) x = uiState.dragZone.orig.x + (uiState.dragZone.orig.w - ms.minW); w = ms.minW; }
      if (h < ms.minH){ if (handle.includes("n")) y = uiState.dragZone.orig.y + (uiState.dragZone.orig.h - ms.minH); h = ms.minH; }
    }
    if (project.ui?.snapToGrid){
      const gs = Number(project.ui.gridSize || 10);
      x = Math.round(x/gs)*gs; y = Math.round(y/gs)*gs;
      w = Math.round(w/gs)*gs; h = Math.round(h/gs)*gs;
    }
    if (w > bounds.maxX - bounds.minX) w = bounds.maxX - bounds.minX;
    if (h > bounds.maxY - bounds.minY) h = bounds.maxY - bounds.minY;
    x = Math.max(bounds.minX, Math.min(bounds.maxX - w, x));
    y = Math.max(bounds.minY, Math.min(bounds.maxY - h, y));
    z.x = x; z.y = y; z.w = w; z.h = h;
    const zel = document.querySelector('.zone[data-zone-id="'+uiState.dragZone.zoneId+'"]');
    if (zel){ zel.style.left = x + "px"; zel.style.top = y + "px"; zel.style.width = w + "px"; zel.style.height = h + "px"; }
    updateCanvasArrows(); 
    return;
  }
  
  if (!uiState.drag.active) return;
  const n = getNode(project, uiState.drag.nodeId);
  if (!n) return;
  let nx = Math.max(0, Math.min(W - n.w, pt.x - uiState.drag.offX));
  let ny = Math.max(0, Math.min(H - n.h, pt.y - uiState.drag.offY));

  if (uiState.drag.lockZone && uiState.drag.lockZoneId){
    const z = getZone(project, uiState.drag.lockZoneId);
    if (z){ const pad = 12; const c = clampToZoneExclusive(project, n, z, nx, ny, pad); nx = c.x; ny = c.y; }
  }
  if (project.ui?.snapToGrid){
    const gs = Number(project.ui.gridSize || 10); nx = Math.round(nx/gs)*gs; ny = Math.round(ny/gs)*gs;
  }
  if (uiState.drag.lockZone && uiState.drag.lockZoneId){
    const z = getZone(project, uiState.drag.lockZoneId);
    if (z){
      const pad = 12; const c3 = clampToZoneExclusive(project, n, z, nx, ny, pad); nx = c3.x; ny = c3.y;
      const ri = (a,b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
      const nr = { x:nx, y:ny, w:n.w, h:n.h };
      const nested = project.zones.filter(zz => zz.id !== z.id && isZoneEnabled(project, zz)).filter(zz => zoneArea(zz) < zoneArea(z)).filter(zz => ri(zz, z));
      const hits = nested.filter(zz => ri(nr, zz));
      if (hits.length){ nx = uiState.drag.lastValidX; ny = uiState.drag.lastValidY; } else { uiState.drag.lastValidX = nx; uiState.drag.lastValidY = ny; }
    }
  }
  const tempNode = Object.assign({}, n, { x:nx, y:ny });
  const hz = detectZoneId(project, tempNode);
  if (hz !== uiState.hoverZoneId){
    const prev = uiState.hoverZoneId; uiState.hoverZoneId = hz;
    if (prev){ const pel = document.querySelector('.zone[data-zone-id="'+prev+'"]'); if (pel) pel.classList.remove('hover'); }
    if (uiState.hoverZoneId){ const nel = document.querySelector('.zone[data-zone-id="'+uiState.hoverZoneId+'"]'); if (nel) nel.classList.add('hover'); }
  }
  n.x = nx; n.y = ny;
  const el = document.querySelector('.node[data-node-id="'+uiState.drag.nodeId+'"]');
  if (el){ el.style.left = n.x + "px"; el.style.top = n.y + "px"; }
  
  updateCanvasArrows(); 
}

export async function onPointerUp(ev){
  const project = state.project;
  const board = document.getElementById('canvas-board');
  if (uiState.dragZone.active){
    const z = getZone(project, uiState.dragZone.zoneId); uiState.dragZone.active = false;
    if (z) { normalizeZoneCascade(project, z.id); syncTXANodes(project); save(); render(); }
    try { board.releasePointerCapture(ev.pointerId); } catch(e){} return;
  }
  if (!uiState.drag.active) return;
  const n = getNode(project, uiState.drag.nodeId); uiState.drag.active = false;
  if (n) { n.zoneId = detectZoneId(project, n); save(); render(); }
  try { board.releasePointerCapture(ev.pointerId); } catch(e){}
}

export function onPointerCancel(ev){
  uiState.drag.active = false; uiState.dragZone.active = false; uiState.hoverZoneId = null; boardState.isPanning = false; render();
}

export function renderCanvas(){
  const project = state.project;
  const board = document.getElementById('canvas-board');
  const zonesLayer = document.getElementById('zones-layer');
  const nodesLayer = document.getElementById('nodes-layer');
  const arrowsLayer = document.getElementById('arrows-layer');
  if (!board || !zonesLayer || !nodesLayer || !arrowsLayer) return;

  zonesLayer.innerHTML = "";
  nodesLayer.innerHTML = "";
  arrowsLayer.innerHTML = "";

  const W = 5000;
  const H = 5000;
  board.dataset.w = String(W); board.dataset.h = String(H);
  board.style.width = W + "px"; board.style.height = H + "px";
  const editMode = (project.ui?.editMode || "nodes");

  project.zones.filter(z=>isZoneEnabled(project,z)).forEach(z=>{
    const el = document.createElement('div');
    el.className = 'zone' + (z.id === uiState.hoverZoneId ? ' hover' : '') + (editMode === "zones" ? ' editable' : '');
    el.dataset.zoneId = z.id; el.style.left = z.x + "px"; el.style.top = z.y + "px";
    el.style.width = z.w + "px"; el.style.height = z.h + "px";
    el.style.borderColor = z.jurisdiction === "KZ" ? "rgba(79,140,255,.55)" : "rgba(151,163,179,.35)";
    el.style.background = z.jurisdiction === "KZ" ? "rgba(79,140,255,.06)" : "rgba(151,163,179,.05)";

    // Отрисовка умной зоны
    const flag = project.catalogs?.jurisdictions?.find(j => j.id === z.jurisdiction)?.flag || '';
    const titleText = z.kind === 'country' ? `${flag} ${z.name}` : z.name;

    el.innerHTML = `
      <div class="zone-header" data-id="${z.id}" title="Потяните, чтобы переместить">
         ${escapeHtml(titleText)}
      </div>
      <div class="zone-resize-handle" data-id="${z.id}" title="Потяните, чтобы изменить размер"></div>
    `;

    zonesLayer.appendChild(el);
  });

  updateCanvasArrows();
  
project.nodes.forEach(n=>{
      if (!isNodeVisible(n)) return;
      const risks = (n.riskFlags||[]);
      const hasCfc = risks.some(f=>f.type==="CFC_RISK");
      const riskCount = risks.length;
      const el = document.createElement('div');
      el.className = 'node' + (n.frozen ? ' frozen' : '') + (hasCfc ? ' risk' : '') + (n.type==="txa" ? ' txa' : '');
      el.style.left = n.x + "px"; el.style.top = n.y + "px"; el.style.width = n.w + "px"; el.style.height = n.h + "px";
      el.dataset.nodeId = n.id;
      const zCode = getZone(project, n.zoneId) ? getZone(project, n.zoneId).code : "none";
      
      // ДОБАВЛЯЕМ ИКОНКУ ШЕСТЕРЕНКИ ⚙️
      el.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div class="nTitle">${escapeHtml(n.name)}</div>
            <div class="node-edit-icon" style="cursor:pointer; opacity:0.6; font-size:14px; transition:opacity 0.2s;" title="Настройки / Удалить">⚙️</div>
        </div>
        <div class="nSub">Regime: ${escapeHtml(zCode)}</div>
        <div class="badges">
          <span class="badge">${escapeHtml(n.type)}</span>
          ${n.type==="company" ? (n.frozen ? `<span class="badge danger">FROZEN</span>` : `<span class="badge ok">OK</span>`) : ""}
          ${hasCfc ? `<span class="badge danger">CFC</span>` : ""}
          ${riskCount ? `<span class="badge danger">RISK ${riskCount}</span>` : ""}
        </div>
      `;
      el.style.cursor = (n.type==="company" && n.frozen) ? "not-allowed" : "grab";
      
      // Эффект наведения на шестеренку
      const icon = el.querySelector('.node-edit-icon');
      icon.onmouseenter = () => icon.style.opacity = '1';
      icon.onmouseleave = () => icon.style.opacity = '0.6';

      el.addEventListener('pointerdown', (ev)=>onPointerDown(ev, n.id));

      // КРАСИВОЕ ВСПЛЫВАЮЩЕЕ ОКНО (МОДАЛКА) ДЛЯ НАСТРОЕК
      const openSettingsModal = (ev) => {
          if (project.readOnly) return toast("Read-only: изменения запрещены");
          ev.stopPropagation();
          if (n.type === "txa") return toast("TXA редактируется через настройки режима");

          if (document.getElementById('nodeModal')) document.getElementById('nodeModal').remove();

          const overlay = document.createElement('div');
          overlay.id = 'nodeModal';
          overlay.style.cssText = "position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(15, 23, 42, 0.4); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); display:flex; align-items:center; justify-content:center; z-index:9999;";

          const zonesList = project.zones.filter(z=>isZoneEnabled(project, z)).map(z=>`<option value="${z.id}" ${z.id===n.zoneId?'selected':''}>${escapeHtml(z.name)} (${escapeHtml(z.code)})</option>`).join('');

          overlay.innerHTML = `
              <div style="background: var(--panel); padding: 24px; border-radius: 16px; width: 440px; border: 1px solid var(--stroke); box-shadow: var(--shadow); color: var(--text);">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                      <h3 style="margin:0; font-weight: 800; font-size: 16px;">Настройки: ${escapeHtml(n.name)}</h3>
                      <span class="badge ${n.type === 'company' ? 'ok' : ''}">${escapeHtml(n.type)}</span>
                  </div>

                  <div class="sep" style="margin-bottom: 16px;"></div>

                  <div style="margin-bottom: 14px;">
                      <label>Название элемента</label>
                      <input id="editNodeName" value="${escapeHtml(n.name)}" placeholder="Например: HoldCo" />
                  </div>

                  <div style="margin-bottom: 14px;">
                      <label>Юрисдикция (Налоговый режим)</label>
                      <select id="editNodeZone">
                          <option value="">(Вне зоны / Независимый)</option>
                          ${zonesList}
                      </select>
                  </div>

                  <div style="background: var(--bg-grid); padding: 12px; border-radius: 8px; border: 1px solid var(--stroke); margin-bottom: 24px;">
                      <div style="font-weight: 700; font-size: 12px; margin-bottom: 10px; color: var(--accent);">ОПЕРАЦИОННАЯ ДЕЯТЕЛЬНОСТЬ</div>

                      <div style="margin-bottom: 10px;">
                          <label>Внешняя выручка (Gross Revenue, KZT)</label>
                          <input id="editNodeGross" type="number" value="${Number(n.grossRevenue||0)}" placeholder="0" />
                      </div>

                      <div style="margin-bottom: 4px;">
                          <label>Фикс. операционные расходы (Lump-sum OPEX, KZT)</label>
                          <input id="editNodeOpex" type="number" value="${Number(n.lumpOpex||0)}" placeholder="0" />
                      </div>
                      <div class="small" style="color: var(--muted); line-height: 1.3;">
                          * База для корпоративного налога (CIT) будет рассчитана как (Выручка - OPEX) + все входящие финансовые потоки.
                      </div>
                  </div>

                  <div class="sep" style="margin-bottom: 16px;"></div>

                  <div style="display: flex; justify-content: space-between; align-items: center;">
                      <button class="btn danger" id="btnDeleteNode">Удалить узел</button>
                      <div style="display: flex; gap: 8px;">
                          <button class="btn secondary" id="btnCancelNode">Отмена</button>
                          <button class="btn" id="btnSaveNode">Сохранить</button>
                      </div>
                  </div>
              </div>
          `;

          document.body.appendChild(overlay);

          document.getElementById('btnCancelNode').onclick = () => overlay.remove();

          document.getElementById('btnSaveNode').onclick = () => {
              n.name = document.getElementById('editNodeName').value.trim() || n.name;

              // Сохраняем новые бизнес-метрики
              n.grossRevenue = Number(document.getElementById('editNodeGross').value) || 0;
              n.lumpOpex = Math.abs(Number(document.getElementById('editNodeOpex').value)) || 0;

              // Для обратной совместимости с текущим ядром до обновления:
              n.annualIncome = Math.max(0, n.grossRevenue - n.lumpOpex);

              const newZ = document.getElementById('editNodeZone').value;
              if (newZ !== n.zoneId) {
                  n.zoneId = newZ || null;
                  if (newZ) {
                      const zTarget = getZone(project, newZ);
                      if (zTarget) { n.x = Math.round(zTarget.x + zTarget.w/2 - n.w/2); n.y = Math.round(zTarget.y + zTarget.h/2 - n.h/2); }
                  }
              }
              recomputeRisks(project); save(); render(); overlay.remove();
          };

          document.getElementById('btnDeleteNode').onclick = () => {
              if (!confirm(`Удалить узел "${n.name}"? Все связанные финансовые потоки и структуры владения будут безвозвратно удалены.`)) return;
              overlay.remove();
              el.classList.add('dissolving');
              setTimeout(async () => {
                  const before = JSON.parse(JSON.stringify({ nodes: project.nodes, flows: project.flows, ownership: project.ownership }));
                  project.nodes = project.nodes.filter(x => x.id !== n.id);
                  project.flows = project.flows.filter(f => f.fromId !== n.id && f.toId !== n.id);
                  project.ownership = project.ownership.filter(o => o.fromId !== n.id && o.toId !== n.id);

                  await auditAppend(project, 'NODE_DELETE', { entityType:'NODE', entityId:n.id }, before, { nodes: project.nodes }, {note:'Deleted via UI cascade'});
                  recomputeRisks(project); save(); render(); toast("Узел удален");
              }, 1500);
          };
      };

      // Открываем модалку по клику на шестеренку или по двойному клику
      icon.addEventListener('pointerdown', openSettingsModal);
      el.addEventListener('dblclick', openSettingsModal);

      nodesLayer.appendChild(el);
    });

  board.onpointermove = (ev) => {
      onPointerMove(ev);
      if (uiState.drag.active || uiState.dragZone.active) updateCanvasArrows();
  };
  board.onpointerup = onPointerUp;
  board.onpointercancel = onPointerCancel;

  // Переприменяем transform доски после рендера
  updateBoardTransform();
}
