// ─── Core Domain Types ───────────────────────────────────────────────────────

export type JurisdictionCode =
  | 'KZ' | 'UAE' | 'HK' | 'CY' | 'SG' | 'UK' | 'US' | 'BVI' | 'CAY' | 'SEY';

export type CurrencyCode =
  | 'KZT' | 'AED' | 'HKD' | 'EUR' | 'SGD' | 'GBP' | 'USD' | 'SCR' | 'CNY';

export type FlowType =
  | 'Services' | 'Dividends' | 'Royalties' | 'Interest' | 'Salary'
  | 'Goods' | 'Equipment';

export type NodeType = 'company' | 'person' | 'txa';

export type CITMode =
  | 'flat' | 'threshold' | 'twoTier' | 'qfzp' | 'brackets' | 'smallProfits';

// ─── Tax Configuration (Law-as-Code declarative schema) ──────────────────────

export interface WHTRates {
  dividends: number;
  interest: number;
  royalties: number;
  services: number;
}

export interface CITConfig {
  mode: CITMode;
  rate?: number;
  zeroUpTo?: number;
  zeroRate?: number;
  mainRate?: number;
  smallRate?: number;
  smallLimit?: number;
  mainLimit?: number;
  qualifyingRate?: number;
  nonQualifyingRate?: number;
  currency?: CurrencyCode;
  brackets?: Array<{ upTo: number | null; rate: number }>;
}

export interface PayrollConfig {
  pitRate: number;
  pensionEmployeeRate?: number;
  medicalEmployeeRate?: number;
  socialContribRate?: number;
  socialTaxEmployerRate?: number;
  medicalEmployerRate?: number;
  pensionEmployerRate?: number;
  socialContribMaxBaseMW?: number;
  medicalEmployerMaxBaseMW?: number;
  medicalEmployeeMaxBaseMW?: number;
  employerRate?: number;
  employeeRate?: number;
}

export interface ZoneTaxOverride {
  vatRate: number;
  cit: CITConfig;
  wht: WHTRates;
  payroll: Partial<PayrollConfig>;
  notes?: string;
}

export interface ZoneRule {
  zoneCode: string;
  taxOverride: Partial<ZoneTaxOverride>;
  whtExemptions?: Array<{
    flowTypes: FlowType[];
    rate: number;
    lawRef: string;
  }>;
}

export interface MasterDataEntry {
  countryCode: JurisdictionCode;
  baseCurrency: CurrencyCode;
  macroConstants?: {
    mciValue: number;
    minWage: number;
    baseOfficialSalary?: number;
  };
  thresholds?: {
    vatRegistrationMci?: number;
    cashLimitMci?: number;
    frozenDebtMci?: number;
    cfcIncomeMci?: number;
    cfcEtrThreshold?: number;
    cfcOwnershipThreshold?: number;
    statuteOfLimitations?: number;
  };
  vatRateStandard: number;
  citRateStandard?: number;
  cit?: CITConfig;
  wht: WHTRates;
  payroll: PayrollConfig;
  statuteOfLimitationsYears: number;
  mciValue?: number;
  minWage?: number;
  special?: Record<string, unknown>;
  zoneRules?: Record<string, ZoneRule>;
}

export type MasterData = Partial<Record<JurisdictionCode, MasterDataEntry>>;

// ─── WHT Exemption Rules (Law-as-Code) ──────────────────────────────────────

export interface WHTExemptionRule {
  match: {
    flowTypes?: FlowType[];
    sameJurisdiction?: boolean;
  };
  effect: {
    rate: number;
    lawRef: string;
  };
}

// ─── Hierarchical Master Data (Country → Regime) ─────────────────────────────

export interface Country {
  id: string;
  name: string;
  baseCurrency: CurrencyCode;
}

export interface TaxRegime {
  id: string;
  countryId: string;
  name: string;
  cit: number;
  wht: number;
}

// ─── Zone ────────────────────────────────────────────────────────────────────

export interface Zone {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  jurisdiction: JurisdictionCode;
  code: string;
  currency: CurrencyCode;
  zIndex: number;
  /** Explicit parent zone id — replaces implicit spatial hierarchy (O(n²) containment checks). */
  parentId?: string | null;
  tax?: Partial<ZoneTaxOverride>;
  /** Spatial validation error — true when zone is outside its parent bounds */
  hasError?: boolean;
}

// ─── Node ────────────────────────────────────────────────────────────────────

export interface NodeBalances {
  [currency: string]: number;
}

export interface CompanyLedger {
  balances: NodeBalances;
  digitalAssets: { CRYPTO_USD_EQUIV: number };
  retainedEarnings: number;
  accumulatedLosses: number;
  debtToTXA: number;
}

