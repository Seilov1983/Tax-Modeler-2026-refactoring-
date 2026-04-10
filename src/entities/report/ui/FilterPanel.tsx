'use client';

/**
 * FilterPanel — Query Builder inputs for the Reports tab.
 *
 * Provides multi-select filters for managementTags, zoneId, and date ranges,
 * plus a column visibility selector for the LedgerTable.
 *
 * No useEffect. All derived state via useMemo.
 */

import { useMemo, useCallback } from 'react';
import { useTranslation, localizedName } from '@shared/lib/i18n';

// ─── Inline Types ────────────────────────────────────────────────────────────

type ColumnId =
  | 'date'
  | 'flowType'
  | 'from'
  | 'to'
  | 'gross'
  | 'net'
  | 'wht'
  | 'compliance';

const MANDATORY_COLUMNS: ReadonlyArray<ColumnId> = [
  'date',
  'flowType',
  'from',
  'to',
  'gross',
  'net',
  'wht',
  'compliance',
];

const OPTIONAL_COLUMNS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'currency', label: 'Currency' },
  { id: 'dttApplied', label: 'DTT Applied' },
  { id: 'zone', label: 'Zone' },
  { id: 'tags', label: 'Management Tags' },
];

// To keep it simple, COLUMN_LABELS will be translated dynamically in the render loop

// ─── Tailwind Classes ────────────────────────────────────────────────────────
const twPanel = "flex flex-col gap-4 px-5 py-4 bg-white/70 dark:bg-slate-900/70 backdrop-blur-3xl border-b border-black/10 dark:border-white/10 font-sans";
const twRow = "flex flex-wrap gap-3 items-end";
const twField = "flex flex-col gap-1 min-w-[160px]";
const twLabel = "text-[12px] font-bold text-slate-500 uppercase tracking-wider block mb-0.5 ml-1";
const twSelect = "px-3 py-1.5 text-[13px] border border-black/10 dark:border-white/10 rounded-xl bg-black/5 dark:bg-white/5 text-slate-900 dark:text-slate-100 outline-none w-[160px] hover:bg-black/10 dark:hover:bg-white/10 transition-colors shadow-inner";
const twInput = "px-3 py-1.5 text-[13px] border border-black/10 dark:border-white/10 rounded-xl bg-black/5 dark:bg-white/5 text-slate-900 dark:text-slate-100 outline-none w-[150px] hover:bg-black/10 dark:hover:bg-white/10 transition-colors shadow-inner";
const twChip = "inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md cursor-default";
const twChipIcon = "cursor-pointer text-[13px] leading-none text-slate-400 hover:text-red-500 transition-colors";

// ─── Component ───────────────────────────────────────────────────────────────

