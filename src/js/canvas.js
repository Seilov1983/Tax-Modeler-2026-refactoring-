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

// 1. ИЗОЛИРОВАННЫЙ КОНТРОЛЛЕР ХОЛСТА
export function initBoardInteractions() {
    const viewport = document.getElementById('viewport');
    const board = document.getElementById('canvas-board');
    if (!viewport || !board) return;

    viewport.addEventListener('pointerdown', (e) => {
        // Если кликнули на элемент управления - игнорируем, они сами перехватят мышь
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

// 2. ГЕОМЕТРИЯ И УТИЛИТЫ СВЯЗЕЙ
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

export function isNodeVisible(n){
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
            line.setAttribute("d", pathData); line.setAttribute("marker-end", "url(#arrow)");
            line.setAttribute("class", "flowLine" + (f.status === "pending" ? " flowPending" : ""));
            line.setAttribute("stroke", colorForType(f.flowType)); line.setAttribute("fill", "none"); line.setAttribute("stroke-width", "2");
            line.style.cursor = 'pointer';
            line.addEventListener('click', (e) => { e.stopPropagation(); openFlowInspector(f.id); });
            svg.appendChild(line);

            let labelText = `${fmtMoney(f.grossAmount)} ${f.currency}`;
            if (f.dealTag) labelText += ` | 🏷 ${f.dealTag}`;
            const textEl = document.createElementNS(svgNS, "text");
            textEl.setAttribute("class", "flowLine"); textEl.setAttribute("fill", "var(--text, #ccc)"); textEl.setAttribute("font-size", "10"); textEl.setAttribute("pointer-events", "none");
            const midA = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, midB = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
            textEl.setAttribute("x", String((midA.x + midB.x) / 2)); textEl.setAttribute("y", String((midA.y + midB.y) / 2 - 6));
            textEl.setAttribute("text-anchor", "middle"); textEl.textContent = labelText;
            svg.appendChild(textEl);
        });
    });
}

// 3. УТИЛИТЫ ЗОН (Экспортируются для ui.js)
export function pointerToCanvas(ev){
  const viewport = document.getElementById('viewport'), rect = viewport.getBoundingClientRect();
  return { x: (ev.clientX - rect.left - boardState.x) / boardState.scale, y: (ev.clientY - rect.top - boardState.y) / boardState.scale };
}
export function getCanvasBounds(){ return { W: Number(document.getElementById("canvas-board")?.dataset?.w || 5000), H: Number(document.getElementById("canvas-board")?.dataset?.h || 5000) }; }
export function findParentZoneId(p, z){
  if (!z) return null; let pid = (z.parentId || null);
  if (!pid){ if (z.id === 'KZ_AIFC' || z.id === 'KZ_HUB') pid = 'KZ_STD'; }
  if (!pid) return null;
  const par = getZone(p, pid);
  if (!par || !isZoneEnabled(p, par) || par.jurisdiction !== z.jurisdiction) return null;
  return pid;
}
export function getZoneMinSize(p, z, parentId){ return parentId ? { minW: 240, minH: 200 } : { minW: 320, minH: 260 }; }
export function getZoneBounds(p, parentId){
  const { W, H } = getCanvasBounds(); let minX = 0, minY = 0, maxX = W, maxY = H;
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
  const z = getZone(p, zoneId); if (!z || !isZoneEnabled(p, z)) return;
  const parentId = findParentZoneId(p, z), bounds = getZoneBounds(p, parentId), ms = getZoneMinSize(p, z, parentId);
  z.w = Math.max(ms.minW, z.w); z.h = Math.max(ms.minH, z.h);
  const clamped = clampRect({ x:z.x, y:z.y, w:z.w, h:z.h }, bounds);
  z.x = clamped.x; z.y = clamped.y; z.w = clamped.w; z.h = clamped.h;
}
export function listChildZoneIds(p, parentId){ return p.zones.filter(z=>isZoneEnabled(p, z) && findParentZoneId(p, z) === parentId).map(z=>z.id); }
export function normalizeZoneCascade(p, rootZoneId){
  const seen = new Set(), q = [rootZoneId];
  while (q.length){
    const id = q.shift(); if (!id || seen.has(id)) continue;
    seen.add(id); normalizeOneZone(p, id); listChildZoneIds(p, id).forEach(k=>q.push(k));
  }
}
export function syncTXANodes(p){
  for (const z of p.zones){
    const txa = getNode(p, 'txa_' + z.id); if (!txa) continue;
    txa.zoneId = z.id; const c = clampToZoneExclusive(p, txa, z, txa.x, txa.y, 14); txa.x = c.x; txa.y = c.y;
  }
}

