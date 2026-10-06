import { useMemo, useState } from "react";
import type { Reading } from "../types";
import { fmtDateTime, TOLERANCE_CENTS_VALUE } from "../store";

interface Props {
  readings: Reading[];
}

const CATEGORIES = ["主音栓", "簧片音栓", "混合音栓", "低音管"] as const;

function categoryOf(stop: string): string {
  const s = stop.toLowerCase();
  if (s.includes("trompete") || s.includes("trumpet") || s.includes("oboe") || s.includes("reed")) return "簧片音栓";
  if (s.includes("mixture") || s.includes("sesquialtera") || s.includes("混合")) return "混合音栓";
  if (s.includes("16'") || s.includes("bourdon") || s.includes("bass")) return "低音管";
  return "主音栓";
}

const SOURCE_LABEL: Record<string, string> = {
  "meter-sync": "音分仪同步",
  manual: "手动录入",
  import: "文件导入",
  unknown: "来源不明",
};

export default function ReadingsPanel({ readings }: Props) {
  const [activeCats, setActiveCats] = useState<string[]>([]);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [query, setQuery] = useState("");

  const toggleCat = (c: string) =>
    setActiveCats((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  const filtered = useMemo(() => {
    return readings.filter((r) => {
      if (pendingOnly && r.verificationStatus !== "pending") return false;
      if (activeCats.length > 0 && !activeCats.includes(categoryOf(r.stop))) return false;
      if (query.trim()) {
        const q = query.trim().toLowerCase();
        if (!`${r.venue}${r.stop}${r.pipeNo}${r.pitch}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [readings, activeCats, pendingOnly, query]);

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>调音偏差表</p>
          <h2>音管读数台账</h2>
        </div>
        <input
          className="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索场馆 / 音栓 / 音管编号"
        />
      </div>

      <div className="chips">
        {CATEGORIES.map((c) => (
          <button key={c} className={activeCats.includes(c) ? "chip-on" : ""} onClick={() => toggleCat(c)}>
            {c}
          </button>
        ))}
        <button className={pendingOnly ? "chip-on" : ""} onClick={() => setPendingOnly((v) => !v)}>
          仅看待核验
        </button>
      </div>

      <div className="table-wrap">
        <table className="ledger">
          <thead>
            <tr>
              <th>音管 / 音栓</th>
              <th>场馆</th>
              <th>音高</th>
              <th>实测偏差</th>
              <th>修正偏差</th>
              <th>结论</th>
              <th>温湿度</th>
              <th>簧片</th>
              <th>绑定证书</th>
              <th>核验 / 上传</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className={r.verificationStatus === "pending" ? "row-pending" : ""}>
                <td>
                  <b>{r.pipeNo}</b>
                  <div className="sub">{r.stop}</div>
                </td>
                <td>{r.venue}</td>
                <td>{r.pitch}</td>
                <td className="num">{r.deviation > 0 ? "+" : ""}{r.deviation} 音分</td>
                <td className="num">
                  {r.correctedDeviation > 0 ? "+" : ""}
                  {r.correctedDeviation}
                  {r.recalculatedAt && <div className="sub">已重算</div>}
                </td>
                <td>
                  <span className={`badge ${r.conclusion === "ok" ? "badge-ok" : "badge-out"}`}>
                    {r.conclusion === "ok" ? "合格" : "超限"}
                  </span>
                </td>
                <td>
                  {r.temperature}℃ / {r.humidity}%RH
                </td>
                <td>
                  {r.reedStatus === "abnormal" ? (
                    <span className="badge badge-out" title={r.reedNote}>
                      异常{r.reedNote ? `：${r.reedNote}` : ""}
                    </span>
                  ) : (
                    <span className="badge badge-ok">正常</span>
                  )}
                </td>
                <td>
                  <div>v{r.certVersion || "—"}</div>
                  <div className="sub" title={`截止 ${fmtDateTime(r.certExpiresAt)}`}>
                    截止 {fmtDateTime(r.certExpiresAt)}
                  </div>
                  <div className="sub">{SOURCE_LABEL[r.source] ?? r.source}</div>
                </td>
                <td>
                  {r.verificationStatus === "verified" ? (
                    <span className="badge badge-ok">已核验</span>
                  ) : (
                    <span className="badge badge-warn">
                      待核验 · {r.pendingReason === "expired-cert" ? "资格失效" : "来源不明"}
                    </span>
                  )}
                  <UploadBadge status={r.uploadStatus} error={r.uploadError} />
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="empty">
                  没有匹配的读数
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="form-hint">合格限 ±{TOLERANCE_CENTS_VALUE} 音分；修正偏差 = 实测偏差 + 证书修正值，随证书更新立即重算。</p>
    </section>
  );
}

export function UploadBadge({ status, error }: { status: Reading["uploadStatus"]; error?: string }) {
  const map = {
    uploaded: { cls: "badge-ok", text: "已上传" },
    uploading: { cls: "badge-info", text: "上传中…" },
    pending: { cls: "badge-muted", text: "待上传" },
    failed: { cls: "badge-out", text: "上传失败" },
  } as const;
  const item = map[status];
  return (
    <span className={`badge ${item.cls}`} title={error ?? ""}>
      {item.text}
    </span>
  );
}
