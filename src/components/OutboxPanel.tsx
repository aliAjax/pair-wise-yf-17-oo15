import type { FailMode, Reading } from "../types";
import { UploadBadge } from "./ReadingsPanel";
import { fmtDateTime } from "../store";

interface Props {
  readings: Reading[];
  online: boolean;
  failMode: FailMode;
  onOnline: (v: boolean) => void;
  onFailMode: (m: FailMode) => void;
  onRetry: () => void;
}

export default function OutboxPanel({ readings, online, failMode, onOnline, onFailMode, onRetry }: Props) {
  const queued = readings.filter((r) => r.uploadStatus !== "uploaded");
  const failed = readings.filter((r) => r.uploadStatus === "failed");
  const uploading = readings.filter((r) => r.uploadStatus === "uploading");
  const pending = readings.filter((r) => r.uploadStatus === "pending");
  const uploaded = readings.filter((r) => r.uploadStatus === "uploaded");

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>断点续传</p>
          <h2>上传队列（发件箱）</h2>
        </div>
        <button className="primary" onClick={onRetry} disabled={queued.length === 0 || uploading.length > 0}>
          续传未完成（{queued.length}）
        </button>
      </div>

      {(failed.length > 0 || !online || failMode !== "none") && (
        <div className="outbox-banner">
          <b>内容已保存在本机：</b>
          {failed.length} 条读数上传失败但内容未丢失，恢复后将只续传这些未完成条目，已上传的 {uploaded.length} 条不会重复上传。
        </div>
      )}

      <div className="outbox-stats">
        <span className="badge badge-ok">已上传 {uploaded.length}</span>
        <span className="badge badge-info">上传中 {uploading.length}</span>
        <span className="badge badge-muted">待上传 {pending.length}</span>
        <span className="badge badge-out">失败 {failed.length}</span>
      </div>

      <div className="outbox-controls">
        <label className="switch">
          <input type="checkbox" checked={online} onChange={(e) => onOnline(e.target.checked)} />
          <span>网络在线（关闭即模拟离线，上传暂存本机）</span>
        </label>
        <label className="fail-mode">
          <span>服务端故障模拟：</span>
          <select value={failMode} onChange={(e) => onFailMode(e.target.value as FailMode)}>
            <option value="none">正常</option>
            <option value="500">服务器 500</option>
            <option value="offline">离线</option>
          </select>
        </label>
      </div>

      <div className="records">
        {queued.length === 0 && <div className="empty-box">所有读数均已上传，无待续传条目。</div>}
        {queued.map((r) => (
          <article key={r.id}>
            <b>{r.uploadStatus === "failed" ? "!" : r.uploadStatus === "uploading" ? "…" : "○"}</b>
            <div>
              <h3>
                {r.pipeNo} · {r.stop} · {r.pitch}
              </h3>
              <p>
                {r.venue} · {r.deviation > 0 ? "+" : ""}
                {r.deviation} 音分 · 保存于 {fmtDateTime(r.createdAt)}
              </p>
              {r.uploadError && <p className="upload-error">失败原因：{r.uploadError}（内容已留存，可续传）</p>}
            </div>
            <UploadBadge status={r.uploadStatus} error={r.uploadError} />
          </article>
        ))}
      </div>
    </section>
  );
}
