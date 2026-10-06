// 台账核心：模拟服务端 + 本机优先存储
// - 读数先落本机（发件箱）再上传，失败留住内容，恢复后只续传未完成条目
// - 证书更新使用乐观并发：baseVersion 与当前版本不一致即 409 冲突
// - 证书更新后立即重算相关读数结论，已签发报告退回复核并写审计留痕
import { useSyncExternalStore } from "react";
import type {
  Certificate,
  Reading,
  Report,
  AuditEvent,
  ReadingInput,
  CertificateInput,
  FailMode,
  VerificationStatus,
  PendingReason,
  ActionResult,
} from "./types";

const STORAGE_KEY = "organ-ledger-v1";
const TOLERANCE_CENTS = 6; // 音分合格限
const UPLOAD_LATENCY_MS = 220;

interface LedgerState {
  certificates: Certificate[];
  readings: Reading[];
  reports: Report[];
  audit: AuditEvent[];
  online: boolean;
  failMode: FailMode;
  operator: string;
}

// ---------- 工具 ----------
export function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

function isoAt(y: number, m: number, d: number, h = 0, min = 0): string {
  return new Date(y, m - 1, d, h, min).toISOString();
}

function currentCertOf(state: LedgerState): Certificate | undefined {
  return [...state.certificates].sort((a, b) => b.version - a.version)[0];
}

function isCertExpiredAt(cert: Certificate, atIso: string): boolean {
  return new Date(atIso).getTime() > new Date(cert.expiresAt).getTime();
}

function conclude(deviation: number, cert: Certificate | undefined) {
  const corrected = cert ? deviation + cert.correctionCents : deviation;
  return {
    correctedDeviation: Math.round(corrected * 10) / 10,
    conclusion: (Math.abs(corrected) <= TOLERANCE_CENTS ? "ok" : "out") as "ok" | "out",
  };
}

