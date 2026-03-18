/**
 * Simple i18n dictionary for static UI strings.
 * Supports English and Russian.
 */

export type Language = 'en' | 'ru';

const dictionary = {
  // Settings Modal
  settings: { en: 'Settings', ru: '\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438' },
  appearance: { en: 'Appearance', ru: '\u041e\u0444\u043e\u0440\u043c\u043b\u0435\u043d\u0438\u0435' },
  baseCurrency: { en: 'Base Currency', ru: '\u0411\u0430\u0437\u043e\u0432\u0430\u044f \u0432\u0430\u043b\u044e\u0442\u0430' },
  snapToGrid: { en: 'Snap to Grid', ru: '\u041f\u0440\u0438\u0432\u044f\u0437\u043a\u0430 \u043a \u0441\u0435\u0442\u043a\u0435' },
  snapToGridDesc: { en: 'Align canvas elements to a 24px grid', ru: '\u0412\u044b\u0440\u0430\u0432\u043d\u0438\u0432\u0430\u043d\u0438\u0435 \u044d\u043b\u0435\u043c\u0435\u043d\u0442\u043e\u0432 \u043f\u043e \u0441\u0435\u0442\u043a\u0435 24px' },
  language: { en: 'Language', ru: '\u042f\u0437\u044b\u043a' },
  light: { en: 'Light', ru: '\u0421\u0432\u0435\u0442\u043b\u0430\u044f' },
  dark: { en: 'Dark', ru: '\u0422\u0451\u043c\u043d\u0430\u044f' },
  system: { en: 'System', ru: '\u0421\u0438\u0441\u0442\u0435\u043c\u043d\u0430\u044f' },

  // Sidebar
  masterData: { en: 'Master Data', ru: '\u0421\u043f\u0440\u0430\u0432\u043e\u0447\u043d\u0438\u043a\u0438' },
  dragHint: { en: 'Drag a row onto the canvas', ru: '\u041f\u0435\u0440\u0435\u0442\u0430\u0449\u0438\u0442\u0435 \u0441\u0442\u0440\u043e\u043a\u0443 \u043d\u0430 \u0445\u043e\u043b\u0441\u0442' },
  search: { en: 'Search countries, regimes, rates...', ru: '\u041f\u043e\u0438\u0441\u043a \u0441\u0442\u0440\u0430\u043d, \u0440\u0435\u0436\u0438\u043c\u043e\u0432, \u0441\u0442\u0430\u0432\u043e\u043a...' },
  noMatching: { en: 'No matching jurisdictions', ru: '\u041d\u0435\u0442 \u0441\u043e\u0432\u043f\u0430\u0434\u0435\u043d\u0438\u0439' },
  editMasterData: { en: 'Edit Master Data', ru: '\u0420\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435' },
  closeSidebar: { en: 'Close sidebar (Esc)', ru: '\u0417\u0430\u043a\u0440\u044b\u0442\u044c (Esc)' },

  // Entities
  entities: { en: 'Entities', ru: '\u041e\u0431\u044a\u0435\u043a\u0442\u044b' },

  // Context Menu
  company: { en: 'Company', ru: '\u041a\u043e\u043c\u043f\u0430\u043d\u0438\u044f' },
  person: { en: 'Person', ru: '\u0424\u0438\u0437\u043b\u0438\u0446\u043e' },
  country: { en: 'Country', ru: '\u0421\u0442\u0440\u0430\u043d\u0430' },
  regime: { en: 'Regime', ru: '\u0420\u0435\u0436\u0438\u043c' },

  // Edit Regime Modal
  editRegime: { en: 'Edit Regime', ru: '\u0420\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435 \u0440\u0435\u0436\u0438\u043c\u0430' },
  name: { en: 'Name', ru: '\u041d\u0430\u0437\u0432\u0430\u043d\u0438\u0435' },
  citRate: { en: 'CIT Rate (%)', ru: '\u0421\u0442\u0430\u0432\u043a\u0430 \u041a\u041f\u041d (%)' },
  vatRate: { en: 'VAT Rate (%)', ru: '\u0421\u0442\u0430\u0432\u043a\u0430 \u041d\u0414\u0421 (%)' },
  substanceRequired: { en: 'Substance Required', ru: '\u0422\u0440\u0435\u0431\u043e\u0432\u0430\u043d\u0438\u0435 substance' },
  save: { en: 'Save', ru: '\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c' },
  cancel: { en: 'Cancel', ru: '\u041e\u0442\u043c\u0435\u043d\u0430' },
} as const;

