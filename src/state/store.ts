import type {
  AuditEntry,
  Certificate,
  PersistedState,
  Reading,
  Report,
} from "../types";

export const STORE_KEY = "organ-tuning-ledger-v1";

/** 模拟服务端账本：证书提交按版本做乐观并发校验，后到者会收到 409。 */
export const serverLedger = {
  certVersion: 2,
};

export function loadPersisted(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    if (!Array.isArray(parsed.certs) || !Array.isArray(parsed.readings)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function persist(state: PersistedState): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    /* 存储不可用时静默失败，界面仍保留内存状态 */
  }
}

export function clearPersisted(): void {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}

export interface CommitCertResult {
  ok: boolean;
  status: number;
  version?: number;
  instrument?: string;
}

/** 模拟一次网络往返，可按需注入失败。 */
export function delay(ms = 260): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function commitCertToServer(
  cert: Certificate,
  baseVersion: number,
  shouldFail: boolean
): Promise<CommitCertResult> {
  await delay();
  if (shouldFail) {
    return { ok: false, status: 0 };
  }
  if (baseVersion !== serverLedger.certVersion) {
    return {
      ok: false,
      status: 409,
      version: serverLedger.certVersion,
      instrument: "音分仪（另一会话已更新）",
    };
  }
  serverLedger.certVersion = cert.version;
  return { ok: true, status: 200, version: cert.version };
}

export interface Snapshot {
  certs: Certificate[];
  readings: Reading[];
  reports: Report[];
  audit: AuditEntry[];
  seq: number;
}

export function toPersisted(s: Snapshot, pendingCert: Certificate | null): PersistedState {
  return {
    certs: s.certs,
    readings: s.readings,
    reports: s.reports,
    audit: s.audit.slice(0, 80),
    pendingCert,
    seq: s.seq,
    savedAt: new Date().toISOString(),
  };
}
