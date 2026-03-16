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
  tax?: Partial<ZoneTaxOverride>;
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
  | 'PILLAR2_TOPUP_RISK';

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