export interface CompanyComplianceData {
  substance: { employeesCount: number; hasPhysicalOffice: boolean; cigaInZone: boolean };
  aifc: { usesCITBenefit: boolean; cigaInZone: boolean };
  bvi: { relevantActivity: boolean; employees: number; office: boolean };
}

export interface NodeDTO {
  id: string;
  name: string;
  type: NodeType;
  x: number;
  y: number;
  w: number;
  h: number;
  zoneId: string | null;
  frozen: boolean;
  riskFlags: RiskFlag[];
  annualIncome: number;
  etr: number;
  computedEtr?: number | null;
  computedCitKZT?: number;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  balances: NodeBalances;
  regimeId?: string | null;
  /** Spatial validation error — true when node is outside its parent zone bounds */
  hasError?: boolean;
  // Company-specific
  ledger?: CompanyLedger;
  complianceData?: CompanyComplianceData;
  industryTags?: string[];
  accountingYears?: Record<string, AccountingYearData>;
  // Person-specific
  citizenship?: string[];
  taxResidency?: string[];
  statuses?: { isInvestmentResident: boolean };
  declaredAssets?: Record<string, number>;
  ownershipFlags?: string[];
  investments?: { aifcInvestmentUsd: number; aifcFeePaidMci: number; isInvestmentResident: boolean };
}

export interface AccountingYearData {
  totalIncomeKZT: number;
  preferentialIncomeKZT: number;
  allocatedIndirectKZT: number;
}

// ─── Flow ────────────────────────────────────────────────────────────────────

export interface FlowDTO {
  id: string;
  fromId: string;
  toId: string;
  flowType: FlowType;
  currency: CurrencyCode;
  grossAmount: number;
  paymentMethod: string;
  cashComponentAmount: number;
  cashComponentCurrency: CurrencyCode;
  whtRate: number;
  status: string;
  flowDate: string;
  dealTag?: string;
  isOffshoreSource?: boolean;
  isDirectExemptExpense?: boolean;
  ack: {
    ackStatus: 'not_required' | 'required' | 'acknowledged';
    acknowledgedBy: string | null;
    acknowledgedAt: string | null;
    comment: string;
  };
  taxAdjustments: TaxAdjustment[];
  fxEvidence: FXEvidence | null;
  compliance?: {
    applicable: boolean;
    exceeded: boolean;
    violationType?: string;
  };
}

export interface TaxAdjustment {
  tax: string;
  effect: 'DISALLOW' | 'EXEMPT' | 'WRITE_OFF' | 'OFFSET' | 'REDUCE';
  baseAmountOriginal: number;
  originalCurrency: CurrencyCode;
  baseAmountFunctional: number;
  functionalCurrency: CurrencyCode;
  fxDate: string;
  fxRateUsed: number;
  lawRefId: string;
}

export interface FXEvidence {
  fxDate: string;
  fxRateUsed: number;
  cashAmountFunctional: number;
  functionalCurrency: CurrencyCode;
  thresholdFunctional: number;
}

// ─── Tax Entry ───────────────────────────────────────────────────────────────

export interface TaxEntry {
  id: string;
  dueFromFlowId: string;
  payerId: string;
  zoneId: string;
  taxType: string;
  amountFunctional: number;
  functionalCurrency: CurrencyCode;
  amountOriginal: number;
  originalCurrency: CurrencyCode;
  fxDate: string;
  status: string;
  meta: Record<string, unknown>;
  adjustments?: Array<TaxAdjustment & { adjustedAmount: number; appliedAt: string; appliedBy: string }>;
}

// ─── Risk Flags ──────────────────────────────────────────────────────────────

export type RiskFlagType =
  | 'CFC_RISK' | 'SUBSTANCE_BREACH' | 'AIFC_PRESENCE_BREACH'
  | 'PILLAR2_LOW_ETR' | 'TRANSFER_PRICING_RISK'
  | 'CASH_LIMIT_EXCEEDED' | 'INTERIM_DIVIDENDS_RISK' | 'CONSTRUCTIVE_DIVIDEND'
  | 'PILLAR2_TOPUP_RISK' | 'NO_JURISDICTION';

export interface RiskFlag {
  type: RiskFlagType | string;
  lawRef?: string;
  [key: string]: unknown;
}

// ─── Ownership ───────────────────────────────────────────────────────────────

export interface OwnershipEdge {
  id: string;
  fromId: string;
  toId: string;
  percent: number;
  manualAdjustment: number;
}

// ─── Audit ───────────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  occurredAt: string;
  actor: { userId: string };
  action: string;
  entityRef: Record<string, unknown>;
  diffFormat: 'JSON_PATCH_RFC6902';
  diff: unknown[];
  metadata: Record<string, unknown>;
  prevHash: string;
  entryHash: string;
}

