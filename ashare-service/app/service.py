"""A 股查询、同步和共享业务资产操作。"""

import json
import logging
import math
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from threading import Lock
from zoneinfo import ZoneInfo

import duckdb
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from .db import SessionLocal, engine
from .models import (
    DailyBar,
    Security,
    SecurityTag,
    StockGroup,
    StockGroupItem,
    SyncJob,
    Tag,
    WatchlistItem,
    utc_now,
)
from .providers import (
    FuyaoClient,
    ProviderError,
    board_for,
    load_recent_dump,
    market_dump,
    trade_date_from_ms,
)

EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ashare-sync")
SYNC_LOCK = Lock()
STORAGE_DIR = Path(__file__).resolve().parents[1] / "storage"
LOGGER = logging.getLogger(__name__)


def serialize_security(security: Security) -> dict:
    return {
        "symbol": security.symbol,
        "code": security.code,
        "name": security.name,
        "exchange": security.exchange,
        "board": security.board,
        "industry": security.industry,
        "listed_on": security.listed_on.isoformat() if security.listed_on else None,
    }


def serialize_bar(bar: DailyBar) -> dict:
    return {
        "date": bar.trade_date.isoformat(),
        "open": bar.open,
        "high": bar.high,
        "low": bar.low,
        "close": bar.close,
        "volume": bar.volume,
        "amount": bar.amount,
        "change_pct": bar.change_pct,
        "turnover_pct": bar.turnover_pct,
        "source": bar.source,
    }


def serialize_job(job: SyncJob) -> dict:
    return {
        "id": job.id,
        "dataset": job.dataset,
        "status": job.status,
        "total": job.total,
        "completed": job.completed,
        "failed": job.failed,
        "message": job.message,
        "created_at": job.created_at.isoformat(),
        "updated_at": job.updated_at.isoformat(),
    }


def require_security(session, symbol: str) -> Security:
    security = session.get(Security, symbol)
    if security is None:
        raise HTTPException(status_code=404, detail="股票不在已接入的沪深 A 股范围内")
    return security


def data_status() -> dict:
    with SessionLocal() as session:
        total = session.scalar(select(func.count()).select_from(Security)) or 0
        latest = session.scalar(select(func.max(DailyBar.trade_date)))
        covered = 0
        if latest:
            covered = (
                session.scalar(
                    select(func.count())
                    .select_from(DailyBar)
                    .where(DailyBar.trade_date == latest)
                )
                or 0
            )
        bars = session.scalar(select(func.count()).select_from(DailyBar)) or 0
        latest_job = session.scalars(
            select(SyncJob).order_by(SyncJob.id.desc()).limit(1)
        ).first()
        return {
            "security_count": total,
            "latest_trade_date": latest.isoformat() if latest else None,
            "latest_date_covered": covered,
            "latest_date_missing": max(total - covered, 0),
            "bar_count": bars,
            "coverage_pct": round(covered * 100 / total, 1) if total else None,
            "latest_job": serialize_job(latest_job) if latest_job else None,
            "source": "Fuyao",
        }


def _tag_map(session) -> dict[str, list[dict]]:
    tags = {tag.id: tag for tag in session.scalars(select(Tag)).all()}
    result = defaultdict(list)
    for link in session.scalars(select(SecurityTag)).all():
        tag = tags.get(link.tag_id)
        if tag:
            result[link.symbol].append(
                {
                    "id": tag.id,
                    "name": tag.name,
                    "color": tag.color,
                    "category_id": tag.category_id,
                }
            )
    return result


