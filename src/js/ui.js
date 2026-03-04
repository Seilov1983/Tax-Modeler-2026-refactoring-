import { 
  escapeHtml, fmtMoney, formatMoney, toast, uid, isoDate, nowIso, bankersRound2, 
  numOrNull, toLocalDateTimeInput, fromLocalDateTimeInput 
} from './utils.js';
import { state, uiState, save, auditAppend, verifyAudit, SCHEMA_VERSION } from './state.js';
import {
  ensureMasterData, ensureZoneTaxDefaults, effectiveZoneTax, computeWht,
  whtDefaultPercentForFlow, updateFlowCompliance, canCreateOutgoing,
  getZone, getNode, listCompanies, listPersons, isZoneEnabled, detectZoneId,
  makeNode, frozenThresholdFunctional, nodeDebtToTXA, yearOf, isYearClosed,
  ensurePeriods, ensureAccounting, ensureAccountingYear, createSnapshot,
  runPipeline, recomputeFrozen, recomputeRisks, applyTaxAdjustment, convert,
  bootstrapNormalizeZones, defaultCatalogs, makeTXA, makeFlowDraft, pointInZone
} from './engine.js';
import {
  renderCanvas, syncTXANodes, normalizeZoneCascade, boardState, updateBoardTransform,
  pointerToCanvas, saveCameraState, animateCameraToZone, animateCameraRestore, findZoneAtPoint
} from './canvas.js';

// ── Smart Focus DnD: Предустановленные шаблоны режимов по юрисдикциям ──
const REGIME_TEMPLATES = {
  KZ: [
    { code: 'KZ_STANDARD', name: 'Kazakhstan — Standard (KZT)', currency: 'KZT', w: 520, h: 380 },
    { code: 'KZ_AIFC', name: 'KZ — AIFC (qualifying services) (KZT)', currency: 'KZT', w: 260, h: 190 },
    { code: 'KZ_HUB', name: 'KZ — Astana Hub (ICT priority) (KZT)', currency: 'KZT', w: 230, h: 170 }
  ],
  UAE: [
    { code: 'UAE_MAINLAND', name: 'UAE — Mainland (AED)', currency: 'AED', w: 220, h: 220 },
    { code: 'UAE_FREEZONE_QFZP', name: 'UAE — Free Zone QFZP (AED)', currency: 'AED', w: 210, h: 105 },
    { code: 'UAE_FREEZONE_NONQFZP', name: 'UAE — Free Zone non-QFZP (AED)', currency: 'AED', w: 210, h: 105 }
  ],
  HK: [
    { code: 'HK_ONSHORE', name: 'Hong Kong — Onshore (HKD)', currency: 'HKD', w: 220, h: 210 },
    { code: 'HK_OFFSHORE', name: 'Hong Kong — Offshore (HKD)', currency: 'HKD', w: 210, h: 210 }
  ],
  CY: [{ code: 'CY_STANDARD', name: 'Cyprus (EUR)', currency: 'EUR', w: 260, h: 200 }],
  SG: [{ code: 'SG_STANDARD', name: 'Singapore (SGD)', currency: 'SGD', w: 260, h: 200 }],
  UK: [{ code: 'UK_STANDARD', name: 'United Kingdom (GBP)', currency: 'GBP', w: 220, h: 130 }],
  US: [{ code: 'US_DE', name: 'US — Delaware (USD)', currency: 'USD', w: 200, h: 130 }],
  BVI: [{ code: 'BVI_STANDARD', name: 'BVI (USD)', currency: 'USD', w: 260, h: 170 }],
  CAY: [{ code: 'CAY_STANDARD', name: 'Cayman (USD)', currency: 'USD', w: 260, h: 170 }],
  SEY: [{ code: 'SEY_STANDARD', name: 'Seychelles (SCR)', currency: 'SCR', w: 260, h: 170 }]
};

const JURISDICTION_CURRENCIES = {
  KZ: 'KZT', UAE: 'AED', HK: 'HKD', CY: 'EUR', SG: 'SGD',
  UK: 'GBP', US: 'USD', BVI: 'USD', CAY: 'USD', SEY: 'SCR'
};

let drawerMode = null;
let drawerSelectedJurisdiction = null;

// ── Smart Focus DnD: Right Drawer ──
export function openRightDrawer(mode, jurisdictionId) {
  const project = state.project;
  const drawer = document.getElementById('rightDrawer');
  const rdTitle = document.getElementById('rdTitle');
  const rdBody = document.getElementById('rdBody');
  if (!drawer || !rdBody) return;

  drawerMode = mode;
  rdBody.innerHTML = '';

  if (mode === 'COUNTRIES') {
    rdTitle.textContent = 'Добавить страну';

    const jurs = (project.catalogs?.jurisdictions || []).filter(j => j.enabled !== false);
    // Фильтрация: исключить юрисдикции, для которых уже есть зона с kind === 'country'
    const usedCountryJurs = new Set(
      project.zones.filter(z => z.kind === 'country').map(z => z.jurisdiction)
    );
    const available = jurs.filter(j => !usedCountryJurs.has(j.id));

    if (available.length === 0) {
      rdBody.innerHTML = '<div class="small" style="padding:20px; text-align:center;">Все доступные страны уже добавлены на канвас.</div>';
    } else {
      available.forEach(j => {
        const card = document.createElement('div');
        card.className = 'draggable-card';
        card.draggable = true;
        card.innerHTML = `
          <div>${escapeHtml(j.name)}</div>
          <div class="dc-sub">${escapeHtml(j.id)} · ${escapeHtml(JURISDICTION_CURRENCIES[j.id] || 'USD')} · Перетащите на канвас</div>
        `;
        card.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('application/json', JSON.stringify({
            type: 'country',
            jurisdictionId: j.id,
            jurisdictionName: j.name
          }));
          e.dataTransfer.effectAllowed = 'copy';
        });
        rdBody.appendChild(card);
      });
    }
  }
  else if (mode === 'REGIMES') {
    const jurId = jurisdictionId || drawerSelectedJurisdiction;
    drawerSelectedJurisdiction = jurId;
    rdTitle.textContent = 'Добавить режим';

    const jurs = (project.catalogs?.jurisdictions || []).filter(j => j.enabled !== false);

    // Селектор юрисдикции
    const selWrap = document.createElement('div');
    selWrap.style.cssText = 'margin-bottom: 10px;';
    selWrap.innerHTML = `
      <label>Страна</label>
      <select id="rdJurSel">${jurs.map(j =>
        `<option value="${j.id}" ${j.id === jurId ? 'selected' : ''}>${escapeHtml(j.name)} (${escapeHtml(j.id)})</option>`
      ).join('')}</select>
    `;
    rdBody.appendChild(selWrap);

    const cardsContainer = document.createElement('div');
    cardsContainer.className = 'col';
    cardsContainer.id = 'rdRegimeCards';
    rdBody.appendChild(cardsContainer);

    const renderRegimes = (selectedJurId) => {
      cardsContainer.innerHTML = '';
      const templates = REGIME_TEMPLATES[selectedJurId] || [];

      // Фильтрация: исключить режимы, для которых уже есть зона с kind === 'regime' внутри этой страны
      const usedRegimeCodes = new Set(
        project.zones
          .filter(z => z.kind === 'regime' && z.jurisdiction === selectedJurId)
          .map(z => z.code)
      );
      const available = templates.filter(t => !usedRegimeCodes.has(t.code));

      if (available.length === 0) {
        cardsContainer.innerHTML = `<div class="small" style="padding:20px; text-align:center;">${
          templates.length === 0
            ? 'Нет предустановленных режимов для этой страны.'
            : 'Все режимы этой страны уже добавлены.'
        }</div>`;
      } else {
        available.forEach(tmpl => {
          const card = document.createElement('div');
          card.className = 'draggable-card';
          card.draggable = true;
          card.innerHTML = `
            <div>${escapeHtml(tmpl.name)}</div>
            <div class="dc-sub">${escapeHtml(tmpl.code)} · ${escapeHtml(tmpl.currency)} · Перетащите на страну</div>
          `;
          card.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('application/json', JSON.stringify({
              type: 'regime',
              jurisdiction: selectedJurId,
              code: tmpl.code,
              name: tmpl.name,
              currency: tmpl.currency,
              w: tmpl.w || 260,
              h: tmpl.h || 200
            }));
            e.dataTransfer.effectAllowed = 'copy';

            // Анимация камеры: фокус на целевой стране
            const countryZone = project.zones.find(z =>
              z.jurisdiction === selectedJurId && (z.kind === 'country' || !z.kind)
            );
            if (countryZone) {
              saveCameraState();
              animateCameraToZone(countryZone);
            }
          });
          cardsContainer.appendChild(card);
        });
      }
    };

    renderRegimes(jurId || jurs[0]?.id);

    rdBody.querySelector('#rdJurSel')?.addEventListener('change', (ev) => {
      drawerSelectedJurisdiction = ev.target.value;
      renderRegimes(ev.target.value);
    });
  }

  drawer.classList.add('open');

  // Обработчик закрытия
  const closeBtn = document.getElementById('rdClose');
  if (closeBtn) closeBtn.onclick = () => closeRightDrawer();
}

export function closeRightDrawer() {
  const drawer = document.getElementById('rightDrawer');
  if (drawer) drawer.classList.remove('open');
  drawerMode = null;
}

function refreshDrawerIfOpen() {
  if (!drawerMode) return;
  if (drawerMode === 'COUNTRIES') openRightDrawer('COUNTRIES');
  else if (drawerMode === 'REGIMES') openRightDrawer('REGIMES', drawerSelectedJurisdiction);
}

// ── Smart Focus DnD: Инициализация обработчиков drop на канвасе ──
export function initCanvasDrop() {
  const viewport = document.getElementById('viewport');
  if (!viewport) return;

  viewport.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';

    // Подсвечиваем зоны-цели
    const pt = pointerToCanvas(e);
    const project = state.project;
    document.querySelectorAll('.zone.drop-target, .zone.drop-invalid').forEach(el => {
      el.classList.remove('drop-target', 'drop-invalid');
    });

    let dataStr;
    try { dataStr = e.dataTransfer.types.includes('application/json') ? 'has-data' : ''; } catch { dataStr = ''; }
    if (!dataStr) return;

    const hitZone = findZoneAtPoint(project, pt.x, pt.y);
    if (hitZone) {
      const el = document.querySelector(`.zone[data-zone-id="${hitZone.id}"]`);
      if (el) el.classList.add('drop-target');
    }
  });

  viewport.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget || !viewport.contains(e.relatedTarget)) {
      document.querySelectorAll('.zone.drop-target, .zone.drop-invalid').forEach(el => {
        el.classList.remove('drop-target', 'drop-invalid');
      });
    }
  });

  viewport.addEventListener('drop', async (e) => {
    e.preventDefault();
    document.querySelectorAll('.zone.drop-target, .zone.drop-invalid').forEach(el => {
      el.classList.remove('drop-target', 'drop-invalid');
    });

    const dataStr = e.dataTransfer.getData('application/json');
    if (!dataStr) return;

    let data;
    try { data = JSON.parse(dataStr); } catch { return; }

    const pt = pointerToCanvas(e);
    const project = state.project;

    if (data.type === 'country') {
      await handleCountryDrop(project, data, pt);
    } else if (data.type === 'regime') {
      await handleRegimeDrop(project, data, pt);
    } else if (data.type === 'node') {
      await handleNodeDrop(project, data, pt);
    }

    // Возврат камеры после drop
    animateCameraRestore();
  });

  // dragend: возврат камеры если drop не произошёл на канвасе
  document.addEventListener('dragend', () => {
    document.querySelectorAll('.zone.drop-target, .zone.drop-invalid').forEach(el => {
      el.classList.remove('drop-target', 'drop-invalid');
    });
    animateCameraRestore();
  });
}

// ── Строгая валидация: Обработка drop страны ──
async function handleCountryDrop(project, data, pt) {
  if (project.readOnly) return toast("Read-only: изменения запрещены");

  const jurId = data.jurisdictionId;
  const jurName = data.jurisdictionName;

  // Создаём зону-страну в точке drop
  const w = 500, h = 400;
  const x = Math.max(10, Math.round(pt.x - w / 2));
  const y = Math.max(10, Math.round(pt.y - h / 2));

  let zoneId = `${jurId}_COUNTRY`;
  let uniqueId = zoneId;
  let k = 2;
  while (getZone(project, uniqueId)) { uniqueId = `${zoneId}_${k++}`; }

  // Убедиться что курс валюты есть
  const currency = JURISDICTION_CURRENCIES[jurId] || 'USD';
  project.fx = project.fx || { fxDate: "2026-01-15", rateToKZT: { KZT: 1 }, source: "manual" };
  project.fx.rateToKZT = project.fx.rateToKZT || { KZT: 1 };
  if (!project.fx.rateToKZT[currency] && currency !== 'KZT') {
    const rStr = prompt(`Нет курса для ${currency} → KZT. Введите курс (число > 0):`, '500');
    const r = Number(rStr);
    if (!isFinite(r) || r <= 0) return toast("Неверный курс, отмена");
    project.fx.rateToKZT[currency] = r;
  }

  const z = {
    id: uniqueId, name: jurName, x, y, w, h,
    jurisdiction: jurId, code: `${jurId}_COUNTRY`, currency,
    zIndex: 1, kind: 'country', tax: {}
  };
  project.zones.push(z);

  // Убедиться что юрисдикция включена
  const jurSet = new Set(project.activeJurisdictions || []);
  jurSet.add(jurId);
  project.activeJurisdictions = Array.from(jurSet);
  if (!(project.catalogs.jurisdictions || []).some(j => j.id === jurId)) {
    project.catalogs.jurisdictions.push({ id: jurId, name: jurName, enabled: true });
  }

  // Создать TXA ноду
  const txa = makeTXA(z);
  if (!getNode(project, txa.id)) project.nodes.push(txa);

  normalizeZoneCascade(project, uniqueId);
  syncTXANodes(project);
  bootstrapNormalizeZones(project);
  recomputeRisks(project);

  await auditAppend(project, 'ZONE_CREATE', { entityType: 'ZONE', entityId: uniqueId }, {}, { zones: [z] }, { note: 'Country zone created via Smart Focus DnD' });
  save();
  toast(`Страна «${jurName}» добавлена на канвас`);
  render();
  refreshDrawerIfOpen();
}

// ── Строгая валидация: Обработка drop режима ──
async function handleRegimeDrop(project, data, pt) {
  if (project.readOnly) return toast("Read-only: изменения запрещены");

  // Валидация: курсор должен быть строго внутри зоны с kind === 'country' и совпадающей jurisdiction
  const hitZones = project.zones.filter(z =>
    isZoneEnabled(project, z) && pointInZone(pt.x, pt.y, z)
  );

  const targetCountry = hitZones.find(z =>
    (z.kind === 'country' || !z.kind) && z.jurisdiction === data.jurisdiction
  );

  if (!targetCountry) {
    toast("Ошибка: Режим не соответствует стране");
    return;
  }

  // Создаём зону-режим внутри страны
  const w = data.w || 260;
  const h = data.h || 200;
  const x = Math.max(targetCountry.x + 10, Math.min(targetCountry.x + targetCountry.w - w - 10, Math.round(pt.x - w / 2)));
  const y = Math.max(targetCountry.y + 30, Math.min(targetCountry.y + targetCountry.h - h - 10, Math.round(pt.y - h / 2)));

  let zoneId = data.code;
  let uniqueId = zoneId;
  let k = 2;
  while (getZone(project, uniqueId)) { uniqueId = `${zoneId}_${k++}`; }

  const maxZI = Math.max(0, ...project.zones.filter(z => z.jurisdiction === data.jurisdiction).map(z => Number(z.zIndex || 0)));

  const currency = data.currency || JURISDICTION_CURRENCIES[data.jurisdiction] || 'USD';
  project.fx = project.fx || { fxDate: "2026-01-15", rateToKZT: { KZT: 1 }, source: "manual" };
  project.fx.rateToKZT = project.fx.rateToKZT || { KZT: 1 };
  if (!project.fx.rateToKZT[currency] && currency !== 'KZT') {
    const rStr = prompt(`Нет курса для ${currency} → KZT. Введите курс (число > 0):`, '500');
    const r = Number(rStr);
    if (!isFinite(r) || r <= 0) return toast("Неверный курс, отмена");
    project.fx.rateToKZT[currency] = r;
  }

  const z = {
    id: uniqueId, name: data.name, x, y, w, h,
    jurisdiction: data.jurisdiction, code: data.code, currency,
    zIndex: maxZI + 1, kind: 'regime', tax: {}
  };
  project.zones.push(z);

  const txa = makeTXA(z);
  if (!getNode(project, txa.id)) project.nodes.push(txa);

  normalizeZoneCascade(project, uniqueId);
  syncTXANodes(project);
  bootstrapNormalizeZones(project);
  recomputeRisks(project);

  await auditAppend(project, 'ZONE_CREATE', { entityType: 'ZONE', entityId: uniqueId }, {}, { zones: [z] }, { note: 'Regime zone created via Smart Focus DnD' });
  save();
  toast(`Режим «${data.name}» добавлен`);
  render();
  refreshDrawerIfOpen();
}

// ── Строгая валидация: Обработка drop узла (Компания/Физлицо) ──
async function handleNodeDrop(project, data, pt) {
  if (project.readOnly) return toast("Read-only: изменения запрещены");

  // Валидация: узел должен падать строго внутрь зоны с kind === 'regime' (или любой зоны)
  const hitZone = findZoneAtPoint(project, pt.x, pt.y);
  if (!hitZone) {
    toast("Ошибка: Узел должен быть размещён внутри режима");
    return;
  }

  // Предпочтительно внутри зоны с kind === 'regime', но допустимо в любой зоне
  const regimeZone = project.zones
    .filter(z => isZoneEnabled(project, z) && pointInZone(pt.x, pt.y, z) && z.kind === 'regime')
    .sort((a, b) => (zoneArea(a) - zoneArea(b)))[0];

  const targetZone = regimeZone || hitZone;

  const nodeType = data.nodeType || 'company';
  const nodeName = data.nodeName || (nodeType === 'company' ? 'New Company' : 'New Person');
  const n = makeNode(nodeName, nodeType, Math.round(pt.x - 95), Math.round(pt.y - 45));
  n.zoneId = targetZone.id;

  project.nodes.push(n);
  await auditAppend(project, 'NODE_CREATE', { entityType: 'NODE', entityId: n.id }, { nodes: [] }, { nodes: [n] }, { note: 'Node created via Smart Focus DnD' });
  save();
  toast(`${nodeType === 'company' ? 'Компания' : 'Физлицо'} создано в «${targetZone.name}»`);
  render();
}

export function render(){
  const project = state.project;
  if (!project) return;

  // Безопасное обновление DOM (Guard-rails)
  const titleEl = document.getElementById('projTitle');
  if (titleEl) titleEl.textContent = project.title || "Project";

  const metaEl = document.getElementById('metaLine');
  if (metaEl) {
      metaEl.textContent = `schema ${SCHEMA_VERSION} · engine ${project.engineVersion} · ${project.readOnly ? 'read-only' : 'editable'} · audit ${project.audit.entries.length}`;
  }

  const roBadge = document.getElementById('roBadge');
  if (roBadge) roBadge.style.display = project.readOnly ? "block" : "none";

  // Скрываем старый контейнер дублирующихся табов (если он остался в HTML)
  const tabsEl = document.getElementById('tabs');
  if (tabsEl) tabsEl.style.display = 'none';

  renderPanel();
  renderCanvas();
}

