import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowClockwise,
  ArrowRight,
  ChartLineUp,
  FloppyDisk,
  Star,
  Tag as TagIcon,
} from "@phosphor-icons/react";
import AShares from "@/models/ashares";
import paths from "@/utils/paths";
import {
  amountText,
  Change,
  IconButton,
  Message,
  numberText,
  PageHeading,
} from "./Common";
import KlineChart from "./KlineChart";
import useBars from "./useBars";
import { useASharesView } from "./Layout";

const BOARDS = [
  ["", "全部板块"],
  ["SSE_MAIN", "沪市主板"],
  ["SZSE_MAIN", "深市主板"],
  ["CHINEXT", "创业板"],
  ["STAR", "科创板"],
];

export default function Workbench() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { compareSymbols, setCompareSymbols } = useASharesView();
  const [search, setSearch] = useState(params.get("q") || "");
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState(null);
  const [tags, setTags] = useState([]);
  const [groups, setGroups] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState([]);
  const [bulkTag, setBulkTag] = useState("");
  const [groupName, setGroupName] = useState("");
  const [showGroupForm, setShowGroupForm] = useState(false);

  const q = params.get("q") || "";
  const board = params.get("board") || "";
  const scope = params.get("scope") || "all_market";
  const groupId = params.get("group") || "";
  const tagId = params.get("tag") || "";
  const sort = params.get("sort") || "symbol";
  const page = Number(params.get("page") || 0);
  const currentSymbol = params.get("symbol") || rows?.items?.[0]?.symbol;
  const bars = useBars(currentSymbol, { period: "1d" });

  function updateParams(nextValues) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      for (const [key, value] of Object.entries(nextValues)) {
        if (!value) next.delete(key);
        else next.set(key, String(value));
      }
      return next;
    });
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (search !== q) updateParams({ q: search, page: "", symbol: "" });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search, q]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      AShares.tags(controller.signal),
      AShares.groups(controller.signal),
      AShares.status(controller.signal),
    ])
      .then(([tagResult, groupResult, statusResult]) => {
        setTags(tagResult.items);
        setGroups(groupResult.items);
        setStatus(statusResult);
      })
      .catch((failure) => {
        if (failure.name !== "AbortError") setError(failure.message);
      });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError(null);
    setRows(null);
    AShares.query(
      {
        filter: {
          q,
          board: board || undefined,
          scope,
          group_id: groupId ? Number(groupId) : undefined,
          include_tag_ids: tagId ? [Number(tagId)] : [],
        },
        sort: { field: sort, direction: sort === "symbol" ? "asc" : "desc" },
        page: { offset: page * 50, size: 50 },
      },
      controller.signal
    )
      .then((result) => setRows(result))
      .catch((failure) => {
        if (failure.name !== "AbortError") setError(failure.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [q, board, scope, groupId, tagId, sort, page, revision]);

  useEffect(() => setSelected([]), [q, board, scope, groupId, tagId, sort]);

  async function toggleWatch(row) {
    try {
      await AShares.watchlist(row.symbol, !row.watchlisted);
      setRevision((value) => value + 1);
    } catch (failure) {
      setError(failure.message);
    }
  }

  function toggleCompare(symbol) {
    setCompareSymbols((previous) => {
      if (previous.includes(symbol))
        return previous.filter((item) => item !== symbol);
      if (previous.length >= 6) return previous;
      return [...previous, symbol];
    });
  }

  async function applyTag(remove = false) {
    if (!bulkTag || selected.length === 0) return;
    try {
      await AShares.setTags({
        symbols: selected,
        add_tag_ids: remove ? [] : [Number(bulkTag)],
        remove_tag_ids: remove ? [Number(bulkTag)] : [],
      });
      setSelected([]);
      setRevision((value) => value + 1);
    } catch (failure) {
      setError(failure.message);
    }
  }

  async function saveGroup(event) {
    event.preventDefault();
    try {
      await AShares.createGroup({
        name: groupName,
        kind: "fixed",
        symbols: selected,
      });
      setShowGroupForm(false);
      setGroupName("");
      setRevision((value) => value + 1);
    } catch (failure) {
      setError(failure.message);
    }
  }

  const current =
    rows?.items?.find((row) => row.symbol === currentSymbol) ||
    rows?.items?.[0];
  let listSummary = "加载中";
  if (rows) {
    listSummary = `${rows.total} 只`;
  } else if (!busy) {
    listSummary = error ? "加载失败" : "暂无数据";
  }

  return (
    <>
      <PageHeading
        title="股票工作台"
        detail={
          status?.latest_trade_date
            ? `行情日期 ${status.latest_trade_date} · ${status.latest_date_covered}/${status.security_count} 只覆盖`
            : "暂无已发布日线"
        }
        action={
          <IconButton
            label="刷新数据"
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
      <div className="ashares-toolbar">
        <label className="ashares-search-label">
          <span className="sr-only">搜索股票</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="代码或名称"
            type="search"
          />
        </label>
        <select
          value={scope}
          onChange={(event) =>
            updateParams({ scope: event.target.value, page: "" })
          }
          aria-label="股票范围"
        >
          <option value="all_market">全市场</option>
          <option value="watchlist">自选</option>
        </select>
        <select
          value={groupId}
          onChange={(event) =>
            updateParams({ group: event.target.value, page: "" })
          }
          aria-label="分组"
        >
          <option value="">全部分组</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
        <select
          value={board}
          onChange={(event) =>
            updateParams({ board: event.target.value, page: "" })
          }
          aria-label="板块"
        >
          {BOARDS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={tagId}
          onChange={(event) =>
            updateParams({ tag: event.target.value, page: "" })
          }
          aria-label="标签"
        >
          <option value="">全部标签</option>
          {tags.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(event) =>
            updateParams({ sort: event.target.value, page: "" })
          }
          aria-label="排序"
        >
          <option value="symbol">代码排序</option>
          <option value="change_pct">涨跌幅排序</option>
          <option value="amount">成交额排序</option>
          <option value="close">收盘价排序</option>
        </select>
      </div>

      {selected.length > 0 && (
        <div className="ashares-bulkbar">
          <strong>已选 {selected.length} 只</strong>
          <select
            value={bulkTag}
            onChange={(event) => setBulkTag(event.target.value)}
            aria-label="批量标签"
          >
            <option value="">选择标签</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
          <button onClick={() => applyTag(false)} disabled={!bulkTag}>
            <TagIcon size={16} /> 添加标签
          </button>
          <button onClick={() => applyTag(true)} disabled={!bulkTag}>
            移除标签
          </button>
          <button onClick={() => setShowGroupForm((value) => !value)}>
            <FloppyDisk size={16} /> 保存分组
          </button>
          <button
            disabled={selected.length < 2 || selected.length > 6}
            onClick={() => {
              setCompareSymbols(selected.slice(0, 6));
              navigate(paths.ashares.compare());
            }}
          >
            <ChartLineUp size={16} /> 比较
          </button>
          <button onClick={() => setSelected([])}>清除选择</button>
          {showGroupForm && (
            <form onSubmit={saveGroup} className="ashares-inline-form">
              <input
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                placeholder="分组名称"
                maxLength={100}
                required
              />
              <button type="submit">保存</button>
            </form>
          )}
        </div>
      )}

      <div className="ashares-workbench">
        <section className="ashares-list-pane" aria-label="股票列表">
          <div className="ashares-pane-header">
            <strong>股票</strong>
            <span>
              {listSummary}
              {busy && rows ? " · 更新中" : ""}
            </span>
          </div>
          {rows?.items?.length ? (
            <div className="ashares-stock-list">
              {rows.items.map((row) => (
                <div
                  key={row.symbol}
                  className={`ashares-stock-row${current?.symbol === row.symbol ? " selected" : ""}`}
                  onClick={() => updateParams({ symbol: row.symbol })}
                  onDoubleClick={() =>
                    navigate(paths.ashares.stock(row.symbol))
                  }
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter")
                      updateParams({ symbol: row.symbol });
                  }}
                >
                  <input
                    type="checkbox"
                    aria-label={`选择 ${row.name}`}
                    checked={selected.includes(row.symbol)}
                    onChange={() =>
                      setSelected((previous) =>
                        previous.includes(row.symbol)
                          ? previous.filter((symbol) => symbol !== row.symbol)
                          : [...previous, row.symbol]
                      )
                    }
                    onClick={(event) => event.stopPropagation()}
                  />
                  <button
                    className={`ashares-star${row.watchlisted ? " active" : ""}`}
                    title={row.watchlisted ? "移出自选" : "加入自选"}
                    aria-label={row.watchlisted ? "移出自选" : "加入自选"}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleWatch(row);
                    }}
                  >
                    <Star
                      size={18}
                      weight={row.watchlisted ? "fill" : "regular"}
                    />
                  </button>
                  <div className="ashares-stock-identity">
                    <strong>{row.name}</strong>
                    <small>{row.symbol}</small>
                  </div>
                  <div className="ashares-stock-value">
                    <strong>{numberText(row.close)}</strong>
                    <Change value={row.change_pct} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Message>
              {busy
                ? "正在读取股票池…"
                : status?.security_count
                  ? "没有匹配的股票"
                  : "股票池为空，请先在数据中心同步股票池"}
            </Message>
          )}
          <div className="ashares-pagination">
            <button
              disabled={page === 0}
              onClick={() => updateParams({ page: page - 1 || "", symbol: "" })}
            >
              上一页
            </button>
            <span>第 {page + 1} 页</span>
            <button
              disabled={!rows || (page + 1) * 50 >= rows.total}
              onClick={() => updateParams({ page: page + 1, symbol: "" })}
            >
              下一页
            </button>
          </div>
        </section>

        <section className="ashares-preview-pane" aria-label="股票预览">
          {current ? (
            <>
              <div className="ashares-pane-header ashares-preview-header">
                <div>
                  <strong>{current.name}</strong>
                  <span>
                    {current.symbol} · {current.board}
                  </span>
                </div>
                <div className="ashares-preview-actions">
                  <IconButton
                    label={
                      compareSymbols.includes(current.symbol)
                        ? "移出比较"
                        : "加入比较"
                    }
                    onClick={() => toggleCompare(current.symbol)}
                  >
                    <ChartLineUp
                      size={19}
                      weight={
                        compareSymbols.includes(current.symbol)
                          ? "fill"
                          : "regular"
                      }
                    />
                  </IconButton>
                  <Link
                    to={paths.ashares.stock(current.symbol)}
                    className="ashares-text-action"
                  >
                    详情 <ArrowRight size={16} />
                  </Link>
                </div>
              </div>
              <div className="ashares-price-strip">
                <strong>{numberText(current.close)}</strong>
                <Change value={current.change_pct} />
                <span>成交额 {amountText(current.amount)}</span>
                <span>{current.trade_date || "暂无目标日行情"}</span>
              </div>
              {bars.error ? (
                <Message tone="error" onRetry={bars.refresh}>
                  {bars.error}
                </Message>
              ) : bars.data?.bars?.length ? (
                <KlineChart bars={bars.data.bars} />
              ) : (
                <Message>
                  {bars.loading ? "正在加载 K 线…" : "该股票尚无已同步日线"}
                </Message>
              )}
              <div className="ashares-tag-row">
                {current.tags.length ? (
                  current.tags.map((tag) => (
                    <span
                      key={tag.id}
                      className="ashares-tag"
                      style={{ borderColor: tag.color }}
                    >
                      <i style={{ backgroundColor: tag.color }} />
                      {tag.name}
                    </span>
                  ))
                ) : (
                  <span className="ashares-muted">暂无标签</span>
                )}
              </div>
            </>
          ) : (
            <Message>选择一只股票查看行情</Message>
          )}
        </section>
      </div>
    </>
  );
}
