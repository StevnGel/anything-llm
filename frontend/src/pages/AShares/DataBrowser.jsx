import React, { useEffect, useState } from "react";
import { DownloadSimple, MagnifyingGlass } from "@phosphor-icons/react";
import AShares from "@/models/ashares";
import { amountText, Change, Message, numberText, PageHeading } from "./Common";

function downloadPage(rows, symbol) {
  const headers = [
    "symbol",
    "date",
    "open",
    "high",
    "low",
    "close",
    "change_pct",
    "volume",
    "amount",
    "source",
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((key) => row[key] ?? "").join(","));
  }
  const blob = new Blob(["\ufeff", lines.join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `ashares-daily-${symbol || "all"}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function DataBrowser() {
  const [symbol, setSymbol] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setRows(null);
    AShares.dailyRows(
      {
        symbol: symbol.trim().toUpperCase() || null,
        start: start || null,
        end: end || null,
        offset,
        size: 50,
      },
      controller.signal
    )
      .then((result) => {
        setRows(result);
        setError(null);
      })
      .catch((failure) => {
        if (failure.name !== "AbortError") setError(failure.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [symbol, start, end, offset, revision]);

  return (
    <>
      <PageHeading
        title="数据浏览"
        detail="已发布日线 · 未复权 · 价格及成交额单位：人民币元"
      />
      {error && (
        <Message tone="error" onRetry={() => setRevision((value) => value + 1)}>
          {error}
        </Message>
      )}
      <div className="ashares-toolbar">
        <label className="ashares-search-label">
          <MagnifyingGlass size={17} />
          <input
            value={symbol}
            onChange={(event) => {
              setSymbol(event.target.value);
              setOffset(0);
            }}
            placeholder="600519.SH"
            aria-label="证券代码"
          />
        </label>
        <label className="ashares-date-label">
          开始{" "}
          <input
            type="date"
            value={start}
            onChange={(event) => {
              setStart(event.target.value);
              setOffset(0);
            }}
          />
        </label>
        <label className="ashares-date-label">
          结束{" "}
          <input
            type="date"
            value={end}
            onChange={(event) => {
              setEnd(event.target.value);
              setOffset(0);
            }}
          />
        </label>
        <button
          className="ashares-outline-button"
          disabled={!rows?.items?.length}
          onClick={() => downloadPage(rows.items, symbol)}
        >
          <DownloadSimple size={17} /> 导出本页 CSV
        </button>
      </div>
      <div className="ashares-pane-header">
        <strong>日线记录</strong>
        <span>
          {rows ? `${rows.total.toLocaleString("zh-CN")} 条` : "加载中"}
          {loading && rows ? " · 更新中" : ""}
        </span>
      </div>
      <div className="ashares-table-scroll">
        <table className="ashares-table">
          <thead>
            <tr>
              <th>日期</th>
              <th>代码</th>
              <th>开盘</th>
              <th>最高</th>
              <th>最低</th>
              <th>收盘</th>
              <th>涨跌幅</th>
              <th>成交量（股）</th>
              <th>成交额（元）</th>
              <th>来源</th>
            </tr>
          </thead>
          <tbody>
            {rows?.items?.map((row) => (
              <tr key={`${row.symbol}-${row.date}`}>
                <td>{row.date}</td>
                <td>{row.symbol}</td>
                <td>{numberText(row.open)}</td>
                <td>{numberText(row.high)}</td>
                <td>{numberText(row.low)}</td>
                <td>{numberText(row.close)}</td>
                <td>
                  <Change value={row.change_pct} />
                </td>
                <td>{numberText(row.volume, 0)}</td>
                <td>{amountText(row.amount)}</td>
                <td>{row.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && !rows?.items?.length && (
          <Message>当前条件没有已发布日线</Message>
        )}
      </div>
      <div className="ashares-pagination">
        <button
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(offset - 50, 0))}
        >
          上一页
        </button>
        <span>第 {Math.floor(offset / 50) + 1} 页</span>
        <button
          disabled={!rows || offset + 50 >= rows.total}
          onClick={() => setOffset(offset + 50)}
        >
          下一页
        </button>
      </div>
    </>
  );
}