// ---------- 种子数据 ----------
function seed(): LedgerState {
  const v1Cal = isoAt(2025, 10, 6);
  const v1Exp = isoAt(2026, 10, 5, 23, 59);
  const v2Cal = isoAt(2026, 10, 1);
  const v2Exp = isoAt(2027, 10, 1, 23, 59);

  const certificates: Certificate[] = [
    {
      id: "cert-1",
      certNo: "CAL-2025-017",
      version: 1,
      instrumentModel: "Fluke 805 音分仪",
      calibratedAt: v1Cal,
      expiresAt: v1Exp,
      correctionCents: 1.2,
      issuedBy: "省计量院",
      createdAt: v1Cal,
    },
    {
      id: "cert-2",
      certNo: "CAL-2026-020",
      version: 2,
      instrumentModel: "Fluke 805 音分仪",
      calibratedAt: v2Cal,
      expiresAt: v2Exp,
      correctionCents: 0.8,
      issuedBy: "省计量院",
      createdAt: v2Cal,
    },
  ];

  const readings: Reading[] = [
    {
      id: "r-1",
      venue: "St.Mary",
      stop: "Trumpet 8'",
      pipeNo: "T8-01",
      pitch: "C#4",
      deviation: 7,
      ...conclude(7, certificates[1]),
      temperature: 20.5,
      humidity: 55,
      reedStatus: "abnormal",
      reedNote: "簧片需微调",
      maintenanceNote: "预约下次调音台处理",
      measuredAt: isoAt(2026, 10, 2, 9, 15),
      source: "meter-sync",
      certId: "cert-2",
      certVersion: 2,
      certExpiresAt: v2Exp,
      verificationStatus: "verified",
      pendingReason: null,
      verifiedAt: isoAt(2026, 10, 2, 10, 0),
      recalculatedAt: v2Cal,
      uploadStatus: "uploaded",
      createdAt: isoAt(2026, 10, 2, 9, 16),
    },
    {
      id: "r-2",
      venue: "ConcertHall A",
      stop: "Principal 4'",
      pipeNo: "P4-07",
      pitch: "G3",
      deviation: -3,
      ...conclude(-3, certificates[1]),
      temperature: 21,
      humidity: 50,
      reedStatus: "normal",
      measuredAt: isoAt(2026, 10, 3, 14, 20),
      source: "meter-sync",
      certId: "cert-2",
      certVersion: 2,
      certExpiresAt: v2Exp,
      verificationStatus: "verified",
      pendingReason: null,
      verifiedAt: isoAt(2026, 10, 3, 15, 0),
      recalculatedAt: v2Cal,
      uploadStatus: "uploaded",
      createdAt: isoAt(2026, 10, 3, 14, 21),
    },
    {
      id: "r-3",
      venue: "St.Mary",
      stop: "Bourdon 16'",
      pipeNo: "B16-03",
      pitch: "F2",
      deviation: -12,
      ...conclude(-12, certificates[1]),
      temperature: 19,
      humidity: 60,
      reedStatus: "abnormal",
      reedNote: "标记复检，音偏低",
      maintenanceNote: "检查共鸣管",
      measuredAt: isoAt(2026, 10, 2, 10, 5),
      source: "meter-sync",
      certId: "cert-2",
      certVersion: 2,
      certExpiresAt: v2Exp,
      verificationStatus: "verified",
      pendingReason: null,
      verifiedAt: isoAt(2026, 10, 2, 11, 0),
      recalculatedAt: v2Cal,
      uploadStatus: "uploaded",
      createdAt: isoAt(2026, 10, 2, 10, 6),
    },
    {
      id: "r-4",
      venue: "Abbey Room",
      stop: "Gemshorn 8'",
      pipeNo: "G8-11",
      pitch: "A4",
      deviation: 2,
      ...conclude(2, certificates[1]),
      temperature: 20,
      humidity: 52,
      reedStatus: "normal",
      measuredAt: isoAt(2026, 10, 4, 16, 40),
      source: "unknown",
      certId: "cert-2",
      certVersion: 2,
      certExpiresAt: v2Exp,
      verificationStatus: "pending",
      pendingReason: "unknown-source",
      uploadStatus: "uploaded",
      createdAt: isoAt(2026, 10, 4, 16, 41),
    },
    {
      id: "r-5",
      venue: "St.Mary",
      stop: "Principal 4'",
      pipeNo: "P4-02",
      pitch: "D4",
      deviation: 5,
      ...conclude(5, certificates[0]),
      temperature: 22,
      humidity: 48,
      reedStatus: "normal",
      measuredAt: isoAt(2026, 10, 6, 8, 30),
      source: "manual",
      certId: "cert-1",
      certVersion: 1,
      certExpiresAt: v1Exp,
      verificationStatus: "pending",
      pendingReason: "expired-cert",
      uploadStatus: "uploaded",
      createdAt: isoAt(2026, 10, 6, 8, 31),
    },
  ];

  const reports: Report[] = [
    {
      id: "rep-1",
      reportNo: "REP-2026-014",
      title: "St.Mary 秋季调音报告",
      venue: "St.Mary",
      readingIds: ["r-1", "r-3"],
      status: "review",
      createdAt: isoAt(2026, 9, 28, 9, 0),
      issuedAt: isoAt(2026, 9, 29, 10, 0),
      reviewReason: "证书 CAL-2026-020（v2）更新后相关音管结论已重算，已签发报告退回复核",
    },
    {
      id: "rep-2",
      reportNo: "REP-2026-015",
      title: "ConcertHall A 常规调音记录",
      venue: "ConcertHall A",
      readingIds: ["r-2"],
      status: "draft",
      createdAt: isoAt(2026, 10, 3, 16, 0),
    },
  ];

  const audit: AuditEvent[] = [
    {
      id: "a-1",
      at: v2Cal,
      type: "cert.created",
      message: "音分仪证书更新为 CAL-2026-020（v2），修正值 +0.8 音分",
      operator: "省计量院",
    },
    {
      id: "a-2",
      at: v2Cal,
      type: "reading.recalculated",
      message: "3 条已核验读数按新证书修正值重算结论",
      operator: "系统",
    },
    {
      id: "a-3",
      at: v2Cal,
      type: "report.recalled",
      message: "已签发报告 REP-2026-014 退回复核：证书更新导致结论重算",
      operator: "系统",
      refId: "rep-1",
    },
  ];

  return {
    certificates,
    readings,
    reports,
    audit,
    online: true,
    failMode: "none",
    operator: "调音师-林岚",
  };
}

