import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FloppyDisk, Plus, Trash, X } from "@phosphor-icons/react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import AShares from "@/models/ashares";
import paths from "@/utils/paths";
import { Message, PageHeading } from "./Common";
import KlineChart from "./KlineChart";
import { useASharesView } from "./Layout";

const COLORS = [
  "#cf7771",
  "#59af8c",
  "#dbb55c",
  "#73a9c9",
  "#b894c6",
  "#a9b36c",
];

export default function Compare() {
  const { compareSymbols, setCompareSymbols } = useASharesView();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [matches, setMatches] = useState([]);
  const [data, setData] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState("trend");
  const [savedSets, setSavedSets] = useState([]);
  const [savedId, setSavedId] = useState("");
  const [setName, setSetName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [savedRevision, setSavedRevision] = useState(0);
  const period = params.get("period") || "1d";
  const start = params.get("start") || "";
  const end = params.get("end") || "";
  const symbols =
    params.get("symbols")?.split(",").filter(Boolean).slice(0, 6) ||
    compareSymbols;
  const symbolsKey = symbols.join(",");

  useEffect(() => {
    const controller = new AbortController();
    AShares.comparisons(controller.signal)
      .then((result) => setSavedSets(result.items))
      .catch((failure) => {
        if (failure.name !== "AbortError") setError(failure.message);
      });
    return () => controller.abort();
  }, [savedRevision]);

  function changeParameter(key, value) {
    setParams((previous) => {
      const updated = new URLSearchParams(previous);
      if (value) updated.set(key, value);
      else updated.delete(key);
      return updated;
    });
  }

  function openSavedSet(id) {
    setSavedId(id);
    setConfirmDelete(false);
    const saved = savedSets.find((item) => item.id === Number(id));
    if (!saved) return;
    setSetName(saved.name);
    setMode(saved.mode);
    setCompareSymbols(saved.symbols);
    setParams((previous) => {
      const updated = new URLSearchParams(previous);
      updated.set("symbols", saved.symbols.join(","));
      updated.set("period", saved.period);
      for (const key of ["start", "end"]) {
        if (saved[key]) updated.set(key, saved[key]);
        else updated.delete(key);
      }
      return updated;
    });
  }

  async function saveSet(event) {
    event.preventDefault();
    try {
      const body = {
        name: setName.trim(),
        symbols,
        period,
        mode,
        start: start || null,
        end: end || null,
      };
      const current = savedSets.find((item) => item.id === Number(savedId));
      const saved = current
        ? await AShares.updateComparison(current.id, {
            ...body,
            version: current.version,
          })
        : await AShares.createComparison(body);
      setSavedId(String(saved.id));
      setError(null);
      setSavedRevision((value) => value + 1);
    } catch (failure) {
      setError(failure.message);
    }
  }

  async function removeSavedSet() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      await AShares.deleteComparison(savedId);
      setSavedId("");
      setSetName("");
      setConfirmDelete(false);
      setSavedRevision((value) => value + 1);
    } catch (failure) {
      setError(failure.message);
    }
  }

  useEffect(() => {
    if (params.has("symbols") || !compareSymbols.length) return;
    setParams((previous) => {
      const updated = new URLSearchParams(previous);
      updated.set("symbols", compareSymbols.join(","));
      return updated;
    });
  }, [compareSymbols, params, setParams]);

  function setSymbols(next) {
    const unique = [...new Set(next)].slice(0, 6);
    setCompareSymbols(unique);
    setParams((previous) => {
      const updated = new URLSearchParams(previous);
      if (unique.length) updated.set("symbols", unique.join(","));
      else updated.delete("symbols");
      return updated;
    });
  }

  useEffect(() => {
    if (!search.trim()) {
      setMatches([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      AShares.search(search, controller.signal)
        .then((result) => setMatches(result.items))
        .catch((failure) => {
          if (failure.name !== "AbortError") setError(failure.message);
        });
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [search]);

  useEffect(() => {
    if (!symbols.length) {
      setData(null);
      setComparison(null);
      return;
    }
    const controller = new AbortController();
    Promise.all([
      AShares.batchBars(
        { symbols, period, start: start || null, end: end || null },
        controller.signal
      ),
      symbols.length >= 2
        ? AShares.compare(
            { symbols, period, start: start || null, end: end || null },
            controller.signal
          )
        : Promise.resolve(null),
    ])
      .then(([bars, result]) => {
        setData(bars.results);
        setComparison(result);
        setError(null);
      })
      .catch((failure) => {
        if (failure.name !== "AbortError") setError(failure.message);
      });
    return () => controller.abort();
  }, [symbolsKey, period, start, end]);

  const trendRows = useMemo(() => {
    if (!comparison) return [];
    const rows = new Map(comparison.dates.map((date) => [date, { date }]));
    for (const symbol of symbols) {
      for (const point of comparison.series[symbol]?.points || []) {
        rows.get(point.date)[symbol] = point.value;
      }
    }
    return [...rows.values()];
  }, [comparison, symbolsKey]);

  return (
    <>
      <PageHeading
        title="多股比较"
        detail={
          symbols.length ? `${symbols.length} 只股票` : "选择 2 至 6 只股票"
        }
      />
      {error && <Message tone="error">{error}</Message>}
      <div className="ashares-toolbar">
        <div className="ashares-search-combo">
          <label>
            <span className="sr-only">添加比较股票</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索股票并加入比较"
            />
          </label>
          {matches.length > 0 && (
            <div className="ashares-suggestions">
              {matches
                .filter((item) => !symbols.includes(item.symbol))
                .slice(0, 8)
                .map((item) => (
                  <button
                    key={item.symbol}
                    onClick={() => {
                      setSymbols([...symbols, item.symbol]);
                      setSearch("");
                    }}
                  >
                    <Plus size={16} /> {item.name} <span>{item.symbol}</span>
                  </button>
                ))}
            </div>
          )}
        </div>
        <div className="ashares-segmented" aria-label="比较视图">
          <button
            aria-pressed={mode === "trend"}
            onClick={() => setMode("trend")}
          >
            走势
          </button>
          <button
            aria-pressed={mode === "grid"}
            onClick={() => setMode("grid")}
          >
            分屏 K 线
          </button>
        </div>
        <div className="ashares-segmented" aria-label="K 线周期">
          {[
            ["1d", "日"],
            ["1w", "周"],
            ["1M", "月"],
          ].map(([value, label]) => (
            <button
              key={value}
              aria-pressed={period === value}
              onClick={() =>
                setParams((previous) => {
                  const updated = new URLSearchParams(previous);
                  updated.set("period", value);
                  return updated;
                })
              }
            >
              {label}
            </button>
          ))}
        </div>
        <label className="ashares-date-label">
          开始{" "}
          <input
            type="date"
            value={start}
            onChange={(event) => changeParameter("start", event.target.value)}
          />
        </label>
        <label className="ashares-date-label">
          结束{" "}
          <input
            type="date"
            value={end}
            onChange={(event) => changeParameter("end", event.target.value)}
          />
        </label>
      </div>
      <form className="ashares-toolbar compact" onSubmit={saveSet}>
        <select
          value={savedId}
          onChange={(event) => openSavedSet(event.target.value)}
          aria-label="已保存比较组合"
        >
          <option value="">新建比较组合</option>
          {savedSets.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <input
          value={setName}
          onChange={(event) => setSetName(event.target.value)}
          placeholder="组合名称"
          aria-label="组合名称"
          maxLength={100}
          required
        />
        <button
          className="ashares-outline-button"
          type="submit"
          disabled={symbols.length < 2}
        >
          <FloppyDisk size={17} /> {savedId ? "更新组合" : "保存组合"}
        </button>
        {savedId && (
          <button
            className="ashares-outline-button"
            type="button"
            onClick={removeSavedSet}
          >
            <Trash size={17} /> {confirmDelete ? "确认删除" : "删除组合"}
          </button>
        )}
      </form>
      <div className="ashares-symbol-chips">
        {symbols.map((symbol, index) => (
          <span key={symbol} style={{ borderColor: COLORS[index] }}>
            <Link to={paths.ashares.stock(symbol)}>
              {data?.[symbol]?.security?.name || symbol}
            </Link>
            <button
              onClick={() =>
                setSymbols(symbols.filter((item) => item !== symbol))
              }
              title={`移除 ${symbol}`}
              aria-label={`移除 ${symbol}`}
            >
              <X size={14} />
            </button>
          </span>
        ))}
      </div>
      {!symbols.length ? (
        <Message>从股票工作台选择股票，或在这里搜索添加</Message>
      ) : symbols.length < 2 ? (
        <Message>再添加一只股票开始比较</Message>
      ) : mode === "trend" && comparison?.error ? (
        <Message tone="error">{comparison.error}</Message>
      ) : mode === "trend" ? (
        <div className="ashares-comparison-chart">
          <ResponsiveContainer width="100%" height={460}>
            <LineChart
              data={trendRows}
              margin={{ top: 24, right: 24, bottom: 8, left: 2 }}
            >
              <CartesianGrid
                stroke="rgba(128, 142, 145, 0.14)"
                vertical={false}
              />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={38} />
              <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
              <Tooltip
                formatter={(value) =>
                  value == null ? "—" : `${Number(value).toFixed(2)}`
                }
              />
              <Legend />
              {symbols.map((symbol, index) => (
                <Line
                  key={symbol}
                  type="linear"
                  dataKey={symbol}
                  name={data?.[symbol]?.security?.name || symbol}
                  stroke={COLORS[index]}
                  dot={false}
                  connectNulls={false}
                  strokeWidth={2}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <div className="ashares-chart-footnote">
            共同基准日 {comparison?.base_date || "—"} 收盘价 = 100 · 未复权
          </div>
        </div>
      ) : (
        <div className="ashares-compare-grid">
          {symbols.map((symbol) => (
            <section key={symbol} className="ashares-compare-item">
              <div className="ashares-pane-header">
                <strong>{data?.[symbol]?.security?.name || symbol}</strong>
                <span>{symbol}</span>
              </div>
              {data?.[symbol]?.bars?.length ? (
                <KlineChart bars={data[symbol].bars} height={280} />
              ) : (
                <Message>{data?.[symbol]?.error || "暂无已同步日线"}</Message>
              )}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