def query_securities(payload: dict) -> dict:
    filters = payload.get("filter") or {}
    page = payload.get("page") or {}
    sort = payload.get("sort") or {}
    size = min(max(int(page.get("size", 50)), 1), 100)
    offset = max(int(page.get("offset", 0)), 0)
    q = str(filters.get("q", "")).strip().casefold()
    board = filters.get("board")
    scope = filters.get("scope", "all_market")
    include_ids = set(filters.get("include_tag_ids") or [])
    exclude_ids = set(filters.get("exclude_tag_ids") or [])
    tag_match = filters.get("tag_match", "all")
    group_id = filters.get("group_id")

    with SessionLocal() as session:
        latest = session.scalar(select(func.max(DailyBar.trade_date)))
        securities = session.scalars(select(Security)).all()
        bars = {}
        if latest:
            bars = {
                bar.symbol: bar
                for bar in session.scalars(
                    select(DailyBar).where(DailyBar.trade_date == latest)
                ).all()
            }
        watchlist = set(session.scalars(select(WatchlistItem.symbol)).all())
        tags = _tag_map(session)
        group = session.get(StockGroup, group_id) if group_id else None
        if group_id and group is None:
            raise HTTPException(status_code=404, detail="分组不存在")
        group_members = set()
        group_query = ""
        group_board = None
        if group and group.kind == "fixed":
            group_members = set(
                session.scalars(
                    select(StockGroupItem.symbol).where(
                        StockGroupItem.group_id == group.id
                    )
                ).all()
            )
        if group and group.kind == "dynamic":
            definition = json.loads(group.filter_json or "{}")
            group_query = str(definition.get("q", "")).strip().casefold()
            group_board = definition.get("board")
            if definition.get("scope") == "watchlist" and scope == "all_market":
                scope = "watchlist"
            if definition.get("tag_match") == "any":
                tag_match = "any"
            include_ids.update(definition.get("include_tag_ids") or [])
            exclude_ids.update(definition.get("exclude_tag_ids") or [])

        rows = []
        for security in securities:
            symbol = security.symbol
            search_text = f"{symbol} {security.code} {security.name}".casefold()
            if q and q not in search_text:
                continue
            if group_query and group_query not in search_text:
                continue
            if board and security.board != board:
                continue
            if group_board and security.board != group_board:
                continue
            if scope == "watchlist" and symbol not in watchlist:
                continue
            if group and group.kind == "fixed" and symbol not in group_members:
                continue

            tag_ids = {tag["id"] for tag in tags[symbol]}
            if include_ids:
                matches = include_ids & tag_ids
                if tag_match == "all" and matches != include_ids:
                    continue
                if tag_match == "any" and not matches:
                    continue
            if exclude_ids & tag_ids:
                continue

            bar = bars.get(symbol)
            rows.append(
                {
                    **serialize_security(security),
                    "close": bar.close if bar else None,
                    "change_pct": bar.change_pct if bar else None,
                    "amount": bar.amount if bar else None,
                    "trade_date": latest.isoformat() if bar else None,
                    "watchlisted": symbol in watchlist,
                    "tags": tags[symbol],
                }
            )

        field = sort.get("field", "symbol")
        if field not in {"symbol", "name", "close", "change_pct", "amount"}:
            field = "symbol"
        reverse = sort.get("direction") == "desc"
        rows.sort(key=lambda row: row["symbol"])
        rows.sort(
            key=lambda row: (
                row[field]
                if row[field] is not None
                else ("" if field in {"symbol", "name"} else 0)
            ),
            reverse=reverse,
        )
        # 缺数始终位于末尾；缺失行情不能参与目标日涨跌幅排序。
        if field in {"close", "change_pct", "amount"}:
            rows.sort(key=lambda row: row[field] is None)
        return {
            "items": rows[offset : offset + size],
            "total": len(rows),
            "offset": offset,
            "size": size,
            "target_trade_date": latest.isoformat() if latest else None,
            "missing_count": sum(row["trade_date"] is None for row in rows),
        }


def aggregate_bars(bars: list[dict], period: str) -> list[dict]:
    if period == "1d":
        return bars
    grouped = []
    current_key = None
    for bar in bars:
        trade_day = date.fromisoformat(bar["date"])
        key = (
            (trade_day.isocalendar().year, trade_day.isocalendar().week)
            if period == "1w"
            else (trade_day.year, trade_day.month)
        )
        if key != current_key:
            grouped.append({**bar})
            current_key = key
            continue
        current = grouped[-1]
        current["date"] = bar["date"]
        current["high"] = max(current["high"], bar["high"])
        current["low"] = min(current["low"], bar["low"])
        current["close"] = bar["close"]
        current["volume"] = (current["volume"] or 0) + (bar["volume"] or 0)
        current["amount"] = (current["amount"] or 0) + (bar["amount"] or 0)
    previous_close = None
    for bar in grouped:
        bar["change_pct"] = (
            round((bar["close"] / previous_close - 1) * 100, 3)
            if previous_close
            else None
        )
        previous_close = bar["close"]
    return grouped