// ---------- 存储 ----------
function load(): LedgerState {
  const fresh = seed();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      persist(fresh);
      return fresh;
    }
    const parsed = JSON.parse(raw) as Partial<LedgerState>;
    return {
      ...fresh,
      ...parsed,
      online: true,
      failMode: "none",
      operator: parsed.operator ?? fresh.operator,
    };
  } catch {
    return fresh;
  }
}

function persist(state: LedgerState) {
  try {
    const { online, failMode, ...slice } = state;
    void online;
    void failMode;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slice));
  } catch {
    /* 本机存储不可用时仍保留内存态 */
  }
}

// ---------- 简易 store ----------
let state: LedgerState = load();
const listeners = new Set<() => void>();

function setState(updater: (prev: LedgerState) => LedgerState) {
  state = updater(state);
  persist(state);
  listeners.forEach((l) => l());
}

function getSnapshot(): LedgerState {
  return state;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function pushAudit(type: string, message: string, operator: string, refId?: string) {
  const event: AuditEvent = { id: uid("a"), at: new Date().toISOString(), type, message, operator, refId };
  setState((s) => ({ ...s, audit: [event, ...s.audit].slice(0, 200) }));
}

// ---------- 动作 ----------
function addReading(input: ReadingInput): ActionResult<{ id: string }> {
  const cert = currentCertOf(state);
  const measuredAt = input.measuredAt || new Date().toISOString();

  // 核验规则：资格失效（测量时证书已过期）或来源不明 → 待核验，报告不采用
  let verificationStatus: VerificationStatus = "verified";
  let pendingReason: PendingReason | null = null;
  if (!cert || isCertExpiredAt(cert, measuredAt)) {
    verificationStatus = "pending";
    pendingReason = "expired-cert";
  } else if (input.source === "unknown") {
    verificationStatus = "pending";
    pendingReason = "unknown-source";
  }

  const { correctedDeviation, conclusion } = conclude(Number(input.deviation), cert);

  const reading: Reading = {
    id: uid("r"),
    venue: input.venue.trim(),
    stop: input.stop.trim(),
    pipeNo: input.pipeNo.trim(),
    pitch: input.pitch.trim(),
    deviation: Number(input.deviation),
    correctedDeviation,
    conclusion,
    temperature: Number(input.temperature),
    humidity: Number(input.humidity),
    reedStatus: input.reedStatus,
    reedNote: input.reedNote?.trim() || undefined,
    maintenanceNote: input.maintenanceNote?.trim() || undefined,
    measuredAt,
    source: input.source || "manual",
    certId: cert?.id ?? "",
    certVersion: cert?.version ?? 0,
    certExpiresAt: cert?.expiresAt ?? "",
    verificationStatus,
    pendingReason,
    verifiedAt: verificationStatus === "verified" ? new Date().toISOString() : undefined,
    uploadStatus: "pending", // 发件箱：先落本机，再上传
    createdAt: new Date().toISOString(),
  };

  setState((s) => ({ ...s, readings: [reading, ...s.readings] }));
  pushAudit(
    verificationStatus === "pending" ? "reading.pending" : "reading.created",
    verificationStatus === "pending"
      ? `读数 ${reading.pipeNo} 待核验：${pendingReason === "expired-cert" ? "资格失效（测量时证书已过期）" : "来源不明"}，报告暂不采用`
      : `读数 ${reading.pipeNo} 已核验并绑定证书 v${cert?.version ?? 0}（截止 ${cert ? new Date(cert.expiresAt).toLocaleString("zh-CN") : "无"}）`,
    state.operator,
    reading.id
  );

  void flushOutbox();
  return { ok: true, data: { id: reading.id } };
}

function verifyReading(id: string) {
  const target = state.readings.find((r) => r.id === id);
  if (!target || target.verificationStatus !== "pending") return;
  setState((s) => ({
    ...s,
    readings: s.readings.map((r) =>
      r.id === id
        ? { ...r, verificationStatus: "verified" as VerificationStatus, pendingReason: null, verifiedAt: new Date().toISOString() }
        : r
    ),
  }));
  pushAudit("reading.verified", `读数 ${target.pipeNo} 经人工核验通过，可用于报告`, state.operator, id);
}

/** 证书更新（乐观并发）：baseVersion 与当前版本不一致 → 409 冲突 */
function addCertificate(input: CertificateInput): ActionResult<{ version: number }> {
  const current = currentCertOf(state);
  if (input.baseVersion !== undefined && current && input.baseVersion !== current.version) {
    pushAudit(
      "conflict",
      `证书版本冲突：提交基于 v${input.baseVersion}，当前已为 v${current.version}（后到提交被拒绝）`,
      state.operator
    );
    return { ok: false, conflict: true, currentVersion: current.version };
  }

  const version = (current?.version ?? 0) + 1;
  const cert: Certificate = {
    id: uid("cert"),
    certNo: input.certNo.trim() || `CAL-${new Date().getFullYear()}-${String(version).padStart(3, "0")}`,
    version,
    instrumentModel: input.instrumentModel.trim(),
    calibratedAt: input.calibratedAt,
    expiresAt: input.expiresAt,
    correctionCents: Number(input.correctionCents),
    issuedBy: input.issuedBy.trim(),
    note: input.note?.trim() || undefined,
    createdAt: new Date().toISOString(),
  };

  setState((s) => ({ ...s, certificates: [...s.certificates, cert] }));
  pushAudit("cert.created", `音分仪证书更新为 ${cert.certNo}（v${version}），修正值 ${cert.correctionCents > 0 ? "+" : ""}${cert.correctionCents} 音分`, cert.issuedBy);

  // 证书更新后相关音管结论立即重算
  recalcWithCertificate(cert);
  return { ok: true, data: { version } };
}

/** 模拟另一终端（同事）抢先提交仪器更新 —— 后到者应看到版本冲突 */
function colleagueUpdate(): ActionResult<{ version: number }> {
  const current = currentCertOf(state);
  const version = (current?.version ?? 0) + 1;
  const cert: Certificate = {
    id: uid("cert"),
    certNo: `CAL-${new Date().getFullYear()}-${String(version).padStart(3, "0")}`,
    version,
    instrumentModel: current?.instrumentModel ?? "Fluke 805 音分仪",
    calibratedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
    correctionCents: 0.9,
    issuedBy: "同事-另一终端",
    createdAt: new Date().toISOString(),
  };
  setState((s) => ({ ...s, certificates: [...s.certificates, cert] }));
  pushAudit("cert.created", `另一终端抢先提交仪器更新：${cert.certNo}（v${version}）`, cert.issuedBy);
  recalcWithCertificate(cert);
  return { ok: true, data: { version } };
}

function recalcWithCertificate(cert: Certificate) {
  const now = new Date().toISOString();
  let recalcCount = 0;
  const nextReadings = state.readings.map((r) => {
    const { correctedDeviation, conclusion } = conclude(r.deviation, cert);
    if (r.correctedDeviation !== correctedDeviation || r.conclusion !== conclusion) recalcCount += 1;
    return { ...r, correctedDeviation, conclusion, recalculatedAt: now };
  });

  // 已签发报告退回复核并留痕
  const recalled: string[] = [];
  const nextReports = state.reports.map((rep) => {
    if (rep.status === "issued") {
      recalled.push(rep.reportNo);
      return {
        ...rep,
        status: "review" as const,
        reviewReason: `证书 ${cert.certNo}（v${cert.version}）更新后相关音管结论已重算，已签发报告退回复核`,
      };
    }
    return rep;
  });

  setState((s) => ({ ...s, readings: nextReadings, reports: nextReports }));
  if (recalcCount > 0) {
    pushAudit("reading.recalculated", `${recalcCount} 条读数按新证书修正值重算结论（合格限 ±6 音分）`, "系统");
  }
  for (const no of recalled) {
    pushAudit("report.recalled", `已签发报告 ${no} 退回复核：证书更新导致结论重算`, "系统");
  }
}

function createReport(input: { title: string; venue: string; stop?: string }): ActionResult<{ id: string }> {
  // 报告只采用已核验读数；待核验读数不纳入
  const included = state.readings.filter(
    (r) => r.verificationStatus === "verified" && r.venue === input.venue && (!input.stop || r.stop === input.stop)
  );
  if (included.length === 0) {
    return { ok: false, conflict: true, currentVersion: 0 };
  }
  const report: Report = {
    id: uid("rep"),
    reportNo: `REP-${new Date().getFullYear()}-${String(state.reports.length + 1).padStart(3, "0")}`,
    title: input.title.trim(),
    venue: input.venue.trim(),
    stop: input.stop?.trim() || undefined,
    readingIds: included.map((r) => r.id),
    status: "draft",
    createdAt: new Date().toISOString(),
  };
  setState((s) => ({ ...s, reports: [report, ...s.reports] }));
  pushAudit("report.created", `维护报告 ${report.reportNo} 创建（含 ${included.length} 条已核验读数）`, state.operator, report.id);
  return { ok: true, data: { id: report.id } };
}

function issueReport(id: string) {
  const rep = state.reports.find((r) => r.id === id);
  if (!rep || rep.status === "issued") return;
  const reissue = rep.status === "review";
  setState((s) => ({
    ...s,
    reports: s.reports.map((r) => (r.id === id ? { ...r, status: "issued" as const, issuedAt: new Date().toISOString() } : r)),
  }));
  pushAudit(
    reissue ? "report.reissued" : "report.issued",
    reissue
      ? `报告 ${rep.reportNo} 复核通过后重新签发`
      : `报告 ${rep.reportNo} 已签发（采用 ${rep.readingIds.length} 条已核验读数）`,
    state.operator,
    id
  );
}

// ---------- 发件箱：保存失败留住内容，恢复后只续传未完成 ----------
async function flushOutbox() {
  const pending = state.readings.filter((r) => r.uploadStatus === "pending" || r.uploadStatus === "failed");
  for (const reading of pending) {
    setState((s) => ({
      ...s,
      readings: s.readings.map((r) => (r.id === reading.id ? { ...r, uploadStatus: "uploading" as const, uploadError: undefined } : r)),
    }));
    await new Promise((resolve) => setTimeout(resolve, UPLOAD_LATENCY_MS));
    const fail = !state.online || state.failMode !== "none";
    const error = !state.online
      ? "离线状态，上传暂存本机"
      : state.failMode === "500"
        ? "服务器 500，上传失败"
        : state.failMode === "offline"
          ? "服务端离线，上传暂存本机"
          : undefined;
    setState((s) => ({
      ...s,
      readings: s.readings.map((r) =>
        r.id === reading.id
          ? {
              ...r,
              uploadStatus: (fail ? "failed" : "uploaded") as Reading["uploadStatus"],
              uploadError: error,
            }
          : r
      ),
    }));
  }
}

function retryOutbox() {
  void flushOutbox();
}

function setOnline(online: boolean) {
  setState((s) => ({ ...s, online }));
  if (online) void flushOutbox();
}

function setFailMode(failMode: FailMode) {
  setState((s) => ({ ...s, failMode }));
}

// ---------- Hook ----------
export function useLedger() {
  const s = useSyncExternalStore(subscribe, getSnapshot);
  return {
    ...s,
    currentCert: currentCertOf(s),
    actions: {
      addReading,
      verifyReading,
      addCertificate,
      colleagueUpdate,
      createReport,
      issueReport,
      retryOutbox,
      setOnline,
      setFailMode,
    },
  };
}

// ---------- 展示工具 ----------
export function fmtDateTime(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function fmtDate(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function toLocalInputValue(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const TOLERANCE_CENTS_VALUE = TOLERANCE_CENTS;

// 页面载入后若在线，自动续传上次未完成的上传（已上传条目不会重传）
if (state.online) {
  void flushOutbox();
}
