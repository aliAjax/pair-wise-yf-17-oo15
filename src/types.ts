// 管风琴调音台账 · 领域模型
// 所有读数必须绑定音分仪校准证书的某个版本与截止时间，以保证可追溯。

export type ReedStatus = "normal" | "abnormal";
export type VerificationStatus = "verified" | "pending";
export type PendingReason = "expired-cert" | "unknown-source";
export type UploadStatus = "pending" | "uploading" | "uploaded" | "failed";
export type ReportStatus = "draft" | "issued" | "review";
export type Conclusion = "ok" | "out";
export type FailMode = "none" | "offline" | "500";

/** 音分仪校准证书（仪器更新即新增一个版本） */
export interface Certificate {
  id: string;
  certNo: string;
  version: number;
  instrumentModel: string;
  calibratedAt: string; // ISO 校准时间
  expiresAt: string; // ISO 截止时间
  correctionCents: number; // 证书修正值（音分）
  issuedBy: string;
  note?: string;
  createdAt: string;
}

/** 音管读数：绑定证书版本与截止时间 */
export interface Reading {
  id: string;
  venue: string; // 场馆名称
  stop: string; // 音栓
  pipeNo: string; // 音管编号
  pitch: string; // 音高，如 C#4
  deviation: number; // 实测音分偏差
  correctedDeviation: number; // 计入证书修正值后的偏差
  conclusion: Conclusion; // 合格 / 超限
  temperature: number; // 温度 ℃
  humidity: number; // 湿度 %RH
  reedStatus: ReedStatus;
  reedNote?: string; // 簧片异常备注
  maintenanceNote?: string; // 维修备注
  measuredAt: string; // 测量时间
  source: string; // 来源：meter-sync / manual / import / unknown
  // —— 证书绑定（追溯关键）——
  certId: string;
  certVersion: number;
  certExpiresAt: string;
  // —— 核验状态 ——
  verificationStatus: VerificationStatus;
  pendingReason: PendingReason | null;
  verifiedAt?: string;
  recalculatedAt?: string; // 最近一次随证书更新重算的时间
  // —— 上传队列（发件箱）——
  uploadStatus: UploadStatus;
  uploadError?: string;
  createdAt: string;
}

/** 单次维护报告：只采用已核验读数 */
export interface Report {
  id: string;
  reportNo: string;
  title: string;
  venue: string;
  stop?: string;
  readingIds: string[]; // 创建时快照，仅含已核验读数
  status: ReportStatus;
  createdAt: string;
  issuedAt?: string;
  reviewReason?: string; // 退回复核原因（留痕）
}

/** 审计留痕 */
export interface AuditEvent {
  id: string;
  at: string;
  type: string;
  message: string;
  operator: string;
  refId?: string;
}

export interface ReadingInput {
  venue: string;
  stop: string;
  pipeNo: string;
  pitch: string;
  deviation: number;
  temperature: number;
  humidity: number;
  reedStatus: ReedStatus;
  reedNote?: string;
  maintenanceNote?: string;
  source: string;
  measuredAt: string;
}

export interface CertificateInput {
  baseVersion?: number; // 提交者基于的版本（乐观并发控制）
  certNo: string;
  instrumentModel: string;
  correctionCents: number;
  calibratedAt: string;
  expiresAt: string;
  issuedBy: string;
  note?: string;
}

export interface ConflictResult {
  ok: false;
  conflict: true;
  currentVersion: number;
}
export interface OkResult<T> {
  ok: true;
  data: T;
}
export type ActionResult<T> = OkResult<T> | ConflictResult;
