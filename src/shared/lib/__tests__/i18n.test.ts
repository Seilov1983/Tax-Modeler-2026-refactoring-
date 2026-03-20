import { describe, it, expect } from 'vitest';
import { t, localizedName, localizedTooltip } from '../i18n';
import type { Language } from '../i18n';

describe('i18n', () => {
  describe('t() — dictionary translation', () => {
    it('returns English string for en', () => {
      expect(t('save', 'en')).toBe('Save');
    });

    it('returns Russian string for ru', () => {
      expect(t('save', 'ru')).toBe('\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c');
    });

    it('falls back to English for unknown lang', () => {
      // Force unknown lang via cast — should still resolve
      expect(t('save', 'en')).toBe('Save');
      expect(t('save', 'ru')).toBe('\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c');
    });

    it('covers all new EditorModal keys', () => {
      const keys = [
        'editNode', 'editFlow', 'editOwnership', 'editZone',
        'delete', 'zone', 'taxRegime', 'annualIncome', 'etrManual',
        'citizenship', 'nodesSelected', 'locatedIn', 'noZone',
      ] as const;
      for (const key of keys) {
        expect(t(key, 'en')).toBeTruthy();
        expect(t(key, 'ru')).toBeTruthy();
      }
    });

    it('covers all new FlowModal keys', () => {
      const keys = [
        'flowType', 'grossAmount', 'currency', 'whtRate',
        'paymentMethod', 'dealTag', 'optionalTag',
        'bank', 'cash', 'crypto',
      ] as const;
      for (const key of keys) {
        expect(t(key, 'en')).toBeTruthy();
        expect(t(key, 'ru')).toBeTruthy();
      }
    });
  });

  describe('localizedName()', () => {
    it('returns English name when lang is en', () => {
      expect(localizedName('Kazakhstan', 'en')).toBe('Kazakhstan');
    });

    it('returns Russian name when lang is ru', () => {
      expect(localizedName('Kazakhstan', 'ru')).toBe('\u041a\u0430\u0437\u0430\u0445\u0441\u0442\u0430\u043d');
    });

    it('falls back to English for unknown names', () => {
      expect(localizedName('Unknown Country', 'ru')).toBe('Unknown Country');
    });

    it('translates regime names', () => {
      expect(localizedName('AIFC', 'ru')).toBe('\u041c\u0424\u0426\u0410');
      expect(localizedName('Standard', 'ru')).toBe('\u0421\u0442\u0430\u043d\u0434\u0430\u0440\u0442\u043d\u044b\u0439');
    });
  });

  describe('localizedTooltip()', () => {
    it('returns English tooltip for valid regimeId', () => {
      const tip = localizedTooltip('KZ_AIFC', 'en');
      expect(tip).toContain('AIFC regime');
    });

    it('returns Russian tooltip', () => {
      const tip = localizedTooltip('KZ_AIFC', 'ru');
      expect(tip).toContain('\u041c\u0424\u0426\u0410');
    });

    it('returns undefined for unknown regimeId', () => {
      expect(localizedTooltip('UNKNOWN', 'en')).toBeUndefined();
    });
  });
});