export function renderPanel(){
  // Находим контейнеры нового SPA интерфейса
  const panelModeling = document.getElementById('panel'); // Плавающая панель на канвасе
  const containerMaster = document.getElementById('masterDataContainer'); // Экран справочников
  const containerAnalytics = document.getElementById('dashboardContainer'); // Экран аналитики

  if (panelModeling) panelModeling.innerHTML = "";

  if (uiState.activeTab === "master") {
      // Рендерим настройки в полноэкранный контейнер
      if (containerMaster) {
          containerMaster.innerHTML = "";
          uiState.settingsSubTab = uiState.settingsSubTab || "jurisdictions";
          renderSettings(containerMaster); // Отправляем старые настройки сюда!

          // Рендерим наши новые загруженные CSV таблицы ниже
          const div = document.createElement('div');
          div.style.marginTop = "30px";
          containerMaster.appendChild(div);
          // Вызов функции отрисовки CSV таблиц (напишем/вызовем её, если она есть)
          if (typeof renderMasterDataTables === 'function') {
               const wrap = document.createElement('div');
               wrap.id = "csvTableWrap";
               containerMaster.appendChild(wrap);
               renderMasterDataTables();
          }
      }
  }
  else if (uiState.activeTab === "analytics") {
      // Рендерим аналитику и D-MACE в полноэкранный контейнер
      if (containerAnalytics) {
          containerAnalytics.innerHTML = "";
          uiState.analyticsTab = uiState.analyticsTab || "dashboard";

          const c = document.createElement('div');
          c.innerHTML = `
            <div class="row" style="margin-bottom:16px; gap:8px; border-bottom:1px solid var(--stroke); padding-bottom:10px;">
              <button class="tab ${uiState.analyticsTab==='dashboard'?'active':''}" id="tDash">Executive Dashboard</button>
              <button class="tab ${uiState.analyticsTab==='risks'?'active':''}" id="tRisks">Риски (D-MACE)</button>
              <button class="tab ${uiState.analyticsTab==='audit'?'active':''}" id="tAudit">Системные Журналы</button>
            </div>
            <div id="analyticsBody"></div>
          `;
          containerAnalytics.appendChild(c);

          c.querySelector('#tDash').onclick = () => { uiState.analyticsTab='dashboard'; renderPanel(); };
          c.querySelector('#tRisks').onclick = () => { uiState.analyticsTab='risks'; renderPanel(); };
          c.querySelector('#tAudit').onclick = () => { uiState.analyticsTab='audit'; renderPanel(); };

          const body = c.querySelector('#analyticsBody');
          if (uiState.analyticsTab === 'risks') renderRisks(body);
          else if (uiState.analyticsTab === 'audit') {
              renderPipeline(body);
              const sep = document.createElement('div'); sep.className = 'sep'; body.appendChild(sep);
              renderAudit(body);
          } else {
              renderDashboard(body); // <-- Вызов нашего нового модуля
          }
      }
  }
  else {
      // Активна вкладка "Моделирование" - оставляем Потоки и Владение в плавающей панели
      if (!panelModeling) return;
      uiState.modelingTab = uiState.modelingTab || "flows";

      const c = document.createElement('div');
      c.innerHTML = `
        <div class="row" style="margin-bottom:16px; gap:8px; border-bottom:1px solid var(--stroke); padding-bottom:10px;">
          <button class="tab ${uiState.modelingTab==='flows'?'active':''}" id="tFlows">Потоки</button>
          <button class="tab ${uiState.modelingTab==='ownership'?'active':''}" id="tOwn">Владение</button>
          <button class="tab ${uiState.modelingTab==='canvas'?'active':''}" id="tCanv">Канвас</button>
        </div>
        <div id="modelingBody"></div>
      `;
      panelModeling.appendChild(c);

      c.querySelector('#tFlows').onclick = () => { uiState.modelingTab='flows'; renderPanel(); };
      c.querySelector('#tOwn').onclick = () => { uiState.modelingTab='ownership'; renderPanel(); };
      c.querySelector('#tCanv').onclick = () => { uiState.modelingTab='canvas'; renderPanel(); };

      const body = c.querySelector('#modelingBody');
      if (uiState.modelingTab === 'ownership') renderOwnership(body);
      else if (uiState.modelingTab === 'canvas') renderCatalogs(body);
      else renderFlows(body);
  }
}

function renderSettings(panel){
  const project = state.project;
  ensureMasterData(project);
  ensureZoneTaxDefaults(project);

  const c = document.createElement('div');
  c.className = 'col';
  c.innerHTML = `
    <div class="title">Настройки</div>
    <div class="small">Дерево: страна → режим. Преднастроены 10 популярных юрисдикций и базовые нормы (редактируемые).</div>
    <div class="row" style="margin-top:8px">
      <button class="btn secondary" id="stJur">Настройки юрисдикций</button>
      <button class="btn secondary" id="stFx">Курсы</button>
      <button class="btn secondary" id="stNorm">Нормативы</button>
      <button class="btn secondary" id="stCat">Справочники</button>
      <button class="btn secondary" id="stAcc">Учет и периоды</button>
    </div>
    <div class="sep"></div>
    <div id="settingsBody"></div>
  `;
  panel.appendChild(c);

  const setActive = ()=>{
    c.querySelectorAll('.btn.secondary').forEach(b=>b.classList.add('secondary'));
    const a = (uiState.settingsSubTab === "fx") ? c.querySelector('#stFx')
            : (uiState.settingsSubTab === "norms") ? c.querySelector('#stNorm')
            : (uiState.settingsSubTab === "catalogs") ? c.querySelector('#stCat')
            : (uiState.settingsSubTab === "accounting") ? c.querySelector('#stAcc')
            : c.querySelector('#stJur');
    if(a) a.classList.remove('secondary');
  };

  c.querySelector('#stJur').onclick = ()=>{ uiState.settingsSubTab="jurisdictions"; renderPanel(); };
  c.querySelector('#stFx').onclick  = ()=>{ uiState.settingsSubTab="fx"; renderPanel(); };
  c.querySelector('#stNorm').onclick= ()=>{ uiState.settingsSubTab="norms"; renderPanel(); };
  c.querySelector('#stCat').onclick = ()=>{ uiState.settingsSubTab="catalogs"; renderPanel(); };
  c.querySelector('#stAcc').onclick = ()=>{ uiState.settingsSubTab="accounting"; renderPanel(); };
  setActive();

  const body = c.querySelector('#settingsBody');
  body.innerHTML = "";
  if (uiState.settingsSubTab === "fx") renderSettingsFx(body);
  else if (uiState.settingsSubTab === "norms") renderSettingsNormatives(body);
  else if (uiState.settingsSubTab === "catalogs") renderSettingsCatalogs(body);
  else if (uiState.settingsSubTab === "accounting") renderSettingsAccounting(body);
  else renderSettingsJurisdictions(body);
}

function renderSettingsFx(panel){
  const project = state.project;
  const fx = project.fx || (project.fx = { fxDate:"2026-01-15", rateToKZT:{KZT:1}, source:"manual" });
  fx.rateToKZT = fx.rateToKZT || { KZT:1 };
  const ccyKeys = Object.keys(fx.rateToKZT || {}).filter(x=>x).sort((a,b)=>a.localeCompare(b));

  const c = document.createElement('div');
  c.className = 'col';
  c.innerHTML = `
    <div class="title">Курсы</div>
    <div class="small">Курс задаётся как 1 единица валюты → KZT. Пример: USD=500 означает 1 USD = 500 KZT.</div>
    <div class="sep"></div>
    <label>Дата курсов (fxDate)</label>
    <input id="fxDate2" type="date" />
    <div class="sep"></div>
    <div class="title">Курсы валют</div>
    <div class="kv" id="fxGrid"></div>
    <div class="row" style="margin-top:10px">
      <button class="btn" id="btnSaveFx">Сохранить</button>
      <button class="btn secondary" id="btnAddFxCcy">Добавить валюту</button>
      <button class="btn secondary" id="btnRecalcFx">Пересчитать</button>
    </div>
  `;
  panel.appendChild(c);

  const fxDate = c.querySelector('#fxDate2');
  fxDate.value = fx.fxDate || "2026-01-15";
  const grid = c.querySelector('#fxGrid');
  grid.innerHTML = ccyKeys.map(ccy=>`
    <div><label>${escapeHtml(ccy)} → KZT</label><input data-ccy="${escapeHtml(ccy)}" type="number" step="0.0001" min="0" value="${escapeHtml(String(fx.rateToKZT[ccy]||""))}"/></div>
  `).join("");

  c.querySelector('#btnAddFxCcy').onclick = ()=>{
    if (project.readOnly) return toast("Read-only: изменения запрещены");
    let ccy = prompt("Код валюты (например USD, EUR):","") || "";
    ccy = String(ccy).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(ccy)) return toast("Неверный код валюты");
    if (fx.rateToKZT[ccy]) return toast("Валюта уже есть");
    const rStr = prompt(`Курс 1 ${ccy} → KZT (число > 0):`, "1");
    const r = Number(rStr);
    if (!isFinite(r) || r<=0) return toast("Неверный курс");
    fx.rateToKZT[ccy] = r;
    save(); render();
  };

  const applyFromUI = ()=>{
    fx.fxDate = fxDate.value || fx.fxDate;
    c.querySelectorAll('input[data-ccy]').forEach(inp=>{
      const ccy = inp.getAttribute('data-ccy');
      const v = Number(inp.value || 0);
      if (isFinite(v) && v>0) fx.rateToKZT[ccy] = v;
    });
    project.fx = fx;
  };

  c.querySelector('#btnSaveFx').onclick = ()=>{
    if (project.readOnly) return toast("Read-only: изменения запрещены");
    applyFromUI();
    project.flows.forEach(f=>updateFlowCompliance(project,f));
    recomputeFrozen(project);
    recomputeRisks(project);
    save();
    toast("Сохранено");
    render();
  };

  c.querySelector('#btnRecalcFx').onclick = ()=>{
    applyFromUI();
    project.flows.forEach(f=>updateFlowCompliance(project,f));
    recomputeFrozen(project);
    recomputeRisks(project);
    save();
    toast("Пересчитано");
    render();
  };
}

function renderSettingsNormatives(panel){
  const project = state.project;
  ensureMasterData(project);
  const md = project.masterData;

  const c = document.createElement('div');
  c.className = 'col';
  c.innerHTML = `
    <div class="title">Нормативы и базовые ставки (страна)</div>
    <div class="small">Это дефолты для расчёта и автоподстановок. Режим (зона) может иметь свои переопределения. Любое поле можно очистить (none) — тогда соответствующее правило/порог не применяется.</div>
    <div class="sep"></div>
    <div class="list" id="normList"></div>
    <div class="row" style="margin-top:10px">
      <button class="btn" id="btnSaveNorm">Сохранить</button>
    </div>
  `;
  panel.appendChild(c);

  const list = c.querySelector('#normList');
  const jurs = (project.catalogs?.jurisdictions || defaultCatalogs().jurisdictions);

  list.innerHTML = jurs.map(j=>{
    const d = md[j.id] || {};
    const vat = (d.vatRateStandard ?? d.vatRate ?? 0);
    const cit = (d.citRateStandard ?? 0);
    const mci = (d.mciValue ?? null);
    const mw  = (d.minWage ?? null);
    const sol = (d.statuteOfLimitationsYears ?? null);

    const src = String(d.sourceNote || "");
    const upd = String(d.updatedAt || "");

    const vatRegMci = (d.vatRegistrationThresholdMci ?? null);
    const cashLimitMci = (d.cashLimitMci ?? null);
    const frozenDebtMci = (d.frozenDebtMci ?? null);
    const cfcIncomeMci = (d.cfcIncomeMci ?? null);
    const cfcEtr = (d.cfcEtrThreshold ?? null);
    const cfcOwn = (d.cfcOwnershipThreshold ?? null);

    const val = (x)=> (x === null || x === undefined) ? "" : String(x);

    return `
      <div class="item">
        <div class="hdr">
          <div>
            <div class="name">${escapeHtml(j.id)} — ${escapeHtml(j.name)}</div>
            <div class="meta">Страна-level дефолты (редактируются). Очистка поля = none.</div>
          </div>
        </div>

        <div class="kv" style="margin-top:8px">
          <div><label>VAT/GST (доля)</label><input data-md="${escapeHtml(j.id)}:vat" type="number" step="0.0001" min="0" max="1" placeholder="0" value="${escapeHtml(val(vat))}"/></div>
          <div><label>CIT flat (доля)</label><input data-md="${escapeHtml(j.id)}:cit" type="number" step="0.0001" min="0" max="1" placeholder="0" value="${escapeHtml(val(cit))}"/></div>
        </div>

        <div class="kv" style="margin-top:8px">
          <div><label>МРП / MCI (опц.)</label><input data-md="${escapeHtml(j.id)}:mci" type="number" step="1" min="0" placeholder="none" value="${escapeHtml(val(mci))}"/></div>
          <div><label>МЗП / Min wage (опц.)</label><input data-md="${escapeHtml(j.id)}:mw" type="number" step="1" min="0" placeholder="none" value="${escapeHtml(val(mw))}"/></div>
        </div>
        
        <div class="kv" style="margin-top:8px">
          <div><label>Исковая давность (лет)</label><input data-md="${escapeHtml(j.id)}:sol" type="number" step="1" min="1" placeholder="none" value="${escapeHtml(val(sol))}"/></div>
          <div></div>
        </div>

        <details style="margin-top:8px">
          <summary class="small" style="cursor:pointer">Пороги/нормативы (опционально)</summary>
          <div class="kv" style="margin-top:8px">
            <div><label>Порог НДС регистрации (в MCI)</label><input data-md="${escapeHtml(j.id)}:vatRegMci" type="number" step="1" min="0" placeholder="none" value="${escapeHtml(val(vatRegMci))}"/></div>
            <div><label>Лимит наличных (в MCI)</label><input data-md="${escapeHtml(j.id)}:cashLimitMci" type="number" step="1" min="0" placeholder="none" value="${escapeHtml(val(cashLimitMci))}"/></div>
          </div>
          <div class="kv" style="margin-top:8px">
            <div><label>Порог «заморозки» (в MCI)</label><input data-md="${escapeHtml(j.id)}:frozenDebtMci" type="number" step="1" min="0" placeholder="none" value="${escapeHtml(val(frozenDebtMci))}"/></div>
            <div><label>CFC income threshold (в MCI)</label><input data-md="${escapeHtml(j.id)}:cfcIncomeMci" type="number" step="1" min="0" placeholder="none" value="${escapeHtml(val(cfcIncomeMci))}"/></div>
          </div>
          <div class="kv" style="margin-top:8px">
            <div><label>CFC ownership threshold (0..1)</label><input data-md="${escapeHtml(j.id)}:cfcOwn" type="number" step="0.0001" min="0" max="1" placeholder="none" value="${escapeHtml(val(cfcOwn))}"/></div>
            <div><label>CFC ETR threshold (0..1)</label><input data-md="${escapeHtml(j.id)}:cfcEtr" type="number" step="0.0001" min="0" max="1" placeholder="none" value="${escapeHtml(val(cfcEtr))}"/></div>
          </div>
        </details>

        <div class="kv" style="margin-top:8px">
          <div><label>Источник (заметка)</label><input data-md="${escapeHtml(j.id)}:src" value="${escapeHtml(src)}" placeholder="например: user input / memo"/></div>
          <div><label>Дата обновления</label><input data-md="${escapeHtml(j.id)}:upd" type="date" value="${escapeHtml(upd)}"/></div>
        </div>
      </div>
    `;
  }).join("");

  c.querySelector('#btnSaveNorm').onclick = ()=>{
    if (project.readOnly) return toast("Read-only: изменения запрещены");
    c.querySelectorAll('input[data-md]').forEach(inp=>{
      const k = inp.getAttribute('data-md');
      const [jid, field] = k.split(':');
      md[jid] = md[jid] || {};
      const raw = String(inp.value || '').trim();

      if (field === 'src') { md[jid].sourceNote = raw; return; }
      if (field === 'upd') { md[jid].updatedAt = raw || null; return; }

      if (raw === '') {
        if (field === 'vat') md[jid].vatRateStandard = null;
        else if (field === 'cit') md[jid].citRateStandard = null;
        else if (field === 'mci') md[jid].mciValue = null;
        else if (field === 'mw') md[jid].minWage = null;
        else if (field === 'sol') md[jid].statuteOfLimitationsYears = null;
        else if (field === 'vatRegMci') md[jid].vatRegistrationThresholdMci = null;
        else if (field === 'cashLimitMci') md[jid].cashLimitMci = null;
        else if (field === 'frozenDebtMci') md[jid].frozenDebtMci = null;
        else if (field === 'cfcIncomeMci') md[jid].cfcIncomeMci = null;
        else if (field === 'cfcOwn') md[jid].cfcOwnershipThreshold = null;
        else if (field === 'cfcEtr') md[jid].cfcEtrThreshold = null;
        return;
      }

      const v = Number(raw);
      if (!Number.isFinite(v)) return;

      if (field === "vat") md[jid].vatRateStandard = Math.min(1, Math.max(0, v));
      if (field === "cit") md[jid].citRateStandard = Math.min(1, Math.max(0, v));
      if (field === "mci") md[jid].mciValue = (v <= 0 ? null : Math.floor(v));
      if (field === "mw") md[jid].minWage = (v <= 0 ? null : Math.floor(v));
      if (field === "sol") md[jid].statuteOfLimitationsYears = (v <= 0 ? null : Math.floor(v));
      if (field === "vatRegMci") md[jid].vatRegistrationThresholdMci = (v <= 0 ? null : Math.floor(v));
      if (field === "cashLimitMci") md[jid].cashLimitMci = (v <= 0 ? null : Math.floor(v));
      if (field === "frozenDebtMci") md[jid].frozenDebtMci = (v <= 0 ? null : Math.floor(v));
      if (field === "cfcIncomeMci") md[jid].cfcIncomeMci = (v <= 0 ? null : Math.floor(v));
      if (field === "cfcOwn") md[jid].cfcOwnershipThreshold = Math.min(1, Math.max(0, v));
      if (field === "cfcEtr") md[jid].cfcEtrThreshold = Math.min(1, Math.max(0, v));
    });
    project.masterData = md;
    try{ project.flows.forEach(f=>updateFlowCompliance(project,f)); }catch(e){}
    recomputeFrozen(project);
    recomputeRisks(project);
    save();
    toast("Сохранено");
    render();
  };
}

function renderSettingsCatalogs(panel){
  const project = state.project;
  project.catalogs = project.catalogs || defaultCatalogs();
  project.catalogs.flowTypes = Array.isArray(project.catalogs.flowTypes) ? project.catalogs.flowTypes : defaultCatalogs().flowTypes;

  const c = document.createElement('div');
  c.className = 'col';
  c.innerHTML = `
    <div class="title">Справочники</div>
    <div class="small">Настройки справочников (не юрисдикции). Юрисдикции/режимы редактируются в «Настройки юрисдикций».</div>
    <div class="sep"></div>
    <div class="item">
      <div class="hdr">
        <div>
          <div class="name">Типы потоков</div>
          <div class="meta">Определяют доступные типы выплат и фильтры легенды потоков.</div>
        </div>
        <div class="row" style="gap:8px">
          <button class="btn secondary" id="ftAdd">Добавить</button>
          <button class="btn secondary" id="ftReset">Сбросить</button>
        </div>
      </div>
      <div class="sep"></div>
      <div class="list" id="ftList"></div>
    </div>
  `;
  panel.appendChild(c);

  const ftList = c.querySelector('#ftList');
  const snap = ()=> JSON.parse(JSON.stringify({ catalogs: project.catalogs, ui: project.ui }));

  const renderFlowTypes = ()=>{
    const list = (project.catalogs.flowTypes || []).filter(ft=>ft && ft.id);
    ftList.innerHTML = list.map(ft=>{
      const enabled = (ft.enabled !== false);
      return `
        <div class="row" style="justify-content:space-between; align-items:center; padding:6px 0">
          <label style="display:flex; gap:8px; align-items:center;">
            <input type="checkbox" data-ft="${escapeHtml(ft.id)}" ${enabled?"checked":""}/>
            <span>${escapeHtml(ft.id)} — ${escapeHtml(ft.name)}</span>
          </label>
          <button class="btn danger" data-del="${escapeHtml(ft.id)}">Удалить</button>
        </div>
      `;
    }).join("");

    ftList.querySelectorAll('input[data-ft]').forEach(cb=>{
      cb.onchange = async (ev)=>{
        if (project.readOnly) return toast("Read-only: изменения запрещены");
        const before = snap();
        const id = ev.target.getAttribute('data-ft');
        project.catalogs.flowTypes = project.catalogs.flowTypes.map(ft=> ft.id===id ? { ...ft, enabled: ev.target.checked } : ft);
        if (project.ui?.flowLegend?.selectedTypes) {
          const set = new Set(project.ui.flowLegend.selectedTypes);
          if (!ev.target.checked) set.delete(id);
          project.ui.flowLegend.selectedTypes = [...set];
        }
        await auditAppend(project, 'MASTERDATA_OVERRIDE', { entityType:'CATALOG', entityId:'flowTypes' }, before, snap());
        save();
        render();
      };
    });

    ftList.querySelectorAll('button[data-del]').forEach(btn=>{
      btn.onclick = async ()=>{
        if (project.readOnly) return toast("Read-only: изменения запрещены");
        const before = snap();
        const id = btn.getAttribute('data-del');
        if (!id) return;
        if (!confirm(`Удалить тип потока "${id}"?`)) return;
        project.catalogs.flowTypes = project.catalogs.flowTypes.filter(ft=>ft.id!==id);
        if (project.ui?.flowLegend?.selectedTypes) {
          project.ui.flowLegend.selectedTypes = project.ui.flowLegend.selectedTypes.filter(t=>t!==id);
        }
        await auditAppend(project, 'MASTERDATA_OVERRIDE', { entityType:'CATALOG', entityId:'flowTypes' }, before, snap());
        save();
        render();
      };
    });
  };

  c.querySelector('#ftAdd').onclick = async ()=>{
    if (project.readOnly) return toast("Read-only: изменения запрещены");
    const before = snap();
    let id = prompt('ID типа потока (латиница, без пробелов):', 'Services');
    if (!id) return;
    id = String(id).trim();
    if (!/^[A-Za-z0-9_\-]{2,32}$/.test(id)) return toast('Неверный ID');
    if ((project.catalogs.flowTypes||[]).some(ft=>ft.id===id)) return toast('Уже существует');
    let name = prompt('Название (для UI):', id) || id;
    name = String(name).trim() || id;
    project.catalogs.flowTypes.push({ id, name, enabled:true });
    await auditAppend(project, 'MASTERDATA_OVERRIDE', { entityType:'CATALOG', entityId:'flowTypes' }, before, snap());
    save();
    render();
  };

  c.querySelector('#ftReset').onclick = async ()=>{
    if (project.readOnly) return toast("Read-only: изменения запрещены");
    const before = snap();
    if (!confirm('Сбросить типы потоков к дефолту?')) return;
    project.catalogs.flowTypes = defaultCatalogs().flowTypes;
    if (project.ui?.flowLegend) {
      project.ui.flowLegend.mode = 'ALL';
      project.ui.flowLegend.selectedTypes = [];
    }
    await auditAppend(project, 'MASTERDATA_OVERRIDE', { entityType:'CATALOG', entityId:'flowTypes' }, before, snap());
    save();
    render();
  };

  renderFlowTypes();
}