export interface AuditLog {
  entries: AuditEntry[];
  lastHash: string;
}

// ─── FX ──────────────────────────────────────────────────────────────────────

export interface FXConfig {
  fxDate: string;
  rateToUSD: Record<string, number>;
  source: string;
}

// ─── Project ─────────────────────────────────────────────────────────────────

export interface Project {
  schemaVersion: string;
  engineVersion: string;
  projectId: string;
  title: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  readOnly: boolean;
  baseCurrency: CurrencyCode;
  masterData: MasterData & {
    countries?: Country[];
    regimes?: TaxRegime[];
  };
  fx: FXConfig;
  zones: Zone[];
  nodes: NodeDTO[];
  ownership: OwnershipEdge[];
  catalogs: {
    jurisdictions: Array<{ id: JurisdictionCode; name: string; enabled: boolean }>;
    flowTypes: Array<{ id: FlowType; name: string; enabled: boolean }>;
    nodeTemplates: Array<{ id: string; name: string; kind: NodeType }>;
  };
  activeJurisdictions: JurisdictionCode[];
  ui: {
    canvasW: number;
    canvasH: number;
    editMode: string;
    gridSize: number;
    snapToGrid: boolean;
    flowLegend: { show: boolean; mode: string; selectedTypes: string[]; showTaxes: boolean };
    hiddenZoneIds?: string[];
  };
  flows: FlowDTO[];
  taxes: TaxEntry[];
  audit: AuditLog;
  periods: { closedYears: number[] };
  group: { consolidatedRevenueEur: number | null };
  accounting: { years: Record<string, unknown> };
  lawReferences: Record<string, { title: string; version: string; effectiveFrom: string }>;
  snapshots: unknown[];
  pipeline: {
    lastRunAt: string | null;
    lastRun: unknown;
    runs: unknown[];
  };
  projectRiskFlags: RiskFlag[];
}

// ─── WHT Computation Result ──────────────────────────────────────────────────

export interface WHTResult {
  amountOriginal?: number;
  originalCurrency?: CurrencyCode;
  amountFunctional?: number;
  functionalCurrency?: CurrencyCode;
  fxDate?: string;
  fxRateUsed?: number;
  appliedLawRef?: string | null;
  amount?: number;
  currency?: CurrencyCode;
}

// ─── Payroll Result ──────────────────────────────────────────────────────────

export interface PayrollBreakdownItem {
  code: string;
  rate: number;
  base: number;
  amount: number;
}

export interface PayrollResult {
  total: number;
  breakdown: PayrollBreakdownItem[];
}

// ─── Group Tax Summary (consolidated output of computeGroupTax) ──────────────

/** Per-entity CIT liability computed by the tax engine. */
export interface EntityCITLiability {
  nodeId: string;
  nodeName: string;
  jurisdiction: JurisdictionCode | null;
  /** The zone/regime the node resides in. */
  zoneId: string | null;
  /** Taxable income (annualIncome from the node). */
  taxableIncome: number;
  /** Effective CIT rate applied (scalar, 0–1). */
  citRate: number;
  /** Computed CIT amount in functional currency. */
  citAmount: number;
  /** Functional currency of the zone. */
  currency: CurrencyCode;
}

/** Per-flow WHT liability computed by the tax engine. */
export interface FlowWHTLiability {
  flowId: string;
  flowType: FlowType;
  fromNodeId: string;
  toNodeId: string;
  /** Gross amount of the flow in its original currency. */
  grossAmount: number;
  originalCurrency: CurrencyCode;
  /** WHT rate applied (percent, 0–100). */
  whtRatePercent: number;
  /** WHT amount in the flow's original currency. */
  whtAmountOriginal: number;
  /** WHT amount converted to the project's base currency. */
  whtAmountBase: number;
}

/** Consolidated tax summary for the entire project graph. */
export interface GroupTaxSummary {
  /** Per-company CIT liabilities. */
  citLiabilities: EntityCITLiability[];
  /** Per-flow WHT liabilities. */
  whtLiabilities: FlowWHTLiability[];
  /** Sum of all CIT amounts, converted to project base currency. */
  totalCITBase: number;
  /** Sum of all WHT amounts, converted to project base currency. */
  totalWHTBase: number;
  /** Total tax burden (CIT + WHT) in project base currency. */
  totalTaxBase: number;
  /** Total pre-tax income across all company nodes, in project base currency. */
  totalIncomeBase: number;
  /** Group-level effective tax rate: totalTaxBase / totalIncomeBase (0–1). */
  totalEffectiveTaxRate: number;
  /** Project base currency used for all *Base amounts. */
  baseCurrency: CurrencyCode;
}
