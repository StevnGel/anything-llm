import React, { useEffect, useState } from "react";
import {
  ArrowClockwise,
  CloudArrowDown,
  Database,
  ListMagnifyingGlass,
} from "@phosphor-icons/react";
import AShares from "@/models/ashares";
import useUser from "@/hooks/useUser";
import { IconButton, Message, PageHeading } from "./Common";

const JOB_STATUS = {
  queued: "排队中",
  running: "运行中",
  partial: "部分完成",
  succeeded: "已完成",
  failed: "失败",
};

export default function DataCenter() {
  const { user } = useUser();
  const canOperate = !user || user.role === "admin";
  const [capabilities, setCapabilities] = useState(null);
  const [status, setStatus] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [symbols, setSymbols] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      AShares.capabilities(controller.signal),
      AShares.status(controller.signal),
      AShares.jobs(controller.signal),
    ])
      .then(([capabilityResult, statusResult, jobResult]) => {
        setCapabilities(capabilityResult);
        setStatus(statusResult);
        setJobs(jobResult.items);
        setError(null);
      })
      .catch((failure) => {
        if (failure.name !== "AbortError") setError(failure.message);
      });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    if (!jobs.some((job) => ["queued", "running"].includes(job.status))) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible")
        setRevision((value) => value + 1);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [jobs]);

  async function runJob(dataset) {
    const requested = symbols
      .split(/[\s,，]+/)
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);
    setSubmitting(true);
    try {
      await AShares.startJob({
        dataset,
        symbols: dataset === "history" ? requested : [],
      });
      setError(null);
      setRevision((value) => value + 1);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSubmitting(false);
    }
  }

  const running =
    submitting ||
    jobs.some((job) => ["queued", "running"].includes(job.status));

  return (
    <>
      <PageHeading
        title="数据中心"
        detail={
          status?.latest_trade_date
            ? `最新已发布交易日 ${status.latest_trade_date}`
            : "尚无已发布行情"
        }
        action={
          <IconButton
            label="刷新状态"
            onClick={() => setRevision((value) => value + 1)}
          >
            <ArrowClockwise size={19} />
          </IconButton>
        }
      />
      {error && (
        <Message tone="error" onRetry={() => setRevision((value) => value + 1)}>
          {error}
        </Message>
      )}
      <section className="ashares-status-grid" aria-label="数据覆盖">
        <div>
          <span>目标股票</span>
          <strong>{status?.security_count ?? "—"}</strong>
          <small>沪深主板、创业板、科创板</small>
        </div>
        <div>
          <span>最新日覆盖</span>
          <strong>
            {status?.coverage_pct == null ? "—" : `${status.coverage_pct}%`}
          </strong>
          <small>
            {status
              ? `${status.latest_date_covered} / ${status.security_count} 只`
              : ""}
          </small>
        </div>
        <div>
          <span>缺口</span>
          <strong>{status?.latest_date_missing ?? "—"}</strong>
          <small>以最新已发布日统计</small>
        </div>
        <div>
          <span>日线记录</span>
          <strong>{status?.bar_count?.toLocaleString("zh-CN") ?? "—"}</strong>
          <small>未复权 · 人民币</small>
        </div>
      </section>
      <div className="ashares-data-center-layout">
        <section>
          <h2>同步</h2>
          <div className="ashares-provider-row">
            <Database size={19} />
            <span>Fuyao</span>
            <strong>
              {capabilities?.provider_configured ? "已配置" : "未配置"}
            </strong>
          </div>
          {canOperate ? (
            <>
              <div className="ashares-job-actions">
                <button
                  disabled={running || !capabilities?.provider_configured}
                  onClick={() => runJob("universe")}
                >
                  <ListMagnifyingGlass size={18} /> 更新股票池
                </button>
                <button
                  disabled={
                    running ||
                    !capabilities?.provider_configured ||
                    !status?.security_count
                  }
                  onClick={() => runJob("recent")}
                >
                  <CloudArrowDown size={18} /> 同步近 10 个交易日
                </button>
                <button
                  disabled={
                    running ||
                    !capabilities?.provider_configured ||
                    !status?.security_count
                  }
                  onClick={() => runJob("full")}
                >
                  <CloudArrowDown size={18} /> 回填全市场近 5 年
                </button>
              </div>
              <div className="ashares-history-form">
                <label htmlFor="ashares-history-symbols">历史日线回填</label>
                <textarea
                  id="ashares-history-symbols"
                  value={symbols}
                  onChange={(event) => setSymbols(event.target.value)}
                  placeholder="600519.SH, 000001.SZ"
                  rows={3}
                />
                <button
                  className="ashares-outline-button"
                  disabled={
                    running ||
                    !capabilities?.provider_configured ||
                    !symbols.trim()
                  }
                  onClick={() => runJob("history")}
                >
                  <CloudArrowDown size={17} /> 回填近 5 年
                </button>
              </div>
            </>
          ) : (
            <Message>同步操作需要管理员权限</Message>
          )}
        </section>
        <section>
          <h2>任务记录</h2>
          <div className="ashares-collection-list">
            {jobs.map((job) => (
              <div key={job.id} className="ashares-job-row">
                <div>
                  <strong>
                    #{job.id} · {job.dataset}
                  </strong>
                  <span>{JOB_STATUS[job.status] || job.status}</span>
                </div>
                <small>
                  {job.total
                    ? `${job.completed} / ${job.total} · 失败 ${job.failed}`
                    : "等待确定任务总量"}{" "}
                  · {job.updated_at?.slice(0, 19).replace("T", " ")}
                </small>
                {job.message && <p>{job.message}</p>}
              </div>
            ))}
            {!jobs.length && <Message>暂无同步任务</Message>}
          </div>
        </section>
      </div>
    </>
  );
}