function renderSettingsAccounting(panel){
  const project = state.project;
  ensurePeriods(project);
  ensureAccounting(project);
  const year = yearOf(project.fx?.fxDate || nowIso());
  const ay = ensureAccountingYear(project, year);

  project.group = project.group || { consolidatedRevenueEur: null };

  const c = document.createElement('div');
  c.className = 'col';

  const closed = (project.periods?.closedYears || []).slice().sort((a,b)=>a-b);
  const closedHtml = closed.length ? closed.map(y=>`<span class="pill warn" style="margin-right:6px">${escapeHtml(String(y))}</span>`).join('') : '<span class="small">нет</span>';

  c.innerHTML = `
    <div class="title">Учет и периоды</div>
    <div class="small">MVP: Separate Accounting для МФЦА (AIFC) и логика закрытых периодов. Пустые (none) нормативы отключают соответствующие правила.</div>
    <div class="sep"></div>

    <div class="item">
      <div class="hdr">
        <div>
          <div class="name">Группа</div>
          <div class="meta">Консолидированная выручка нужна для Pillar Two (750 млн EUR).</div>
        </div>
      </div>
      <div class="kv" style="margin-top:8px">
        <div>
          <label>Consolidated revenue (EUR)</label>
          <input id="grpRev" type="number" step="1" min="0" placeholder="none" value="${escapeHtml(project.group.consolidatedRevenueEur==null?'':String(project.group.consolidatedRevenueEur))}" />
        </div>
        <div>
          <label>Indirect expense pool (KZT) · ${escapeHtml(String(year))}</label>
          <input id="indPool" type="number" step="1" min="0" value="${escapeHtml(String(ay.indirectExpensePoolKZT||0))}" />
        </div>
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn" id="saveAcc">Сохранить</button>
        <button class="btn secondary" id="runAcc">Пересчитать</button>
      </div>
      <div class="small" style="margin-top:8px">Последний расчет: ${escapeHtml(ay.lastComputedAt || '—')}</div>
    </div>

    <div class="item">
      <div class="hdr">
        <div>
          <div class="name">Closed Period</div>
          <div class="meta">Закрытый период блокирует создание/исполнение потоков и оплату налогов в этом году.</div>
        </div>
      </div>
      <div class="row" style="margin-top:8px; justify-content:space-between">
        <div class="small">Текущий год: <b>${escapeHtml(String(year))}</b> · Закрытые: ${closedHtml}</div>
        <div class="row" style="gap:8px">
          <button class="btn secondary" id="closeYear">Закрыть год</button>
          <button class="btn secondary" id="openYear">Открыть год</button>
        </div>
      </div>
    </div>

    <div class="item">
      <div class="hdr">
        <div>
          <div class="name">Separate Accounting (AIFC)</div>
          <div class="meta">Распределение косвенных расходов пропорционально удельному весу льготного дохода в общем доходе группы.</div>
        </div>
      </div>
      <div class="sep"></div>
      <div class="list" id="accList"></div>
    </div>

    <div class="item">
      <div class="hdr">
        <div>
          <div class="name">Snapshots</div>
          <div class="meta">Снимок фиксирует балансы, версии LawReference и ключевые параметры на дату.</div>
        </div>
        <button class="btn secondary" id="mkSnap">Create snapshot</button>
      </div>
      <div class="sep"></div>
      <div class="list" id="snapList"></div>
    </div>
  `;
  panel.appendChild(c);

  const renderAccList = ()=>{
    const list = c.querySelector('#accList');
    list.innerHTML = '';
    const companies = listCompanies(project);
    companies.forEach(co=>{
      co.accountingYears = co.accountingYears || {};
      const yk = String(year);
      const ci = co.accountingYears[yk] || (co.accountingYears[yk] = { totalIncomeKZT: 0, preferentialIncomeKZT: 0, allocatedIndirectKZT: 0 });
      const z = getZone(project, co.zoneId);
      const isAifc = z && z.code === 'KZ_AIFC';
      const it = document.createElement('div');
      it.className = 'item';
      it.innerHTML = `
        <div class="hdr">
          <div>
            <div class="name">${escapeHtml(co.name)}</div>
            <div class="meta">zone: ${escapeHtml(z?z.code:'none')} · totalIncome(KZT) + льготный доход для AIFC</div>
          </div>
          <div class="pill">${escapeHtml(z?z.jurisdiction:'n/a')}</div>
        </div>
        <div class="kv" style="margin-top:8px">
          <div>
            <label>Total income (KZT)</label>
            <input data-k="ti" type="number" step="1" min="0" value="${escapeHtml(String(ci.totalIncomeKZT||0))}" />
          </div>
          <div>
            <label>Preferential income (KZT) ${isAifc ? '' : '(n/a)'}</label>
            <input data-k="pi" type="number" step="1" min="0" ${isAifc ? '' : 'disabled'} value="${escapeHtml(String(ci.preferentialIncomeKZT||0))}" />
          </div>
        </div>
        <div class="small" style="margin-top:8px">Allocated indirect (KZT): <b>${escapeHtml(fmtMoney(ci.allocatedIndirectKZT||0))}</b></div>
        <div class="row" style="margin-top:10px">
          <button class="btn secondary" data-act="save">Save</button>
        </div>
      `;
      it.querySelector('[data-act="save"]').onclick = async ()=>{
        if (project.readOnly) return toast('Read-only: изменения запрещены');
        if (isYearClosed(project, year)) return toast('Нельзя: год закрыт');
        const before = JSON.parse(JSON.stringify(co));
        ci.totalIncomeKZT = Number(it.querySelector('[data-k="ti"]').value || 0);
        if (isAifc) ci.preferentialIncomeKZT = Number(it.querySelector('[data-k="pi"]').value || 0);
        await auditAppend(project, 'NODE_UPDATE', {entityType:'NODE', entityId:co.id}, before, co, {note:'accounting inputs', year});
        save();
        toast('Сохранено');
        render();
      };
      list.appendChild(it);
    });
  };
  renderAccList();

  c.querySelector('#saveAcc').onclick = async ()=>{
    if (project.readOnly) return toast('Read-only: изменения запрещены');
    if (isYearClosed(project, year)) return toast('Нельзя: год закрыт');
    const before = JSON.parse(JSON.stringify({ group: project.group, accounting: project.accounting }));
    const v = c.querySelector('#grpRev').value;
    project.group.consolidatedRevenueEur = (v === '' ? null : Number(v));
    ay.indirectExpensePoolKZT = Number(c.querySelector('#indPool').value || 0);
    await auditAppend(project, 'PROJECT_UPDATE', {entityType:'PROJECT', entityId:project.projectId}, before, { group: project.group, accounting: project.accounting }, {note:'accounting settings'});
    recomputeRisks(project);
    save();
    toast('Сохранено');
    render();
  };

  c.querySelector('#runAcc').onclick = ()=>{
    if (project.readOnly) return toast('Read-only: изменения запрещены');
    separateAccountingAIFC(project, year);
    recomputeRisks(project);
    save();
    toast('Пересчитано');
    render();
  };

  c.querySelector('#closeYear').onclick = async ()=>{
    if (project.readOnly) return toast('Read-only: изменения запрещены');
    const y = year;
    const before = JSON.parse(JSON.stringify(project.periods));
    ensurePeriods(project);
    if (!project.periods.closedYears.includes(y)) project.periods.closedYears.push(y);
    await auditAppend(project, 'PROJECT_UPDATE', {entityType:'PROJECT', entityId:project.projectId}, before, project.periods, {note:'close period', year:y, lawRef:'AFSA_CLOSED_PERIOD_2026'});
    save();
    toast('Год закрыт');
    render();
  };

  c.querySelector('#openYear').onclick = async ()=>{
    if (project.readOnly) return toast('Read-only: изменения запрещены');
    const y = year;
    const before = JSON.parse(JSON.stringify(project.periods));
    ensurePeriods(project);
    project.periods.closedYears = (project.periods.closedYears||[]).filter(x=>Number(x)!==Number(y));
    await auditAppend(project, 'PROJECT_UPDATE', {entityType:'PROJECT', entityId:project.projectId}, before, project.periods, {note:'open period', year:y, lawRef:'AFSA_CLOSED_PERIOD_2026'});
    save();
    toast('Год открыт');
    render();
  };

  const snapList = c.querySelector('#snapList');
  const renderSnaps = ()=>{
    project.snapshots = Array.isArray(project.snapshots) ? project.snapshots : [];
    snapList.innerHTML = '';
    if (!project.snapshots.length){
      const it = document.createElement('div');
      it.className = 'item';
      it.innerHTML = '<div class="small">Снимков пока нет.</div>';
      snapList.appendChild(it);
      return;
    }
    project.snapshots.slice(0,20).forEach(s=>{
      const it = document.createElement('div');
      it.className = 'item';
      it.innerHTML = `
        <div class="hdr">
          <div>
            <div class="name">Snapshot ${escapeHtml(s.id)}</div>
            <div class="meta">year: ${escapeHtml(String(s.periodYear))} · at: ${escapeHtml(s.createdAt)} · engine: ${escapeHtml(s.engineVersion)} · schema: ${escapeHtml(s.schemaVersion)}</div>
          </div>
          <button class="btn secondary" data-exp="${escapeHtml(s.id)}">Export</button>
        </div>
        <div class="small" style="margin-top:6px">LawReference: ${escapeHtml(s.lawReferenceSet || '—')}</div>
      `;
      it.querySelector('[data-exp]').onclick = ()=>{
        const blob = new Blob([JSON.stringify(s, null, 2)], {type:'application/json'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `tsm26_snapshot_${s.periodYear}_${s.id}.json`;
        a.click();
        setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
      };
      snapList.appendChild(it);
    });
  };
  renderSnaps();

  c.querySelector('#mkSnap').onclick = async ()=>{
    if (project.readOnly) return toast('Read-only: изменения запрещены');
    const snap = createSnapshot(project, year);
    await auditAppend(project, 'SNAPSHOT_CREATE', {entityType:'SNAPSHOT', entityId:snap.id}, {}, snap, {note:'snapshot created'});
    save();
    toast('Snapshot создан');
    render();
  };
}

function renderSettingsJurisdictions(panel){
  const project = state.project;
  ensureMasterData(project);
  ensureZoneTaxDefaults(project);

  const c = document.createElement('div');
  c.className = 'col';
  c.innerHTML = `
    <div class="title">Настройки юрисдикций</div>
    <div class="small">Страна → режим (зона). Здесь настраиваются справочники и налоговые параметры. Отображение/скрытие на канвасе — во вкладке «Канвас и элементы».</div>
    <div class="sep"></div>
    <div class="item">
      <div class="hdr">
        <div>
          <div class="name">Дерево</div>
          <div class="meta">Клик по режиму откроет параметры ниже</div>
        </div>
        <div class="row" style="gap:6px">
          <button class="btn secondary" id="btnAddCountry">Добавить страну</button>
          <button class="btn secondary" id="btnAddRegime">Добавить режим</button>
        </div>
      </div>
      <div class="sep"></div>
      <div class="list" id="tree"></div>
    </div>
    <div class="item">
      <div class="hdr">
        <div>
          <div class="name">Параметры режима</div>
          <div class="meta">Выберите режим в дереве выше</div>
        </div>
      </div>
      <div class="sep"></div>
      <div id="editor"></div>
    </div>
  `;
  panel.appendChild(c);

  const tree = c.querySelector('#tree');
  const editor = c.querySelector('#editor');

  const jurs = (project.catalogs?.jurisdictions || defaultCatalogs().jurisdictions).slice().sort((a,b)=>a.id.localeCompare(b.id));

  function renderTree(){
    tree.innerHTML = "";
    jurs.forEach(j=>{
      const zones = (project.zones||[]).filter(z=>z.jurisdiction===j.id).slice().sort((a,b)=> (a.zIndex||0)-(b.zIndex||0) || a.id.localeCompare(b.id));
      const expanded = (uiState.settingsExpanded[j.id] !== false);
      const head = document.createElement('div');
      head.className = 'item';
      head.innerHTML = `
        <div class="hdr">
          <div>
            <div class="name">${escapeHtml(j.id)} — ${escapeHtml(j.name)} <span class="badge">${zones.length}</span></div>
            <div class="meta">Режимов: ${zones.length}</div>
          </div>
          <div class="row" style="gap:6px">
            <button class="btn secondary" data-exp="${escapeHtml(j.id)}">${expanded ? "Свернуть" : "Развернуть"}</button>
          </div>
        </div>
        <div class="list" data-children="${escapeHtml(j.id)}" style="margin-top:8px; display:${expanded?"flex":"none"}"></div>
      `;
      tree.appendChild(head);

      const child = head.querySelector(`[data-children="${j.id}"]`);
      if (child){
        child.innerHTML = zones.map(z=>{
          const sel = (uiState.settingsSelectedZoneId === z.id);
          return `
            <div class="row" style="justify-content:space-between; align-items:center; padding:6px 0; border-top:1px solid var(--stroke)">
              <div style="display:flex; flex-direction:column; gap:2px; cursor:pointer" data-selz="${escapeHtml(z.id)}">
                <div style="font-weight:700; font-size:12px; ${sel?"text-decoration:underline":""}">${escapeHtml(z.name)}</div>
                <div class="meta">${escapeHtml(z.code)} · ${escapeHtml(z.currency)} · zIndex ${escapeHtml(String(z.zIndex||0))}</div>
              </div>
              <div class="meta">Отображение: «Канвас и элементы»</div>
            </div>
          `;
        }).join("");
      }
    });

    tree.querySelectorAll('button[data-exp]').forEach(b=>{
      b.onclick = ()=>{
        const id = b.getAttribute('data-exp');
        uiState.settingsExpanded[id] = !(uiState.settingsExpanded[id] !== false);
        renderPanel();
      };
    });

    tree.querySelectorAll('[data-selz]').forEach(el=>{
      el.onclick = ()=>{
        uiState.settingsSelectedZoneId = el.getAttribute('data-selz');
        renderPanel();
      };
    });
  }

  function renderEditor(){
    editor.innerHTML = "";
    const z = uiState.settingsSelectedZoneId ? getZone(project, uiState.settingsSelectedZoneId) : null;
    if (!z){
      editor.innerHTML = `<div class="small">Выберите режим (зону) слева. Затем здесь можно отредактировать базовые налоговые параметры режима.</div>`;
      return;
    }
    const tx = effectiveZoneTax(project, z);
    const md = project.masterData[z.jurisdiction] || {};
    const payroll = tx.payroll || {};

    const wrap = document.createElement('div');
    wrap.className = 'col';
    wrap.innerHTML = `
      <div class="title">${escapeHtml(z.name)}</div>
      <div class="small">${escapeHtml(z.jurisdiction)} · ${escapeHtml(z.code)} · ${escapeHtml(z.currency)}</div>
      <div class="sep"></div>

      <div class="title">Параметры зоны</div>
      <div class="kv">
        <div><label>Название</label><input id="zName" value="${escapeHtml(z.name)}"/></div>
        <div><label>zIndex</label><input id="zZI" type="number" step="1" min="0" value="${escapeHtml(String(z.zIndex||0))}"/></div>
      </div>
      <div class="kv">
        <div><label>Код режима (zone.code)</label><input id="zCode" value="${escapeHtml(z.code)}"/></div>
        <div><label>Валюта</label><input id="zCcy" value="${escapeHtml(z.currency)}"/></div>
      </div>

      <div class="sep"></div>
      <div class="title">Налоги (режим)</div>
      <div class="kv">
        <div><label>VAT/GST (доля)</label><input id="tVat" type="number" step="0.0001" min="0" max="1" value="${escapeHtml(String(tx.vatRate||0))}"/></div>
        <div><label>WHT (Div/Int/Roy/Serv), %</label><input id="tWhtPack" value="${escapeHtml(String(bankersRound2((tx.wht?.dividends||0)*100)))};${escapeHtml(String(bankersRound2((tx.wht?.interest||0)*100)))};${escapeHtml(String(bankersRound2((tx.wht?.royalties||0)*100)))};${escapeHtml(String(bankersRound2((tx.wht?.services||0)*100)))}"/></div>
      </div>

      <div class="kv">
        <div>
          <label>CIT mode</label>
          <select id="tCitMode">
            ${["flat","threshold","twoTier","qfzp","brackets","smallProfits"].map(m=>`<option value="${m}" ${tx.cit?.mode===m?"selected":""}>${m}</option>`).join("")}
          </select>
        </div>
        <div><label>Примечание</label><input id="tNote" value="${escapeHtml(String(tx.notes||""))}"/></div>
      </div>

      <div id="citFields" class="col"></div>

      <div class="sep"></div>
      <div class="title">Payroll (упрощенно, доли)</div>
      <div class="kv">
        <div><label>PIT</label><input id="pPit" type="number" step="0.0001" min="0" max="1" value="${escapeHtml(String(payroll.pitRate||0))}"/></div>
        <div><label>Соц.налог работодателя</label><input id="pSocTax" type="number" step="0.0001" min="0" max="1" value="${escapeHtml(String(payroll.socialTaxEmployerRate||0))}"/></div>
      </div>
      <div class="kv">
        <div><label>Пенсия работник</label><input id="pPenE" type="number" step="0.0001" min="0" max="1" value="${escapeHtml(String(payroll.pensionEmployeeRate||0))}"/></div>
        <div><label>Пенсия работодатель</label><input id="pPenER" type="number" step="0.0001" min="0" max="1" value="${escapeHtml(String(payroll.pensionEmployerRate||0))}"/></div>
      </div>

      <div class="row" style="margin-top:16px; justify-content:space-between; border-top: 1px solid var(--stroke); padding-top: 16px;">
        <div class="row">
          <button class="btn" id="btnSaveZoneTax">Сохранить</button>
          <button class="btn secondary" id="btnResetZoneTax">Сбросить</button>
        </div>
        <button class="btn danger" id="btnDeleteZone">Удалить зону</button>
      </div>
    `;
    editor.appendChild(wrap);

    const citFields = wrap.querySelector('#citFields');
    const renderCitFields = ()=>{
      const mode = wrap.querySelector('#tCitMode').value;
      const cit = tx.cit || { mode:"flat", rate: 0 };
      let html = "";
      if (mode === "flat"){
        html = `<div class="kv"><div><label>CIT rate (доля)</label><input id="cit_rate" type="number" step="0.0001" min="0" max="1" value="${escapeHtml(String(cit.rate ?? md.citRateStandard ?? 0))}"/></div><div></div></div>`;
      } else if (mode === "threshold"){
        html = `<div class="kv">
          <div><label>0% up to (amount)</label><input id="cit_zeroUpTo" type="number" step="1" min="0" value="${escapeHtml(String(cit.zeroUpTo ?? 0))}"/></div>
          <div><label>Main rate (доля)</label><input id="cit_mainRate" type="number" step="0.0001" min="0" max="1" value="${escapeHtml(String(cit.mainRate ?? 0))}"/></div>
        </div>`;
      } else if (mode === "twoTier"){
        html = `<div class="kv">
          <div><label>Small rate (доля)</label><input id="cit_smallRate" type="number" step="0.0001" min="0" max="1" value="${escapeHtml(String(cit.smallRate ?? 0))}"/></div>
          <div><label>Small limit (amount)</label><input id="cit_smallLimit" type="number" step="1" min="0" value="${escapeHtml(String(cit.smallLimit ?? 0))}"/></div>
        </div>
        <div class="kv">
          <div><label>Main rate (доля)</label><input id="cit_mainRate" type="number" step="0.0001" min="0" max="1" value="${escapeHtml(String(cit.mainRate ?? 0))}"/></div>
          <div></div>
        </div>`;
      } else if (mode === "qfzp"){
        html = `<div class="kv">
          <div><label>Qualifying rate (доля)</label><input id="cit_qRate" type="number" step="0.0001" min="0" max="1" value="${escapeHtml(String(cit.qualifyingRate ?? 0))}"/></div>
          <div><label>Non-qualifying rate (доля)</label><input id="cit_nqRate" type="number" step="0.0001" min="0" max="1" value="${escapeHtml(String(cit.nonQualifyingRate ?? 0))}"/></div>
        </div>`;
      } else if (mode === "brackets"){
        const b1 = (cit.brackets && cit.brackets[0]) ? cit.brackets[0] : {upTo:0, rate:0};
        const b2 = (cit.brackets && cit.brackets[1]) ? cit.brackets[1] : {upTo:null, rate:0};
        html = `<div class="kv">
          <div><label>Up to (amount)</label><input id="cit_b1_up" type="number" step="1" min="0" value="${escapeHtml(String(b1.upTo ?? 0))}"/></div>
          <div><label>Rate 1 (доля)</label><input id="cit_b1_r" type="number" step="0.0001" min="0" max="1" value="${escapeHtml(String(b1.rate ?? 0))}"/></div>
        </div>
        <div class="kv">
          <div><label>Rate 2 (доля)</label><input id="cit_b2_r" type="number" step="0.0001" min="0" max="1" value="${escapeHtml(String(b2.rate ?? 0))}"/></div>
          <div></div>
        </div>`;
      } else if (mode === "smallProfits"){
        html = `<div class="kv">
          <div><label>Small rate (доля)</label><input id="cit_smallRate" type="number" step="0.0001" min="0" max="1" value="${escapeHtml(String(cit.smallRate ?? 0))}"/></div>
          <div><label>Small limit</label><input id="cit_smallLimit" type="number" step="1" min="0" value="${escapeHtml(String(cit.smallLimit ?? 0))}"/></div>
        </div>
        <div class="kv">
          <div><label>Main rate (доля)</label><input id="cit_mainRate" type="number" step="0.0001" min="0" max="1" value="${escapeHtml(String(cit.mainRate ?? 0))}"/></div>
          <div><label>Main limit</label><input id="cit_mainLimit" type="number" step="1" min="0" value="${escapeHtml(String(cit.mainLimit ?? 0))}"/></div>
        </div>`;
      }
      citFields.innerHTML = html;
    };
    renderCitFields();
    wrap.querySelector('#tCitMode').onchange = ()=>{ renderCitFields(); };

    wrap.querySelector('#btnResetZoneTax').onclick = ()=>{
      if (project.readOnly) return toast("Read-only: изменения запрещены");
      const before = JSON.parse(JSON.stringify(z));
      z.tax = {};
      auditAppend(project, 'MASTERDATA_OVERRIDE', { entityType:'ZONE', entityId: z.id }, [
        {op:'replace', path:`/zones`, value: project.zones}
      ]);
      save();
      toast("Переопределения сброшены");
      render();
    };

    wrap.querySelector('#btnSaveZoneTax').onclick = ()=>{
      if (project.readOnly) return toast("Read-only: изменения запрещены");
      z.name = String(wrap.querySelector('#zName').value || z.name).trim() || z.name;
      z.code = String(wrap.querySelector('#zCode').value || z.code).trim().toUpperCase().replace(/\s+/g,'_') || z.code;
      z.currency = String(wrap.querySelector('#zCcy').value || z.currency).trim().toUpperCase() || z.currency;
      z.zIndex = Math.max(0, Math.floor(Number(wrap.querySelector('#zZI').value || z.zIndex || 0)));

      z.tax = z.tax || {};
      z.tax.vatRate = Math.min(1, Math.max(0, Number(wrap.querySelector('#tVat').value || 0)));

      const pack = String(wrap.querySelector('#tWhtPack').value || "").split(';').map(s=>Number(String(s).trim()||0));
      const wht = { dividends: (pack[0]||0)/100, interest:(pack[1]||0)/100, royalties:(pack[2]||0)/100, services:(pack[3]||0)/100 };
      z.tax.wht = wht;

      const mode = wrap.querySelector('#tCitMode').value;
      const cit = { mode };
      if (mode === "flat"){
        cit.rate = Math.min(1, Math.max(0, Number(wrap.querySelector('#cit_rate').value || 0)));
      } else if (mode === "threshold"){
        cit.zeroUpTo = Math.max(0, Number(wrap.querySelector('#cit_zeroUpTo').value || 0));
        cit.zeroRate = 0.00;
        cit.mainRate = Math.min(1, Math.max(0, Number(wrap.querySelector('#cit_mainRate').value || 0)));
      } else if (mode === "twoTier"){
        cit.smallRate = Math.min(1, Math.max(0, Number(wrap.querySelector('#cit_smallRate').value || 0)));
        cit.smallLimit = Math.max(0, Number(wrap.querySelector('#cit_smallLimit').value || 0));
        cit.mainRate = Math.min(1, Math.max(0, Number(wrap.querySelector('#cit_mainRate').value || 0)));
      } else if (mode === "qfzp"){
        cit.qualifyingRate = Math.min(1, Math.max(0, Number(wrap.querySelector('#cit_qRate').value || 0)));
        cit.nonQualifyingRate = Math.min(1, Math.max(0, Number(wrap.querySelector('#cit_nqRate').value || 0)));
      } else if (mode === "brackets"){
        const up = Math.max(0, Number(wrap.querySelector('#cit_b1_up').value || 0));
        const r1 = Math.min(1, Math.max(0, Number(wrap.querySelector('#cit_b1_r').value || 0)));
        const r2 = Math.min(1, Math.max(0, Number(wrap.querySelector('#cit_b2_r').value || 0)));
        cit.brackets = [{ upTo: up, rate: r1 }, { upTo: null, rate: r2 }];
      } else if (mode === "smallProfits"){
        cit.smallRate = Math.min(1, Math.max(0, Number(wrap.querySelector('#cit_smallRate').value || 0)));
        cit.smallLimit = Math.max(0, Number(wrap.querySelector('#cit_smallLimit').value || 0));
        cit.mainRate = Math.min(1, Math.max(0, Number(wrap.querySelector('#cit_mainRate').value || 0)));
        cit.mainLimit = Math.max(0, Number(wrap.querySelector('#cit_mainLimit').value || 0));
      }
      z.tax.cit = cit;
      z.tax.notes = String(wrap.querySelector('#tNote').value || "").trim();

      z.tax.payroll = z.tax.payroll || {};
      z.tax.payroll.pitRate = Math.min(1, Math.max(0, Number(wrap.querySelector('#pPit').value || 0)));
      z.tax.payroll.socialTaxEmployerRate = Math.min(1, Math.max(0, Number(wrap.querySelector('#pSocTax').value || 0)));
      z.tax.payroll.pensionEmployeeRate = Math.min(1, Math.max(0, Number(wrap.querySelector('#pPenE').value || 0)));
      z.tax.payroll.pensionEmployerRate = Math.min(1, Math.max(0, Number(wrap.querySelector('#pPenER').value || 0)));

      project.fx = project.fx || { fxDate:"2026-01-15", rateToKZT:{KZT:1}, source:"manual" };
      project.fx.rateToKZT = project.fx.rateToKZT || { KZT:1 };
      if (!project.fx.rateToKZT[z.currency]){
        const rStr = prompt(`Нет курса для ${z.currency} → KZT. Введите курс (число > 0):`, "1");
        const r = Number(rStr);
        if (!isFinite(r) || r<=0) return toast("Неверный курс");
        project.fx.rateToKZT[z.currency] = r;
      }

      syncTXANodes(project);
      bootstrapNormalizeZones(project);
      recomputeRisks(project);
      recomputeFrozen(project);

      auditAppend(project, 'MASTERDATA_OVERRIDE', { entityType:'ZONE', entityId: z.id }, [
        {op:'replace', path:`/zones`, value: project.zones},
        {op:'replace', path:`/fx/rateToKZT`, value: project.fx.rateToKZT},
        {op:'replace', path:`/nodes`, value: project.nodes}
      ]);
      save();
      toast("Режим сохранён");
      render();
    };

    // ЛОГИКА УДАЛЕНИЯ ЗОНЫ
    wrap.querySelector('#btnDeleteZone').onclick = async () => {
      if (project.readOnly) return toast("Read-only: изменения запрещены");
      if (!confirm(`Точно удалить режим "${z.name}"? Все узлы, находящиеся внутри, останутся на канвасе, но потеряют налоговую привязку.`)) return;

      const before = JSON.parse(JSON.stringify({ zones: project.zones, nodes: project.nodes }));

      // Удаляем саму зону
      project.zones = project.zones.filter(x => x.id !== z.id);
      
      // Удаляем TXA-ноду этой зоны (сборщик налогов)
      project.nodes = project.nodes.filter(n => n.id !== 'txa_' + z.id);
      
      // Открепляем узлы, которые были в этой зоне
      project.nodes.forEach(n => {
        if (n.zoneId === z.id) n.zoneId = null;
      });

      uiState.settingsSelectedZoneId = null;

      await auditAppend(project, 'ZONE_DELETE', { entityType:'ZONE', entityId: z.id }, before, { zones: project.zones, nodes: project.nodes }, { note: 'Zone deleted by user' });

      syncTXANodes(project);
      bootstrapNormalizeZones(project);
      recomputeRisks(project);
      save();
      toast("Режим удален");
      render();
    };
  }

  c.querySelector('#btnAddCountry').onclick = async ()=>{
    if (project.readOnly) return toast("Read-only: изменения запрещены");

    let id = prompt('1. КОД СТРАНЫ (ID). Строго латиницей! (например: CN, DE, RU):', '');
    if (!id) return;
    id = String(id).trim().toUpperCase().replace(/\s+/g,'_');
    if (!/^[A-Z0-9_]{2,10}$/.test(id)) {
        alert('Ошибка: Код страны должен содержать ТОЛЬКО латинские буквы!');
        return;
    }
    if ((project.catalogs.jurisdictions||[]).some(j=>j.id===id)) return toast('Такой код уже существует');

    let name = prompt('2. НАЗВАНИЕ СТРАНЫ. (Можно на русском, например: Китай):', 'Китай') || id;
    name = String(name||'').trim() || id;

    const jur = { id, name, enabled:true };
    project.catalogs.jurisdictions.push(jur);
    const set = new Set(project.activeJurisdictions || []);
    set.add(id);
    project.activeJurisdictions = Array.from(set);
    project.masterData[id] = project.masterData[id] || {};

    await auditAppend(project, 'MASTERDATA_OVERRIDE', { entityType:'CATALOG', entityId:'jurisdictions' }, [
      {op:'add', path:'/catalogs/jurisdictions/-', value: jur},
      {op:'replace', path:'/activeJurisdictions', value: project.activeJurisdictions}
    ]);
    save(); toast('Страна успешно добавлена!'); render();
  };

  c.querySelector('#btnAddRegime').onclick = async ()=>{
    if (project.readOnly) return toast("Read-only: изменения запрещены");
    const existing = (project.catalogs.jurisdictions||[]).map(j=>j.id).join(', ');
    let jurId = prompt(`Страна (код). Существующие: ${existing || '(пусто)'}`, 'KZ');
    if (!jurId) return;
    jurId = String(jurId).trim().toUpperCase().replace(/\s+/g,'_');
    if (!/^[A-Z0-9_]{2,10}$/.test(jurId)) return toast('Неверный код');

    let zoneCode = prompt('Код режима (zone.code), например KZ_STANDARD:', `${jurId}_STANDARD`) || '';
    zoneCode = String(zoneCode||'').trim().toUpperCase().replace(/\s+/g,'_');
    if (!zoneCode) return;

    let zoneName = prompt('Название режима (zone.name):', zoneCode) || zoneCode;
    zoneName = String(zoneName||'').trim() || zoneCode;

    project.fx = project.fx || { fxDate:"2026-01-15", rateToKZT:{KZT:1}, source:"manual" };
    project.fx.rateToKZT = project.fx.rateToKZT || { KZT:1 };
    const knownCcy = Object.keys(project.fx.rateToKZT||{KZT:1}).filter(x=>x && x!=='');
    let currency = prompt(`Валюта режима (${knownCcy.join(', ')}). Можно ввести новую:`, (knownCcy.includes('KZT') ? 'KZT' : (knownCcy[0]||'KZT'))) || 'KZT';
    currency = String(currency||'').trim().toUpperCase();
    if (!currency) return;

    if (!project.fx.rateToKZT[currency]){
      const rStr = prompt(`Нет курса для ${currency} → KZT. Введите курс (число > 0):`, '1');
      const r = Number(rStr);
      if (!isFinite(r) || r <= 0) return toast('Неверный курс');
      project.fx.rateToKZT[currency] = r;
    }

    const safeTail = zoneCode.replace(new RegExp('^'+jurId+'_?'), '').replace(/[^A-Z0-9_]/g,'') || 'ZONE';
    let zoneIdBase = `${jurId}_${safeTail}`.replace(/_+/g,'_').slice(0,40);
    let zoneId = prompt('ID режима (zone.id). Должен быть уникальным:', zoneIdBase) || zoneIdBase;
    zoneId = String(zoneId||'').trim().toUpperCase().replace(/\s+/g,'_');
    if (!/^[A-Z0-9_]{2,40}$/.test(zoneId)) return toast('Неверный ID');

    let uniqueId = zoneId;
    let k = 2;
    while (getZone(project, uniqueId)){
      uniqueId = `${zoneId}_${k++}`;
    }
    zoneId = uniqueId;

    const maxZI = Math.max(0, ...(project.zones||[]).filter(z=>z.jurisdiction===jurId).map(z=>Number(z.zIndex||0)));
    let zIndex = Number(prompt('zIndex (слой, больше = выше):', String(maxZI + 1)));
    if (!isFinite(zIndex) || zIndex < 0) zIndex = maxZI + 1;

    const w = 360, h = 220;
    const W = Math.max(1000, Math.min(4000, Number(project.ui?.canvasW || 1400)));
    const H = Math.max(700, Math.min(3000, Number(project.ui?.canvasH || 1000)));
    const n = (project.zones||[]).length;
    let x = 40 + (n * 40) % Math.max(1, (W - w - 80));
    let y = 40 + (n * 30) % Math.max(1, (H - h - 80));
    x = Math.max(10, Math.min(W - w - 10, x));
    y = Math.max(10, Math.min(H - h - 10, y));

    const z = { id: zoneId, name: zoneName, x, y, w, h, jurisdiction: jurId, code: zoneCode, currency, zIndex, tax:{} };
    project.zones.push(z);
    project.ui = project.ui || {};
    project.ui.hiddenZoneIds = (project.ui.hiddenZoneIds || []).filter(x=>x!==zoneId);

    const txa = makeTXA(z);
    if (!getNode(project, txa.id)){
      project.nodes.push(txa);
    }

    normalizeZoneCascade(project, zoneId);
    syncTXANodes(project);
    bootstrapNormalizeZones(project);
    recomputeRisks(project);
    recomputeFrozen(project);

    await auditAppend(project, 'MASTERDATA_OVERRIDE', { entityType:'ZONE', entityId: zoneId }, [
      {op:'add', path:'/zones/-', value: z},
      {op:'add', path:'/nodes/-', value: txa},
      {op:'replace', path:'/fx/rateToKZT', value: project.fx.rateToKZT}
    ]);
    save(); toast('Режим добавлен'); render();
  };

  renderTree();
  renderEditor();
}

function renderOwnership(panel){
  const project = state.project;
  const persons = listPersons(project);
  const companies = listCompanies(project);
  const c = document.createElement('div');
  c.className = 'col';
  c.innerHTML = `
    <div class="title">Владение</div>
    <div class="small">MVP: проценты задаются вручную. Manual adjustment применяется как добавка/вычитание к проценту.</div>
    <div class="sep"></div>
    <div class="title">Новая связь</div>
    <div class="kv">
      <div><label>From</label><select id="ownFrom"></select></div>
      <div><label>To (company)</label><select id="ownTo"></select></div>
    </div>
    <div class="kv" style="margin-top:8px">
      <div><label>Percent</label><input id="ownPct" type="number" step="0.01" min="0" max="100" /></div>
      <div><label>manualAdjustment</label><input id="ownAdj" type="number" step="0.01" min="-100" max="100" /></div>
    </div>
    <div class="row" style="margin-top:10px">
      <button class="btn" id="btnAddOwn">Add</button>
    </div>
    <div class="sep"></div>
    <div class="title">Текущие связи</div>
    <div class="list" id="ownList"></div>
  `;
  panel.appendChild(c);
  const fromSel = c.querySelector('#ownFrom');
  const toSel = c.querySelector('#ownTo');
  [...persons, ...companies].forEach(n=>{
    const o = document.createElement('option'); o.value=n.id; o.textContent=n.name; fromSel.appendChild(o);
  });
  companies.forEach(n=>{
    const o = document.createElement('option'); o.value=n.id; o.textContent=n.name; toSel.appendChild(o);
  });
  fromSel.value = persons[0]?.id || companies[0]?.id || "";
  toSel.value = companies[0]?.id || "";
  c.querySelector('#ownPct').value = "100";
  c.querySelector('#ownAdj').value = "0";
  c.querySelector('#btnAddOwn').onclick = async ()=>{
    if (project.readOnly) return toast("Read-only: изменения запрещены");
    const pctRaw = Number(c.querySelector('#ownPct').value);
    const adjRaw = Number(c.querySelector('#ownAdj').value);
    if (!Number.isFinite(pctRaw) || pctRaw < 0 || pctRaw > 100) return toast("Percent должен быть числом от 0 до 100");
    if (!Number.isFinite(adjRaw) || adjRaw < -100 || adjRaw > 100) return toast("Manual adjustment должен быть числом (рекомендуемо -100..100)");
    if (!fromSel.value || !toSel.value) return toast("Выберите From и To");
    if (fromSel.value === toSel.value) return toast("From и To не могут быть одинаковыми");

    const effective = pctRaw + adjRaw;
    if (effective < 0 || effective > 100) return toast('Percent + manualAdjustment должен быть в диапазоне 0..100');
    const incoming = (project.ownership||[]).filter(x=>x.toId===toSel.value).reduce((s,x)=>s + Number(x.percent||0) + Number(x.manualAdjustment||0), 0);
    if (incoming + effective > 100 + 1e-6){
      return toast(`Сумма владения в ${toSel.options[toSel.selectedIndex]?.textContent||'company'} превысит 100%`);
    }
    const e = {
      id: "o_" + uid(),
      fromId: fromSel.value,
      toId: toSel.value,
      percent: bankersRound2(Number(c.querySelector('#ownPct').value || 0)),
      manualAdjustment: bankersRound2(Number(c.querySelector('#ownAdj').value || 0)),
    };
    
    const effPct = bankersRound2((e.percent||0) + (e.manualAdjustment||0));
    if (!Number.isFinite(effPct) || effPct < 0 || effPct > 100) return toast('Effective percent должен быть от 0 до 100');
    const incomingSum = (project.ownership||[])
      .filter(x=> x.toId===e.toId && x.id!==e.id)
      .reduce((s,x)=> s + ((Number(x.percent||0) + Number(x.manualAdjustment||0))||0), 0);
    const totalIncoming = bankersRound2(incomingSum + effPct);
    if (totalIncoming > 100.0001) return toast(`Суммарное владение превысит 100%`);
    
    project.ownership.unshift(e);
    await auditAppend(project, "OWNERSHIP_CREATE", {entityType:"OWNERSHIP", entityId:e.id}, {}, e, {});
    recomputeRisks(project);
    save();
    toast("Связь добавлена");
    render();
  };
  const list = c.querySelector('#ownList');
  const totals = {};
  (project.ownership||[]).forEach(o=>{ totals[o.toId] = (totals[o.toId]||0) + Number(o.percent||0) + Number(o.manualAdjustment||0); });

  (project.ownership || []).forEach(e=>{
    const from = getNode(project, e.fromId);
    const to = getNode(project, e.toId);
    const it = document.createElement('div');
    it.className = 'item';
    it.innerHTML = `
      <div class="hdr">
        <div>
          <div class="name">${escapeHtml(from?from.name:"?")} → ${escapeHtml(to?to.name:"?")}</div>
          <div class="meta">percent: ${formatMoney(e.percent)} · manualAdjustment: ${formatMoney(e.manualAdjustment)}</div>
        </div>
        <button class="btn danger" data-act="del">Delete</button>
      </div>
    `;
    it.querySelector('[data-act="del"]').onclick = async ()=>{
      if (project.readOnly) return toast("Read-only: изменения запрещены");
      project.ownership = project.ownership.filter(x=>x.id!==e.id);
      await auditAppend(project, "OWNERSHIP_DELETE", {entityType:"OWNERSHIP", entityId:e.id}, e, {}, {});
      recomputeRisks(project);
      save();
      toast("Удалено");
      render();
    };
    list.appendChild(it);
  });
}

function renderRisks(panel){
  const project = state.project;
  const companies = listCompanies(project);
  const persons = listPersons(project);

  const kz = project.masterData.KZ || {};
  const mci = numOrNull(kz.mciValue);
  const incomeMult = numOrNull(kz.cfcIncomeMci);
  const etrThr = numOrNull(kz.cfcEtrThreshold);
  const ownThr = numOrNull(kz.cfcOwnershipThreshold);
  const incomeThr = (mci != null && incomeMult != null) ? incomeMult * mci : null;
  const cfcEnabled = (incomeThr != null && etrThr != null && ownThr != null);

  const rev = numOrNull(project.group?.consolidatedRevenueEur);
  const pillarTwoActive = (rev != null && rev > 750_000_000);

  const c = document.createElement('div');
  c.className = 'col';
  c.innerHTML = `
    <div class="title">Риски (D-MACE + MVP)</div>
    <div class="small">
      CFC: ${cfcEnabled ? `включен (ownership ≥ ${Math.round(ownThr*100)}%, income > ${formatMoney(incomeThr)} KZT, ETR < ${Math.round(etrThr*100)}%)` : 'выключен (нормативы = none)'}.
      Pillar Two: ${pillarTwoActive ? `включен (revenue ${formatMoney(rev)} EUR)` : 'выключен (revenue <= 750 млн EUR или none)'}.
    </div>
    <div class="sep"></div>
    <div class="title">Параметры компаний</div>
    <div class="list" id="riskCompanies"></div>
    <div class="sep"></div>
    <div class="title">Параметры персон</div>
    <div class="list" id="riskPersons"></div>
    <div class="sep"></div>
    <div class="title">Сработавшие риски</div>
    <div class="list" id="riskFired"></div>
  `;
  panel.appendChild(c);

  const listC = c.querySelector('#riskCompanies');
  companies.forEach(co=>{
    const z = getZone(project, co.zoneId);
    const jur = z ? z.jurisdiction : 'n/a';
    co.compliance = co.compliance || { bvi:{relevantActivity:false,employees:0,office:false}, aifc:{usesCITBenefit:false,cigaInZone:true} };

    const isBvi = (jur === 'BVI');
    const isAifc = (z && z.code === 'KZ_AIFC');

    const it = document.createElement('div');
    it.className = 'item';
    it.innerHTML = `
      <div class="hdr">
        <div>
          <div class="name">${escapeHtml(co.name)}</div>
          <div class="meta">zone: ${escapeHtml(z ? z.code : 'none')} · jurisdiction: ${escapeHtml(jur)}</div>
        </div>
        <div class="pill">${escapeHtml(jur)}</div>
      </div>
      <div class="kv" style="margin-top:8px">
        <div><label>Annual income (KZT)</label><input data-k="income" type="number" step="1" min="0" value="${escapeHtml(String(Number(co.annualIncome||0)))}"/></div>
        <div><label>Manual ETR (override)</label><input data-k="etr" type="number" step="0.0001" min="0" max="1" value="${escapeHtml(String(Number(co.etr||0)))}"/></div>
      </div>
      <div class="small" style="margin-top:8px; padding:8px; background:rgba(0,0,0,0.04); border-radius:6px; border-left:3px solid var(--accent);">
        <div style="font-weight:bold; margin-bottom:4px;">CIT Engine (Computed):</div>
        <div>CIT Tax: <b>${formatMoney(co.computedCitKZT || 0)} KZT</b></div>
        <div>Effective Tax Rate: <b style="color:var(--warn);">${formatMoney((co.computedEtr || 0) * 100)}%</b></div>
      </div>

      ${isBvi ? `
        <div class="sep"></div>
        <div class="title">BVI Substance checklist</div>
        <div class="kv" style="margin-top:8px">
          <div>
            <label style="display:flex; gap:8px; align-items:center;">
              <input type="checkbox" data-k="bvi_ra" ${co.compliance.bvi.relevantActivity ? 'checked' : ''}/>
              <span class="small">Relevant Activity</span>
            </label>
          </div>
          <div>
            <label style="display:flex; gap:8px; align-items:center;">
              <input type="checkbox" data-k="bvi_office" ${co.compliance.bvi.office ? 'checked' : ''}/>
              <span class="small">Office in BVI</span>
            </label>
          </div>
        </div>
        <div style="margin-top:8px">
          <label>Employees</label>
          <input data-k="bvi_emp" type="number" step="1" min="0" value="${escapeHtml(String(Number(co.compliance.bvi.employees||0)))}"/>
        </div>
      ` : ''}

      ${isAifc ? `
        <div class="sep"></div>
        <div class="title">AIFC Presence (CIGA)</div>
        <div class="kv" style="margin-top:8px">
          <div>
            <label style="display:flex; gap:8px; align-items:center;">
              <input type="checkbox" data-k="aifc_benefit" ${co.compliance.aifc.usesCITBenefit ? 'checked' : ''}/>
              <span class="small">Uses CIT benefit</span>
            </label>
          </div>
          <div>
            <label style="display:flex; gap:8px; align-items:center;">
              <input type="checkbox" data-k="aifc_ciga" ${co.compliance.aifc.cigaInZone ? 'checked' : ''}/>
              <span class="small">CIGA in Zone</span>
            </label>
          </div>
        </div>
      ` : ''}
      <div class="row" style="margin-top:10px">
        <button class="btn secondary" data-act="save">Save</button>
      </div>
    `;

    it.querySelector('[data-act="save"]').onclick = async ()=>{
      if (project.readOnly) return toast('Read-only: изменения запрещены');
      const before = JSON.parse(JSON.stringify(co));
      co.annualIncome = Number(it.querySelector('[data-k="income"]').value || 0);
      co.etr = Number(it.querySelector('[data-k="etr"]').value || 0);
      if (isBvi){
        co.compliance.bvi.relevantActivity = !!it.querySelector('[data-k="bvi_ra"]').checked;
        co.compliance.bvi.office = !!it.querySelector('[data-k="bvi_office"]').checked;
        co.compliance.bvi.employees = Number(it.querySelector('[data-k="bvi_emp"]').value || 0);
      }
      if (isAifc){
        co.compliance.aifc.usesCITBenefit = !!it.querySelector('[data-k="aifc_benefit"]').checked;
        co.compliance.aifc.cigaInZone = !!it.querySelector('[data-k="aifc_ciga"]').checked;
      }
      await auditAppend(project, 'NODE_UPDATE', {entityType:'NODE', entityId:co.id}, before, co, {note:'risk inputs'});
      recomputeRisks(project);
      save();
      toast('Сохранено');
      render();
    };
    listC.appendChild(it);
  });

  const listP = c.querySelector('#riskPersons');
  persons.forEach(per=>{
    per.investments = per.investments || { aifcInvestmentUsd:0, aifcFeePaidMci:0, isInvestmentResident:false };
    const it = document.createElement('div');
    it.className = 'item';
    it.innerHTML = `
      <div class="hdr">
        <div>
          <div class="name">${escapeHtml(per.name)}</div>
          <div class="meta">citizenship: ${(per.citizenship||[]).map(escapeHtml).join(', ') || '—'}</div>
        </div>
        <div class="pill">person</div>
      </div>
      <div class="kv" style="margin-top:8px">
        <div><label>AIFC investment (USD)</label><input data-k="inv" type="number" step="1" min="0" value="${escapeHtml(String(Number(per.investments.aifcInvestmentUsd||0)))}"/></div>
        <div><label>AIFC fee paid (MCI)</label><input data-k="fee" type="number" step="1" min="0" value="${escapeHtml(String(Number(per.investments.aifcFeePaidMci||0)))}"/></div>
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn secondary" data-act="save">Save</button>
      </div>
      <div class="small" style="margin-top:8px">Investment resident: <b>${per.investments.isInvestmentResident ? 'true' : 'false'}</b></div>
    `;
    it.querySelector('[data-act="save"]').onclick = async ()=>{
      if (project.readOnly) return toast('Read-only: изменения запрещены');
      const before = JSON.parse(JSON.stringify(per));
      per.investments.aifcInvestmentUsd = Number(it.querySelector('[data-k="inv"]').value || 0);
      per.investments.aifcFeePaidMci = Number(it.querySelector('[data-k="fee"]').value || 0);
      await auditAppend(project, 'NODE_UPDATE', {entityType:'NODE', entityId:per.id}, before, per, {note:'investment resident inputs'});
      recomputeRisks(project);
      save();
      toast('Сохранено');
      render();
    };
    listP.appendChild(it);
  });

  const fired = c.querySelector('#riskFired');
  fired.innerHTML = '';

  const prf = Array.isArray(project.projectRiskFlags) ? project.projectRiskFlags : [];
  if (prf.length){
    prf.forEach(f=>{
      const it = document.createElement('div');
      it.className = 'item';
      it.innerHTML = `
        <div class="hdr">
          <div>
            <div class="name">${escapeHtml(f.type)}</div>
            <div class="meta">lawRef: ${escapeHtml(f.lawRef || '—')} · affected: ${escapeHtml(String(f.affectedCount||''))}</div>
          </div>
          <div class="pill danger">flag</div>
        </div>
      `;
      fired.appendChild(it);
    });
  }

  const any = [];
  for (const n of project.nodes){
    for (const rf of (n.riskFlags||[])){
      any.push({ node:n, rf });
    }
  }

  if (!any.length && !prf.length){
    const it = document.createElement('div');
    it.className = 'item';
    it.innerHTML = `<div class="small">Пока нет срабатываний.</div>`;
    fired.appendChild(it);
  } else {
    any.forEach(({node, rf})=>{
      const it = document.createElement('div');
      it.className = 'item';
      it.innerHTML = `
        <div class="hdr">
          <div>
            <div class="name">${escapeHtml(rf.type)}: ${escapeHtml(node.name)}</div>
            <div class="meta">lawRef: ${escapeHtml(rf.lawRef || '—')}</div>
          </div>
          <div class="pill danger">flag</div>
        </div>
      `;
      fired.appendChild(it);
    });
  }
}

function renderPipeline(panel){
  const project = state.project;
  project.pipeline = project.pipeline || { lastRunAt:null, lastRun:null, runs:[] };
  const c = document.createElement('div');
  c.className = 'col';
  const last = project.pipeline.lastRun;
  const lastAt = project.pipeline.lastRunAt;
  const year = yearOf(project.fx?.fxDate || nowIso());

  const stepsHtml = last && Array.isArray(last.steps) && last.steps.length
    ? last.steps.map(s=>{
        const pill = (s.status === 'ok') ? 'ok' : 'danger';
        const det = s.details ? `<div class="small" style="margin-top:4px">${escapeHtml(s.details)}</div>` : '';
        return `<div class="item"><div class="hdr"><div><div class="name">${escapeHtml(s.name)}</div>${det}</div><div class="pill ${pill}">${escapeHtml(s.status)}</div></div></div>`;
      }).join('')
    : `<div class="item"><div class="small">Лог пуст. Нажмите «Run pipeline».</div></div>`;

  c.innerHTML = `
    <div class="title">Лог расчетов</div>
    <div class="small">Последовательность: detectJurisdiction → loadMetadata → Separate Accounting → Recalculate ETR.</div>
    <div class="sep"></div>
    <div class="row" style="justify-content:space-between">
      <div class="small">Период (год): <b>${escapeHtml(String(year))}</b> · Последний запуск: ${escapeHtml(lastAt || '—')}</div>
      <button class="btn" id="runPipe">Run pipeline</button>
    </div>
    <div class="sep"></div>
    <div class="title">Steps</div>
    <div class="list" id="pipeSteps">${stepsHtml}</div>
  `;
  panel.appendChild(c);

  c.querySelector('#runPipe').onclick = ()=>{
    if (project.readOnly) return toast('Read-only: изменения запрещены');
    runPipeline(project, 'manual');
    save();
    render();
  };
}

export function scrollToZone(z){
  if (!z) return;
  const viewport = document.getElementById('viewport');
  if (!viewport) return;
  // Центрируем зону в окне просмотра
  const rect = viewport.getBoundingClientRect();
  boardState.x = rect.width / 2 - (z.x + z.w / 2) * boardState.scale;
  boardState.y = rect.height / 2 - (z.y + z.h / 2) * boardState.scale;
  updateBoardTransform();
}

function renderCatalogs(panel){
  const project = state.project;
  project.catalogs = project.catalogs || defaultCatalogs();
  if (!Array.isArray(project.activeJurisdictions)) {
    project.activeJurisdictions = (project.catalogs.jurisdictions || []).filter(j=>j.enabled !== false).map(j=>j.id);
  }

  project.ui = project.ui || { canvasW: 1400, canvasH: 1000, editMode: "nodes", gridSize: 10, snapToGrid: true, hiddenZoneIds: [], flowLegend: { show:true, mode:"ALL", selectedTypes:[], showTaxes:true } };
  project.ui.flowLegend = project.ui.flowLegend || { show:true, mode:"ALL", selectedTypes:[], showTaxes:true };
  project.ui.hiddenZoneIds = Array.isArray(project.ui.hiddenZoneIds) ? project.ui.hiddenZoneIds : [];

  const root = document.createElement('div');
  root.className = 'col';
  root.innerHTML = `
    <div class="title">Канвас и элементы</div>
    <div class="small">Отображение/скрытие стран и режимов, создание узлов.</div>
    <div class="sep"></div>
    <div class="item">
      <div class="hdr">
        <div><div class="name">Канвас</div></div>
      </div>
      <div class="sep"></div>
      <div class="kv">
        <div><label>Ширина</label><input id="cvW" type="number" min="1000" max="4000" step="50" value="${Number(project.ui.canvasW||1400)}"/></div>
        <div><label>Высота</label><input id="cvH" type="number" min="700" max="3000" step="50" value="${Number(project.ui.canvasH||1000)}"/></div>
      </div>
      <div class="row" style="margin-top:10px; justify-content:space-between">
        <div class="row" style="gap:8px">
          <button class="btn secondary" id="applyCanvas">Применить</button>
          <button class="btn secondary" id="fitCanvas">Под экран</button>
        </div>
        <div class="seg">
          <button class="segBtn" id="modeNodes">Узлы</button>
          <button class="segBtn" id="modeZones">Зоны</button>
        </div>
      </div>
      <div class="row" style="margin-top:10px; justify-content:space-between">
        <label style="display:flex; gap:8px; align-items:center;">
          <input type="checkbox" id="snapGrid" ${project.ui.snapToGrid===false ? "" : "checked"}/>
          <span class="small">Привязка к сетке</span>
        </label>
        <label style="display:flex; gap:8px; align-items:center;">
          <input type="checkbox" id="showLegend" ${project.ui.flowLegend.show===false ? "" : "checked"}/>
          <span class="small">Легенда потоков</span>
        </label>
      </div>
    </div>

    <div class="item">
      <div class="hdr">
        <div>
          <div class="name">Smart Focus DnD</div>
          <div class="meta">Перетащите элемент из панели на канвас</div>
        </div>
      </div>
      <div class="sep"></div>
      <div class="row" style="gap:8px">
        <button class="btn secondary" id="btnDndCountries">Добавить страну</button>
        <button class="btn secondary" id="btnDndRegimes">Добавить режим</button>
      </div>
    </div>

    <div class="item">
      <div class="hdr">
        <div><div class="name">Отображение стран и режимов</div></div>
        <div class="row" style="gap:8px">
          <button class="btn secondary" id="expAll">Развернуть</button>
          <button class="btn secondary" id="colAll">Свернуть</button>
        </div>
      </div>
      <div class="sep"></div>
      <div class="list" id="visTree"></div>
    </div>

    <div class="item">
      <div class="hdr">
        <div><div class="name">Создать элемент</div></div>
      </div>
      <div class="sep"></div>
      <div class="kv">
        <div>
          <label>Тип</label>
          <select id="tplSel">
            <option value="company">Company</option>
            <option value="person">Person</option>
          </select>
        </div>
        <div>
          <label>Режим (зона)</label>
          <select id="zoneSel"></select>
        </div>
      </div>
      <div style="margin-top:8px">
        <label>Название</label>
        <input id="newNodeName" placeholder="HoldCo, Founder"/>
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn" id="createNode">Создать</button>
      </div>
    </div>
  `;
  panel.appendChild(root);

  const setSeg = ()=>{
    const m = project.ui.editMode || 'nodes';
    root.querySelector('#modeNodes')?.classList.toggle('active', m==='nodes');
    root.querySelector('#modeZones')?.classList.toggle('active', m==='zones');
  };
  setSeg();
  root.querySelector('#modeNodes')?.addEventListener('click', ()=>{ project.ui.editMode = 'nodes'; save(); render(); });
  root.querySelector('#modeZones')?.addEventListener('click', ()=>{ project.ui.editMode = 'zones'; save(); render(); });

  // Smart Focus DnD кнопки
  root.querySelector('#btnDndCountries')?.addEventListener('click', () => openRightDrawer('COUNTRIES'));
  root.querySelector('#btnDndRegimes')?.addEventListener('click', () => {
    const firstJur = (project.catalogs?.jurisdictions || [])[0]?.id || 'KZ';
    openRightDrawer('REGIMES', firstJur);
  });

  root.querySelector('#applyCanvas')?.addEventListener('click', ()=>{
    if (project.readOnly) return toast("Read-only");
    project.ui.canvasW = Number(root.querySelector('#cvW').value||1400);
    project.ui.canvasH = Number(root.querySelector('#cvH').value||1000);
    save(); render();
  });
  root.querySelector('#fitCanvas')?.addEventListener('click', ()=>{
    if (project.readOnly) return toast("Read-only");
    const w = Math.max(1000, window.innerWidth - 420);
    const h = Math.max(700, window.innerHeight - 80);
    project.ui.canvasW = Math.min(4000, Math.round(w/50)*50);
    project.ui.canvasH = Math.min(3000, Math.round(h/50)*50);
    save(); render();
  });
  root.querySelector('#showLegend')?.addEventListener('change', (ev)=>{ project.ui.flowLegend.show = !!ev.target.checked; save(); render(); });
  root.querySelector('#snapGrid')?.addEventListener('change', (ev)=>{ project.ui.snapToGrid = !!ev.target.checked; save(); render(); });

  const tree = root.querySelector('#visTree');
  const jurs = (project.catalogs?.jurisdictions || defaultCatalogs().jurisdictions).slice().sort((a,b)=>a.id.localeCompare(b.id));

  const renderTree = ()=>{
    tree.innerHTML = "";
    jurs.forEach(j=>{
      const zones = (project.zones||[]).filter(z=>z.jurisdiction===j.id).slice().sort((a,b)=> (a.zIndex||0)-(b.zIndex||0) || a.id.localeCompare(b.id));
      const enabled = (project.activeJurisdictions||[]).includes(j.id);
      const expanded = (uiState.catalogsExpanded[j.id] !== false);

      const box = document.createElement('div');
      box.className = 'item';
      box.innerHTML = `
        <div class="hdr">
          <div>
            <div class="name">${escapeHtml(j.id)} — ${escapeHtml(j.name)} <span class="badge">${zones.length}</span></div>
            <div class="meta">${enabled ? "Включено" : "Скрыто"}</div>
          </div>
          <div class="row" style="gap:8px">
            <button class="btn secondary" data-exp="${escapeHtml(j.id)}">${expanded ? "Свернуть" : "Развернуть"}</button>
            <label style="display:flex; gap:8px; align-items:center;">
              <input type="checkbox" data-j="${escapeHtml(j.id)}" ${enabled ? "checked" : ""}/>
            </label>
          </div>
        </div>
        <div class="list" data-children="${escapeHtml(j.id)}" style="margin-top:8px; display:${expanded ? "flex" : "none"}"></div>
      `;
      tree.appendChild(box);

      const child = box.querySelector(`[data-children="${j.id}"]`);
      if (child){
        child.innerHTML = zones.map(z=>{
          const hidden = (project.ui.hiddenZoneIds||[]).includes(z.id);
          return `
            <div class="row" style="justify-content:space-between; align-items:center; padding:6px 0; border-top:1px solid var(--stroke);">
              <div style="font-weight:800; font-size:12px; cursor:pointer" data-focus="${escapeHtml(z.id)}">${escapeHtml(z.name)}</div>
              <div class="row" style="gap:10px; align-items:center;">
                <button class="btn secondary" data-find="${escapeHtml(z.id)}">Найти</button>
                <label><input type="checkbox" data-vis="${escapeHtml(z.id)}" ${hidden ? "" : "checked"}/></label>
              </div>
            </div>
          `;
        }).join("");
      }
    });

    tree.querySelectorAll('button[data-exp]').forEach(b=>{ b.onclick = ()=>{ uiState.catalogsExpanded[b.getAttribute('data-exp')] = !(uiState.catalogsExpanded[b.getAttribute('data-exp')] !== false); renderPanel(); }; });
    tree.querySelectorAll('input[data-j]').forEach(cb=>{
      cb.onchange = async (ev)=>{
        if (project.readOnly) return toast("Read-only");
        const id = ev.target.getAttribute('data-j');
        const set = new Set(project.activeJurisdictions || []);
        if (ev.target.checked) set.add(id); else set.delete(id);
        project.activeJurisdictions = Array.from(set);
        project.catalogs.jurisdictions = project.catalogs.jurisdictions.map(jj=> jj.id===id ? { ...jj, enabled: set.has(id) } : jj);
        save(); render();
      };
    });
    tree.querySelectorAll('input[data-vis]').forEach(ch=>{
      ch.onchange = (ev)=>{
        if (project.readOnly) return toast("Read-only");
        const id = ev.target.getAttribute('data-vis');
        const set = new Set(project.ui.hiddenZoneIds || []);
        if (ev.target.checked) set.delete(id); else set.add(id);
        project.ui.hiddenZoneIds = Array.from(set);
        bootstrapNormalizeZones(project);
        save(); render();
      };
    });
    tree.querySelectorAll('button[data-find]').forEach(btn=>{ btn.onclick = ()=>{ const z = getZone(project, btn.getAttribute('data-find')); if (z) scrollToZone(z); }; });
    tree.querySelectorAll('[data-focus]').forEach(el=>{ el.onclick = ()=>{ const z = getZone(project, el.getAttribute('data-focus')); if (z) scrollToZone(z); }; });
  };

  root.querySelector('#expAll').onclick = ()=>{ jurs.forEach(j=>{ uiState.catalogsExpanded[j.id] = true; }); renderPanel(); };
  root.querySelector('#colAll').onclick = ()=>{ jurs.forEach(j=>{ uiState.catalogsExpanded[j.id] = false; }); renderPanel(); };

  renderTree();

  const zoneSel = root.querySelector('#zoneSel');
  const zonesEnabled = (project.zones||[]).filter(z=>isZoneEnabled(project, z));
  zoneSel.innerHTML = `<option value="">(не выбрано)</option>` + zonesEnabled.map(z=>`<option value="${escapeHtml(z.id)}">${escapeHtml(z.name)}</option>`).join("");

  root.querySelector('#createNode').onclick = async ()=>{
    if (project.readOnly) return toast("Read-only");
    const kind = root.querySelector('#tplSel').value;
    const name = String(root.querySelector('#newNodeName').value || '').trim();
    if (!name) return toast('Укажи название элемента');
    const zoneId = zoneSel.value || null;
    const z = zoneId ? getZone(project, zoneId) : null;
    const n = makeNode(name, (kind === 'person' ? 'person' : 'company'), 80, 80);
    if (z){
      n.x = Math.round(z.x + z.w/2 - n.w/2);
      n.y = Math.round(z.y + z.h/2 - n.h/2);
      n.zoneId = z.id;
    } else {
      n.x = 60 + Math.round(Math.random()*160);
      n.y = 60 + Math.round(Math.random()*160);
      n.zoneId = detectZoneId(project, n);
    }
    project.nodes.push(n);
    await auditAppend(project, 'NODE_CREATE', { entityType:'NODE', entityId:n.id }, { nodes: [] }, { nodes: [n] });
    save(); root.querySelector('#newNodeName').value = ''; render();
  };
}

function renderFlows(panel){
  const project = state.project;
  const companies = listCompanies(project);
  const c = document.createElement('div');
  c.className = 'col';

  const editingFlow = uiState.editingFlow || null;

  function formatMask(val) {
    if (val === null || val === undefined || val === '') return '';
    let s = String(val).replace(/[^\d.,]/g, '').replace(',', '.');
    let parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    if (parts.length > 2) parts = [parts[0], parts.slice(1).join('')];
    return parts.join('.');
  }
  function unmask(val) {
    return Number(String(val).replace(/\s/g, '')) || 0;
  }
  const handleMaskInput = (e) => {
    const cursor = e.target.selectionStart;
    const oldLen = e.target.value.length;
    e.target.value = formatMask(e.target.value);
    const newLen = e.target.value.length;
    e.target.setSelectionRange(cursor + (newLen - oldLen), cursor + (newLen - oldLen));
  };

  c.innerHTML = `
    <div class="item" style="margin-bottom: 20px; background: linear-gradient(145deg, #e6e9ef, #c8d0da); border: none; box-shadow: 5px 5px 10px rgb(163,177,198,0.4), -5px -5px 10px rgba(255,255,255, 0.4);">
      <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
              <div class="name" style="font-size: 1.1em; color: #333; margin-bottom: 4px;">📊 Аналитика и Подведение итогов</div>
              <div class="small" style="color: #666;">Запустите Year-End Wizard для переоценки валюты, НДС и оптимизации налогов.</div>
          </div>
          <button class="btn" id="btnLaunchWizard" style="background: #a855f7; color: white; border: none; padding: 10px 16px; font-weight: 600;">Закрыть период</button>
      </div>
    </div>
    <div class="sep"></div>

    <div class="title">Баланс и статус</div>
    <div class="list" id="balList"></div>
    <div class="sep"></div>
    <div class="title" id="formTitle">${editingFlow ? "Редактирование потока" : "Новый поток"}</div>
    <div class="kv">
      <div><label>Плательщик</label><select id="fromSel"></select></div>
      <div><label>Получатель</label><select id="toSel"></select></div>
    </div>
    <div class="kv" style="margin-top:8px">
      <div><label>Тип</label><select id="typeSel"></select></div>
      <div><label>Валюта</label>
        <select id="ccySel">
          <option>KZT</option><option>USD</option><option>HKD</option><option>AED</option><option>EUR</option><option>GBP</option><option>SGD</option>
        </select>
      </div>
    </div>
    
    <div style="margin-top:8px; padding: 12px; background: rgba(255,255,255,0.6); border-radius: 8px; border: 1px solid var(--stroke);">
      <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
        <label style="margin:0; font-weight: 600;">Сумма платежа (Amount)</label>
        <label style="font-size: 0.9em; display:flex; align-items:center; gap:6px; cursor: pointer; color: #a855f7; font-weight: 600;">
          <input type="checkbox" id="isNet" style="width:16px; height:16px; margin:0;">
          Ввести чистыми (Net)
        </label>
      </div>
      <input id="grossIn" type="text" inputmode="decimal" placeholder="0.00" style="width: 100%; box-sizing: border-box; font-size: 1.1em; padding: 8px;" />
      <div id="netGrossHint" class="small" style="color: #666; margin-top: 6px; min-height: 14px;">Ввод суммы до вычета налогов (Gross)</div>
    </div>

    <div class="kv" style="margin-top:8px">
      <div><label>Способ оплаты</label>
        <select id="paySel">
          <option value="bank">bank</option><option value="cash">cash</option><option value="card">card</option><option value="crypto">crypto</option><option value="other">other</option>
        </select>
      </div>
      <div><label>Наличная часть</label><input id="cashPart" type="text" inputmode="decimal" placeholder="0.00" /></div>
    </div>
    <div class="kv" style="margin-top:8px">
      <div><label>Cash currency</label>
        <select id="cashCcy">
          <option>KZT</option><option>USD</option><option>HKD</option><option>AED</option><option>EUR</option><option>GBP</option><option>SGD</option>
        </select>
      </div>
      <div><label>WHT % (Налог у источника)</label><input id="whtRate" type="number" step="0.01" min="0" max="100" /></div>
    </div>
    <div style="margin-top:8px"><label>Дата операции</label><input id="flowDate" type="datetime-local" /></div>
    <div class="row" style="margin-top:10px; gap:8px;">
      <button class="btn" id="btnAdd">${editingFlow ? "Update Flow" : "Add pending"}</button>
      ${editingFlow ? `<button class="btn secondary" id="btnCancelEdit">Cancel</button>` : ``}
    </div>
    <div class="sep"></div>
    <div class="title">Потоки</div>
    <div class="list" id="flowList"></div>
    <div class="sep"></div>
    <div class="title">Налоги к оплате (TXA)</div>
    <div class="list" id="taxList"></div>
  `;
  panel.appendChild(c);

  c.querySelector('#btnLaunchWizard').onclick = () => showYearEndWizard();
  c.querySelector('#grossIn').addEventListener('input', handleMaskInput);
  c.querySelector('#cashPart').addEventListener('input', handleMaskInput);

  const balList = c.querySelector('#balList');
  companies.forEach(n=>{
    const z = getZone(project, n.zoneId);
    const ccy = z ? z.currency : "KZT";
    const debt = bankersRound2(nodeDebtToTXA(project, n));
    const thr = frozenThresholdFunctional(project, n);
    const status = n.frozen ? "FROZEN" : "OK";
    const pill = n.frozen ? "danger" : "ok";
    const it = document.createElement('div');
    it.className = 'item';
    it.innerHTML = `
      <div class="hdr">
        <div><div class="name">${escapeHtml(n.name)}</div><div class="meta">Zone: ${escapeHtml(z ? z.code : "none")} · Balance: ${formatMoney(n.balances?.[ccy]||0)} ${ccy} · Debt: ${formatMoney(debt)} ${ccy}</div></div>
        <div class="pill ${pill}">${status}</div>
      </div>
      ${thr ? `<div class="small" style="margin-top:6px">Frozen threshold: ${formatMoney(thr)} ${ccy}</div>` : `<div class="small" style="margin-top:6px">Frozen threshold: n/a</div>`}
    `;
    balList.appendChild(it);
  });

  const fromSel = c.querySelector('#fromSel'), toSel = c.querySelector('#toSel');
  companies.forEach(n=>{
    fromSel.appendChild(new Option(n.name, n.id));
    toSel.appendChild(new Option(n.name, n.id));
  });
  
  const typeSelEl = c.querySelector('#typeSel');
  const flowTypes = (project.catalogs?.flowTypes || defaultCatalogs().flowTypes).filter(ft=>ft.enabled !== false);
  typeSelEl.innerHTML = flowTypes.map(ft=>`<option value="${escapeHtml(ft.id)}">${escapeHtml(ft.name)}</option>`).join("");
  
  const draft = editingFlow || makeFlowDraft(project);
  fromSel.value = draft.fromId || companies[0]?.id || "";
  toSel.value = draft.toId || companies[1]?.id || companies[0]?.id || "";
  c.querySelector('#typeSel').value = draft.flowType;
  c.querySelector('#ccySel').value = draft.currency;
  c.querySelector('#grossIn').value = draft.grossAmount ? formatMask(draft.grossAmount) : "";
  c.querySelector('#paySel').value = draft.paymentMethod;
  c.querySelector('#cashPart').value = draft.cashComponentAmount ? formatMask(draft.cashComponentAmount) : "";
  c.querySelector('#cashCcy').value = draft.cashComponentCurrency;
  c.querySelector('#whtRate').value = String(draft.whtRate);
  c.querySelector('#flowDate').value = toLocalDateTimeInput(draft.flowDate);

  if (editingFlow) c.querySelector('#btnCancelEdit').onclick = () => { uiState.editingFlow = null; render(); };

  const _grossIn = c.querySelector('#grossIn');
  const _isNet = c.querySelector('#isNet');
  const _whtIn = c.querySelector('#whtRate');
  const _hint = c.querySelector('#netGrossHint');
  const _ccySel = c.querySelector('#ccySel');

  const updateNetGrossHint = () => {
    const rawAmt = unmask(_grossIn.value);
    const wht = Number(_whtIn.value || 0);
    const ccy = _ccySel.value;
    if (_isNet.checked) {
      if (wht > 0 && wht < 100) {
        const gross = rawAmt / (1 - wht / 100);
        const tax = gross - rawAmt;
        _hint.innerHTML = `Авторасчет: Gross <b style="color:#a855f7; font-size:1.1em;">${formatMoney(gross)}</b> ${ccy} (Налог удержан: ${formatMoney(tax)} ${ccy})`;
      } else {
        _hint.innerHTML = `Авторасчет: Налога у источника нет (WHT 0%). Net равен Gross.`;
      }
    } else {
      const tax = rawAmt * (wht / 100);
      const net = rawAmt - tax;
      _hint.innerHTML = `Ввод суммы до вычета (Gross). На руки получатель получит: <b style="color:#333;">${formatMoney(net)}</b> ${ccy}`;
    }
  };

  _grossIn.addEventListener('input', updateNetGrossHint);
  _isNet.addEventListener('change', updateNetGrossHint);
  _whtIn.addEventListener('input', updateNetGrossHint);
  _ccySel.addEventListener('change', updateNetGrossHint);

  const applyDefaultWht = ()=>{
    if (editingFlow) return; 
    const payer = getNode(project, fromSel.value), payee = getNode(project, toSel.value);
    const z = payer ? getZone(project, payer.zoneId) : null, zPayee = payee ? getZone(project, payee.zoneId) : null;
    const fType = c.querySelector('#typeSel').value;
    
    if (fType === "Salary" || fType === "Goods" || fType === "Equipment" || fType === "Services"){
      _whtIn.value = "0";
    } else if (z && zPayee && z.jurisdiction === zPayee.jurisdiction) {
      _whtIn.value = "0";
    } else if (z){
      const tx = effectiveZoneTax(project, z);
      _whtIn.value = String(bankersRound2(whtDefaultPercentForFlow(tx, fType)));
    }
    updateNetGrossHint();
  };
  c.querySelector('#typeSel').addEventListener('change', applyDefaultWht);
  fromSel.addEventListener('change', applyDefaultWht);
  toSel.addEventListener('change', applyDefaultWht);
  
  updateNetGrossHint();

  c.querySelector('#btnAdd').onclick = async ()=>{
    if (project.readOnly) return toast("Read-only: изменения запрещены");
    const fromId = fromSel.value;
    if (!canCreateOutgoing(project, fromId)) return toast("Нельзя: компания FROZEN");
    
    const flow = editingFlow ? editingFlow : makeFlowDraft(project);
    const before = editingFlow ? JSON.parse(JSON.stringify(editingFlow)) : null;

    flow.fromId = fromSel.value;
    flow.toId = toSel.value;
    flow.flowType = c.querySelector('#typeSel').value;
    flow.currency = c.querySelector('#ccySel').value;
    
    let rawAmt = bankersRound2(unmask(c.querySelector('#grossIn').value));
    let isNet = c.querySelector('#isNet').checked;
    let whtRate = bankersRound2(Number(c.querySelector('#whtRate').value || 0));
    
    if (isNet && whtRate > 0 && whtRate < 100) {
      flow.grossAmount = bankersRound2(rawAmt / (1 - whtRate / 100));
    } else {
      flow.grossAmount = rawAmt;
    }
    flow.whtRate = whtRate;

    flow.paymentMethod = c.querySelector('#paySel').value;
    flow.cashComponentAmount = bankersRound2(unmask(c.querySelector('#cashPart').value));
    flow.cashComponentCurrency = c.querySelector('#cashCcy').value;
    flow.flowDate = fromLocalDateTimeInput(c.querySelector('#flowDate').value) || flow.flowDate;
    
    const y = yearOf(flow.flowDate);
    if (isYearClosed(project, y)) return toast("Нельзя: год закрыт");
    
    updateFlowCompliance(project, flow);

    if (editingFlow) {
      await auditAppend(project, "FLOW_UPDATE", {entityType:"FLOW", entityId:flow.id}, before, flow, {note:"user edited pending flow"});
      uiState.editingFlow = null;
      toast("Поток обновлен");
    } else {
      project.flows.unshift(flow);
      await auditAppend(project, "FLOW_CREATE", {entityType:"FLOW", entityId:flow.id}, {}, flow, {note:"create pending"});
      toast("Добавлен pending flow");
    }
    save(); render();
  };

  const flowList = c.querySelector('#flowList');
  project.flows.forEach(flow=>{
    const payer = getNode(project, flow.fromId), payee = getNode(project, flow.toId), payerZ = payer ? getZone(project, payer.zoneId) : null;
    const ccy = flow.currency, ack = flow.ack.ackStatus, isExecuted = flow.status === "executed", needsAck = ack === "required";
    const canExec = !isExecuted && (!needsAck) && !project.readOnly && canCreateOutgoing(project, flow.fromId);
    
    const it = document.createElement('div');
    it.className = 'item';
    let actionButtons = isExecuted 
      ? `<button class="btn secondary" data-act="rollback">Rollback (Сторно)</button> <button class="btn secondary" data-act="clone">Clone</button>`
      : `<button class="btn" data-act="exec" ${!canExec ? "disabled" : ""}>Execute</button> <button class="btn secondary" data-act="ack" ${(!needsAck || project.readOnly) ? "disabled" : ""}>Ack</button> <button class="btn secondary" data-act="edit">Edit</button> <button class="btn secondary" data-act="clone">Clone</button> <button class="btn danger" data-act="del">Del</button>`;

    it.innerHTML = `
      <div class="hdr">
        <div><div class="name">${escapeHtml(flow.flowType)} · ${formatMoney(flow.grossAmount)} ${ccy}</div><div class="meta">${escapeHtml(payer ? payer.name : "?")} → ${escapeHtml(payee ? payee.name : "?")} · pay: ${escapeHtml(flow.paymentMethod)} · WHT: ${formatMoney(flow.whtRate)}%</div><div class="meta">date: ${escapeHtml(isoDate(flow.flowDate))}</div></div>
        <div class="pill ${isExecuted ? "ok" : (needsAck ? "warn" : "pill")}">${isExecuted ? "executed" : (needsAck ? "ack required" : "pending")}</div>
      </div>
      ${needsAck ? `<div class="small warn" style="margin-top:6px; padding:6px; background:rgba(255,100,100,0.1); border-radius:4px;"><b>⚠️ Требуется подтверждение риска:</b> ${escapeHtml(flow.compliance?.violationType || 'Неизвестный риск')}. Комментарий обязателен.</div>` : ``}
      <div class="row" style="margin-top:10px; gap:8px;">${actionButtons}</div>
    `;

    it.querySelector('[data-act="clone"]')?.addEventListener('click', async () => {
      if (project.readOnly) return toast("Read-only");
      const clone = JSON.parse(JSON.stringify(flow));
      clone.id = "f_" + uid(); clone.status = "pending"; clone.ack = { ackStatus: "not_required", acknowledgedBy: null, acknowledgedAt: null, comment: "" }; clone.taxAdjustments = []; clone.fxEvidence = null; clone.dmace = {}; clone.flowDate = new Date(project.fx.fxDate + "T12:00:00Z").toISOString();
      updateFlowCompliance(project, clone);
      project.flows.unshift(clone);
      await auditAppend(project, "FLOW_CREATE", {entityType:"FLOW", entityId:clone.id}, {}, clone, {note:"cloned from " + flow.id});
      uiState.editingFlow = clone; save(); toast("Поток продублирован"); render();
      document.getElementById('formTitle').scrollIntoView({behavior: "smooth"});
    });

    if (!isExecuted) {
      it.querySelector('[data-act="edit"]')?.addEventListener('click', () => { if (project.readOnly) return; uiState.editingFlow = flow; render(); document.getElementById('formTitle').scrollIntoView({behavior: "smooth"}); });
      it.querySelector('[data-act="del"]')?.addEventListener('click', async () => { if (project.readOnly) return; if (!confirm("Удалить этот поток?")) return; project.flows = project.flows.filter(f => f.id !== flow.id); if (uiState.editingFlow?.id === flow.id) uiState.editingFlow = null; await auditAppend(project, "FLOW_DELETE", {entityType:"FLOW", entityId:flow.id}, flow, null, {note:"deleted pending flow"}); save(); render(); });
      it.querySelector('[data-act="ack"]')?.addEventListener('click', async ()=>{
        if (project.readOnly || (!needsAck)) return;
        const comment = prompt("Комментарий (обязательно):", "");
        if (!comment || !comment.trim()) return toast("Нужен комментарий");
        const before = JSON.parse(JSON.stringify(flow));
        flow.ack.ackStatus = "acknowledged"; flow.ack.acknowledgedBy = project.userId; flow.ack.acknowledgedAt = nowIso(); flow.ack.comment = comment.trim();
        await auditAppend(project, "FLOW_UPDATE", {entityType:"FLOW", entityId:flow.id}, before, flow, {note:"acknowledge risk"});
        save(); toast("Риск подтвержден"); render();
      });
      it.querySelector('[data-act="exec"]')?.addEventListener('click', async ()=>{
        if (project.readOnly || !canExec) return;
        const payerNode = getNode(project, flow.fromId);
        if (payerNode.frozen) return toast("Нельзя: компания FROZEN");
        updateFlowCompliance(project, flow);
        if (isYearClosed(project, yearOf(flow.flowDate || project.fx.fxDate))) return toast("Нельзя: год закрыт");
        if (flow.ack.ackStatus === "required") return toast("Сначала подтвердите риск");
        const before = JSON.parse(JSON.stringify(flow));
        flow.status = "executed";
        const createdTaxIds = [];
        if (payerZ){          
          const w = computeWht(project, flow, Number(flow.whtRate || 0));
          if (Number(w.amountFunctional || 0) > 0){
            const tax = {
              id: "t_" + uid(), dueFromFlowId: flow.id, payerId: payerNode.id, zoneId: payerNode.zoneId,
              taxType: "WHT", amountFunctional: w.amountFunctional, functionalCurrency: payerZ.currency,
              amountOriginal: w.amountOriginal, originalCurrency: w.originalCurrency, fxDate: w.fxDate,
              fxRateUsed: w.fxRateUsed, status: "pending", createdAt: nowIso(), executedAt: null
            };
            project.taxes.unshift(tax); createdTaxIds.push(tax.id);
          }
          await auditAppend(project, "FLOW_EXECUTE", {entityType:"FLOW", entityId:flow.id}, before, flow, {note:"execute business flow"});
          recomputeFrozen(project);
        }
        save(); toast("Flow executed. Налог добавлен в pending."); render();
      });
    } else {
      it.querySelector('[data-act="rollback"]')?.addEventListener('click', async () => {
        if (project.readOnly) return toast("Read-only");
        if (project.taxes.filter(t => t.dueFromFlowId === flow.id).some(t => t.status === "executed")) return toast("Сначала откатите налоги.");
        const beforeFlow = JSON.parse(JSON.stringify(flow));
        project.taxes = project.taxes.filter(t => t.dueFromFlowId !== flow.id);
        flow.status = "pending";
        await auditAppend(project, "FLOW_ROLLBACK", {entityType:"FLOW", entityId:flow.id}, beforeFlow, flow, {note:"rollback to pending"}); 
        recomputeFrozen(project); save(); toast("Поток откачен"); render();
      });
    }
    flowList.appendChild(it);
  });

  const taxList = c.querySelector('#taxList');
  project.taxes.forEach(t=>{
    const payer = getNode(project, t.payerId), z = getZone(project, t.zoneId), txa = getNode(project, "txa_" + t.zoneId);
    const isPending = t.status === "pending";
    const it = document.createElement('div');
    it.className = 'item';
    
    let taxButtons = isPending 
      ? `<button class="btn" data-act="pay">Pay Tax</button> <button class="btn secondary" data-act="settle" style="border-color:#a855f7; color:#a855f7;">Settle (Урегулировать)</button>`
      : `<button class="btn secondary" data-act="tax_rollback">Rollback (Сторно)</button>`;

    it.innerHTML = `
      <div class="hdr">
        <div><div class="name">Tax ${escapeHtml(t.taxType)} · ${formatMoney(t.amountFunctional)} ${escapeHtml(t.functionalCurrency)}</div><div class="meta">payer: ${escapeHtml(payer ? payer.name : "?")} · flow: ${escapeHtml(t.dueFromFlowId)}</div></div>
        <div class="pill ${isPending ? 'warn' : 'ok'}">${isPending ? 'pending' : 'executed'}</div>
      </div>
      <div class="row" style="margin-top:10px; gap:8px;">${taxButtons}</div>
    `;

    if (isPending) {
      it.querySelector('[data-act="pay"]').onclick = async ()=>{
        if (project.readOnly) return toast("Read-only");
        if (isYearClosed(project, yearOf(project.flows.find(f=>f.id===t.dueFromFlowId)?.flowDate))) return toast("Год закрыт");
        payer.balances[t.functionalCurrency] = bankersRound2(Number(payer.balances[t.functionalCurrency]||0) - Number(t.amountFunctional || 0));
        txa.balances[t.functionalCurrency] = bankersRound2(Number(txa.balances[t.functionalCurrency]||0) + Number(t.amountFunctional || 0));
        t.status = "executed"; t.executedAt = nowIso();
        recomputeFrozen(project); save(); toast("Налог оплачен"); render();
      };

      it.querySelector('[data-act="settle"]').onclick = async ()=>{
        if (project.readOnly) return toast("Read-only");
        const reason = prompt("Причина списания:\\n1 - DTT_APPLIED (Сертификат)\\n2 - RECHARACTERIZATION (Смена типа)\\n3 - TAX_OFFSET (Взаимозачет)\\n4 - ERROR_CORRECTION\\n5 - STATUTE_OF_LIMITATIONS", "1");
        const rMap = {"1":"DTT_APPLIED", "2":"RECHARACTERIZATION", "3":"TAX_OFFSET", "4":"ERROR_CORRECTION", "5":"STATUTE_OF_LIMITATIONS"};
        if (!reason || !rMap[reason.trim()]) return toast("Отменено");
        const lawRef = prompt("Ссылка на закон (например KZ_UAE_DTT_ART_10):", "DTT_ART_10");
        try {
          await applyTaxAdjustment(project, t.payerId, t.dueFromFlowId, {
            taxType: t.taxType.includes('WHT') ? 'WHT' : (t.taxType.includes('VAT') ? 'VAT' : 'CIT'),
            effect: (rMap[reason.trim()] === "TAX_OFFSET") ? "OFFSET" : (rMap[reason.trim()] === "STATUTE_OF_LIMITATIONS" ? "WRITE_OFF" : "EXEMPT"),
            reason: rMap[reason.trim()], amountFunctional: t.amountFunctional, lawRefId: lawRef || "N/A"
          });
          toast("Урегулировано"); render();
        } catch(e) { toast("Ошибка: " + e.message); }
      };
    } else {
      it.querySelector('[data-act="tax_rollback"]')?.addEventListener('click', async () => {
        if (project.readOnly) return toast("Read-only");
        payer.balances[t.functionalCurrency] = bankersRound2(Number(payer.balances[t.functionalCurrency]) + Number(t.amountFunctional || 0));
        txa.balances[t.functionalCurrency] = bankersRound2(Number(txa.balances[t.functionalCurrency]) - Number(t.amountFunctional || 0));
        t.status = "pending"; t.executedAt = null;
        recomputeFrozen(project); save(); toast("Оплата отменена"); render();
      });
    }
    taxList.appendChild(it);
  });
}

// --- АНАЛИТИЧЕСКИЙ ДАШБОРД (Vanilla SVG) ---
export function renderDashboard(panel) {
    const project = state.project;
    if (!project) return;

    let totalIncomeKZT = 0;
    const incomeByZone = {};

    listCompanies(project).forEach(co => {
        const incomeKZT = Number(co.annualIncome || 0);
        totalIncomeKZT += incomeKZT;
        const z = getZone(project, co.zoneId);
        const jur = z ? z.jurisdiction : 'Вне юрисдикции';
        incomeByZone[jur] = (incomeByZone[jur] || 0) + incomeKZT;
    });

    let totalTaxKZT = 0;
    const taxesByType = { 'CIT (Корпоративный)': 0, 'WHT (У источника)': 0, 'VAT (НДС)': 0, 'Payroll (Зарплатные)': 0 };

    (project.taxes || []).forEach(t => {
        if (['written_off', 'exempted', 'offset_cleared'].includes(t.status)) return;
        const taxKZT = convert(project, t.amountFunctional, t.functionalCurrency, 'KZT') || 0;
        totalTaxKZT += taxKZT;

        if (t.taxType.includes('CIT')) taxesByType['CIT (Корпоративный)'] += taxKZT;
        else if (t.taxType.includes('WHT')) taxesByType['WHT (У источника)'] += taxKZT;
        else if (t.taxType.includes('VAT')) taxesByType['VAT (НДС)'] += taxKZT;
        else taxesByType['Payroll (Зарплатные)'] += taxKZT;
    });

    const globalEtr = totalIncomeKZT > 0 ? (totalTaxKZT / totalIncomeKZT) * 100 : 0;

    const createDonutChart = (dataObj, size = 240) => {
        const data = Object.entries(dataObj).filter(([_, val]) => val > 0).map(([label, value], i) => ({ label, value, color: ['accent', 'warn', 'ok', 'danger'][i % 4] }));
        const center = size / 2, strokeW = 35, radius = center - strokeW / 2, circ = 2 * Math.PI * radius;
        const total = data.reduce((s, d) => s + d.value, 0);

        if (total === 0) return `<svg width="${size}" height="${size}"><circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="var(--stroke)" stroke-width="${strokeW}"/></svg><div class="small" style="text-align:center; margin-top:10px;">Нет налогов</div>`;

        let offset = 0;
        const circles = data.map(d => {
            const fraction = d.value / total, dashArray = `${fraction * circ} ${circ}`, dashOffset = -offset;
            offset += fraction * circ;
            return `<circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="var(--${d.color})" stroke-width="${strokeW}" stroke-dasharray="${dashArray}" stroke-dashoffset="${dashOffset}" transform="rotate(-90 ${center} ${center})" style="transition: all 0.5s ease;"><title>${d.label}: ${formatMoney(d.value)} KZT</title></circle>`;
        }).join('');

        const legend = data.map(d => `<div style="display:flex; align-items:center; justify-content:space-between; font-size:12px; font-weight:600; margin-bottom:6px;"><div style="display:flex; align-items:center; gap:6px;"><div style="width:10px; height:10px; border-radius:50%; background:var(--${d.color})"></div>${d.label}</div><span>${formatMoney(d.value)}</span></div>`).join('');

        return `<div style="display:flex; gap: 30px; align-items: center; justify-content: center; flex-wrap: wrap;"><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${circles}<text x="${center}" y="${center - 5}" text-anchor="middle" dominant-baseline="middle" fill="var(--text)" font-size="16" font-weight="800">${formatMoney(total)}</text><text x="${center}" y="${center + 15}" text-anchor="middle" dominant-baseline="middle" fill="var(--muted)" font-size="10">Всего налогов (KZT)</text></svg><div style="min-width: 200px;">${legend}</div></div>`;
    };

    const createBarChart = (dataObj) => {
        const entries = Object.entries(dataObj).filter(([_, val]) => val > 0).sort((a, b) => b[1] - a[1]);
        if (!entries.length) return `<div class="small" style="text-align:center; padding: 20px;">Нет доходов</div>`;
        const maxVal = entries[0][1];
        return `<div class="col" style="gap:12px; justify-content:center; margin-top: 10px;">` + entries.map(([label, val]) => `<div style="margin-bottom: 8px;"><div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:12px; font-weight:600;"><span>${escapeHtml(label)}</span><span>${formatMoney(val)} KZT</span></div><div style="width:100%; height:10px; background:var(--stroke); border-radius:5px; overflow:hidden;"><div style="width:${(val / maxVal) * 100}%; height:100%; background:var(--accent); border-radius:5px; transition: width 0.5s ease;"></div></div></div>`).join('') + `</div>`;
    };

    const c = document.createElement('div');
    c.className = 'col'; c.style.gap = '20px';
    c.innerHTML = `
        <div class="row" style="gap: 16px; flex-wrap: wrap;">
            <div class="item" style="flex:1; min-width: 200px; border-left: 4px solid var(--ok);">
                <div class="small">Выручка группы</div><div style="font-size: 22px; font-weight: 800; margin-top: 4px; color: var(--text);">${formatMoney(totalIncomeKZT)} <span style="font-size:12px; color:var(--muted)">KZT</span></div>
            </div>
            <div class="item" style="flex:1; min-width: 200px; border-left: 4px solid var(--danger);">
                <div class="small">Налоговая нагрузка</div><div style="font-size: 22px; font-weight: 800; margin-top: 4px; color: var(--danger);">${formatMoney(totalTaxKZT)} <span style="font-size:12px; color:var(--muted)">KZT</span></div>
            </div>
            <div class="item" style="flex:1; min-width: 200px; border-left: 4px solid ${globalEtr > 15 ? 'var(--warn)' : 'var(--ok)'};">
                <div class="small">Global ETR</div><div style="display: flex; align-items: baseline; gap: 8px;"><div style="font-size: 22px; font-weight: 800; margin-top: 4px; color: ${globalEtr > 15 ? 'var(--warn)' : 'var(--ok)'};">${bankersRound2(globalEtr)}%</div>${globalEtr < 15 ? '<span class="badge danger" style="font-size:10px;">Pillar 2 Risk</span>' : '<span class="badge ok" style="font-size:10px;">Safe Harbor</span>'}</div>
            </div>
        </div>
        <div class="row" style="gap: 20px; align-items: stretch; flex-wrap: wrap;">
            <div class="item" style="flex: 2; min-width: 350px;"><div class="title" style="margin-bottom: 20px;">Структура налогов (Consolidated)</div>${createDonutChart(taxesByType)}</div>
            <div class="item" style="flex: 1; min-width: 300px;"><div class="title">Концентрация выручки</div>${createBarChart(incomeByZone)}</div>
        </div>
    `;
    panel.appendChild(c);
}

function renderAudit(panel){
  const project = state.project;
  const c = document.createElement('div');
  c.className = 'col';
  c.innerHTML = `
    <div class="title">Audit Log</div>
    <div class="small">Все значимые действия в системе логируются здесь. Блок защищен SHA-256 хешами.</div>
    <div class="sep"></div>
    <div class="list">
      ${(project.audit?.entries||[]).map(e=>`
        <div class="item">
          <div class="small"><b>${escapeHtml(e.action)}</b> · ${escapeHtml(e.occurredAt)}</div>
          <div class="meta" style="word-break:break-all; margin-top:4px;">Hash: ${escapeHtml(e.entryHash)}</div>
        </div>
      `).join('')}
    </div>
  `;
  panel.appendChild(c);
}

export function showYearEndWizard() {
  const project = state.project;
  if (document.getElementById('wizardModal')) return;
  const year = yearOf(project.fx.fxDate) || new Date().getFullYear();

  const overlay = document.createElement('div');
  overlay.id = 'wizardModal';
  overlay.style.cssText = "position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(15, 23, 42, 0.4); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); display:flex; align-items:center; justify-content:center; z-index:9999;";

  const isClosed = project.periods?.closedYears?.includes(year);
  if (isClosed) {
      overlay.innerHTML = `
          <div style="background: var(--panel); padding: 30px; border-radius: 16px; width: 450px; text-align: center; border: 1px solid var(--stroke); box-shadow: var(--shadow); color: var(--text);">
              <h2 style="color: var(--danger); margin-top:0;">Период ${year} закрыт 🔒</h2>
              <p style="color: var(--muted);">Внесение изменений, проводка платежей и генерация налогов за этот год заблокированы для защиты Audit Log.</p>
              <div style="display: flex; gap: 12px; justify-content: center; margin-top: 25px;">
                  <button class="btn secondary" id="btnWzCancel">Отмена</button>
                  <button class="btn" id="btnWzUnlock" style="background: var(--danger); color: white; border:none; padding:10px 20px;">🔓 Открыть период</button>
              </div>
          </div>
      `;
      document.body.appendChild(overlay);
      document.getElementById('btnWzCancel').onclick = () => overlay.remove();
      document.getElementById('btnWzUnlock').onclick = async () => {
          if (project.readOnly) return toast("Read-only: изменения запрещены");
          project.periods.closedYears = project.periods.closedYears.filter(y => y !== year);
          await auditAppend(project, "YEAR_OPEN", {entityType:"PROJECT", entityId:project.projectId}, null, null, {note: `Year ${year} unlocked manually`});
          save(); toast(`Год ${year} открыт для редактирования!`);
          overlay.remove(); render();
      };
      return;
  }

  const kzCompanies = project.nodes.filter(n => n.type === 'company' && getZone(project, n.zoneId)?.jurisdiction === 'KZ');
  let outputVat = 0, inputVat = 0;
  project.flows.forEach(f => {
      if (f.status !== 'executed' || yearOf(f.flowDate) !== year) return;
      if (f.flowType !== 'Services' && f.flowType !== 'Goods') return;
      const fromNode = getNode(project, f.fromId), toNode = getNode(project, f.toId);
      const fromZ = getZone(project, fromNode?.zoneId), toZ = getZone(project, toNode?.zoneId);
      if (fromZ?.jurisdiction === 'KZ' && toZ?.jurisdiction === 'KZ') {
          const vat = convert(project, f.grossAmount, f.currency, 'KZT') * 0.12; 
          if (kzCompanies.some(c => c.id === toNode.id)) outputVat += vat; 
          if (kzCompanies.some(c => c.id === fromNode.id)) inputVat += vat;
      }
  });
  const netVat = bankersRound2(outputVat - inputVat);
  let netVatText = netVat > 0 ? `К уплате: <b style="color:var(--danger);">${formatMoney(netVat)} KZT</b>` : (netVat < 0 ? `Переплата: <b style="color:var(--ok);">${formatMoney(Math.abs(netVat))} KZT</b>` : `<b>0 KZT</b>`);
  let totalLosses = 0; kzCompanies.forEach(c => { if (c.accountingYears && c.accountingYears[year - 1]) totalLosses += (c.accountingYears[year - 1].accumulatedLosses || 0); });
  if (totalLosses === 0) totalLosses = 5000000;

  const executedFlows = project.flows.filter(f => f.status === 'executed');
  const totalGross = executedFlows.reduce((sum, f) => sum + convert(project, f.grossAmount, f.currency, 'KZT'), 0);
  const totalTaxes = project.taxes.filter(t => t.status === 'executed').reduce((sum, t) => sum + convert(project, t.amountFunctional, t.functionalCurrency, 'KZT'), 0);
  const etr = totalGross > 0 ? ((totalTaxes / totalGross) * 100).toFixed(1) : 0;

  overlay.innerHTML = `
      <div style="background: var(--panel); padding: 30px; border-radius: 16px; width: 680px; max-width: 95%; max-height: 90vh; overflow-y: auto; border: 1px solid var(--stroke); box-shadow: var(--shadow); color: var(--text);">
          
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
              <h2 style="margin:0; font-size: 1.5em;">Закрытие ${year} года</h2>
              <div class="pill ok" style="font-size: 14px; padding: 6px 12px;">Group ETR: ${etr}%</div>
          </div>
          <div style="font-size: 0.95em; color: var(--muted); margin-bottom: 25px;">Математическая модель рассчитана на базе ${executedFlows.length} транзакций.</div>

          <div class="item" style="margin-bottom: 15px; cursor: default;">
              <h4 style="margin: 0 0 8px 0; color: var(--accent);">1. Перенос убытков (Loss Carryforward)</h4>
              <p style="margin: 0 0 10px 0; font-size: 0.9em; color: var(--text);">Доступный убыток: <b style="color:var(--danger);">- ${formatMoney(totalLosses)} KZT</b></p>
              <label style="font-size: 0.9em; display:flex; align-items:center; gap:10px; cursor: pointer; font-weight: 500;">
                  <input type="checkbox" checked id="wz_loss" style="width:16px; height:16px;"> Уменьшить НОД текущего года
              </label>
          </div>

          <div class="item" style="margin-bottom: 15px; cursor: default;">
              <h4 style="margin: 0 0 8px 0; color: var(--accent);">2. Взаимозачет НДС (VAT Netting)</h4>
              <p style="margin: 0 0 10px 0; font-size: 0.9em; color: var(--text);">Сальдо: ${netVatText}</p>
              ${netVat > 0 ? `
              <label style="font-size: 0.9em; display:flex; align-items:center; gap:10px; cursor: pointer; font-weight: 500;">
                  <input type="checkbox" checked id="wz_vat" style="width:16px; height:16px;"> Сгенерировать единый налоговый платеж
              </label>` : '<div style="font-size: 0.85em; color: var(--muted);">Действия не требуются.</div>'}
          </div>

          <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top:25px;">
              <button class="btn secondary" id="btnWzCancel">Отмена</button>
              <button class="btn" id="btnWzApply" style="background: var(--accent); color: white;">Применить и Закрыть год</button>
          </div>
      </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('btnWzCancel').onclick = () => overlay.remove();
  document.getElementById('btnWzApply').onclick = async () => {
      if (project.readOnly) return toast("Read-only: изменения запрещены");
      if (netVat > 0 && document.getElementById('wz_vat')?.checked && kzCompanies[0]) {
          project.taxes.unshift({
              id: "t_" + uid(), dueFromFlowId: "VAT_NETTING_" + year, payerId: kzCompanies[0].id, zoneId: kzCompanies[0].zoneId,
              taxType: "VAT (Net)", amountFunctional: netVat, functionalCurrency: "KZT", amountOriginal: netVat, originalCurrency: "KZT",
              fxDate: project.fx.fxDate, fxRateUsed: 1, status: "pending", createdAt: nowIso(), executedAt: null
          });
      }
      if(!project.periods) project.periods = { closedYears: [] };
      if(!project.periods.closedYears.includes(year)) project.periods.closedYears.push(year);
      await auditAppend(project, "YEAR_CLOSE", {entityType:"PROJECT", entityId:project.projectId}, null, null, {note: `Year ${year} closed`});
      overlay.remove(); save(); toast(`Год ${year} закрыт!`); render();
  };
}

// --- ЛОГИКА СОЗДАНИЯ (Двойной клик и кнопка +) ---
export function initCreation() {
  const project = state.project;

  const showCreationModal = (x, y) => {
      if (project.readOnly) return toast("Read-only: изменения запрещены");
      if (document.getElementById('createModal')) document.getElementById('createModal').remove();

      const overlay = document.createElement('div');
      overlay.id = 'createModal';
      overlay.style.cssText = "position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(15, 23, 42, 0.4); backdrop-filter:blur(8px); display:flex; align-items:center; justify-content:center; z-index:9999;";

      overlay.innerHTML = `
          <div style="background: var(--panel); padding: 24px; border-radius: 16px; width: 340px; border: 1px solid var(--stroke); box-shadow: var(--shadow); color: var(--text);">
              <h3 style="margin-top:0; color: var(--accent);">Добавить элемент</h3>
              <div class="row" style="flex-direction: column; gap: 8px;">
                  <button class="btn secondary" id="btnCrCo" style="width:100%; justify-content:flex-start;">🏢 Компания (Legal Entity)</button>
                  <button class="btn secondary" id="btnCrPe" style="width:100%; justify-content:flex-start;">👤 Физлицо (Person)</button>
              </div>
              <div class="sep" style="margin: 16px 0;"></div>
              <button class="btn" id="btnCrCancel" style="width:100%;">Отмена</button>
          </div>
      `;
      document.body.appendChild(overlay);
      document.getElementById('btnCrCancel').onclick = () => overlay.remove();

      const makeAction = async (type) => {
          const name = prompt("Название:", type === "company" ? "New Company" : "New Person");
          if (!name) return;
          const n = makeNode(name, type, x, y);
          n.zoneId = detectZoneId(project, n);
          // Строгая валидация: узел должен быть внутри режима
          if (!n.zoneId) {
              toast("Ошибка: Узел должен быть размещён внутри режима");
              return;
          }
          project.nodes.push(n);
          await auditAppend(project, 'NODE_CREATE', {entityType:'NODE', entityId:n.id}, {nodes:[]}, {nodes:[n]});
          save(); render(); overlay.remove();
      };

      document.getElementById('btnCrCo').onclick = () => makeAction('company');
      document.getElementById('btnCrPe').onclick = () => makeAction('person');
  };

  // Слушаем двойной клик от Канваса
  window.addEventListener('open-creation-menu', (e) => {
      showCreationModal(e.detail.x, e.detail.y);
  });

  // Слушаем плавающую кнопку "+"
  const fab = document.getElementById('fabCreate');
  if (fab) {
      fab.onclick = () => {
          // Создаем элемент в центре текущего экрана
          const viewport = document.getElementById('viewport');
          const rect = viewport.getBoundingClientRect();
          const pseudoEvent = { clientX: rect.left + rect.width/2, clientY: rect.top + rect.height/2 };
          const pt = pointerToCanvas(pseudoEvent);
          showCreationModal(pt.x, pt.y);
      };
  }

  // Инициализация Smart Focus DnD (drop-обработчики на канвасе)
  initCanvasDrop();
}

export function exportJson(){
  const project = state.project;
  const blob = new Blob([JSON.stringify(project, null, 2)], {type:"application/json"});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `tsm26_${project.projectId}.json`; a.click();
}

export async function importJson(){
  const project = state.project;
  if (project.readOnly) return toast("Read-only: импорт запрещён");
  const input = document.createElement('input'); input.type = "file"; input.accept = "application/json";
  input.onchange = async ()=>{
    const f = input.files && input.files[0]; if (!f) return;
    try{
      const obj = JSON.parse(await f.text());
      if (obj.schemaVersion !== SCHEMA_VERSION) return toast("Неверная schemaVersion");
      obj.readOnly = !(await verifyAudit(obj)); 
      state.project = obj; 
      save(); render(); toast("Импортировано");
    } catch(e){ toast("Ошибка импорта"); }
  };
  input.click();
}

// ── SPA Router: переключение полноэкранных вкладок ──
export function initRouter() {
    const navButtons = document.querySelectorAll('.nav-btn');
    const screens = document.querySelectorAll('.app-screen');
    const sidebarPanelWrap = document.getElementById('sidebarPanelWrap');
    const tabsEl = document.getElementById('tabs');

    navButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetId = e.currentTarget.getAttribute('data-target');

            // Синхронизируем старый стейт с новым левым меню
            if (targetId === 'screen-master') uiState.activeTab = "master";
            else if (targetId === 'screen-analytics') uiState.activeTab = "analytics";
            else uiState.activeTab = "modeling";

            // 1. Обновляем активную кнопку в меню
            navButtons.forEach(b => {
                b.classList.remove('primary');
                b.classList.add('secondary');
            });
            e.currentTarget.classList.remove('secondary');
            e.currentTarget.classList.add('primary');

            // 2. Скрываем все экраны и показываем нужный
            screens.forEach(screen => {
                screen.style.display = 'none';
            });
            const activeScreen = document.getElementById(targetId);
            if (activeScreen) activeScreen.style.display = 'block';

            // 3. Показываем/скрываем боковую панель с табами для моделирования
            if (targetId === 'screen-modeling') {
                if (sidebarPanelWrap) sidebarPanelWrap.style.display = 'block';
                if (tabsEl) tabsEl.style.display = 'flex';
            } else {
                if (sidebarPanelWrap) sidebarPanelWrap.style.display = 'none';
                if (tabsEl) tabsEl.style.display = 'none';
            }

            // 4. Guard-rails
            if (targetId === 'screen-analytics') {
                window.dispatchEvent(new Event('resize'));
            }
            if (targetId === 'screen-master') {
                renderMasterDataTables();
            }
            if (targetId === 'screen-modeling') {
                renderCanvas();
            }

            renderPanel();
        });
    });

    // По умолчанию: моделирование активно
    if (sidebarPanelWrap) sidebarPanelWrap.style.display = 'block';
    if (tabsEl) tabsEl.style.display = 'flex';
}

// ── Рендер таблиц Master Data (экран Мастер-данные) ──
export function renderMasterDataTables() {
    const project = state.project;
    if (!project) return;

    // --- 1. РЕНДЕР БАЗОВЫХ ВВОДНЫХ (FX & ENVIRONMENT) ---
    const fxContainer = document.getElementById('fxDataContainer');
    if (fxContainer) {
        // Убедимся, что объект fx существует
        project.fx = project.fx || { fxDate: "2026-01-15", rateToKZT: { KZT: 1 }, source: "manual" };
        project.fx.rateToKZT = project.fx.rateToKZT || { KZT: 1 };

        const ccyKeys = Object.keys(project.fx.rateToKZT).filter(x => x && x !== 'KZT').sort();

        let fxHtml = `
            <div class="md-row" id="fxRow">
                <div class="md-header" style="grid-template-columns: 1fr 2fr auto;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span class="small" style="font-weight:700;">Дата курсов (fxDate)</span>
                        <input class="md-input fx-input" type="date" value="${escapeHtml(project.fx.fxDate)}" data-orig="${escapeHtml(project.fx.fxDate)}" id="fxDateInp"/>
                    </div>

                    <div style="display:flex; gap:12px; flex-wrap:wrap;">
                        <div style="display:flex; align-items:center; gap:6px;">
                            <span class="small">KZT</span>
                            <input class="md-input" disabled value="1.00" style="width:70px; background:var(--bg-grid);"/>
                        </div>
                        ${ccyKeys.map(ccy => `
                            <div style="display:flex; align-items:center; gap:6px;">
                                <span class="small">${escapeHtml(ccy)}</span>
                                <input class="md-input fx-input" type="number" step="0.01" min="0" value="${project.fx.rateToKZT[ccy]}" data-orig="${project.fx.rateToKZT[ccy]}" id="fx_${ccy}" style="width:80px;"/>
                            </div>
                        `).join('')}
                    </div>

                    <div class="md-actions" id="fxActions">
                        <button class="btn ok" style="padding:6px 12px;" id="fxSave">✓ Сохранить и пересчитать</button>
                        <button class="btn secondary" style="padding:6px 12px;" id="fxCancel">✕</button>
                    </div>
                </div>
            </div>
        `;
        fxContainer.innerHTML = fxHtml;

        // Логика Inline-редактирования для FX
        const fxRow = document.getElementById('fxRow');
        const fxInputs = fxRow.querySelectorAll('.fx-input');

        const checkFxChanges = () => {
            const isChanged = Array.from(fxInputs).some(inp => inp.value !== inp.getAttribute('data-orig'));
            fxRow.classList.toggle('modified', isChanged);
        };

        fxInputs.forEach(inp => inp.addEventListener('input', checkFxChanges));

        document.getElementById('fxCancel').onclick = () => {
            fxInputs.forEach(inp => inp.value = inp.getAttribute('data-orig'));
            checkFxChanges();
        };

        document.getElementById('fxSave').onclick = () => {
            // Собираем данные
            project.fx.fxDate = document.getElementById('fxDateInp').value;
            ccyKeys.forEach(ccy => {
                const val = Number(document.getElementById(`fx_${ccy}`).value);
                if (isFinite(val) && val > 0) project.fx.rateToKZT[ccy] = val;
            });

            // Пересчёт рисков и лимитов при изменении курсов
            if (project.flows) {
                project.flows.forEach(f => updateFlowCompliance(project, f));
            }
            recomputeFrozen(project);
            recomputeRisks(project);

            save(); // Сохраняем в LocalStorage

            // Обновляем UI (прячем кнопки)
            fxInputs.forEach(inp => inp.setAttribute('data-orig', inp.value));
            checkFxChanges();
            toast("Курсы обновлены, пересчет выполнен");
        };
    }

    // --- 2. РЕНДЕР СТРАН И РЕЖИМОВ ---
    const container = document.getElementById('masterDataContainer');
    if (!container) return;

    const jurisdictions = project.catalogs?.jurisdictions || [];
    const masterData = project.masterData || {};

    if (jurisdictions.length === 0) {
        container.innerHTML = '<p style="color: var(--muted);">Нет загруженных данных. Используйте кнопку «Загрузить Страны (CSV)» для импорта.</p>';
        return;
    }

    let html = '<h3 style="margin-top: 0;">Юрисдикции (' + jurisdictions.length + ')</h3>';
    html += '<table class="master-table"><thead><tr>';
    html += '<th>Код</th><th>Название</th><th>Флаг</th><th>Валюта</th><th>Срок давности</th><th>CFC</th><th>Pillar Two</th><th>MCI</th><th>Мин. зарплата</th><th>Порог НДС</th>';
    html += '</tr></thead><tbody>';

    jurisdictions.forEach(j => {
        const md = masterData[j.id] || {};
        const mc = md.macroConstants || {};
        const th = md.thresholds || {};
        html += '<tr>';
        html += '<td><strong>' + escapeHtml(j.id) + '</strong></td>';
        html += '<td>' + escapeHtml(j.name || '') + '</td>';
        html += '<td>' + escapeHtml(j.flag || '') + '</td>';
        html += '<td>' + escapeHtml(md.baseCurrency || '—') + '</td>';
        html += '<td>' + (md.statuteOfLimitationsYears || '—') + '</td>';
        html += '<td>' + (md.cfcRulesActive ? '✅' : '—') + '</td>';
        html += '<td>' + (md.pillarTwoActive ? '✅' : '—') + '</td>';
        html += '<td>' + (mc.mciValue != null ? mc.mciValue.toLocaleString() : '—') + '</td>';
        html += '<td>' + (mc.minWage != null ? mc.minWage.toLocaleString() : '—') + '</td>';
        html += '<td>' + (th.vatRegistrationBaseCurrency != null ? th.vatRegistrationBaseCurrency.toLocaleString() : '—') + '</td>';
        html += '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

// ── CSV Импортеры для Master Data ──
export function initCsvImporters() {
    const project = state.project;
    if (!project) return;

    // Умный парсер строки: не разбивает запятые, если они внутри двойных кавычек
    const parseCsvLine = (text) => {
        let result = [], cur = '', inQuotes = false;
        for (let i = 0; i < text.length; i++) {
            let char = text[i];
            if (inQuotes) {
                if (char === '"') {
                    if (i + 1 < text.length && text[i+1] === '"') { cur += '"'; i++; } 
                    else inQuotes = false;
                } else cur += char;
            } else {
                if (char === '"') inQuotes = true;
                else if (char === ',' || char === ';') { result.push(cur.trim()); cur = ''; }
                else cur += char;
            }
        }
        result.push(cur.trim());
        return result;
    };

    const btnImportCountries = document.getElementById('btnImportCountries');
    if (btnImportCountries) {
        btnImportCountries.onclick = () => {
            const input = document.createElement('input'); input.type = 'file'; input.accept = '.csv';
            input.onchange = (e) => {
                const file = e.target.files[0]; if (!file) return;
                const reader = new FileReader();
                reader.onload = (event) => {
                    // ИСПРАВЛЕНИЕ: Читаем переносы строк Windows, Mac и Linux
                    const lines = event.target.result.split(/\r\n|\n|\r/).map(l => l.trim()).filter(l => l);
                    let added = 0;
                    
                    if (!project.catalogs) project.catalogs = {};
                    if (!project.catalogs.jurisdictions) project.catalogs.jurisdictions = [];
                    if (!project.activeJurisdictions) project.activeJurisdictions = [];
                    if (!project.masterData) project.masterData = {};

                    lines.slice(1).forEach(line => {
                        const parts = parseCsvLine(line);
                        if (parts.length < 4) return;
                        
                        const code = parts[0].toUpperCase();
                        if (!code) return;
                        
                        // Добавляем в общий каталог для UI
                        if (!project.catalogs.jurisdictions.find(j => j.id === code)) {
                            project.catalogs.jurisdictions.push({ id: code, name: parts[1], flag: parts[2], enabled: true });
                            if (!project.activeJurisdictions.includes(code)) project.activeJurisdictions.push(code);
                        }
                        
                        // Заполняем базу налоговых констант
                        project.masterData[code] = project.masterData[code] || {};
                        const md = project.masterData[code];
                        md.countryCode = code; 
                        md.baseCurrency = parts[3];
                        md.statuteOfLimitationsYears = Number(parts[4]) || 5;
                        md.cfcRulesActive = String(parts[5]).toLowerCase() === 'true';
                        md.pillarTwoActive = String(parts[6]).toLowerCase() === 'true';
                        
                        md.macroConstants = md.macroConstants || {};
                        if (parts[7] && String(parts[7]).toLowerCase() !== 'null') md.macroConstants.mciValue = Number(parts[7]);
                        if (parts[8] && String(parts[8]).toLowerCase() !== 'null') md.macroConstants.minWage = Number(parts[8]);
                        
                        md.thresholds = md.thresholds || {};
                        if (parts[9] && String(parts[9]).toLowerCase() !== 'null') md.thresholds.vatRegistrationBaseCurrency = Number(String(parts[9]).replace(/[^0-9]/g, ''));
                        added++;
                    });
                    toast(`✅ Загружено стран: ${added}`); save(); renderMasterDataTables();
                };
                reader.readAsText(file);
            };
            input.click();
        };
    }

    const btnImportRegimes = document.getElementById('btnImportRegimes');
    if (btnImportRegimes) {
        btnImportRegimes.onclick = () => {
            const input = document.createElement('input'); input.type = 'file'; input.accept = '.csv';
            input.onchange = (e) => {
                const file = e.target.files[0]; if (!file) return;
                const reader = new FileReader();
                reader.onload = (event) => {
                    // ИСПРАВЛЕНИЕ: Читаем любые переносы строк
                    const lines = event.target.result.split(/\r\n|\n|\r/).map(l => l.trim()).filter(l => l);
                    let added = 0;
                    
                    lines.slice(1).forEach(line => {
                        const parts = parseCsvLine(line);
                        if (parts.length < 12) return;
                        
                        const regimeCode = parts[0].toUpperCase();
                        const countryCode = parts[1].toUpperCase();
                        if (!regimeCode || !countryCode) return;
                        
                        project.masterData[countryCode] = project.masterData[countryCode] || {};
                        project.masterData[countryCode].regimes = project.masterData[countryCode].regimes || {};
                        
                        // Читаем сложную WHT ставку (берем первую цифру до слэша)
                        let whtDiv = parts[5] || "0";
                        let whtDivBase = whtDiv.includes('/') ? Number(whtDiv.split('/')[0].trim()) : Number(whtDiv);

                        project.masterData[countryCode].regimes[regimeCode] = {
                            regimeName: parts[2],
                            citRateStandard: Number(parts[3]) || 0,
                            vatRateStandard: Number(parts[4]) || 0,
                            wht: {
                                dividends: whtDivBase,
                                interest: Number(parts[6]) || 0,
                                royalties: Number(parts[7]) || 0,
                                services: Number(parts[8]) || 0
                            },
                            substanceRequired: String(parts[9]).toLowerCase() === 'true',
                            cryptoAllowed: String(parts[10]).toLowerCase() === 'true',
                            separateAccounting: String(parts[11]).toLowerCase() === 'true',
                            lossCarryforwardYears: String(parts[12]).toLowerCase() === 'unlimited' ? 999 : (Number(parts[12]) || 0)
                        };
                        added++;
                    });
                    toast(`✅ Загружено режимов: ${added}`); save(); renderMasterDataTables();
                };
                reader.readAsText(file);
            };
            input.click();
        };
    }
}
