'use server';

import { prisma } from '@shared/lib/db/prisma';
import type { DictionaryCountry, DictionaryRegime, TaxFlowRule } from '../../../generated/prisma/client';

// ─── Dictionary Country Actions ──────────────────────────────────────────────

export async function fetchCountries(): Promise<DictionaryCountry[]> {
  return prisma.dictionaryCountry.findMany({
    orderBy: { name: 'asc' },
  });
}

export async function fetchCountryByCode(code: string): Promise<DictionaryCountry | null> {
  return prisma.dictionaryCountry.findUnique({ where: { code } });
}

export async function createCountry(data: {
  code: string;
  name: string;
  baseCurrency: string;
  vatRate?: number;
  citRate?: number;
}): Promise<DictionaryCountry> {
  return prisma.dictionaryCountry.create({
    data: {
      code: data.code,
      name: data.name,
      baseCurrency: data.baseCurrency,
      vatRate: data.vatRate ?? 0,
      citRate: data.citRate ?? 0,
    },
  });
}

export async function updateCountry(
  id: string,
  data: Partial<Pick<DictionaryCountry, 'name' | 'baseCurrency' | 'vatRate' | 'citRate' | 'enabled'>>,
): Promise<DictionaryCountry> {
  return prisma.dictionaryCountry.update({ where: { id }, data });
}

export async function deleteCountry(id: string): Promise<void> {
  await prisma.dictionaryCountry.delete({ where: { id } });
}

// ─── Dictionary Regime Actions ───────────────────────────────────────────────

export async function fetchRegimes(countryId?: string): Promise<DictionaryRegime[]> {
  return prisma.dictionaryRegime.findMany({
    where: countryId ? { countryId } : undefined,
    orderBy: { name: 'asc' },
  });
}

export async function fetchRegimesByCountry(countryId: string): Promise<DictionaryRegime[]> {
  return prisma.dictionaryRegime.findMany({
    where: { countryId },
    orderBy: { name: 'asc' },
  });
}

export async function createRegime(data: {
  countryId: string;
  name: string;
  citRate?: number;
  whtRate?: number;
  notes?: string;
}): Promise<DictionaryRegime> {
  return prisma.dictionaryRegime.create({
    data: {
      countryId: data.countryId,
      name: data.name,
      citRate: data.citRate ?? 0,
      whtRate: data.whtRate ?? 0,
      notes: data.notes,
    },
  });
}

export async function updateRegime(
  id: string,
  data: Partial<Pick<DictionaryRegime, 'name' | 'citRate' | 'whtRate' | 'notes' | 'enabled'>>,
): Promise<DictionaryRegime> {
  return prisma.dictionaryRegime.update({ where: { id }, data });
}

export async function deleteRegime(id: string): Promise<void> {
  await prisma.dictionaryRegime.delete({ where: { id } });
}

// ─── Tax Flow Rule Actions ───────────────────────────────────────────────────

export async function fetchTaxFlowRules(regimeId: string): Promise<TaxFlowRule[]> {
  return prisma.taxFlowRule.findMany({
    where: { regimeId },
    orderBy: { flowType: 'asc' },
  });
}

export async function createTaxFlowRule(data: {
  regimeId: string;
  flowType: string;
  whtRate?: number;
  citDeductible?: boolean;
  exemptionRef?: string;
}): Promise<TaxFlowRule> {
  return prisma.taxFlowRule.create({
    data: {
      regimeId: data.regimeId,
      flowType: data.flowType,
      whtRate: data.whtRate ?? 0,
      citDeductible: data.citDeductible ?? true,
      exemptionRef: data.exemptionRef,
    },
  });
}

export async function updateTaxFlowRule(
  id: string,
  data: Partial<Pick<TaxFlowRule, 'whtRate' | 'citDeductible' | 'exemptionRef' | 'effectiveTo'>>,
): Promise<TaxFlowRule> {
  return prisma.taxFlowRule.update({ where: { id }, data });
}

export async function deleteTaxFlowRule(id: string): Promise<void> {
  await prisma.taxFlowRule.delete({ where: { id } });
}

// ─── Aggregate: Fetch all master data (countries + regimes + rules) ──────────

export async function fetchAllMasterData() {
  const [countries, regimes, rules] = await Promise.all([
    prisma.dictionaryCountry.findMany({
      where: { enabled: true },
      orderBy: { name: 'asc' },
    }),
    prisma.dictionaryRegime.findMany({
      where: { enabled: true },
      orderBy: { name: 'asc' },
    }),
    prisma.taxFlowRule.findMany({
      orderBy: { flowType: 'asc' },
    }),
  ]);

  return { countries, regimes, rules };
}
