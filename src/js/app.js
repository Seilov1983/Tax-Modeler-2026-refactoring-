import { load, save, state, STORAGE_KEY } from './state.js';
import { defaultProject, emptyProject, ensureMasterData, ensureZoneTaxDefaults, updateFlowCompliance, recomputeFrozen, recomputeRisks, defaultCatalogs } from './engine.js';
import { render, exportJson, importJson } from './ui.js';
import { toast } from './utils.js';
import { onPointerCancel } from './canvas.js';

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

  // Внедряем кнопки "Demo" и "Empty" 
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
  
  document.getElementById('btnClear').onclick = ()=>{
      if(confirm("Полностью очистить кэш и создать пустой холст?")) { localStorage.removeItem(STORAGE_KEY); state.project = emptyProject(); save(); toast("Очищено"); render(); }
  };
  
  document.getElementById('btnExport').onclick = exportJson;
  document.getElementById('btnImport').onclick = importJson;
  
  window.onblur = onPointerCancel;
  document.addEventListener('visibilitychange', ()=>{ if (document.hidden) onPointerCancel(); });

  if (project.readOnly) toast("Audit log нарушен. Режим read-only.");
  render();
})();
