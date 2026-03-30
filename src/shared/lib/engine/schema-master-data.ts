/**
 * Zod schemas for temporal master-data validation (Law-as-Code).
 *
 * These schemas formalize the JSON dictionaries used by the tax engine.
 * Every rate entry carries a temporal window [validFrom, validTo) so the
 * engine can resolve the correct rate for any transaction date.
 *
 * INVARIANT: This file is pure TypeScript — ZERO React, DOM, or UI imports.
 */

import { z } from 'zod';

// ─── ISO Date String ────────────────────────────────────────────────────────

const isoDateString = z.string().regex(
  /^\d{4}-\d{2}-\d{2}/,
  'Must be an ISO date string (YYYY-MM-DD…)',
);

// ─── Temporal Rate Schema ───────────────────────────────────────────────────

/** A single temporal rate: value is valid within [validFrom, validTo). */
export const TemporalRateSchema = z.object({
  validFrom: isoDateString,
  validTo: isoDateString.nullable(),
  value: z.number(),
});

export type TemporalRateEntry = z.infer<typeof TemporalRateSchema>;

/** Array of temporal rates — the standard shape for CIT, VAT, WHT flat rates. */
export const TemporalRateArraySchema = z.array(TemporalRateSchema);

// ─── Progressive WHT Brackets Schema ────────────────────────────────────────

export const WHTBracketSchema = z.object({
  upToMRP: z.number().nullable(),
  rate: z.number(),
});

export const TemporalWHTBracketsSchema = z.object({
  validFrom: isoDateString,
  validTo: isoDateString.nullable(),
  brackets: z.array(WHTBracketSchema),
});

export type TemporalWHTBracketsEntry = z.infer<typeof TemporalWHTBracketsSchema>;

// ─── Macro Constants Schema ─────────────────────────────────────────────────

export const MacroConstantsSchema = z.object({
  mrpValue: TemporalRateArraySchema.optional(),
  mciValue: TemporalRateArraySchema.optional(),
  minWage: TemporalRateArraySchema.optional(),
});

// ─── CFC Rules Schema ───────────────────────────────────────────────────────

export const CFCRuleSchema = z.object({
  validFrom: isoDateString,
  validTo: isoDateString.nullable(),
  ownershipThreshold: z.number(),
  etrThreshold: z.number(),
  incomeExemptionMRP: z.number(),
});

// ─── Special Zone Schema ────────────────────────────────────────────────────

export const SpecialZoneSchema = z.object({
  citRate: TemporalRateArraySchema.optional(),
  vatRate: TemporalRateArraySchema.optional(),
  citReduction: TemporalRateArraySchema.optional(),
  nexusFraction: z.object({
    formula: z.string(),
    appliesTo: z.string(),
    cappedAt: z.number(),
  }).optional(),
  conditions: z.array(z.string()).optional(),
  lawRef: z.string().optional(),
});

// ─── Cash Limit Schema ──────────────────────────────────────────────────────

export const CashLimitSchema = z.object({
  validFrom: isoDateString,
  validTo: isoDateString.nullable(),
  threshold: z.number(),
});

// ─── Defensive Measures Schema (Cyprus) ─────────────────────────────────────

export const DeductionDenialSchema = z.object({
  flowTypes: z.array(z.string()),
  effect: z.string(),
  lawRef: z.string(),
});

export const DefensiveMeasureSchema = z.object({
  validFrom: isoDateString,
  validTo: isoDateString.nullable(),
  enabled: z.boolean(),
  penaltyWhtDividendsToLTJ: z.number(),
  deductionDenial: DeductionDenialSchema,
  lowTaxJurisdictions: z.array(z.string()),
  lawRef: z.string(),
});

// ─── UAE Free Zone Threshold Schema ─────────────────────────────────────────

export const FreeZoneThresholdSchema = z.object({
  validFrom: isoDateString,
  validTo: isoDateString.nullable(),
  zeroUpTo: z.number(),
  mainRate: z.number(),
  currency: z.string(),
});

// ─── UAE Tax Group Rules Schema ─────────────────────────────────────────────

export const TaxGroupRuleSchema = z.object({
  validFrom: isoDateString,
  validTo: isoDateString.nullable(),
  enabled: z.boolean(),
  eliminateIntraGroupFlows: z.boolean(),
  consolidatedReporting: z.boolean(),
  conditions: z.array(z.string()),
  lawRef: z.string(),
});

// ─── Country-Level Rate Dictionary Schemas ──────────────────────────────────

/**
 * Kazakhstan rates dictionary — full temporal schema.
 * Covers CIT, VAT, all WHT categories, macro constants, CFC rules, special zones.
 */
export const KZRatesSchema = z.object({
  $schema: z.string().optional(),
  $jurisdiction: z.literal('KZ').optional(),
  $description: z.string().optional(),

  macroConstants: MacroConstantsSchema,
  vatRates: TemporalRateArraySchema,
  citRates: TemporalRateArraySchema,

  whtDividends: z.object({
    progressive: z.array(TemporalWHTBracketsSchema),
    flat: TemporalRateArraySchema,
  }),
  whtInterest: TemporalRateArraySchema,
  whtRoyalties: TemporalRateArraySchema,
  whtServices: TemporalRateArraySchema,

  cashLimitMRP: z.array(CashLimitSchema).optional(),
  cfcRules: z.array(CFCRuleSchema).optional(),
  specialZones: z.record(z.string(), SpecialZoneSchema).optional(),
});

export type KZRates = z.infer<typeof KZRatesSchema>;

/**
 * Cyprus rates dictionary — CIT rates + defensive measures.
 */
export const CYRatesSchema = z.object({
  $schema: z.string().optional(),
  $jurisdiction: z.literal('CY').optional(),
  $description: z.string().optional(),

  citRates: TemporalRateArraySchema,
  vatRates: TemporalRateArraySchema.optional(),
  whtDividends: TemporalRateArraySchema.optional(),
  whtInterest: TemporalRateArraySchema.optional(),
  whtRoyalties: TemporalRateArraySchema.optional(),
  whtServices: TemporalRateArraySchema.optional(),

  defensiveMeasures: z.array(DefensiveMeasureSchema).optional(),
});

export type CYRates = z.infer<typeof CYRatesSchema>;

/**
 * UAE rates dictionary — CIT rates, free zone thresholds, tax group rules.
 */
export const UAERatesSchema = z.object({
  $schema: z.string().optional(),
  $jurisdiction: z.literal('UAE').optional(),
  $description: z.string().optional(),

  citRates: TemporalRateArraySchema,
  vatRates: TemporalRateArraySchema.optional(),

  freeZoneThreshold: z.array(FreeZoneThresholdSchema).optional(),
  taxGroupRules: z.array(TaxGroupRuleSchema).optional(),
});

export type UAERates = z.infer<typeof UAERatesSchema>;

// ─── Validation Helpers ─────────────────────────────────────────────────────

/**
 * Validate and parse a KZ rates JSON dictionary.
 * Throws ZodError if validation fails.
 */
export function parseKZRates(data: unknown): KZRates {
  return KZRatesSchema.parse(data);
}

/**
 * Validate and parse a CY rates JSON dictionary.
 * Throws ZodError if validation fails.
 */
export function parseCYRates(data: unknown): CYRates {
  return CYRatesSchema.parse(data);
}

/**
 * Validate and parse a UAE rates JSON dictionary.
 * Throws ZodError if validation fails.
 */
export function parseUAERates(data: unknown): UAERates {
  return UAERatesSchema.parse(data);
}
