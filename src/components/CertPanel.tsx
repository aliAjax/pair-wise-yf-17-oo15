import { useState } from "react";
import type { ActionResult, Certificate, CertificateInput } from "../types";
import { fmtDate, fmtDateTime, toLocalInputValue } from "../store";

interface Props {
  certificates: Certificate[];
  currentCert?: Certificate;
  onSubmit: (input: CertificateInput) => ActionResult<{ version: number }>;
  onColleague: () => void;
}

export default function CertPanel({ certificates, currentCert, onSubmit, onColleague }: Props) {
  const [baseVersion, setBaseVersion] = useState(currentCert?.version ?? 0);
  const [conflict, setConflict] = useState<number | null>(null);
  const [form, setForm] = useState({
    certNo: "",
    instrumentModel: currentCert?.instrumentModel ?? "Fluke 805 音分仪",
    correctionCents: "0.8",
    calibratedAt: toLocalInputValue(),
    expiresAt: toLocalInputValue(new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString()),
    issuedBy: "省计量院",
    note: "",
  });

  // 当前版本被其他提交者抬高后，用户提交时会撞冲突；表单保留其输入
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = onSubmit({
      baseVersion,
      certNo: form.certNo,
      instrumentModel: form.instrumentModel,
      correctionCents: Number(form.correctionCents),
      calibratedAt: form.calibratedAt ? new Date(form.calibratedAt).toISOString() : new Date().toISOString(),
      expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : new Date().toISOString(),
      issuedBy: form.issuedBy,
      note: form.note,
    });
    if (!result.ok && result.conflict) {
      setConflict(result.currentVersion ?? null);
    } else if (result.ok) {
      setConflict(null);
      setBaseVersion(result.data.version);
    }
  };

  const refreshVersion = () => {
    if (currentCert) setBaseVersion(currentCert.version);
    setConflict(null);
  };

  const expired = currentCert ? new Date() > new Date(currentCert.expiresAt) : true;

  return (
    <div className="cert-grid">
      <section className="panel">
        <div className="heading">
          <div>
            <p>音分仪台账</p>
            <h2>当前证书</h2>
          </div>
          <span className={`badge ${expired ? "badge-out" : "badge-ok"}`}>{expired ? "已过截止时间" : "有效"}</span>
        </div>

        {currentCert ? (
          <div className="cert-current">
            <div className="cert-version">v{currentCert.version}</div>
            <dl>
              <div>
                <dt>证书编号</dt>
                <dd>{currentCert.certNo}</dd>
              </div>
              <div>
                <dt>仪器型号</dt>
                <dd>{currentCert.instrumentModel}</dd>
              </div>
              <div>
                <dt>校准时间</dt>
                <dd>{fmtDate(currentCert.calibratedAt)}</dd>
              </div>
              <div>
                <dt>截止时间</dt>
                <dd>{fmtDateTime(currentCert.expiresAt)}</dd>
              </div>
              <div>
                <dt>修正值</dt>
                <dd>{currentCert.correctionCents > 0 ? "+" : ""}{currentCert.correctionCents} 音分</dd>
              </div>
              <div>
                <dt>校准机构</dt>
                <dd>{currentCert.issuedBy}</dd>
              </div>
            </dl>
          </div>
        ) : (
          <p>暂无证书，所有读数将因资格失效进入待核验。</p>
        )}

        <h3 className="sub-heading">历史版本</h3>
        <div className="cert-history">
          {certificates.map((c) => (
            <div key={c.id} className={c.id === currentCert?.id ? "cert-row cert-active" : "cert-row"}>
              <b>v{c.version}</b>
              <span>{c.certNo}</span>
              <span className="sub">截止 {fmtDate(c.expiresAt)}</span>
              <span className="sub">{c.issuedBy}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>仪器更新</p>
            <h2>提交新校准证书</h2>
          </div>
        </div>

        <div className="concurrency-note">
          两人同时提交仪器更新时，后到者会看到版本冲突（乐观并发）。
          <button type="button" className="link-btn" onClick={onColleague}>
            模拟另一终端抢先提交
          </button>
        </div>

        {conflict !== null && (
          <div className="conflict-banner" role="alert">
            <b>版本冲突：</b>你基于 v{baseVersion} 提交，但当前证书已被更新到 v{conflict}。
            你的提交未生效，请刷新到最新版本后重新提交。
            <button type="button" className="primary" onClick={refreshVersion}>
              刷新到 v{conflict}
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="field-grid">
          <label>
            <span>基于版本（提交前读取）</span>
            <input value={`v${baseVersion}`} readOnly />
          </label>
          <label>
            <span>证书编号</span>
            <input value={form.certNo} onChange={(e) => set("certNo", e.target.value)} placeholder="留空自动生成" />
          </label>
          <label>
            <span>仪器型号</span>
            <input value={form.instrumentModel} onChange={(e) => set("instrumentModel", e.target.value)} />
          </label>
          <label>
            <span>修正值（音分）</span>
            <input type="number" step="0.1" value={form.correctionCents} onChange={(e) => set("correctionCents", e.target.value)} />
          </label>
          <label>
            <span>校准时间</span>
            <input type="datetime-local" required value={form.calibratedAt} onChange={(e) => set("calibratedAt", e.target.value)} />
          </label>
          <label>
            <span>截止时间</span>
            <input type="datetime-local" required value={form.expiresAt} onChange={(e) => set("expiresAt", e.target.value)} />
          </label>
          <label>
            <span>校准机构</span>
            <input value={form.issuedBy} onChange={(e) => set("issuedBy", e.target.value)} />
          </label>
          <label>
            <span>备注</span>
            <input value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="选填" />
          </label>
          <div className="form-actions">
            <button className="primary" type="submit">
              提交仪器更新
            </button>
          </div>
        </form>
        <p className="form-hint">提交后相关音管结论立即重算：已签发报告退回复核并留痕，草稿报告不受影响。</p>
      </section>
    </div>
  );
}
