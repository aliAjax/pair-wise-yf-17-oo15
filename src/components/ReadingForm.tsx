import { useState } from "react";
import type { Certificate, ReadingInput, ReedStatus } from "../types";
import { toLocalInputValue } from "../store";

interface Props {
  currentCert?: Certificate;
  onSubmit: (input: ReadingInput) => void;
}

const STOPS = ["Principal 4'", "Trumpet 8'", "Bourdon 16'", "Gemshorn 8'", "Mixture V", "Trompete 16'", "Oboe 8'"];
const SOURCES = [
  { value: "meter-sync", label: "音分仪同步" },
  { value: "manual", label: "手动录入" },
  { value: "import", label: "文件导入" },
  { value: "unknown", label: "来源不明（将进待核验）" },
];

const initial = {
  venue: "",
  stop: STOPS[0],
  pipeNo: "",
  pitch: "",
  deviation: "",
  temperature: "20",
  humidity: "55",
  reedStatus: "normal" as ReedStatus,
  reedNote: "",
  maintenanceNote: "",
  source: "meter-sync",
  measuredAt: toLocalInputValue(),
};

export default function ReadingForm({ currentCert, onSubmit }: Props) {
  const [form, setForm] = useState(initial);
  const set = (k: keyof typeof initial, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      venue: form.venue,
      stop: form.stop,
      pipeNo: form.pipeNo,
      pitch: form.pitch,
      deviation: Number(form.deviation),
      temperature: Number(form.temperature),
      humidity: Number(form.humidity),
      reedStatus: form.reedStatus,
      reedNote: form.reedNote,
      maintenanceNote: form.maintenanceNote,
      source: form.source,
      measuredAt: form.measuredAt ? new Date(form.measuredAt).toISOString() : new Date().toISOString(),
    });
    setForm({ ...initial, measuredAt: toLocalInputValue() });
  };

  return (
    <form className="panel form-panel" onSubmit={handleSubmit}>
      <div className="heading">
        <div>
          <p>专业字段</p>
          <h2>新增读数</h2>
        </div>
        <button className="primary" type="submit">
          保存并上传
        </button>
      </div>

      <div className="cert-binding">
        {currentCert ? (
          <>
            <span className="dot" />
            读数将绑定音分仪证书 <b>{currentCert.certNo}</b>（v{currentCert.version}） · 截止时间{" "}
            <b>{new Date(currentCert.expiresAt).toLocaleString("zh-CN")}</b>
          </>
        ) : (
          <>
            <span className="dot dot-warn" />
            当前无有效证书，读数将因「资格失效」进入待核验
          </>
        )}
      </div>

      <div className="field-grid">
        <label>
          <span>场馆名称</span>
          <input required value={form.venue} onChange={(e) => set("venue", e.target.value)} placeholder="如 St.Mary" />
        </label>
        <label>
          <span>音栓</span>
          <input list="stop-list" required value={form.stop} onChange={(e) => set("stop", e.target.value)} />
          <datalist id="stop-list">
            {STOPS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <label>
          <span>音管编号</span>
          <input required value={form.pipeNo} onChange={(e) => set("pipeNo", e.target.value)} placeholder="如 T8-01" />
        </label>
        <label>
          <span>音高</span>
          <input required value={form.pitch} onChange={(e) => set("pitch", e.target.value)} placeholder="如 C#4" />
        </label>
        <label>
          <span>音分偏差（实测，音分）</span>
          <input type="number" step="0.1" required value={form.deviation} onChange={(e) => set("deviation", e.target.value)} placeholder="如 7" />
        </label>
        <label>
          <span>测量时间</span>
          <input type="datetime-local" required value={form.measuredAt} onChange={(e) => set("measuredAt", e.target.value)} />
        </label>
        <label>
          <span>温度（℃）</span>
          <input type="number" step="0.1" value={form.temperature} onChange={(e) => set("temperature", e.target.value)} />
        </label>
        <label>
          <span>湿度（%RH）</span>
          <input type="number" step="1" value={form.humidity} onChange={(e) => set("humidity", e.target.value)} />
        </label>
        <label>
          <span>簧片状态</span>
          <select value={form.reedStatus} onChange={(e) => set("reedStatus", e.target.value as ReedStatus)}>
            <option value="normal">正常</option>
            <option value="abnormal">异常</option>
          </select>
        </label>
        <label>
          <span>数据来源</span>
          <select value={form.source} onChange={(e) => set("source", e.target.value)}>
            {SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>簧片异常备注</span>
          <input value={form.reedNote} onChange={(e) => set("reedNote", e.target.value)} placeholder="如 簧片需微调" />
        </label>
        <label>
          <span>维修备注</span>
          <input value={form.maintenanceNote} onChange={(e) => set("maintenanceNote", e.target.value)} placeholder="维修与复检安排" />
        </label>
      </div>
      <p className="form-hint">
        内容先保存在本机（发件箱）再上传；若证书已过截止时间或来源不明，读数自动进入「待核验」，维护报告不采用。
      </p>
    </form>
  );
}