def get_bars(symbol: str, period: str, start: date | None, end: date | None) -> dict:
    if period not in {"1d", "1w", "1M"}:
        raise HTTPException(status_code=422, detail="不支持的 K 线周期")
    with SessionLocal() as session:
        security = require_security(session, symbol)
        statement = select(DailyBar).where(DailyBar.symbol == symbol)
        if start:
            statement = statement.where(DailyBar.trade_date >= start)
        if end:
            statement = statement.where(DailyBar.trade_date <= end)
        bars = session.scalars(statement.order_by(DailyBar.trade_date)).all()
        return {
            "security": serialize_security(security),
            "bars": aggregate_bars([serialize_bar(bar) for bar in bars], period),
            "period": period,
            "adjust": "none",
            "units": {
                "price": "CNY",
                "volume": "shares",
                "amount": "CNY",
                "change_pct": "%",
            },
            "source": "Fuyao",
            "latest_trade_date": bars[-1].trade_date.isoformat() if bars else None,
        }


def _upsert_rows(session, model, rows: list[dict], key_columns: list[str]) -> None:
    if not rows:
        return
    table = model.__table__
    dialect_insert = (
        postgresql_insert if engine.dialect.name == "postgresql" else sqlite_insert
    )
    for index in range(0, len(rows), 500):
        chunk = rows[index : index + 500]
        statement = dialect_insert(table).values(chunk)
        updates = {
            column.name: getattr(statement.excluded, column.name)
            for column in table.columns
            if column.name not in key_columns
        }
        session.execute(
            statement.on_conflict_do_update(index_elements=key_columns, set_=updates)
        )


def _normalize_bar(symbol: str, row: dict, source: str) -> dict:
    date_ms = row.get("date_ms")
    values = [
        row.get(key) for key in ("open_price", "high_price", "low_price", "close_price")
    ]
    if not isinstance(date_ms, int) or any(value is None for value in values):
        raise ProviderError(f"{symbol} 存在缺失的交易日期或 OHLC")
    open_price, high, low, close = map(float, values)
    if not all(map(math.isfinite, (open_price, high, low, close))):
        raise ProviderError(f"{symbol} 存在非有限价格")
    if (
        min(open_price, high, low, close) <= 0
        or high < max(open_price, close)
        or low > min(open_price, close)
    ):
        raise ProviderError(f"{symbol} 存在无效 OHLC")
    volume = row.get("volume")
    amount = row.get("turnover")
    if volume is not None and (not math.isfinite(float(volume)) or float(volume) < 0):
        raise ProviderError(f"{symbol} 存在无效成交量")
    if amount is not None and (not math.isfinite(float(amount)) or float(amount) < 0):
        raise ProviderError(f"{symbol} 存在无效成交额")
    return {
        "symbol": symbol,
        "trade_date": trade_date_from_ms(date_ms),
        "open": open_price,
        "high": high,
        "low": low,
        "close": close,
        "volume": float(volume) if volume is not None else None,
        "amount": float(amount) if amount is not None else None,
        "change_pct": None,
        "turnover_pct": None,
        "source": source,
        "fetched_at": utc_now(),
    }


def _apply_change_pct(rows: list[dict]) -> None:
    by_symbol = defaultdict(list)
    for row in rows:
        by_symbol[row["symbol"]].append(row)
    for series in by_symbol.values():
        series.sort(key=lambda row: row["trade_date"])
        previous = None
        for row in series:
            row["change_pct"] = (
                round((row["close"] / previous - 1) * 100, 3) if previous else None
            )
            previous = row["close"]


def _sync_universe(job_id: int) -> None:
    items = FuyaoClient().securities()
    rows = []
    for item in items:
        symbol = item.get("thscode", "")
        board = board_for(symbol)
        if not board:
            continue
        listed_on = item.get("list_date")
        rows.append(
            {
                "symbol": symbol,
                "code": symbol[:6],
                "name": item["name"],
                "exchange": item["exchange"],
                "board": board,
                "industry": None,
                "listed_on": date.fromisoformat(listed_on) if listed_on else None,
                "updated_at": utc_now(),
            }
        )
    if not rows:
        raise ProviderError("Fuyao 未返回目标市场股票，未更新股票池")
    with SessionLocal.begin() as session:
        _upsert_rows(session, Security, rows, ["symbol"])
        job = session.get(SyncJob, job_id)
        job.total = len(rows)
        job.completed = len(rows)
        job.message = f"已更新 {len(rows)} 只沪深 A 股；板块按交易所与代码段分类"


