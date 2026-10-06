import { useState } from "react";
import "./styles.css";
import { useLedger } from "./store";
import ReadingForm from "./components/ReadingForm";
import ReadingsPanel from "./components/ReadingsPanel";
import CertPanel from "./components/CertPanel";
import PendingPanel from "./components/PendingPanel";
import ReportsPanel from "./components/ReportsPanel";
import OutboxPanel from "./components/OutboxPanel";
import type { ReadingInput } from "./types";

type Tab = "readings" | "cert" | "pending" | "reports" | "outbox";

interface Toast {
  id: number;
  type: "success" | "error" | "info";
  msg: string;
}

export default function App() {
  const ledger = useLedger();
  const { actions } = ledger;
  const [tab, setTab] = useState<Tab>("readings");
  const [toasts, setToasts] = useState<Toast[]>([]);

  const pushToast = (type: Toast["type"], msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, type, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  };

  const pendingCount = ledger.readings.filter((r) => r.verificationStatus === "pending").length;
  const failedCount = ledger.readings.filter((r) => r.uploadStatus === "failed").length;
  const outCount = ledger.readings.filter((r) => r.conclusion === "out").length;
  const stopCount = new Set(ledger.readings.map((r) => r.stop)).size;
  const avgTemp =
    ledger.readings.length > 0
      ? Math.round((ledger.readings.reduce((s, r) => s + r.temperature, 0) / ledger.readings.length) * 10) / 10
      : 0;

  const handleAddReading = (input: ReadingInput) => {
    const result = actions.addReading(input);
    if (result.ok) {
      const certInfo = ledger.currentCert
        ? `已绑定 v${ledger.currentCert.version}（截止 ${new Date(ledger.currentCert.expiresAt).toLocaleString("zh-CN")}）`
        : "无绑定证书";
      pushToast(
        input.source === "unknown" || !ledger.currentCert
          ? "info"
          : "success",
        input.source === "unknown"
          ? "读数已保存到本机（来源不明 → 待核验，报告暂不采用）"
          : !ledger.currentCert
            ? "读数已保存到本机（无有效证书 → 待核验）"
            : `读数已保存到本机并发上传，${certInfo}`
      );
    }
  };

  const handleCertSubmit: React.ComponentProps<typeof CertPanel>["onSubmit"] = (input) => {
    const result = actions.addCertificate(input);
    if (!result.ok && result.conflict) {
      pushToast("error", `版本冲突：你基于 v${input.baseVersion} 提交，当前已为 v${result.currentVersion}，请刷新后重提`);
    } else if (result.ok) {
      pushToast("success", `证书已更新到 v${result.data.version}，相关音管结论已重算，已签发报告退回复核`);
    }
    return result;
  };

  const handleColleague = () => {
    const result = actions.colleagueUpdate();
    if (result.ok) {
      pushToast("info", `另一终端已抢先提交到 v${result.data.version}；你现在提交将看到版本冲突`);
    }
  };

  const tabs: { key: Tab; label: string; badge?: number; badgeCls?: string }[] = [
    { key: "readings", label: "调音台账" },
    { key: "cert", label: "音分仪与证书" },
    { key: "pending", label: "待核验", badge: pendingCount, badgeCls: "badge-warn" },
    { key: "reports", label: "维护报告" },
    { key: "outbox", label: "上传队列", badge: failedCount, badgeCls: "badge-out" },
  ];

  return (
    <main className="app">
      <section className="hero">
        <p>hxyfront-62005 · 源提示词 7 · Port 62005</p>
        <h1>管风琴调音台账</h1>
        <span>
          音分仪更换后旧证书与测量脱钩，本台账把每次读数绑定到证书版本与截止时间：资格失效或来源不明的读数进待核验、报告不采用；
          证书更新后相关音管结论立即重算，已签发报告退回复核并留痕；两人同时提交仪器更新时后到者见版本冲突；
          保存失败时已核验内容留在本机，恢复后只续传未完成条目。
        </span>
      </section>

      <section className="metrics">
        <article>
          <small>音栓数量</small>
          <strong>{stopCount}</strong>
        </article>
        <article>
          <small>偏差超限</small>
          <strong>{outCount}</strong>
        </article>
        <article>
          <small>待核验读数</small>
          <strong>{pendingCount}</strong>
        </article>
        <article>
          <small>平均温度</small>
          <strong>{avgTemp}℃</strong>
        </article>
      </section>

      <nav className="tabs">
        {tabs.map((t) => (
          <button key={t.key} className={tab === t.key ? "tab tab-active" : "tab"} onClick={() => setTab(t.key)}>
            {t.label}
            {t.badge ? <span className={`badge ${t.badgeCls} tab-badge`}>{t.badge}</span> : null}
          </button>
        ))}
      </nav>

      {!ledger.online && (
        <div className="outbox-banner" role="status">
          <b>当前离线：</b>新读数与仪器更新将保存在本机，恢复联网后自动续传未完成条目。
        </div>
      )}

      <div className="tab-body">
        {tab === "readings" && (
          <>
            <ReadingForm currentCert={ledger.currentCert} onSubmit={handleAddReading} />
            <ReadingsPanel readings={ledger.readings} />
          </>
        )}
        {tab === "cert" && (
          <CertPanel
            certificates={ledger.certificates}
            currentCert={ledger.currentCert}
            onSubmit={handleCertSubmit}
            onColleague={handleColleague}
          />
        )}
        {tab === "pending" && <PendingPanel readings={ledger.readings} onVerify={actions.verifyReading} />}
        {tab === "reports" && (
          <ReportsPanel
            reports={ledger.reports}
            readings={ledger.readings}
            audit={ledger.audit}
            onCreate={(input) => {
              const r = actions.createReport(input);
              if (!r.ok) pushToast("error", "没有可纳入的已核验读数，报告未生成");
              else pushToast("success", "报告草稿已生成（仅含已核验读数）");
              return r;
            }}
            onIssue={(id) => {
              actions.issueReport(id);
              pushToast("success", "报告状态已更新，操作已留痕");
            }}
          />
        )}
        {tab === "outbox" && (
          <OutboxPanel
            readings={ledger.readings}
            online={ledger.online}
            failMode={ledger.failMode}
            onOnline={actions.setOnline}
            onFailMode={actions.setFailMode}
            onRetry={actions.retryOutbox}
          />
        )}
      </div>

      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </main>
  );
}
