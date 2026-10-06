import { useEffect, useState } from "react";
import "./styles.css";
import {
  CENT_LIMIT,
  STOP_ORDER,
  type AuditEntry,
  type Certificate,
  type ConflictInfo,
  type Reading,
  type ReedStatus,
  type Report,
  type StopType,
} from "./types";
import {
  applyCertificate,
  checkReading,
  fmtCents,
  isCertValid,
  latestCert,
  nowStamp,
  pendingReadings,
  reedLabel,
  reportInvalidatedReadings,
  summarizeStops,
  verifiedReadings,
} from "./state/logic";
import { seedAudit, seedCerts, seedReadings, seedReports } from "./state/seed";
import {
  clearPersisted,
  commitCertToServer,
  loadPersisted,
  persist,
  serverLedger,
  toPersisted,
} from "./state/store";

const project = {
  id: "hxyfront-62005",
  sourceNo: 7,
  port: 62005,
  title: "管风琴音管调音记录",
};

interface ReadingForm {
  venue: string;
  stop: string;
  stopType: StopType;
  pipeNo: string;
  pitch: string;
  cents: string;
  temperature: string;
  humidity: string;
  reed: ReedStatus;
  note: string;
  unknownSource: boolean;
}

const emptyReadingForm: ReadingForm = {
  venue: "",
  stop: "",
  stopType: "主音栓",
  pipeNo: "",
  pitch: "",
  cents: "0",
  temperature: "20",
  humidity: "45",
  reed: "normal",
  note: "",
  unknownSource: false,
};

const STATUS_LABEL: Record<string, string> = {
  valid: "有效",
  recalc: "待复测",
  pending: "待核验",
  excluded: "不采用",
  draft: "草稿",
  issued: "已签发",
  recalled: "退回复核",
  expired: "已失效",
};

const KIND_LABEL: Record<AuditEntry["kind"], string> = {
  cert: "证书",
  report: "报告",
  reading: "读数",
  system: "系统",
  conflict: "冲突",
};

