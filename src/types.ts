export type StopType = "主音栓" | "簧片音栓" | "混合音栓" | "低音管";

export type StopStatus = "valid" | "recalc" | "pending" | "excluded";

export type CertStatus = "valid" | "expired";

export type ReportStatus = "draft" | "issued" | "recalled";

export type ReedStatus = "normal" | "watch" | "abnormal";

export type SourceType = "calibrated" | "unknown";

export interface Certificate {
  id: string;
  version: number;
  instrument: string;
  serial: string;
  issuedAt: string;
  validUntil: string;
  status: CertStatus;
  note: string;
}

export interface Reading {
  id: string;
  venue: string;
  stop: string;
  stopType: StopType;
  pipeNo: string;
  pitch: string;
  cents: number;
  temperature: number;
  humidity: number;
  reed: ReedStatus;
  note: string;
  measuredAt: string;
  certVersion: number;
  source: SourceType;
}

export interface StopSummary {
  stop: string;
  stopType: StopType;
  venue: string;
  total: number;
  avgCents: number;
  maxAbsCents: number;
  overLimit: number;
  reedAbnormal: number;
  status: StopStatus;
  reasons: string[];
}

export interface Report {
  id: string;
  title: string;
  venue: string;
  certVersion: number;
  readingIds: string[];
  excludedIds: string[];
  status: ReportStatus;
  createdAt: string;
  issuedAt: string | null;
  history: string[];
}

export interface AuditEntry {
  id: number;
  at: string;
  text: string;
  kind: "cert" | "report" | "reading" | "system" | "conflict";
}

export interface ConflictInfo {
  theirVersion: number;
  theirInstrument: string;
  myInstrument: string;
}

export interface PersistedState {
  certs: Certificate[];
  readings: Reading[];
  reports: Report[];
  audit: AuditEntry[];
  pendingCert: Certificate | null;
  seq: number;
  savedAt: string;
}

export const CENT_LIMIT = 8;

export const STOP_ORDER: StopType[] = ["主音栓", "簧片音栓", "混合音栓", "低音管"];