// Заглушки, чтобы app.js не падал при импорте
export function onPointerCancel() { boardState.isPanning = false; }
export function onPointerMove() {}
export function onPointerUp() {}
export function onPointerDown() {}
export function onZonePointerDown() {}

// 4. ГЛАВНЫЙ РЕНДЕР И ИЗОЛИРОВАННАЯ ЛОГИКА
export function renderCanvas(){
  const project = state.project;
  const board = document.getElementById('canvas-board');
  const zonesLayer = document.getElementById('zones-layer');
  const nodesLayer = document.getElementById('nodes-layer');
  const arrowsLayer = document.getElementById('arrows-layer');
  if (!board || !zonesLayer || !nodesLayer || !arrowsLayer) return;

  zonesLayer.innerHTML = ""; nodesLayer.innerHTML = ""; arrowsLayer.innerHTML = "";
  board.dataset.w = "5000"; board.dataset.h = "5000"; board.style.width = "5000px"; board.style.height = "5000px";

  // --- РЕНДЕР ЗОН ---
  project.zones.filter(z=>isZoneEnabled(project,z)).forEach(z=>{
    const el = document.createElement('div');
    el.className = 'zone' + (z.id === uiState.hoverZoneId ? ' hover' : '');
    el.dataset.zoneId = z.id;
    el.style.left = z.x + "px"; el.style.top = z.y + "px"; el.style.width = z.w + "px"; el.style.height = z.h + "px";
    el.style.pointerEvents = "none";

    const flag = project.catalogs?.jurisdictions?.find(j => j.id === z.jurisdiction)?.flag || '';
    const titleText = z.kind === 'country' ? `${flag} ${z.name}` : z.name;

    el.innerHTML = `
      <div class="zone-header" data-id="${z.id}" title="Потяните, чтобы переместить" style="pointer-events: auto;">
         ${escapeHtml(titleText)}
      </div>
      <div class="zone-resize-handle" data-id="${z.id}" title="Потяните, чтобы изменить размер" style="pointer-events: auto;"></div>
    `;

    const header = el.querySelector('.zone-header');
    const resize = el.querySelector('.zone-resize-handle');

    if (header) {
        header.addEventListener('pointerdown', (ev) => {
            if (project.readOnly) return;
            ev.preventDefault(); ev.stopPropagation();
            const startPt = pointerToCanvas(ev), origX = z.x, origY = z.y;
            header.setPointerCapture(ev.pointerId);

            const onMove = (mEv) => {
                const pt = pointerToCanvas(mEv);
                z.x = origX + (pt.x - startPt.x); z.y = origY + (pt.y - startPt.y);
                if (project.ui?.snapToGrid) { const gs = project.ui.gridSize || 10; z.x = Math.round(z.x/gs)*gs; z.y = Math.round(z.y/gs)*gs; }
                el.style.left = z.x + "px"; el.style.top = z.y + "px"; updateCanvasArrows();
            };
            const onUp = (uEv) => {
                header.releasePointerCapture(uEv.pointerId);
                header.removeEventListener('pointermove', onMove); header.removeEventListener('pointerup', onUp);
                normalizeZoneCascade(project, z.id); syncTXANodes(project); save(); renderCanvas();
            };
            header.addEventListener('pointermove', onMove); header.addEventListener('pointerup', onUp);
        });
    }

    if (resize) {
        resize.addEventListener('pointerdown', (ev) => {
            if (project.readOnly) return;
            ev.preventDefault(); ev.stopPropagation();
            const startPt = pointerToCanvas(ev), origW = z.w, origH = z.h;
            resize.setPointerCapture(ev.pointerId);

            const onMove = (mEv) => {
                const pt = pointerToCanvas(mEv);
                z.w = Math.max(200, origW + (pt.x - startPt.x)); z.h = Math.max(150, origH + (pt.y - startPt.y));
                if (project.ui?.snapToGrid) { const gs = project.ui.gridSize || 10; z.w = Math.round(z.w/gs)*gs; z.h = Math.round(z.h/gs)*gs; }
                el.style.width = z.w + "px"; el.style.height = z.h + "px"; updateCanvasArrows();
            };
            const onUp = (uEv) => {
                resize.releasePointerCapture(uEv.pointerId);
                resize.removeEventListener('pointermove', onMove); resize.removeEventListener('pointerup', onUp);
                normalizeZoneCascade(project, z.id); syncTXANodes(project); save(); renderCanvas();
            };
            resize.addEventListener('pointermove', onMove); resize.addEventListener('pointerup', onUp);
        });
    }
    zonesLayer.appendChild(el);
  });

  updateCanvasArrows();
  
  // --- РЕНДЕР УЗЛОВ ---
  project.nodes.forEach(n=>{
      if (!isNodeVisible(n)) return;
      const risks = (n.riskFlags||[]);
      const hasCfc = risks.some(f=>f.type==="CFC_RISK");
      const riskCount = risks.length;
      const el = document.createElement('div');
      const isTxa = (n.type==="txa");
      el.className = 'node' + (n.frozen ? ' frozen' : '') + (hasCfc ? ' risk' : '') + (isTxa ? ' txa' : '');
      el.style.left = n.x + "px"; el.style.top = n.y + "px"; el.style.width = n.w + "px"; el.style.height = n.h + "px";
      el.dataset.nodeId = n.id;
      const zCode = getZone(project, n.zoneId) ? getZone(project, n.zoneId).code : "none";
      
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
      
      const icon = el.querySelector('.node-edit-icon');
      icon.onmouseenter = () => icon.style.opacity = '1';
      icon.onmouseleave = () => icon.style.opacity = '0.6';

      const openSettingsModal = (ev) => {
          if (project.readOnly) return toast("Read-only: изменения запрещены");
          ev.stopPropagation();
          if (isTxa) return toast("TXA редактируется через настройки режима");

          if (document.getElementById('nodeModal')) document.getElementById('nodeModal').remove();
          const overlay = document.createElement('div'); overlay.id = 'nodeModal';
          overlay.style.cssText = "position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(15, 23, 42, 0.4); backdrop-filter:blur(8px); display:flex; align-items:center; justify-content:center; z-index:9999;";
          const zonesList = project.zones.filter(z=>isZoneEnabled(project, z)).map(z=>`<option value="${z.id}" ${z.id===n.zoneId?'selected':''}>${escapeHtml(z.name)} (${escapeHtml(z.code)})</option>`).join('');

          overlay.innerHTML = `
              <div style="background: var(--panel); padding: 24px; border-radius: 16px; width: 440px; border: 1px solid var(--stroke); box-shadow: 0 10px 30px rgba(0,0,0,0.2); color: var(--text);">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                      <h3 style="margin:0; font-weight: 800; font-size: 16px;">Настройки: ${escapeHtml(n.name)}</h3>
                  </div>
                  <div style="margin-bottom: 14px;"><label>Название элемента</label><input class="md-input" id="editNodeName" value="${escapeHtml(n.name)}" /></div>
                  <div style="margin-bottom: 14px;"><label>Режим</label><select class="md-input" id="editNodeZone"><option value="">(Вне зоны)</option>${zonesList}</select></div>
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-top:20px;">
                      <button class="btn danger" id="btnDeleteNode">Удалить</button>
                      <div style="display: flex; gap: 8px;"><button class="btn secondary" id="btnCancelNode">Отмена</button><button class="btn ok" id="btnSaveNode">Сохранить</button></div>
                  </div>
              </div>
          `;
          document.body.appendChild(overlay);

          document.getElementById('btnCancelNode').onclick = () => overlay.remove();
          document.getElementById('btnSaveNode').onclick = () => {
              n.name = document.getElementById('editNodeName').value.trim() || n.name;
              const newZ = document.getElementById('editNodeZone').value;
              if (newZ !== n.zoneId) {
                  n.zoneId = newZ || null;
                  if (newZ) { const zTarget = getZone(project, newZ); if (zTarget) { n.x = Math.round(zTarget.x + zTarget.w/2 - n.w/2); n.y = Math.round(zTarget.y + zTarget.h/2 - n.h/2); } }
              }
              recomputeRisks(project); save(); renderCanvas(); overlay.remove();
          };
          document.getElementById('btnDeleteNode').onclick = () => {
              if (!confirm("Удалить узел?")) return;
              project.nodes = project.nodes.filter(x => x.id !== n.id);
              project.flows = project.flows.filter(f => f.fromId !== n.id && f.toId !== n.id);
              project.ownership = project.ownership.filter(o => o.fromId !== n.id && o.toId !== n.id);
              recomputeRisks(project); save(); renderCanvas(); overlay.remove();
          };
      };

      icon.addEventListener('pointerdown', openSettingsModal);
      el.addEventListener('dblclick', openSettingsModal);

      // Логика перетаскивания узла (ИЗОЛИРОВАННАЯ)
      el.addEventListener('pointerdown', (ev) => {
          if (project.readOnly || (n.type === "company" && n.frozen)) return;
          if (ev.target.closest('.node-edit-icon')) return;

          ev.preventDefault(); ev.stopPropagation();
          el.setPointerCapture(ev.pointerId);

          const startPt = pointerToCanvas(ev);
          const offX = startPt.x - n.x, offY = startPt.y - n.y;

          const onMove = (mEv) => {
              const pt = pointerToCanvas(mEv);
              let nx = pt.x - offX, ny = pt.y - offY;

              if (project.ui?.snapToGrid) { const gs = project.ui.gridSize || 10; nx = Math.round(nx/gs)*gs; ny = Math.round(ny/gs)*gs; }
              if (isTxa && n.zoneId) { const z = getZone(project, n.zoneId); if (z) { const c = clampToZoneExclusive(project, n, z, nx, ny, 12); nx = c.x; ny = c.y; } }

              n.x = nx; n.y = ny;
              el.style.left = nx + "px"; el.style.top = ny + "px";

              if (!isTxa) {
                  const hz = detectZoneId(project, n);
                  if (hz !== uiState.hoverZoneId) {
                      if (uiState.hoverZoneId) { const pel = document.querySelector('.zone[data-zone-id="'+uiState.hoverZoneId+'"]'); if (pel) pel.classList.remove('hover'); }
                      uiState.hoverZoneId = hz;
                      if (hz) { const nel = document.querySelector('.zone[data-zone-id="'+hz+'"]'); if (nel) nel.classList.add('hover'); }
                  }
              }
              updateCanvasArrows();
          };

          const onUp = (uEv) => {
              el.releasePointerCapture(uEv.pointerId);
              el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp);
              if (!isTxa) n.zoneId = detectZoneId(project, n);
              uiState.hoverZoneId = null; save(); renderCanvas();
          };

          el.addEventListener('pointermove', onMove); el.addEventListener('pointerup', onUp);
      });

      nodesLayer.appendChild(el);
  });

  updateBoardTransform();
}
