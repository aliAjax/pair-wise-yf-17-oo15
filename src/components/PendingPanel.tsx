import type { Reading } from "../types";
import { fmtDateTime } from "../store";

interface Props {
  readings: Reading[];
  onVerify: (id: string) => void;
}

const SOURCE_LABEL: Record<string, string> = {
  "meter-sync": "音分仪同步",
  manual: "手动录入",
  import: "文件导入",
  unknown: "来源不明",
};

export default function PendingPanel({ readings, onVerify }: Props) {
  const pending = readings.filter((r) => r.verificationStatus === "pending");

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>待核验读数</p>
          <h2>资格失效 / 来源不明</h2>
        </div>
        <span className="badge badge-warn">{pending.length} 条待核验</span>
      </div>

      <p className="form-hint">
        以下读数因「测量时证书已过截止时间（资格失效）」或「来源不明」进入待核验；在人工核验通过前，维护报告不采用这些读数。
      </p>

      {pending.length === 0 ? (
        <div className="empty-box">没有待核验读数，所有读数均可用于报告。</div>
      ) : (
        <div className="records">
          {pending.map((r) => (
            <article key={r.id} className="pending-row">
              <b className="pending-index">!</b>
              <div className="pending-body">
                <h3>
                  {r.pipeNo} · {r.stop} · {r.pitch}
                </h3>
                <p>
                  {r.venue} · 实测 {r.deviation > 0 ? "+" : ""}
                  {r.deviation} 音分 · {r.temperature}℃ / {r.humidity}%RH · 来源 {SOURCE_LABEL[r.source] ?? r.source}
                </p>
                <p className="sub">
                  绑定证书 v{r.certVersion || "—"}（截止 {fmtDateTime(r.certExpiresAt)}）· 测量于 {fmtDateTime(r.measuredAt)}
                </p>
                <span className={`badge ${r.pendingReason === "expired-cert" ? "badge-out" : "badge-warn"}`}>
                  {r.pendingReason === "expired-cert" ? "资格失效：测量时证书已过截止时间" : "来源不明：无法确认数据来源"}
                </span>
              </div>
              <button className="primary" onClick={() => onVerify(r.id)}>
                核验通过
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
