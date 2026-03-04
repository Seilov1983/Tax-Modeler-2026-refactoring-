import { load, save, state, STORAGE_KEY } from './state.js';
import { defaultProject, emptyProject, ensureMasterData, ensureZoneTaxDefaults, updateFlowCompliance, recomputeFrozen, recomputeRisks, defaultCatalogs } from './engine.js';
import { render, exportJson, importJson, initCreation, initRouter, initCsvImporters } from './ui.js';
import { toast } from './utils.js';
import { onPointerCancel, initBoardInteractions } from './canvas.js';

(async ()=>{
  state.project = await load();
  if (!state.project){ state.project = defaultProject(); save(); }
  
  const project = state.project;
  
  project.fx = project.fx || { fxDate: "2026-01-15", rateToKZT: { KZT:1 }, source:"manual" };
  project.catalogs = project.catalogs || defaultCatalogs();
  project.catalogs.jurisdictions = project.catalogs.jurisdictions || defaultCatalogs().jurisdictions;
  if (!Array.isArray(project.activeJurisdictions)) project.activeJurisdictions = (project.catalogs.jurisdictions||[]).filter(j=>j.enabled !== false).map(j=>j.id);
  project.ui = project.ui || { canvasW: 1400, canvasH: 1000, editMode: "nodes", gridSize: 10, snapToGrid: true, hiddenZoneIds: [], flowLegend: { show:true, mode:"ALL", selectedTypes:[], showTaxes:true } };
  
  ensureMasterData(project); ensureZoneTaxDefaults(project);
  project.ownership = project.ownership || []; project.taxes = project.taxes || [];
  project.flows = project.flows || []; project.zones = project.zones || []; project.nodes = project.nodes || [];
  project.nodes.forEach(n=>{ n.riskFlags = n.riskFlags || []; n.balances = n.balances || {}; if (n.annualIncome == null) n.annualIncome = 0; if (n.etr == null) n.etr = 0.2; if (n.w == null) n.w = 190; if (n.h == null) n.h = 90; });
  project.flows.forEach(f=>updateFlowCompliance(project, f));
  recomputeFrozen(project); recomputeRisks(project);

  // Внедряем кнопки "Demo" и "Empty" (Безопасная проверка)
  const btnNew = document.getElementById('btnNew');
  if (btnNew) {
      const p = btnNew.parentNode;
      if (!document.getElementById('btnNewEmpty')) {
          const btnEmpty = document.createElement('button');
          btnEmpty.className = 'btn secondary';
          btnEmpty.id = 'btnNewEmpty';
          btnEmpty.textContent = 'Empty Project';
          btnEmpty.style.marginLeft = '8px';
          p.insertBefore(btnEmpty, btnNew.nextSibling);
      }
      btnNew.textContent = "Demo Project";
      btnNew.classList.remove('secondary');
      btnNew.classList.add('primary');
      
      btnNew.onclick = ()=>{ 
          if(confirm("Сбросить текущий холст и создать Демо-проект?")) { localStorage.removeItem(STORAGE_KEY); state.project = defaultProject(); save(); toast("Создан демо-проект"); render(); }
      };
      document.getElementById('btnNewEmpty').onclick = ()=>{ 
          if(confirm("Сбросить текущий холст и создать Пустой проект?")) { localStorage.removeItem(STORAGE_KEY); state.project = emptyProject(); save(); toast("Создан пустой проект"); render(); }
      };
  }
  
  const btnClear = document.getElementById('btnClear');
  if (btnClear) btnClear.onclick = ()=>{
      if(confirm("Полностью очистить кэш и создать пустой холст?")) { localStorage.removeItem(STORAGE_KEY); state.project = emptyProject(); save(); toast("Очищено"); render(); }
  };
  
  // --- ИСПРАВЛЕНИЕ ОШИБКИ: БЕЗОПАСНАЯ ПРИВЯЗКА СОБЫТИЙ ---
  const btnExport = document.getElementById('btnExport');
  if (btnExport) btnExport.onclick = exportJson;
  
  const btnImport = document.getElementById('btnImport');
  if (btnImport) btnImport.onclick = importJson;
  
  window.onblur = onPointerCancel;
  document.addEventListener('visibilitychange', ()=>{ if (document.hidden) onPointerCancel(); });

  initBoardInteractions(); // Включаем камеру viewport
  initCreation(); // Логика создания элементов (двойной клик + кнопка +)

  initRouter();        // SPA-роутинг: переключение экранов
  initCsvImporters();  // CSV-импорт стран и режимов

  if (project.readOnly) toast("Audit log нарушен. Режим read-only.");

  // --- НОВЫЙ БЛОК: ГЛОБАЛЬНЫЕ НАСТРОЙКИ (ШЕСТЕРЕНКА В ТОП-БАРЕ) ---
  const btnSettings = document.getElementById('btnSettings');
  if (btnSettings) {
      btnSettings.onclick = () => {
          if (document.getElementById('sysSettingsModal')) document.getElementById('sysSettingsModal').remove();

          const overlay = document.createElement('div');
          overlay.id = 'sysSettingsModal';
          overlay.style.cssText = "position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(15, 23, 42, 0.4); backdrop-filter:var(--blur); -webkit-backdrop-filter:var(--blur); display:flex; align-items:center; justify-content:center; z-index:9999;";

          const isDark = document.body.classList.contains('dark-mode');

          overlay.innerHTML = `
              <div style="background: var(--panel); padding: 24px; border-radius: 16px; width: 340px; border: 1px solid var(--stroke); box-shadow: var(--shadow); color: var(--text);">
                  <h3 style="margin-top:0; margin-bottom: 20px; display:flex; justify-content:space-between; align-items:center;">
                      Настройки ⚙️ 
                      <span class="badge ok">v2.4.1</span>
                  </h3>
                  
                  <div class="col" style="gap: 12px;">
                      <button class="btn secondary" id="mdlBtnExport">📥 Экспорт проекта (JSON)</button>
                      <button class="btn secondary" id="mdlBtnImport">📤 Импорт проекта (JSON)</button>
                      <div class="sep"></div>
                      <button class="btn secondary" id="mdlBtnTheme">${isDark ? '☀️ Включить светлую тему' : '🌙 Включить тёмную тему'}</button>
                      <button class="btn secondary" id="mdlBtnClear" style="color: var(--danger); border-color: var(--danger-soft);">🗑 Сбросить проект (Очистить)</button>
                  </div>

                  <div class="sep" style="margin: 16px 0;"></div>
                  <button class="btn" id="mdlBtnClose" style="width:100%;">Закрыть</button>
              </div>
          `;
          document.body.appendChild(overlay);

          document.getElementById('mdlBtnClose').onclick = () => overlay.remove();
          
          document.getElementById('mdlBtnExport').onclick = () => { exportJson(); overlay.remove(); };
          document.getElementById('mdlBtnImport').onclick = () => { importJson(); overlay.remove(); };
          
          document.getElementById('mdlBtnTheme').onclick = () => {
              document.body.classList.toggle('dark-mode');
              overlay.remove();
          };
          
          document.getElementById('mdlBtnClear').onclick = () => {
              if(confirm("Внимание! Текущий проект будет удален. Создать пустой холст?")) { 
                  localStorage.removeItem(STORAGE_KEY); 
                  state.project = emptyProject(); 
                  save(); toast("Проект очищен"); render(); overlay.remove(); 
              }
          };
      };
  }

  // Запасная проверка для старой кнопки темы (если где-то осталась)
  const themeToggle = document.getElementById('themeToggle');
  const themeIcon = document.getElementById('themeIcon');
  if (themeToggle) {
    themeToggle.onclick = () => {
      document.body.classList.toggle('dark-mode');
      if (themeIcon) themeIcon.textContent = document.body.classList.contains('dark-mode') ? '☀️' : '🌓';
    };
  }
  
  render();
})();