def _sync_recent(job_id: int) -> None:
    with SessionLocal() as session:
        known = set(session.scalars(select(Security.symbol)).all())
    if not known:
        raise ProviderError("请先同步股票池，再同步日线")
    source_rows = load_recent_dump(FuyaoClient(), STORAGE_DIR)
    rows = []
    for item in source_rows:
        if item.get("thscode") not in known:
            continue
        if (
            item.get("currency") != "CNY"
            or item.get("interval") != "1d"
            or item.get("adjusted") != "none"
        ):
            raise ProviderError("Fuyao 日线文件的币种、周期或复权口径不符合要求")
        rows.append(_normalize_bar(item["thscode"], item, "fuyao_recent_dump"))
    if not rows:
        raise ProviderError("Fuyao 近期文件没有目标市场日线，未发布")
    _apply_change_pct(rows)
    with SessionLocal.begin() as session:
        _upsert_rows(session, DailyBar, rows, ["symbol", "trade_date"])
        job = session.get(SyncJob, job_id)
        job.total = len(rows)
        job.completed = len(rows)
        job.message = f"已发布 {len(rows)} 根近期日线"


def _sync_full(job_id: int) -> None:
    with SessionLocal() as session:
        known = set(session.scalars(select(Security.symbol)).all())
    if not known:
        raise ProviderError("请先同步股票池，再回填全市场历史日线")

    five_year_start = datetime.now(ZoneInfo("Asia/Shanghai")).date() - timedelta(
        days=365 * 5
    )
    start_ms = int(
        datetime.combine(
            five_year_start, datetime.min.time(), ZoneInfo("Asia/Shanghai")
        ).timestamp()
        * 1000
    )
    with market_dump(FuyaoClient(), STORAGE_DIR, "full") as (_source, dump_path):
        # 排序计算可能落盘，临时文件限定在本次下载目录并随任务清理。
        connection = duckdb.connect(
            config={"temp_directory": str(dump_path.parent / "duckdb")}
        )
        try:
            # 先核对目标日期范围的源键，避免冲突行被 upsert 任意覆盖。
            duplicate = connection.execute(
                """
                SELECT thscode, date_ms
                FROM read_parquet(?)
                WHERE date_ms >= ?
                GROUP BY thscode, date_ms
                HAVING COUNT(*) > 1
                LIMIT 1
                """,
                [str(dump_path), start_ms],
            ).fetchone()
            if duplicate:
                raise ProviderError("Fuyao 全量日线包含重复证券与日期，未继续发布")

            # DuckDB 在文件上计算前收盘价；Arrow 分批交接，避免整库载入 Python 内存。
            reader = connection.execute(
                """
                SELECT
                    thscode,
                    date_ms,
                    currency,
                    interval,
                    adjusted,
                    open_price,
                    high_price,
                    low_price,
                    close_price,
                    volume,
                    turnover,
                    LAG(close_price) OVER (
                        PARTITION BY thscode ORDER BY date_ms
                    ) AS previous_close
                FROM read_parquet(?)
                WHERE date_ms >= ?
                ORDER BY thscode, date_ms
                """,
                [str(dump_path), start_ms],
            ).fetch_record_batch(rows_per_batch=5000)
            for batch in reader:
                rows = []
                for item in batch.to_pylist():
                    symbol = item["thscode"]
                    if symbol not in known:
                        continue
                    if (item["currency"], item["interval"], item["adjusted"]) != (
                        "CNY",
                        "1d",
                        "none",
                    ):
                        raise ProviderError(
                            "Fuyao 全量日线口径不符合未复权 CNY 日线要求"
                        )
                    row = _normalize_bar(symbol, item, "fuyao_full_dump")
                    previous = item["previous_close"]
                    if previous and previous > 0:
                        row["change_pct"] = round(
                            (row["close"] / previous - 1) * 100, 3
                        )
                    rows.append(row)
                with SessionLocal.begin() as session:
                    _upsert_rows(session, DailyBar, rows, ["symbol", "trade_date"])
                    job = session.get(SyncJob, job_id)
                    job.completed += len(rows)
                    job.updated_at = utc_now()
        finally:
            connection.close()
    with SessionLocal.begin() as session:
        job = session.get(SyncJob, job_id)
        job.total = job.completed
        job.message = f"已发布 {job.completed} 根近 5 年未复权日线"


