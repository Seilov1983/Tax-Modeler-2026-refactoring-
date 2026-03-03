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
  bootstrapNormalizeZones, defaultCatalogs, makeTXA, makeFlowDraft
} from './engine.js';
import { renderCanvas, syncTXANodes, normalizeZoneCascade } from './canvas.js';

// Новая 3-звенная Enterprise архитектура навигации
const tabs = [
  { id:"master", name:"📚 Мастер-данные" },
  { id:"modeling", name:"🛠 Моделирование" },
  { id:"analytics", name:"📊 Аналитика и Отчеты" }
];

export function render(){
  const project = state.project;
  if (!project) return;

  document.getElementById('projTitle').textContent = project.title || "Project";
  document.getElementById('metaLine').textContent =
    `schema ${SCHEMA_VERSION} · engine ${project.engineVersion} · ${project.readOnly ? 'read-only' : 'editable'} · audit ${project.audit.entries.length}`;

  const roBadge = document.getElementById('roBadge');
  if (roBadge) roBadge.style.display = project.readOnly ? "block" : "none";

  // Если активная вкладка не задана или осталась старая, сбрасываем на Моделирование
  if (!uiState.activeTab || !tabs.find(t=>t.id === uiState.activeTab)) {
      uiState.activeTab = "modeling";
  }

  const tabsEl = document.getElementById('tabs');
  tabsEl.innerHTML = "";
  tabs.forEach(t=>{
    const b = document.createElement('button');
    b.className = 'tab' + (uiState.activeTab===t.id ? ' active' : '');
    b.textContent = t.name;
    b.onclick = ()=>{ uiState.activeTab=t.id; renderPanel(); };
    tabsEl.appendChild(b);
  });
  renderPanel();
  renderCanvas();
}

export function renderPanel(){
  const panel = document.getElementById('panel');
  if (!panel) return;
  panel.innerHTML = "";

  if (uiState.activeTab === "master") {
      // Раздел 1: Мастер-данные (переиспользуем старый компонент Настроек)
      uiState.settingsSubTab = uiState.settingsSubTab || "jurisdictions";
      renderSettings(panel);
  }
  else if (uiState.activeTab === "analytics") {
      // Раздел 3: Аналитика и Отчеты (создаем под-навигацию)
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
      panel.appendChild(c);

      c.querySelector('#tDash').onclick = () => { uiState.analyticsTab='dashboard'; renderPanel(); };
      c.querySelector('#tRisks').onclick = () => { uiState.analyticsTab='risks'; renderPanel(); };
      c.querySelector('#tAudit').onclick = () => { uiState.analyticsTab='audit'; renderPanel(); };

      const body = c.querySelector('#analyticsBody');
      if (uiState.analyticsTab === 'risks') renderRisks(body);
      else if (uiState.analyticsTab === 'audit') {
          renderPipeline(body);
          const sep = document.createElement('div'); sep.className = 'sep'; body.appendChild(sep);
          renderAudit(body);
      }
      else {
          // Заглушка для будущего Дашборда (Шаг 3)
          body.innerHTML = `
            <div class="item" style="text-align:center; padding: 40px 20px;">
                <h3 style="margin-top:0; color:var(--accent);">Здесь будет Executive Dashboard 📊</h3>
                <p class="small" style="color:var(--muted); font-size:13px; max-width: 300px; margin: 0 auto;">
                    Мы готовим виджеты для расчета Net Cash to UBO, Global ETR, Trapped Cash и оцифровки рисков.
                </p>
            </div>
          `;
      }
  }
  else {
      // Раздел 2: Моделирование (создаем под-навигацию)
      uiState.modelingTab = uiState.modelingTab || "flows";

      const c = document.createElement('div');
      c.innerHTML = `
        <div class="row" style="margin-bottom:16px; gap:8px; border-bottom:1px solid var(--stroke); padding-bottom:10px;">
          <button class="tab ${uiState.modelingTab==='flows'?'active':''}" id="tFlows">Потоки</button>
          <button class="tab ${uiState.modelingTab==='ownership'?'active':''}" id="tOwn">Владение</button>
          <button class="tab ${uiState.modelingTab==='canvas'?'active':''}" id="tCanv">Структура Холста</button>
        </div>
        <div id="modelingBody"></div>
      `;
      panel.appendChild(c);

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
    let id = prompt('Код страны (например: DE, CN, RU). Только латиница/цифры/_.', '');
    if (!id) return;
    id = String(id).trim().toUpperCase().replace(/\s+/g,'_');
    if (!/^[A-Z0-9_]{2,10}$/.test(id)) return toast('Неверный код');
    if ((project.catalogs.jurisdictions||[]).some(j=>j.id===id)) return toast('Уже существует');
    let name = prompt('Название (для UI):', id) || id;
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
    save(); toast('Страна добавлена'); render();
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
  const wrap = document.querySelector('.canvasWrap');
  if (!wrap || !z) return;
  wrap.scrollLeft = Math.max(0, z.x - 60);
  wrap.scrollTop = Math.max(0, z.y - 60);
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