export function FilterPanel(props: {
  availableTags: ReadonlyArray<string>;
  availableZones: ReadonlyArray<{ id: string; name: string; jurisdiction: string }>;
  selectedTags: ReadonlyArray<string>;
  selectedZoneIds: ReadonlyArray<string>;
  dateFrom: string;
  dateTo: string;
  visibleOptionalColumns: ReadonlyArray<string>;
  onTagsChange: (tags: ReadonlyArray<string>) => void;
  onZoneIdsChange: (ids: ReadonlyArray<string>) => void;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  onOptionalColumnsChange: (cols: ReadonlyArray<string>) => void;
}) {
  const {
    availableTags,
    availableZones,
    selectedTags,
    selectedZoneIds,
    dateFrom,
    dateTo,
    visibleOptionalColumns,
    onTagsChange,
    onZoneIdsChange,
    onDateFromChange,
    onDateToChange,
    onOptionalColumnsChange,
  } = props;
  const { t, lang } = useTranslation();

  const handleAddTag = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const tag = e.target.value;
      if (tag && !selectedTags.includes(tag)) {
        onTagsChange([...selectedTags, tag]);
      }
      e.target.value = '';
    },
    [selectedTags, onTagsChange],
  );

  const handleRemoveTag = useCallback(
    (tag: string) => {
      onTagsChange(selectedTags.filter((t) => t !== tag));
    },
    [selectedTags, onTagsChange],
  );

  const handleAddZone = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const id = e.target.value;
      if (id && !selectedZoneIds.includes(id)) {
        onZoneIdsChange([...selectedZoneIds, id]);
      }
      e.target.value = '';
    },
    [selectedZoneIds, onZoneIdsChange],
  );

  const handleRemoveZone = useCallback(
    (id: string) => {
      onZoneIdsChange(selectedZoneIds.filter((z) => z !== id));
    },
    [selectedZoneIds, onZoneIdsChange],
  );

  const handleToggleOptionalColumn = useCallback(
    (colId: string) => {
      if (visibleOptionalColumns.includes(colId)) {
        onOptionalColumnsChange(visibleOptionalColumns.filter((c) => c !== colId));
      } else {
        onOptionalColumnsChange([...visibleOptionalColumns, colId]);
      }
    },
    [visibleOptionalColumns, onOptionalColumnsChange],
  );

  const zoneNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const z of availableZones) m.set(z.id, `${z.name} (${z.jurisdiction})`);
    return m;
  }, [availableZones]);

  return (
    <div className={twPanel}>
      <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
        <span className="text-indigo-500">❖</span> {t('queryBuilder')}
      </div>

      <div className={twRow}>
        {/* Management Tags filter */}
        <div className={twField}>
          <span className={twLabel}>{t('managementTags')}</span>
          <select
            className={twSelect}
            onChange={handleAddTag}
            defaultValue=""
          >
            <option value="" disabled>
              {t('addTag')}
            </option>
            {availableTags
              .filter((t) => !selectedTags.includes(t))
              .map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
          </select>
          {selectedTags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {selectedTags.map((t) => (
                <span key={t} className={`${twChip} bg-indigo-500/10 text-indigo-700 dark:text-indigo-300`}>
                  {t}
                  <span className={twChipIcon} onClick={() => handleRemoveTag(t)}>
                    ✕
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Zone filter */}
        <div className={twField}>
          <span className={twLabel}>{t('jurisdictionZone')}</span>
          <select
            className={twSelect}
            onChange={handleAddZone}
            defaultValue=""
          >
            <option value="" disabled>
              {t('addZone2')}
            </option>
            {availableZones
              .filter((z) => !selectedZoneIds.includes(z.id))
              .map((z) => (
                <option key={z.id} value={z.id}>
                  {localizedName(z.name, lang)} ({z.jurisdiction})
                </option>
              ))}
          </select>
          {selectedZoneIds.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {selectedZoneIds.map((id) => {
                const zMap = availableZones.find(z => z.id === id);
                const displayName = zMap ? `${localizedName(zMap.name, lang)} (${zMap.jurisdiction})` : id;
                return (
                <span key={id} className={`${twChip} bg-emerald-500/10 text-emerald-700 dark:text-emerald-300`}>
                  {displayName}
                  <span className={twChipIcon} onClick={() => handleRemoveZone(id)}>
                    ✕
                  </span>
                </span>
                );
              })}
            </div>
          )}
        </div>

        {/* Date range */}
        <div className={twField}>
          <span className={twLabel}>{t('dateFrom')}</span>
          <input
            type="date"
            className={twInput}
            value={dateFrom}
            onChange={(e) => onDateFromChange(e.target.value)}
          />
        </div>
        <div className={twField}>
          <span className={twLabel}>{t('dateTo')}</span>
          <input
            type="date"
            className={twInput}
            value={dateTo}
            onChange={(e) => onDateToChange(e.target.value)}
          />
        </div>
      </div>

      {/* Column Selector */}
      <div>
        <span className={twLabel}>
          {t('columns')}
        </span>
        <div className="flex flex-wrap gap-2 mt-1">
          {MANDATORY_COLUMNS.map((col) => {
            const colKey = 'col' + col.charAt(0).toUpperCase() + col.slice(1);
            return (
              <span
                key={col}
                className={`${twChip} bg-slate-200/50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 font-bold px-3`}
              >
                {t(colKey as any)}
              </span>
            );
          })}
          {OPTIONAL_COLUMNS.map((col) => {
            const active = visibleOptionalColumns.includes(col.id);
            return (
              <span
                key={col.id}
                className={`${twChip} cursor-pointer px-3 transition-colors ${
                  active 
                    ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 font-bold border border-blue-500/20' 
                    : 'bg-black/5 dark:bg-white/5 text-slate-500 border border-black/5 dark:border-white/5 hover:bg-black/10 dark:hover:bg-white/10'
                }`}
                onClick={() => handleToggleOptionalColumn(col.id)}
              >
                {active ? '✓ ' : '+ '}
                {t(('col' + col.id.charAt(0).toUpperCase() + col.id.slice(1)) as any) || col.label}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export { MANDATORY_COLUMNS, OPTIONAL_COLUMNS };
export type { ColumnId };
