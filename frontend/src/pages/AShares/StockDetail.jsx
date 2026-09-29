import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  ChartLineUp,
  FloppyDisk,
  Star,
} from "@phosphor-icons/react";
import AShares from "@/models/ashares";
import paths from "@/utils/paths";
import { amountText, Change, Message, numberText, PageHeading } from "./Common";
import KlineChart from "./KlineChart";
import useBars from "./useBars";
import { useASharesView } from "./Layout";

function startForRange(range) {
  if (range === "all") return "";
  const months = { "3m": 3, "1y": 12, "3y": 36 }[range] || 12;
  const start = new Date();
  start.setMonth(start.getMonth() - months);
  return start.toISOString().slice(0, 10);
}

export default function StockDetail() {
  const { symbol } = useParams();
  const navigate = useNavigate();
  const { setCompareSymbols } = useASharesView();
  const [detail, setDetail] = useState(null);
  const [tags, setTags] = useState([]);
  const [error, setError] = useState(null);
  const [revision, setRevision] = useState(0);
  const [period, setPeriod] = useState("1d");
  const [range, setRange] = useState("1y");
  const [tab, setTab] = useState("chart");
  const [noteText, setNoteText] = useState("");
  const [noteDirty, setNoteDirty] = useState(false);
  const bars = useBars(symbol, { period, start: startForRange(range) });

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      AShares.detail(symbol, controller.signal),
      AShares.tags(controller.signal),
    ])
      .then(([result, tagResult]) => {
        setDetail(result);
        setTags(tagResult.items);
        setNoteText(result.note.content);
        setNoteDirty(false);
        setError(null);
      })
      .catch((failure) => {
        if (failure.name !== "AbortError") setError(failure.message);
      });
    return () => controller.abort();
  }, [symbol, revision]);

  useEffect(() => {
    if (!noteDirty) return;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [noteDirty]);

  async function toggleWatch() {
    try {
      await AShares.watchlist(symbol, !detail.watchlisted);
      setDetail((previous) => ({
        ...previous,
        watchlisted: !previous.watchlisted,
      }));
    } catch (failure) {
      setError(failure.message);
    }
  }

  async function toggleTag(tagId) {
    const selected = detail.tag_ids.includes(tagId);
    try {
      await AShares.setTags({
        symbols: [symbol],
        add_tag_ids: selected ? [] : [tagId],
        remove_tag_ids: selected ? [tagId] : [],
      });
      setDetail((previous) => ({
        ...previous,
        tag_ids: selected
          ? previous.tag_ids.filter((id) => id !== tagId)
          : [...previous.tag_ids, tagId],
      }));
    } catch (failure) {
      setError(failure.message);
    }
  }

  async function saveNote(event) {
    event.preventDefault();
    try {
      const saved = await AShares.saveNote(symbol, {
        content: noteText,
        version: detail.note.version,
      });
      setDetail((previous) => ({ ...previous, note: saved }));
      setNoteDirty(false);
      setError(null);
    } catch (failure) {
      setError(failure.message);
    }
  }

  function addToCompare() {
    setCompareSymbols((previous) =>
      previous.includes(symbol) ? previous : [...previous, symbol].slice(0, 6)
    );
    navigate(paths.ashares.compare());
  }

  return (
    <>
      <div className="ashares-backline">
        <button onClick={() => navigate(-1)}>
          <ArrowLeft size={17} /> 返回
        </button>
        <Link to={paths.ashares.home()}>股票工作台</Link>
      </div>
      <PageHeading
        title={detail?.security?.name || symbol}
        detail={
          detail?.security
            ? `${symbol} · ${detail.security.board} · ${detail.latest_bar?.date || "暂无行情"}`
            : symbol
        }
        action={
          detail && (
            <div className="ashares-heading-actions">
              <button className="ashares-outline-button" onClick={toggleWatch}>
                <Star
                  size={17}
                  weight={detail.watchlisted ? "fill" : "regular"}
                />
                {detail.watchlisted ? "已自选" : "加入自选"}
              </button>
              <button className="ashares-outline-button" onClick={addToCompare}>
                <ChartLineUp size={17} /> 加入比较
              </button>
            </div>
          )
        }
      />
      {error && (
        <Message tone="error" onRetry={() => setRevision((value) => value + 1)}>
          {error}
        </Message>
      )}
      {!detail ? (
        <Message>正在读取股票资料…</Message>
      ) : (
        <div className="ashares-detail-layout">
          <div className="ashares-detail-primary">
            <div className="ashares-price-strip large">
              <strong>{numberText(detail.latest_bar?.close)}</strong>
              <Change value={detail.latest_bar?.change_pct} />
              <span>成交量 {numberText(detail.latest_bar?.volume, 0)} 股</span>
              <span>成交额 {amountText(detail.latest_bar?.amount)}</span>
            </div>
            <div
              className="ashares-tabbar"
              role="tablist"
              aria-label="股票详情视图"
            >
              {[
                ["chart", "图表"],
                ["table", "行情表"],
                ["profile", "资料"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  role="tab"
                  aria-selected={tab === value}
                  className={tab === value ? "active" : ""}
                  onClick={() => setTab(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab !== "profile" && (
              <div className="ashares-toolbar compact">
                <div className="ashares-segmented" aria-label="K 线周期">
                  {[
                    ["1d", "日"],
                    ["1w", "周"],
                    ["1M", "月"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      aria-pressed={period === value}
                      onClick={() => setPeriod(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="ashares-segmented" aria-label="日期范围">
                  {[
                    ["3m", "3 月"],
                    ["1y", "1 年"],
                    ["3y", "3 年"],
                    ["all", "全部"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      aria-pressed={range === value}
                      onClick={() => setRange(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span className="ashares-muted">未复权 · 人民币元</span>
              </div>
            )}
            {tab === "chart" &&
              (bars.error ? (
                <Message tone="error" onRetry={bars.refresh}>
                  {bars.error}
                </Message>
              ) : bars.data?.bars?.length ? (
                <KlineChart bars={bars.data.bars} height={430} />
              ) : (
                <Message>
                  {bars.loading ? "正在读取日线…" : "尚无已同步日线"}
                </Message>
              ))}
            {tab === "table" && (
              <div className="ashares-table-scroll">
                <table className="ashares-table">
                  <thead>
                    <tr>
                      <th>日期</th>
                      <th>开盘</th>
                      <th>最高</th>
                      <th>最低</th>
                      <th>收盘</th>
                      <th>涨跌幅</th>
                      <th>成交量（股）</th>
                      <th>成交额（元）</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...(bars.data?.bars || [])].reverse().map((bar) => (
                      <tr key={bar.date}>
                        <td>{bar.date}</td>
                        <td>{numberText(bar.open)}</td>
                        <td>{numberText(bar.high)}</td>
                        <td>{numberText(bar.low)}</td>
                        <td>{numberText(bar.close)}</td>
                        <td>
                          <Change value={bar.change_pct} />
                        </td>
                        <td>{numberText(bar.volume, 0)}</td>
                        <td>{amountText(bar.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!bars.loading && !bars.data?.bars?.length && (
                  <Message>当前范围没有日线</Message>
                )}
              </div>
            )}
            {tab === "profile" && (
              <dl className="ashares-profile">
                <div>
                  <dt>证券代码</dt>
                  <dd>{symbol}</dd>
                </div>
                <div>
                  <dt>交易所</dt>
                  <dd>{detail.security.exchange}</dd>
                </div>
                <div>
                  <dt>板块</dt>
                  <dd>{detail.security.board}</dd>
                </div>
                <div>
                  <dt>上市日期</dt>
                  <dd>{detail.security.listed_on || "暂无"}</dd>
                </div>
                <div>
                  <dt>行业</dt>
                  <dd>{detail.security.industry || "暂无"}</dd>
                </div>
                <div>
                  <dt>行情来源</dt>
                  <dd>{detail.latest_bar?.source || "暂无"}</dd>
                </div>
              </dl>
            )}
          </div>
          <aside className="ashares-detail-side">
            <div className="ashares-side-section">
              <div className="ashares-pane-header">
                <strong>标签</strong>
                <Link to={paths.ashares.collections()}>
                  <ArrowRight size={16} />
                </Link>
              </div>
              <div className="ashares-tag-picker">
                {tags.length ? (
                  tags.map((tag) => (
                    <label key={tag.id}>
                      <input
                        type="checkbox"
                        checked={detail.tag_ids.includes(tag.id)}
                        onChange={() => toggleTag(tag.id)}
                      />
                      <i style={{ backgroundColor: tag.color }} />
                      {tag.name}
                    </label>
                  ))
                ) : (
                  <span className="ashares-muted">暂无标签</span>
                )}
              </div>
            </div>
            <div className="ashares-side-section">
              <div className="ashares-pane-header">
                <strong>备注</strong>
                <span>{detail.note.updated_at?.slice(0, 10) || ""}</span>
              </div>
              <form onSubmit={saveNote}>
                <textarea
                  value={noteText}
                  onChange={(event) => {
                    setNoteText(event.target.value);
                    setNoteDirty(true);
                  }}
                  rows={7}
                  maxLength={5000}
                  aria-label="股票备注"
                  placeholder="记录观察与判断"
                />
                <button
                  type="submit"
                  className="ashares-primary-button"
                  disabled={!noteDirty}
                >
                  <FloppyDisk size={16} /> 保存备注
                </button>
              </form>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
