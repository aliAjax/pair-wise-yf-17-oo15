import { useMemo, useState } from "react";
import type { AuditEvent, Reading, Report } from "../types";
import { fmtDateTime } from "../store";

interface Props {
  reports: Report[];
  readings: Reading[];
  audit: AuditEvent[];
  onCreate: (input: { title: string; venue: string; stop?: string }) => { ok: boolean };
  onIssue: (id: string) => void;
}

const STATUS_BADGE: Record<Report["status"], { cls: string; text: string }> = {
  draft: { cls: "badge-muted", text: "草稿" },
  issued: { cls: "badge-ok", text: "已签发" },
  review: { cls: "badge-warn", text: "退回复核" },
};

export default function ReportsPanel({ reports, readings, audit, onCreate, onIssue }: Props) {
  const [title, setTitle] = useState("");
  const [venue, setVenue] = useState("");
  const [stop, setStop] = useState("");
  const [detail, setDetail] = useState<Report | null>(null);

  const venues = useMemo(() => Array.from(new Set(readings.map((r) => r.venue))), [readings]);
  const stops = useMemo(() => Array.from(new Set(readings.map((r) => r.stop))), [readings]);

  const eligible = readings.filter(
    (r) => r.verificationStatus === "verified" && r.venue === venue && (!stop || r.stop === stop)
  );
  const pendingExcluded = readings.filter(
    (r) => r.verificationStatus === "pending" && r.venue === venue && (!stop || r.stop === stop)
  ).length;

  const readingOf = (id: string) => readings.find((r) => r.id === id);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !venue) return;
    const result = onCreate({ title, venue, stop: stop || undefined });
    if (result.ok) {
      setTitle("");
      setStop("");
    }
  };

  return (
    <div className="reports-grid">
      <section className="panel">
        <div className="heading">
          <div>
            <p>单次维护报告</p>
            <h2>新建报告</h2>
          </div>
        </div>
        <form className="field-grid" onSubmit={handleCreate}>
          <label>
            <span>报告标题</span>
            <input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如 St.Mary 秋季调音报告" />
          </label>
          <label>
            <span>场馆</span>
            <input list="venue-list" required value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="选择或输入场馆" />
            <datalist id="venue-list">
              {venues.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </label>
          <label>
            <span>音栓（选填）</span>
            <input list="stop-list-r" value={stop} onChange={(e) => setStop(e.target.value)} placeholder="全部音栓" />
            <datalist id="stop-list-r">
              {stops.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
          <label>
            <span>可纳入读数（仅已核验）</span>
            <input value={`${eligible.length} 条`} readOnly />
          </label>
          <div className="form-actions">
            <button className="primary" type="submit" disabled={eligible.length === 0}>
              生成草稿
            </button>
          </div>
        </form>
        {pendingExcluded > 0 && (
          <p className="form-hint form-hint-warn">
            另有 {pendingExcluded} 条待核验读数（资格失效 / 来源不明）不纳入本报告。
          </p>
        )}
        {eligible.length === 0 && venue && (
          <p className="form-hint form-hint-warn">当前条件下没有已核验读数，无法生成报告。</p>
        )}
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>报告台账</p>
            <h2>维护报告</h2>
          </div>
        </div>
        <div className="records">
          {reports.map((rep) => {
            const badge = STATUS_BADGE[rep.status];
            return (
              <article key={rep.id} className="report-row">
                <b className={`report-dot ${rep.status === "review" ? "dot-review" : ""}`}>
                  {rep.status === "review" ? "!" : rep.status === "issued" ? "✓" : "稿"}
                </b>
                <div className="report-body">
                  <h3>
                    {rep.reportNo} · {rep.title}
                  </h3>
                  <p>
                    {rep.venue}
                    {rep.stop ? ` · ${rep.stop}` : ""} · {rep.readingIds.length} 条已核验读数
                  </p>
                  <p className="sub">
                    创建 {fmtDateTime(rep.createdAt)}
                    {rep.issuedAt ? ` · 签发 ${fmtDateTime(rep.issuedAt)}` : ""}
                  </p>
                  {rep.status === "review" && <p className="review-reason">退回复核：{rep.reviewReason}</p>}
                  <div className="report-actions">
                    <span className={`badge ${badge.cls}`}>{badge.text}</span>
                    <button type="button" onClick={() => setDetail(rep)}>
                      查看读数
                    </button>
                    {rep.status === "draft" && (
                      <button className="primary" type="button" onClick={() => onIssue(rep.id)}>
                        签发报告
                      </button>
                    )}
                    {rep.status === "review" && (
                      <button className="primary" type="button" onClick={() => onIssue(rep.id)}>
                        复核通过并重新签发
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
          {reports.length === 0 && <div className="empty-box">还没有维护报告。</div>}
        </div>
      </section>

      <section className="panel audit-panel">
        <div className="heading">
          <div>
            <p>操作留痕</p>
            <h2>审计日志</h2>
          </div>
        </div>
        <div className="audit-list">
          {audit.map((e) => (
            <div key={e.id} className="audit-row">
              <span className="audit-time">{fmtDateTime(e.at)}</span>
              <span className={`badge badge-muted audit-type`}>{e.type}</span>
              <span className="audit-msg">{e.message}</span>
              <span className="sub audit-op">{e.operator}</span>
            </div>
          ))}
        </div>
      </section>

      {detail && (
        <div className="modal-backdrop" onClick={() => setDetail(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="heading">
              <div>
                <p>{detail.reportNo}</p>
                <h2>{detail.title} · 采用的读数</h2>
              </div>
              <button type="button" onClick={() => setDetail(null)}>
                关闭
              </button>
            </div>
            <table className="ledger">
              <thead>
                <tr>
                  <th>音管</th>
                  <th>音栓</th>
                  <th>音高</th>
                  <th>实测偏差</th>
                  <th>绑定证书</th>
                  <th>测量时间</th>
                </tr>
              </thead>
              <tbody>
                {detail.readingIds.map((id) => {
                  const r = readingOf(id);
                  if (!r) return null;
                  return (
                    <tr key={id}>
                      <td><b>{r.pipeNo}</b></td>
                      <td>{r.stop}</td>
                      <td>{r.pitch}</td>
                      <td>{r.deviation > 0 ? "+" : ""}{r.deviation} 音分</td>
                      <td>v{r.certVersion}（截止 {fmtDateTime(r.certExpiresAt)}）</td>
                      <td>{fmtDateTime(r.measuredAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