type DictKey = keyof typeof dictionary;

export function t(key: DictKey, lang: Language): string {
  return dictionary[key]?.[lang] ?? dictionary[key]?.en ?? key;
}

// ─── Master Data Localization ─────────────────────────────────────────────────
// Country and regime names, zone names, and tooltips in both languages.

const masterDataNames: Record<string, { en: string; ru: string }> = {
  // Countries
  'Kazakhstan': { en: 'Kazakhstan', ru: '\u041a\u0430\u0437\u0430\u0445\u0441\u0442\u0430\u043d' },
  'UAE': { en: 'UAE', ru: '\u041e\u0410\u042d' },
  'Hong Kong': { en: 'Hong Kong', ru: '\u0413\u043e\u043d\u043a\u043e\u043d\u0433' },
  'Cyprus': { en: 'Cyprus', ru: '\u041a\u0438\u043f\u0440' },
  'Singapore': { en: 'Singapore', ru: '\u0421\u0438\u043d\u0433\u0430\u043f\u0443\u0440' },
  'United Kingdom': { en: 'United Kingdom', ru: '\u0412\u0435\u043b\u0438\u043a\u043e\u0431\u0440\u0438\u0442\u0430\u043d\u0438\u044f' },
  'US (Delaware)': { en: 'US (Delaware)', ru: '\u0421\u0428\u0410 (\u0414\u0435\u043b\u0430\u0432\u044d\u0440)' },
  'BVI': { en: 'BVI', ru: '\u0411\u0412\u041e' },
  'Cayman': { en: 'Cayman', ru: '\u041a\u0430\u0439\u043c\u0430\u043d\u044b' },
  'Seychelles': { en: 'Seychelles', ru: '\u0421\u0435\u0439\u0448\u0435\u043b\u044b' },
  // Regimes
  'Standard': { en: 'Standard', ru: '\u0421\u0442\u0430\u043d\u0434\u0430\u0440\u0442\u043d\u044b\u0439' },
  'AIFC': { en: 'AIFC', ru: '\u041c\u0424\u0426\u0410' },
  'Astana Hub': { en: 'Astana Hub', ru: '\u0410\u0441\u0442\u0430\u043d\u0430 \u0425\u0430\u0431' },
  'Mainland': { en: 'Mainland', ru: '\u041c\u0430\u0442\u0435\u0440\u0438\u043a\u043e\u0432\u044b\u0439' },
  'Free Zone (QFZP)': { en: 'Free Zone (QFZP)', ru: '\u0421\u0432\u043e\u0431\u043e\u0434\u043d\u0430\u044f \u0437\u043e\u043d\u0430 (QFZP)' },
  'Free Zone (Non-QFZP)': { en: 'Free Zone (Non-QFZP)', ru: '\u0421\u0432\u043e\u0431\u043e\u0434\u043d\u0430\u044f \u0437\u043e\u043d\u0430 (\u043d\u0435-QFZP)' },
  'Onshore': { en: 'Onshore', ru: '\u041e\u043d\u0448\u043e\u0440' },
  'Offshore': { en: 'Offshore', ru: '\u041e\u0444\u0448\u043e\u0440' },
  // Node types
  'New Company': { en: 'New Company', ru: '\u041d\u043e\u0432\u0430\u044f \u043a\u043e\u043c\u043f\u0430\u043d\u0438\u044f' },
  'New Person': { en: 'New Person', ru: '\u041d\u043e\u0432\u043e\u0435 \u043b\u0438\u0446\u043e' },
};

/**
 * Resolve a localized name for master data (countries, regimes, zones).
 * Falls back to the English name if no translation is found.
 */
export function localizedName(englishName: string, lang: Language): string {
  if (lang === 'en') return englishName;
  return masterDataNames[englishName]?.[lang] ?? englishName;
}

