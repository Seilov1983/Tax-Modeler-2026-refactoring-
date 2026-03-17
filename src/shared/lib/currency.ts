/**
 * Currency symbol map — maps CurrencyCode to display symbol.
 * Used by sidebar, context menus, and summary widgets.
 */

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '\u20ac',
  KZT: '\u20b8',
  AED: '\u062f.\u0625',
  GBP: '\u00a3',
  HKD: 'HK$',
  SGD: 'S$',
  SCR: '\u20a8',
  CNY: '\u00a5',
};

export function currencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code] || code;
}