def _sync_history(job_id: int, symbols: list[str]) -> None:
    if not symbols or len(symbols) > 20:
        raise ProviderError("一次只能回填 1 至 20 只股票")
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=365 * 5)
    client = FuyaoClient()
    with SessionLocal.begin() as session:
        for symbol in symbols:
            require_security(session, symbol)
        session.get(SyncJob, job_id).total = len(symbols)
    errors = []
    for symbol in symbols:
        try:
            source_rows = client.bars(
                symbol,
                int(start.timestamp() * 1000),
                int(end.timestamp() * 1000),
            )
            if any(
                (row.get("currency"), row.get("interval"), row.get("adjusted"))
                != ("CNY", "1d", "none")
                for row in source_rows
            ):
                raise ProviderError("返回的币种、周期或复权口径不符合要求")
            rows = [
                _normalize_bar(symbol, row, "fuyao_historical") for row in source_rows
            ]
            if not rows:
                raise ProviderError("未返回日线")
            if len({row["trade_date"] for row in rows}) != len(rows):
                raise ProviderError("返回了重复交易日")
            _apply_change_pct(rows)
            with SessionLocal.begin() as session:
                _upsert_rows(session, DailyBar, rows, ["symbol", "trade_date"])
                job = session.get(SyncJob, job_id)
                job.completed += 1
                job.updated_at = utc_now()
        except ProviderError as exc:
            errors.append(f"{symbol}: {exc}")
            with SessionLocal.begin() as session:
                job = session.get(SyncJob, job_id)
                job.failed += 1
                job.updated_at = utc_now()
    with SessionLocal.begin() as session:
        job = session.get(SyncJob, job_id)
        job.message = (
            "；".join(errors[:5])
            if errors
            else f"已回填 {job.completed} 只股票近 5 年日线"
        )


def _run_job(job_id: int) -> None:
    with SYNC_LOCK:
        with SessionLocal.begin() as session:
            job = session.get(SyncJob, job_id)
            job.status = "running"
            job.updated_at = utc_now()
            dataset = job.dataset
            symbols = json.loads(job.targets_json)
        try:
            if dataset == "universe":
                _sync_universe(job_id)
            elif dataset == "recent":
                _sync_recent(job_id)
            elif dataset == "full":
                _sync_full(job_id)
            else:
                _sync_history(job_id, symbols)
            with SessionLocal.begin() as session:
                job = session.get(SyncJob, job_id)
                job.status = "partial" if job.failed else "succeeded"
                job.updated_at = utc_now()
        except (ProviderError, ValueError, OSError) as exc:
            with SessionLocal.begin() as session:
                job = session.get(SyncJob, job_id)
                job.status = "partial" if job.completed else "failed"
                job.message = str(exc)
                job.updated_at = utc_now()
        except Exception as exc:
            LOGGER.exception("A 股同步任务 %s 失败：%s", job_id, type(exc).__name__)
            with SessionLocal.begin() as session:
                job = session.get(SyncJob, job_id)
                job.status = "partial" if job.completed else "failed"
                job.message = "内部同步失败，请检查服务日志并重新提交"
                job.updated_at = utc_now()


def create_sync_job(dataset: str, symbols: list[str]) -> dict:
    if dataset not in {"universe", "recent", "full", "history"}:
        raise HTTPException(status_code=422, detail="不支持的同步数据集")
    if dataset == "history" and (not symbols or len(symbols) > 20):
        raise HTTPException(status_code=422, detail="一次只能回填 1 至 20 只股票")
    with SessionLocal.begin() as session:
        active = session.scalars(
            select(SyncJob).where(SyncJob.status.in_(["queued", "running"])).limit(1)
        ).first()
        if active:
            raise HTTPException(
                status_code=409, detail=f"同步任务 {active.id} 正在执行"
            )
        job = SyncJob(
            dataset=dataset, targets_json=json.dumps(symbols), total=len(symbols)
        )
        session.add(job)
        session.flush()
        result = serialize_job(job)
    EXECUTOR.submit(_run_job, result["id"])
    return result