function App() {
  const [initial] = useState(() => loadPersisted());
  const [certs, setCerts] = useState<Certificate[]>(initial?.certs ?? seedCerts);
  const [readings, setReadings] = useState<Reading[]>(initial?.readings ?? seedReadings);
  const [reports, setReports] = useState<Report[]>(initial?.reports ?? seedReports);
  const [audit, setAudit] = useState<AuditEntry[]>(initial?.audit ?? seedAudit);
  const [pendingCert, setPendingCert] = useState<Certificate | null>(initial?.pendingCert ?? null);
  const [seq, setSeq] = useState<number>(initial?.seq ?? 2001);

  const [serverVersion, setServerVersion] = useState(() => {
    const maxV = Math.max(2, ...(initial?.certs ?? seedCerts).map((c) => c.version));
    serverLedger.certVersion = maxV;
    return maxV;
  });
  const [saveError, setSaveError] = useState<string | null>(
    initial?.pendingCert
      ? `检测到上次证书 v${initial.pendingCert.version} 提交未完成，已核验内容已保留，可续传。`
      : null
  );
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);
  const [conflictCert, setConflictCert] = useState<Certificate | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [failOnce, setFailOnce] = useState(false);

  const [stopFilter, setStopFilter] = useState<StopType | "全部">("全部");
  const [form, setForm] = useState<ReadingForm>(emptyReadingForm);
  const [certForm, setCertForm] = useState({ instrument: "", serial: "", validUntil: "", note: "" });

  /* 任何状态变化都落本地账本：保存失败时已核验内容不丢，恢复后可续传 */
  useEffect(() => {
    persist(toPersisted({ certs, readings, reports, audit, seq }, pendingCert));
  }, [certs, readings, reports, audit, seq, pendingCert]);

  const currentCert = latestCert(certs);
  const currentValid = isCertValid(currentCert);
  const verified = verifiedReadings(readings, certs);
  const pending = pendingReadings(readings, certs);
  const summaries = summarizeStops(readings, certs);
  const venues = Array.from(new Set(readings.map((r) => r.venue)));

  const overLimitCount = verified.filter((r) => Math.abs(r.cents) > CENT_LIMIT).length;
  const avgTemp = verified.length
    ? (verified.reduce((s, r) => s + r.temperature, 0) / verified.length).toFixed(1)
    : "—";
  const avgHum = verified.length
    ? Math.round(verified.reduce((s, r) => s + r.humidity, 0) / verified.length)
    : "—";

  const tableRows = verified
    .filter((r) => stopFilter === "全部" || r.stopType === stopFilter)
    .sort((a, b) => b.measuredAt.localeCompare(a.measuredAt));

  const pushAudit = (kind: AuditEntry["kind"], text: string) => {
    setAudit((prev) => [{ id: (prev[0]?.id ?? 0) + 1, at: nowStamp(), kind, text }, ...prev]);
  };

  const pushAuditBatch = (entries: { kind: AuditEntry["kind"]; text: string }[]) => {
    setAudit((prev) => {
      let id = prev[0]?.id ?? 0;
      const stamped = nowStamp();
      const rows = entries.map((e) => ({ id: ++id, at: stamped, kind: e.kind, text: e.text }));
      return [...rows, ...prev];
    });
  };

  /* ---------- 证书更新：提交 / 冲突 / 失败续传 ---------- */

  const applyCert = (cert: Certificate) => {
    const result = applyCertificate(certs, reports, cert, nowStamp());
    setCerts(result.certs);
    setReports(result.reports);
    pushAuditBatch(result.entries);
    setPendingCert(null);
    setSaveError(null);
    setConflict(null);
    setConflictCert(null);
    setServerVersion(serverLedger.certVersion);
  };

  const attemptCommit = async (cert: Certificate, baseVersion: number, shouldFail: boolean) => {
    setSubmitting(true);
    const result = await commitCertToServer(cert, baseVersion, shouldFail);
    setSubmitting(false);
    if (result.ok) {
      applyCert(cert);
      return;
    }
    if (result.status === 409) {
      setConflict({
        theirVersion: result.version ?? baseVersion + 1,
        theirInstrument: result.instrument ?? "另一会话的音分仪",
        myInstrument: cert.instrument,
      });
      setConflictCert(cert);
      pushAudit(
        "conflict",
        `提交证书 v${cert.version} 被拒：服务端已存在 v${result.version}（版本冲突），本地草稿保留。`
      );
      return;
    }
    setPendingCert(cert);
    setSaveError(
      `证书 v${cert.version}（${cert.instrument}）保存失败：网络或存储不可用。已核验内容保留在本地，恢复后只需续传本次提交。`
    );
    pushAudit("system", `证书 v${cert.version} 保存失败，已核验数据保留在本地，等待恢复续传。`);
  };

  const submitCertUpdate = async () => {
    if (submitting) return;
    const base = latestCert(certs)?.version ?? 0;
    const cert: Certificate = {
      id: `CERT-2026-${String(seq).slice(-3)}`,
      version: base + 1,
      instrument: certForm.instrument.trim() || "未命名音分仪",
      serial: certForm.serial.trim() || "—",
      issuedAt: nowStamp().slice(0, 10),
      validUntil: certForm.validUntil || "2027-10-01",
      status: "valid",
      note: certForm.note.trim() || "换机后新校准证书入库。",
    };
    setSeq(seq + 1);
    const shouldFail = failOnce;
    if (failOnce) setFailOnce(false);
    await attemptCommit(cert, base, shouldFail);
  };

  const resumePendingCert = async () => {
    if (!pendingCert || submitting) return;
    const base = latestCert(certs)?.version ?? 0;
    await attemptCommit(pendingCert, base, false);
  };

  const discardPendingCert = () => {
    if (!pendingCert) return;
    pushAudit("system", `未完成的证书 v${pendingCert.version} 提交已放弃，已核验内容不受影响。`);
    setPendingCert(null);
    setSaveError(null);
  };

  const resolveConflict = async () => {
    if (!conflict || !conflictCert || submitting) return;
    setSubmitting(true);
    const stamped = nowStamp();
    const theirCert: Certificate = {
      id: `CERT-2026-S${conflict.theirVersion}`,
      version: conflict.theirVersion,
      instrument: conflict.theirInstrument,
      serial: "—",
      issuedAt: stamped.slice(0, 10),
      validUntil: "2027-09-30",
      status: "valid",
      note: "另一会话提交的证书更新，冲突后同步入库。",
    };
    const myCert: Certificate = {
      ...conflictCert,
      id: `${conflictCert.id}-R`,
      version: conflict.theirVersion + 1,
    };
    const result = await commitCertToServer(myCert, conflict.theirVersion, false);
    setSubmitting(false);
    if (!result.ok) {
      setPendingCert(myCert);
      setSaveError(`冲突解决后重传 v${myCert.version} 仍失败，草稿已保留，可稍后续传。`);
      return;
    }
    const step1 = applyCertificate(certs, reports, theirCert, stamped);
    const step2 = applyCertificate(step1.certs, step1.reports, myCert, stamped);
    setCerts(step2.certs);
    setReports(step2.reports);
    pushAuditBatch([
      {
        kind: "conflict",
        text: `版本冲突已解决：同步对方 v${theirCert.version} 后，本地更新重新编号为 v${myCert.version} 提交成功。`,
      },
      ...step1.entries,
      ...step2.entries,
    ]);
    setConflict(null);
    setConflictCert(null);
    setPendingCert(null);
    setSaveError(null);
    setServerVersion(serverLedger.certVersion);
  };

  const abandonConflict = () => {
    if (!conflictCert) return;
    pushAudit("conflict", `版本冲突后放弃本地证书 v${conflictCert.version} 更新，未写入账本。`);
    setConflict(null);
    setConflictCert(null);
  };

  const simulateOtherCommit = () => {
    serverLedger.certVersion += 1;
    setServerVersion(serverLedger.certVersion);
    pushAudit(
      "conflict",
      `另一会话已提交证书 v${serverLedger.certVersion}（模拟并发），本地再提交将触发版本冲突。`
    );
  };

  /* ---------- 读数登记 ---------- */

  const addReading = () => {
    const cert = latestCert(certs);
    const reading: Reading = {
      id: `R-${seq}`,
      venue: form.venue.trim() || "未命名场馆",
      stop: form.stop.trim() || "未命名音栓",
      stopType: form.stopType,
      pipeNo: form.pipeNo.trim() || "—",
      pitch: form.pitch.trim() || form.pipeNo.trim() || "—",
      cents: Number(form.cents) || 0,
      temperature: Number(form.temperature) || 0,
      humidity: Number(form.humidity) || 0,
      reed: form.reed,
      note: form.note.trim() || "—",
      measuredAt: nowStamp(),
      certVersion: cert?.version ?? 0,
      source: form.unknownSource ? "unknown" : "calibrated",
    };
    setSeq(seq + 1);
    setReadings([reading, ...readings]);
    const check = checkReading(reading, certs);
    pushAudit(
      "reading",
      check.usable
        ? `${reading.id} 已登记并核验通过（绑定证书 v${reading.certVersion}，截止 ${cert?.validUntil}）。`
        : `${reading.id} 已登记但进入待核验：${check.reasons.join("；")}。报告不采用。`
    );
    setForm(emptyReadingForm);
  };

  /* ---------- 报告 ---------- */

  const createReport = (venue: string) => {
    if (!currentCert || !currentValid) return;
    const usable = verified.filter((r) => r.venue === venue);
    const excluded = pending.filter((p) => p.reading.venue === venue).map((p) => p.reading.id);
    const stamped = nowStamp();
    const report: Report = {
      id: `RPT-${seq}`,
      title: `${venue} · 单次维护报告`,
      venue,
      certVersion: currentCert.version,
      readingIds: usable.map((r) => r.id),
      excludedIds: excluded,
      status: "draft",
      createdAt: stamped,
      issuedAt: null,
      history: [
        `${stamped} 创建草稿（绑定证书 v${currentCert.version}，纳入 ${usable.length} 条已核验读数，${excluded.length} 条待核验不采用）`,
      ],
    };
    setSeq(seq + 1);
    setReports([report, ...reports]);
    pushAudit(
      "report",
      `${report.id} 创建草稿（证书 v${currentCert.version}），待核验读数不纳入报告。`
    );
  };

  const issueReport = (report: Report) => {
    const stamped = nowStamp();
    setReports(
      reports.map((r) =>
        r.id === report.id
          ? {
              ...r,
              status: "issued",
              issuedAt: stamped,
              history: [...r.history, `${stamped} 签发，纳入 ${r.readingIds.length} 条已核验读数`],
            }
          : r
      )
    );
    pushAudit("report", `${report.id} 已签发（绑定证书 v${report.certVersion}）。`);
  };

  const confirmReview = (report: Report) => {
    const stamped = nowStamp();
    setReports(
      reports.map((r) =>
        r.id === report.id
          ? { ...r, status: "draft", history: [...r.history, `${stamped} 复核确认，退回草稿重新整理`] }
          : r
      )
    );
    pushAudit("report", `${report.id} 复核确认，退回草稿。`);
  };

  const resetDemo = () => {
    clearPersisted();
    serverLedger.certVersion = 2;
    setCerts(seedCerts);
    setReadings(seedReadings);
    setReports(seedReports);
    setAudit(seedAudit);
    setPendingCert(null);
    setSeq(2001);
    setServerVersion(2);
    setSaveError(null);
    setConflict(null);
    setConflictCert(null);
  };

  /* ---------- 渲染 ---------- */

  return (
    <main className="app">
      <section className="hero">
        <p>
          {project.id} · 源提示词{project.sourceNo} · Port {project.port}
        </p>
        <h1>{project.title}</h1>
        <span>
          可追溯的调音账：每条读数绑定校准证书版本与截止时间，证书失效或来源不明的读数进入待核验、报告不采用；
          证书更新后音管结论立即重算，已签发报告退回复核并留痕。
        </span>
        <div className="hero-badges">
          {currentCert ? (
            <span className={`badge ${currentValid ? "ok" : "bad"}`}>
              当前证书 v{currentCert.version} · {currentCert.instrument} ·{" "}
              {currentValid ? `有效至 ${currentCert.validUntil}` : "已失效"}
            </span>
          ) : (
            <span className="badge bad">无有效证书</span>
          )}
          <span className="badge neutral">服务端证书版本 v{serverVersion}</span>
          <span className={`badge ${pending.length > 0 ? "warn" : "ok"}`}>
            待核验 {pending.length} 条
          </span>
        </div>
      </section>

      {saveError && pendingCert && (
        <section className="banner warn">
          <div>
            <strong>保存失败，待续传</strong>
            <p>{saveError}</p>
          </div>
          <div className="banner-actions">
            <button className="primary" disabled={submitting} onClick={resumePendingCert}>
              {submitting ? "提交中…" : `恢复后续传 v${pendingCert.version}`}
            </button>
            <button onClick={discardPendingCert}>放弃本次提交</button>
          </div>
        </section>
      )}

      {conflict && (
        <section className="banner danger">
          <div>
            <strong>版本冲突</strong>
            <p>
              你提交的证书（{conflict.myInstrument}）基于旧版本，另一会话已抢先提交 v
              {conflict.theirVersion}（{conflict.theirInstrument}）。后到提交被拒绝，本地草稿已保留。
            </p>
          </div>
          <div className="banner-actions">
            <button className="primary" disabled={submitting} onClick={resolveConflict}>
              {submitting ? "同步中…" : `同步 v${conflict.theirVersion} 并重新提交`}
            </button>
            <button onClick={abandonConflict}>放弃本次更新</button>
          </div>
        </section>
      )}

      <section className="metrics">
        <article>
          <small>音栓数量</small>
          <strong>{summaries.length}</strong>
        </article>
        <article>
          <small>偏差超限（±{CENT_LIMIT} cent）</small>
          <strong>{overLimitCount}</strong>
        </article>
        <article>
          <small>平均温度</small>
          <strong>{avgTemp === "—" ? "—" : `${avgTemp}°C`}</strong>
        </article>
        <article>
          <small>平均湿度</small>
          <strong>{avgHum === "—" ? "—" : `${avgHum}%`}</strong>
        </article>
      </section>

      <section className="workspace">
        <aside className="panel">
          <h2>音栓筛选</h2>
          <div className="chips">
            {(["全部", ...STOP_ORDER] as const).map((item) => (
              <button
                key={item}
                className={stopFilter === item ? "chip-active" : ""}
                onClick={() => setStopFilter(item)}
              >
                {item}
              </button>
            ))}
          </div>

          <h2 className="mt">校准证书</h2>
          <div className="cert-list">
            {[...certs]
              .sort((a, b) => b.version - a.version)
              .map((c) => (
                <div key={c.id} className={`cert-card ${c.status}`}>
                  <div className="cert-head">
                    <strong>
                      v{c.version} · {c.instrument}
                    </strong>
                    <span className={`badge ${c.status === "valid" ? "ok" : "bad"}`}>
                      {STATUS_LABEL[c.status]}
                    </span>
                  </div>
                  <p>
                    {c.id} · 编号 {c.serial}
                    <br />
                    签发 {c.issuedAt} · 截止 {c.validUntil}
                    <br />
                    {c.note}
                  </p>
                </div>
              ))}
          </div>
        </aside>

        <section className="panel form-panel">
          <div className="heading">
            <div>
              <p>读数绑定证书 v{currentCert?.version ?? "—"}</p>
              <h2>新增调音读数</h2>
            </div>
            <button className="primary" onClick={addReading}>
              登记读数
            </button>
          </div>
          <div className="field-grid">
            <label>
              <span>场馆名称</span>
              <input
                placeholder="如 St.Mary 大教堂"
                value={form.venue}
                onChange={(e) => setForm({ ...form, venue: e.target.value })}
              />
            </label>
            <label>
              <span>音栓</span>
              <input
                placeholder="如 Trumpet 8'"
                value={form.stop}
                onChange={(e) => setForm({ ...form, stop: e.target.value })}
              />
            </label>
            <label>
              <span>音栓类型</span>
              <select
                value={form.stopType}
                onChange={(e) => setForm({ ...form, stopType: e.target.value as StopType })}
              >
                {STOP_ORDER.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label>
              <span>音管编号</span>
              <input
                placeholder="如 C#4"
                value={form.pipeNo}
                onChange={(e) => setForm({ ...form, pipeNo: e.target.value })}
              />
            </label>
            <label>
              <span>音高</span>
              <input
                placeholder="如 C#4"
                value={form.pitch}
                onChange={(e) => setForm({ ...form, pitch: e.target.value })}
              />
            </label>
            <label>
              <span>音分偏差（cent）</span>
              <input
                type="number"
                value={form.cents}
                onChange={(e) => setForm({ ...form, cents: e.target.value })}
              />
            </label>
            <label>
              <span>温度（°C）</span>
              <input
                type="number"
                step="0.1"
                value={form.temperature}
                onChange={(e) => setForm({ ...form, temperature: e.target.value })}
              />
            </label>
            <label>
              <span>湿度（%）</span>
              <input
                type="number"
                value={form.humidity}
                onChange={(e) => setForm({ ...form, humidity: e.target.value })}
              />
            </label>
            <label>
              <span>簧片状态</span>
              <select
                value={form.reed}
                onChange={(e) => setForm({ ...form, reed: e.target.value as ReedStatus })}
              >
                <option value="normal">正常</option>
                <option value="watch">观察</option>
                <option value="abnormal">异常</option>
              </select>
            </label>
            <label>
              <span>维修备注</span>
              <input
                placeholder="填写维修备注"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </label>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={form.unknownSource}
              onChange={(e) => setForm({ ...form, unknownSource: e.target.checked })}
            />
            <span>来源不明（无校准仪器编号，登记后直接进入待核验，报告不采用）</span>
          </label>
          {!currentValid && (
            <p className="hint bad-text">
              当前无有效证书，新读数登记后将因证书资格失效进入待核验。
            </p>
          )}
        </section>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>仪器更新 · 乐观并发校验</p>
            <h2>提交新校准证书</h2>
          </div>
          <button className="primary" disabled={submitting} onClick={submitCertUpdate}>
            {submitting ? "提交中…" : `提交证书 v${(currentCert?.version ?? 0) + 1}`}
          </button>
        </div>
        <div className="field-grid cols-4">
          <label>
            <span>仪器名称</span>
            <input
              placeholder="如 Peterson StroboPlus HDC"
              value={certForm.instrument}
              onChange={(e) => setCertForm({ ...certForm, instrument: e.target.value })}
            />
          </label>
          <label>
            <span>仪器编号</span>
            <input
              placeholder="如 SPHDC-1024"
              value={certForm.serial}
              onChange={(e) => setCertForm({ ...certForm, serial: e.target.value })}
            />
          </label>
          <label>
            <span>有效期至</span>
            <input
              type="date"
              value={certForm.validUntil}
              onChange={(e) => setCertForm({ ...certForm, validUntil: e.target.value })}
            />
          </label>
          <label>
            <span>备注</span>
            <input
              placeholder="校准机构、溯源信息等"
              value={certForm.note}
              onChange={(e) => setCertForm({ ...certForm, note: e.target.value })}
            />
          </label>
        </div>
        <div className="sim-row">
          <label className="check-row">
            <input
              type="checkbox"
              checked={failOnce}
              onChange={(e) => setFailOnce(e.target.checked)}
            />
            <span>模拟本次保存失败（验证失败保留与恢复续传）</span>
          </label>
          <button onClick={simulateOtherCommit}>模拟同事并发提交（服务端版本 +1）</button>
          <button onClick={resetDemo}>重置演示数据</button>
        </div>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>基于证书 v{currentCert?.version ?? "—"} 已核验读数实时重算</p>
            <h2>音栓列表 · 音管结论</h2>
          </div>
        </div>
        {summaries.length === 0 ? (
          <p className="hint">暂无已核验读数，音管结论等待有效证书下的测量数据。</p>
        ) : (
          <div className="stop-grid">
            {summaries.map((s) => (
              <article key={`${s.venue}-${s.stop}`} className={`stop-card ${s.status}`}>
                <div className="cert-head">
                  <strong>{s.stop}</strong>
                  <span className={`badge ${s.status === "valid" ? "ok" : "warn"}`}>
                    {STATUS_LABEL[s.status]}
                  </span>
                </div>
                <p className="stop-meta">
                  {s.venue} · {s.stopType} · {s.total} 条读数
                </p>
                <div className="stop-nums">
                  <span>
                    平均偏差 <b>{fmtCents(s.avgCents)}</b>
                  </span>
                  <span>
                    最大 |偏差| <b>{s.maxAbsCents} cent</b>
                  </span>
                  <span>
                    超限 <b>{s.overLimit}</b>
                  </span>
                  <span>
                    簧片异常 <b>{s.reedAbnormal}</b>
                  </span>
                </div>
                <p className="stop-reason">{s.reasons.join("；")}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>调音偏差表 · 温湿度记录 · 异常音管标记</p>
            <h2>已核验读数（{tableRows.length}）</h2>
          </div>
        </div>
        {tableRows.length === 0 ? (
          <p className="hint">当前筛选下没有已核验读数。</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>编号</th>
                  <th>场馆</th>
                  <th>音栓</th>
                  <th>音管</th>
                  <th>音高</th>
                  <th>偏差</th>
                  <th>温度</th>
                  <th>湿度</th>
                  <th>簧片</th>
                  <th>证书</th>
                  <th>测量时间</th>
                  <th>备注</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((r) => (
                  <tr key={r.id} className={Math.abs(r.cents) > CENT_LIMIT ? "row-over" : ""}>
                    <td>{r.id}</td>
                    <td>{r.venue}</td>
                    <td>{r.stop}</td>
                    <td>{r.pipeNo}</td>
                    <td>{r.pitch}</td>
                    <td className={Math.abs(r.cents) > CENT_LIMIT ? "bad-text" : ""}>
                      {fmtCents(r.cents)}
                    </td>
                    <td>{r.temperature}°C</td>
                    <td>{r.humidity}%</td>
                    <td>
                      <span className={`badge ${r.reed === "normal" ? "ok" : r.reed === "watch" ? "warn" : "bad"}`}>
                        {reedLabel(r.reed)}
                      </span>
                    </td>
                    <td>v{r.certVersion}</td>
                    <td>{r.measuredAt}</td>
                    <td>{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>资格失效或来源不明 · 报告不采用</p>
            <h2>待核验队列（{pending.length}）</h2>
          </div>
        </div>
        {pending.length === 0 ? (
          <p className="hint">没有待核验读数。</p>
        ) : (
          <div className="records">
            {pending.map(({ reading, reasons }, i) => (
              <article key={reading.id}>
                <b>{String(i + 1).padStart(2, "0")}</b>
                <div>
                  <h3>
                    {reading.id} · {reading.venue} · {reading.stop} {reading.pipeNo}
                  </h3>
                  <p>
                    {fmtCents(reading.cents)} · {reading.temperature}°C · {reading.humidity}% · 簧片
                    {reedLabel(reading.reed)} · 绑定证书 v{reading.certVersion} ·{" "}
                    {reading.measuredAt}
                  </p>
                  <p className="bad-text">{reasons.join("；")}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>单次维护报告 · 仅采用已核验读数</p>
            <h2>维护报告</h2>
          </div>
          <div className="report-new">
            {venues.map((v) => (
              <button
                key={v}
                disabled={!currentValid}
                title={currentValid ? `为 ${v} 生成报告草稿` : "无有效证书，不能生成报告"}
                onClick={() => createReport(v)}
              >
                + {v}报告
              </button>
            ))}
          </div>
        </div>
        {!currentValid && <p className="hint bad-text">当前无有效证书，不能生成或签发报告。</p>}
        <div className="records">
          {reports.map((r) => {
            const invalidated = reportInvalidatedReadings(r, readings, certs);
            const issuable =
              r.status === "draft" && currentValid && invalidated.length === 0 && r.readingIds.length > 0;
            return (
              <article key={r.id}>
                <b>{r.id.slice(-2)}</b>
                <div>
                  <h3>
                    {r.title}
                    <span className={`badge status-${r.status}`}>{STATUS_LABEL[r.status]}</span>
                  </h3>
                  <p>
                    {r.id} · 绑定证书 v{r.certVersion} · 纳入 {r.readingIds.length} 条 · 排除待核验{" "}
                    {r.excludedIds.length} 条 · 创建于 {r.createdAt}
                    {r.issuedAt ? ` · 签发于 ${r.issuedAt}` : ""}
                  </p>
                  {invalidated.length > 0 && r.status !== "recalled" && (
                    <p className="bad-text">
                      {invalidated.length} 条读数已失去核验资格（{invalidated.map((x) => x.id).join("、")}
                      ），签发前需重新整理。
                    </p>
                  )}
                  <div className="report-actions">
                    {r.status === "draft" && (
                      <button
                        className="primary"
                        disabled={!issuable}
                        title={issuable ? "签发报告" : "存在失格读数或无有效证书，不能签发"}
                        onClick={() => issueReport(r)}
                      >
                        签发
                      </button>
                    )}
                    {r.status === "recalled" && (
                      <button className="primary" onClick={() => confirmReview(r)}>
                        复核确认，退回草稿
                      </button>
                    )}
                  </div>
                  <details className="history">
                    <summary>留痕（{r.history.length}）</summary>
                    <ul>
                      {r.history.map((h, i) => (
                        <li key={i}>{h}</li>
                      ))}
                    </ul>
                  </details>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>操作留痕</p>
            <h2>审计日志</h2>
          </div>
        </div>
        <div className="audit-list">
          {audit.map((a) => (
            <div key={a.id} className="audit-row">
              <span className={`badge kind-${a.kind}`}>{KIND_LABEL[a.kind]}</span>
              <span className="audit-time">{a.at}</span>
              <span>{a.text}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

export default App;
