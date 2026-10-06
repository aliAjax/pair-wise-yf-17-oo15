import {
  CENT_LIMIT,
  type AuditEntry,
  type Certificate,
  type Reading,
  type Report,
  type StopStatus,
  type StopSummary,
} from "../types";

export function latestCert(certs: Certificate[]): Certificate | null {
  if (certs.length === 0) return null;
  return certs.reduce((a, b) => (a.version >= b.version ? a : b));
}

export function certByVersion(
  certs: Certificate[],
  version: number
): Certificate | undefined {
  return certs.find((c) => c.version === version);
}

export function isCertValid(cert: Certificate | null | undefined): boolean {
  return !!cert && cert.status === "valid";
}

export interface ReadingCheck {
  usable: boolean;
  reasons: string[];
}

/**
 * 读数是否可用于结论与报告：
 * 1. 来源必须可溯（calibrated）；
 * 2. 绑定的证书版本必须存在；
 * 3. 该证书当前必须有效（未过期）。
 */
export function checkReading(reading: Reading, certs: Certificate[]): ReadingCheck {
  const reasons: string[] = [];
  if (reading.source !== "calibrated") {
    reasons.push("来源不明：缺少校准仪器信息");
  }
  const cert = certByVersion(certs, reading.certVersion);
  if (!cert) {
    reasons.push(`绑定的证书 v${reading.certVersion} 不存在`);
  } else if (cert.status !== "valid") {
    reasons.push(`证书 v${cert.version} 已失效（有效期至 ${cert.validUntil}）`);
  }
  return { usable: reasons.length === 0, reasons };
}

export function verifiedReadings(readings: Reading[], certs: Certificate[]): Reading[] {
  return readings.filter((r) => checkReading(r, certs).usable);
}

export function pendingReadings(
  readings: Reading[],
  certs: Certificate[]
): { reading: Reading; reasons: string[] }[] {
  return readings
    .map((r) => ({ reading: r, ...checkReading(r, certs) }))
    .filter((x) => !x.usable)
    .map((x) => ({ reading: x.reading, reasons: x.reasons }));
}

export function reedLabel(reed: Reading["reed"]): string {
  return reed === "normal" ? "正常" : reed === "watch" ? "观察" : "异常";
}

export function summarizeStops(readings: Reading[], certs: Certificate[]): StopSummary[] {
  const usable = verifiedReadings(readings, certs);
  const map = new Map<string, Reading[]>();
  for (const r of usable) {
    const key = `${r.venue}::${r.stop}`;
    const list = map.get(key) ?? [];
    list.push(r);
    map.set(key, list);
  }
  const summaries: StopSummary[] = [];
  for (const [key, list] of map) {
    const [venue, stop] = key.split("::");
    const avg = list.reduce((s, r) => s + r.cents, 0) / list.length;
    const maxAbs = Math.max(...list.map((r) => Math.abs(r.cents)));
    const over = list.filter((r) => Math.abs(r.cents) > CENT_LIMIT).length;
    const reedAbn = list.filter((r) => r.reed === "abnormal").length;
    const reasons: string[] = [];
    let status: StopStatus = "valid";
    if (reedAbn > 0) {
      status = "pending";
      reasons.push(`${reedAbn} 根音管簧片异常，需拆检后复测`);
    }
    if (over > 0) {
      if (status === "valid") status = "recalc";
      reasons.push(`${over} 条读数偏差超过 ±${CENT_LIMIT} cent`);
    }
    if (reasons.length === 0) reasons.push("全部读数在容差内，证书有效");
    summaries.push({
      stop,
      stopType: list[0].stopType,
      venue,
      total: list.length,
      avgCents: Math.round(avg * 10) / 10,
      maxAbsCents: maxAbs,
      overLimit: over,
      reedAbnormal: reedAbn,
      status,
      reasons,
    });
  }
  return summaries.sort((a, b) => a.venue.localeCompare(b.venue) || a.stop.localeCompare(b.stop));
}

/** 报告可纳入的读数：已核验且属于报告绑定的证书版本。 */
export function reportEligibleReadings(report: Report, readings: Reading[], certs: Certificate[]): Reading[] {
  return readings.filter(
    (r) => report.readingIds.includes(r.id) && checkReading(r, certs).usable && r.certVersion === report.certVersion
  );
}

export function reportInvalidatedReadings(report: Report, readings: Reading[], certs: Certificate[]): Reading[] {
  return readings.filter(
    (r) => report.readingIds.includes(r.id) && (!checkReading(r, certs).usable || r.certVersion !== report.certVersion)
  );
}

export function fmtCents(cents: number): string {
  const sign = cents > 0 ? "+" : "";
  return `${sign}${cents} cent`;
}

export function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export interface CertApplyResult {
  certs: Certificate[];
  reports: Report[];
  entries: { kind: AuditEntry["kind"]; text: string }[];
}

/**
 * 证书更新落账：旧有效证书立即失效，其名下读数因资格失效转入待核验（由
 * checkReading 派生），音管结论随已核验集合立即重算；绑定旧证书的已签发
 * 报告退回复核并写入历史留痕。
 */
export function applyCertificate(
  certs: Certificate[],
  reports: Report[],
  cert: Certificate,
  stamped: string
): CertApplyResult {
  const oldValid = certs.find((c) => c.status === "valid");
  const nextCerts: Certificate[] = [
    ...certs.map((c) =>
      c.status === "valid"
        ? { ...c, status: "expired" as const, note: `${c.note}（被 v${cert.version} 取代）` }
        : c
    ),
    cert,
  ];
  const entries: CertApplyResult["entries"] = [
    {
      kind: "cert",
      text: `证书更新至 v${cert.version}（${cert.instrument}，编号 ${cert.serial}），有效期至 ${cert.validUntil}。`,
    },
  ];
  if (oldValid) {
    entries.push({
      kind: "system",
      text: `证书 v${oldValid.version} 失效，名下读数资格失效转入待核验，相关音管结论已立即重算。`,
    });
  }
  const nextReports = reports.map((r) => {
    if (r.status === "issued" && oldValid && r.certVersion === oldValid.version) {
      entries.push({
        kind: "report",
        text: `${r.id} 已签发报告绑定证书 v${r.certVersion}，资格失效，退回复核。`,
      });
      return {
        ...r,
        status: "recalled" as const,
        history: [
          ...r.history,
          `${stamped} 证书更新至 v${cert.version}，原绑定证书 v${r.certVersion} 失效，报告退回复核`,
        ],
      };
    }
    return r;
  });
  return { certs: nextCerts, reports: nextReports, entries };
}