// ─── Tooltip Localization ─────────────────────────────────────────────────────

const tooltipTranslations: Record<string, { en: string; ru: string }> = {
  KZ_AIFC: {
    en: 'AIFC regime: Requires CIGA substance, registered office in Astana, and qualified employees on the ground.',
    ru: '\u0420\u0435\u0436\u0438\u043c \u041c\u0424\u0426\u0410: \u0442\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044f \u0441\u0443\u0431\u0441\u0442\u0430\u043d\u0446\u0438\u044f CIGA, \u0437\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u043e\u0432\u0430\u043d\u043d\u044b\u0439 \u043e\u0444\u0438\u0441 \u0432 \u0410\u0441\u0442\u0430\u043d\u0435 \u0438 \u043a\u0432\u0430\u043b\u0438\u0444\u0438\u0446\u0438\u0440\u043e\u0432\u0430\u043d\u043d\u044b\u0435 \u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u0438 \u043d\u0430 \u043c\u0435\u0441\u0442\u0435.',
  },
  KZ_HUB: {
    en: 'Astana Hub: IT park benefits require Advance Ruling from the Ministry. Substance and revenue tests apply.',
    ru: '\u0410\u0441\u0442\u0430\u043d\u0430 \u0425\u0430\u0431: \u043b\u044c\u0433\u043e\u0442\u044b IT-\u043f\u0430\u0440\u043a\u0430 \u0442\u0440\u0435\u0431\u0443\u044e\u0442 \u043f\u0440\u0435\u0434\u0432\u0430\u0440\u0438\u0442\u0435\u043b\u044c\u043d\u043e\u0433\u043e \u0440\u0435\u0448\u0435\u043d\u0438\u044f \u041c\u0438\u043d\u0438\u0441\u0442\u0435\u0440\u0441\u0442\u0432\u0430. \u041f\u0440\u0438\u043c\u0435\u043d\u044f\u044e\u0442\u0441\u044f \u0442\u0435\u0441\u0442\u044b \u043d\u0430 \u0441\u0443\u0431\u0441\u0442\u0430\u043d\u0446\u0438\u044e \u0438 \u0432\u044b\u0440\u0443\u0447\u043a\u0443.',
  },
  UAE_FZ_Q: {
    en: 'Qualifying Free Zone: Must meet QFZP conditions including adequate substance, no mainland revenue, and TP compliance.',
    ru: '\u041a\u0432\u0430\u043b\u0438\u0444\u0438\u0446\u0438\u0440\u043e\u0432\u0430\u043d\u043d\u0430\u044f \u0441\u0432\u043e\u0431\u043e\u0434\u043d\u0430\u044f \u0437\u043e\u043d\u0430: \u043d\u0435\u043e\u0431\u0445\u043e\u0434\u0438\u043c\u043e \u0441\u043e\u043e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0438\u0435 QFZP, \u0432\u043a\u043b\u044e\u0447\u0430\u044f \u0441\u0443\u0431\u0441\u0442\u0430\u043d\u0446\u0438\u044e, \u043e\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0438\u0435 \u0432\u044b\u0440\u0443\u0447\u043a\u0438 \u0441 \u043c\u0430\u0442\u0435\u0440\u0438\u043a\u0430 \u0438 TP-\u043a\u043e\u043c\u043f\u043b\u0430\u0435\u043d\u0441.',
  },
  UAE_FZ_NQ: {
    en: 'Non-Qualifying Free Zone: Standard 9% CIT applies. Consider restructuring to meet QFZP criteria.',
    ru: '\u041d\u0435\u043a\u0432\u0430\u043b\u0438\u0444\u0438\u0446\u0438\u0440\u043e\u0432\u0430\u043d\u043d\u0430\u044f \u0441\u0432\u043e\u0431\u043e\u0434\u043d\u0430\u044f \u0437\u043e\u043d\u0430: \u043f\u0440\u0438\u043c\u0435\u043d\u044f\u0435\u0442\u0441\u044f \u0441\u0442\u0430\u043d\u0434\u0430\u0440\u0442\u043d\u044b\u0439 \u041a\u041f\u041d 9%. \u0420\u0430\u0441\u0441\u043c\u043e\u0442\u0440\u0438\u0442\u0435 \u0440\u0435\u0441\u0442\u0440\u0443\u043a\u0442\u0443\u0440\u0438\u0437\u0430\u0446\u0438\u044e \u0434\u043b\u044f QFZP.',
  },
  HK_OFF: {
    en: 'Offshore profits claim: Requires robust TP documentation, no HK-sourced income, and no HK CIGA.',
    ru: '\u041e\u0444\u0448\u043e\u0440\u043d\u0430\u044f \u043f\u0440\u0438\u0431\u044b\u043b\u044c: \u0442\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044f \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u0430\u0446\u0438\u044f TP, \u043e\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0438\u0435 \u0434\u043e\u0445\u043e\u0434\u043e\u0432 \u0438\u0437 \u0413\u043e\u043d\u043a\u043e\u043d\u0433\u0430 \u0438 CIGA.',
  },
  BVI_STD: {
    en: 'BVI entity: Economic Substance Act requires relevant activity, qualified employees, and physical premises.',
    ru: '\u041a\u043e\u043c\u043f\u0430\u043d\u0438\u044f \u0411\u0412\u041e: \u0437\u0430\u043a\u043e\u043d \u043e\u0431 \u044d\u043a\u043e\u043d\u043e\u043c\u0438\u0447\u0435\u0441\u043a\u043e\u0439 \u0441\u0443\u0431\u0441\u0442\u0430\u043d\u0446\u0438\u0438 \u0442\u0440\u0435\u0431\u0443\u0435\u0442 \u0440\u0435\u043b\u0435\u0432\u0430\u043d\u0442\u043d\u0443\u044e \u0434\u0435\u044f\u0442\u0435\u043b\u044c\u043d\u043e\u0441\u0442\u044c, \u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u043e\u0432 \u0438 \u043f\u043e\u043c\u0435\u0449\u0435\u043d\u0438\u044f.',
  },
  CY_STD: {
    en: 'Cyprus holding: IP Box and NID benefits available. Watch for EU defensive measures on dividends from low-tax jurisdictions.',
    ru: '\u041a\u0438\u043f\u0440\u0441\u043a\u0438\u0439 \u0445\u043e\u043b\u0434\u0438\u043d\u0433: \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u044b IP Box \u0438 NID. \u0412\u043d\u0438\u043c\u0430\u043d\u0438\u0435: \u0437\u0430\u0449\u0438\u0442\u043d\u044b\u0435 \u043c\u0435\u0440\u044b \u0415\u0421 \u043d\u0430 \u0434\u0438\u0432\u0438\u0434\u0435\u043d\u0434\u044b \u0438\u0437 \u043d\u0438\u0437\u043a\u043e\u043d\u0430\u043b\u043e\u0433\u043e\u0432\u044b\u0445 \u044e\u0440\u0438\u0441\u0434\u0438\u043a\u0446\u0438\u0439.',
  },
  SG_STD: {
    en: 'Singapore: Consider Section 13R/13X fund incentives. WHT on services requires careful structuring.',
    ru: '\u0421\u0438\u043d\u0433\u0430\u043f\u0443\u0440: \u0440\u0430\u0441\u0441\u043c\u043e\u0442\u0440\u0438\u0442\u0435 \u043b\u044c\u0433\u043e\u0442\u044b 13R/13X. WHT \u043d\u0430 \u0443\u0441\u043b\u0443\u0433\u0438 \u0442\u0440\u0435\u0431\u0443\u0435\u0442 \u0442\u0449\u0430\u0442\u0435\u043b\u044c\u043d\u043e\u0433\u043e \u0441\u0442\u0440\u0443\u043a\u0442\u0443\u0440\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u044f.',
  },
};

/**
 * Resolve a localized tooltip for a regime.
 */
export function localizedTooltip(regimeId: string, lang: Language): string | undefined {
  const entry = tooltipTranslations[regimeId];
  if (!entry) return undefined;
  return entry[lang] ?? entry.en;
}
