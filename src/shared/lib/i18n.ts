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
