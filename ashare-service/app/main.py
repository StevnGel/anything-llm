"""A 股内部 API，由 AnythingLLM 的已鉴权路由调用。"""

import hmac
import json
import os
import re
from contextlib import asynccontextmanager
from datetime import date

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from .db import Base, SessionLocal, engine
from .models import (
    DailyBar,
    Security,
    SecurityNote,
    SecurityTag,
    StockGroup,
    StockGroupItem,
    SyncJob,
    Tag,
    TagCategory,
    WatchlistItem,
    utc_now,
)
from .service import (
    create_sync_job,
    data_status,
    get_bars,
    query_securities,
    require_security,
    serialize_bar,
    serialize_job,
    serialize_security,
)

HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(engine)
    # 进程中断后线程任务不会继续运行；保留记录并明确标记失败，允许重新提交。
    with SessionLocal.begin() as session:
        jobs = session.scalars(
            select(SyncJob).where(SyncJob.status.in_(["queued", "running"]))
        ).all()
        for job in jobs:
            job.status = "failed"
            job.message = "服务重启中断任务，请重新提交"
            job.updated_at = utc_now()
    yield


app = FastAPI(title="AnythingLLM A 股服务", lifespan=lifespan, docs_url=None, redoc_url=None)


@app.middleware("http")
async def internal_auth(request: Request, call_next):
    if request.url.path == "/health":
        return await call_next(request)
    expected = os.getenv("ASHARE_SERVICE_TOKEN", "")
    supplied = request.headers.get("X-Internal-Token", "")
    if not expected or not hmac.compare_digest(expected, supplied):
        return JSONResponse(status_code=401, content={"detail": "内部服务认证失败"})
    return await call_next(request)


@app.get("/health")
def health():
    return {"online": True}


@app.get("/capabilities")
def capabilities():
    return {
        "enabled": True,
        "periods": ["1d", "1w", "1M"],
        "adjustments": ["none"],
        "datasets": ["daily"],
        "boards": ["SSE_MAIN", "SZSE_MAIN", "CHINEXT", "STAR"],
        "provider": "Fuyao",
        "provider_configured": bool(os.getenv("FUYAO_API_KEY")),
        "sync_modes": ["universe", "recent", "history"],
    }


class QueryBody(BaseModel):
    filter: dict = Field(default_factory=dict)
    sort: dict = Field(default_factory=dict)
    page: dict = Field(default_factory=dict)


@app.post("/securities/query")
def securities_query(body: QueryBody):
    return query_securities(body.model_dump())


@app.get("/securities")
def securities_search(q: str = "", limit: int = 20):
    result = query_securities(
        {"filter": {"q": q}, "page": {"size": min(max(limit, 1), 100)}}
    )
    return {"items": result["items"], "total": result["total"]}


@app.get("/securities/{symbol}")
def security_detail(symbol: str):
    with SessionLocal() as session:
        security = require_security(session, symbol)
        latest = session.scalars(
            select(DailyBar)
            .where(DailyBar.symbol == symbol)
            .order_by(DailyBar.trade_date.desc())
            .limit(1)
        ).first()
        note = session.get(SecurityNote, symbol)
        tag_ids = session.scalars(
            select(SecurityTag.tag_id).where(SecurityTag.symbol == symbol)
        ).all()
        return {
            "security": serialize_security(security),
            "latest_bar": serialize_bar(latest) if latest else None,
            "watchlisted": session.get(WatchlistItem, symbol) is not None,
            "tag_ids": tag_ids,
            "note": {
                "content": note.content,
                "version": note.version,
                "updated_at": note.updated_at.isoformat(),
            } if note else {"content": "", "version": 0, "updated_at": None},
        }


@app.get("/securities/{symbol}/bars")
def security_bars(
    symbol: str,
    period: str = "1d",
    adjust: str = "none",
    start: date | None = None,
    end: date | None = None,
):
    if adjust != "none":
        raise HTTPException(status_code=422, detail="当前仅支持已验证的未复权行情")
    if start and end and start > end:
        raise HTTPException(status_code=422, detail="起始日期不能晚于结束日期")
    return get_bars(symbol, period, start, end)


class BatchBarsBody(BaseModel):
    symbols: list[str] = Field(min_length=1, max_length=6)
    period: str = "1d"
    start: date | None = None
    end: date | None = None


@app.post("/bars/batch")
def bars_batch(body: BatchBarsBody):
    if len(set(body.symbols)) != len(body.symbols):
        raise HTTPException(status_code=422, detail="比较股票不能重复")
    results = {}
    for symbol in body.symbols:
        try:
            results[symbol] = get_bars(symbol, body.period, body.start, body.end)
        except HTTPException as exc:
            results[symbol] = {"error": exc.detail, "bars": []}
    return {"results": results}


@app.post("/comparisons/query")
def comparisons_query(body: BatchBarsBody):
    batch = bars_batch(body)["results"]
    timeline = set()
    for result in batch.values():
        timeline.update(bar["date"] for bar in result.get("bars", []))
    series = {}
    for symbol, result in batch.items():
        bars = result.get("bars", [])
        first_close = bars[0]["close"] if bars else None
        series[symbol] = {
            "name": result.get("security", {}).get("name", symbol),
            "points": [
                {"date": bar["date"], "value": round(bar["close"] / first_close * 100, 3)}
                for bar in bars
            ] if first_close else [],
            "error": result.get("error"),
        }
    return {"dates": sorted(timeline), "series": series, "base": 100}


@app.get("/watchlists/default")
def watchlist():
    with SessionLocal() as session:
        return {"symbols": session.scalars(select(WatchlistItem.symbol)).all()}


@app.put("/watchlists/default/items/{symbol}")
def add_watchlist_item(symbol: str):
    with SessionLocal.begin() as session:
        require_security(session, symbol)
        if session.get(WatchlistItem, symbol) is None:
            session.add(WatchlistItem(symbol=symbol))
    return {"symbol": symbol, "watchlisted": True}


@app.delete("/watchlists/default/items/{symbol}")
def remove_watchlist_item(symbol: str):
    with SessionLocal.begin() as session:
        item = session.get(WatchlistItem, symbol)
        if item:
            session.delete(item)
    return {"symbol": symbol, "watchlisted": False}


class NoteBody(BaseModel):
    content: str = Field(max_length=5000)
    version: int = Field(ge=0)


@app.put("/securities/{symbol}/notes")
def update_note(symbol: str, body: NoteBody):
    with SessionLocal.begin() as session:
        require_security(session, symbol)
        note = session.get(SecurityNote, symbol)
        actual_version = note.version if note else 0
        if body.version != actual_version:
            raise HTTPException(status_code=409, detail="备注已被其他人修改，请刷新后重试")
        if note is None:
            note = SecurityNote(symbol=symbol, content=body.content)
            session.add(note)
        else:
            note.content = body.content
            note.version += 1
            note.updated_at = utc_now()
        session.flush()
        return {
            "content": note.content,
            "version": note.version,
            "updated_at": note.updated_at.isoformat(),
        }


def _tag_payload(tag: Tag) -> dict:
    return {
        "id": tag.id,
        "category_id": tag.category_id,
        "name": tag.name,
        "color": tag.color,
        "version": tag.version,
    }


@app.get("/tag-categories")
def tag_categories():
    with SessionLocal() as session:
        categories = session.scalars(
            select(TagCategory).order_by(TagCategory.sort_order, TagCategory.id)
        ).all()
        return {"items": [{"id": item.id, "name": item.name} for item in categories]}


class CategoryBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)


@app.post("/tag-categories", status_code=201)
def create_category(body: CategoryBody):
    try:
        with SessionLocal.begin() as session:
            category = TagCategory(name=body.name.strip())
            session.add(category)
            session.flush()
            return {"id": category.id, "name": category.name}
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="标签分类名称已存在") from exc


@app.delete("/tag-categories/{category_id}")
def delete_category(category_id: int):
    with SessionLocal.begin() as session:
        category = session.get(TagCategory, category_id)
        if category is None:
            raise HTTPException(status_code=404, detail="标签分类不存在")
        used = session.scalar(select(func.count()).select_from(Tag).where(Tag.category_id == category_id))
        if used:
            raise HTTPException(status_code=409, detail="分类下仍有标签，请先处理标签")
        session.delete(category)
    return {"success": True}


@app.get("/tags")
def tags():
    with SessionLocal() as session:
        return {"items": [_tag_payload(tag) for tag in session.scalars(select(Tag).order_by(Tag.id))]}


class TagBody(BaseModel):
    category_id: int
    name: str = Field(min_length=1, max_length=80)
    color: str = "#4f8071"


@app.post("/tags", status_code=201)
def create_tag(body: TagBody):
    if not HEX_COLOR.fullmatch(body.color):
        raise HTTPException(status_code=422, detail="颜色必须是六位十六进制值")
    with SessionLocal.begin() as session:
        if not session.get(TagCategory, body.category_id):
            raise HTTPException(status_code=404, detail="标签分类不存在")
        exists = session.scalars(
            select(Tag).where(Tag.category_id == body.category_id, Tag.name == body.name.strip())
        ).first()
        if exists:
            raise HTTPException(status_code=409, detail="该分类下标签名称已存在")
        tag = Tag(category_id=body.category_id, name=body.name.strip(), color=body.color)
        session.add(tag)
        session.flush()
        return _tag_payload(tag)


class TagUpdateBody(TagBody):
    version: int


@app.patch("/tags/{tag_id}")
def update_tag(tag_id: int, body: TagUpdateBody):
    if not HEX_COLOR.fullmatch(body.color):
        raise HTTPException(status_code=422, detail="颜色必须是六位十六进制值")
    with SessionLocal.begin() as session:
        tag = session.get(Tag, tag_id)
        if tag is None:
            raise HTTPException(status_code=404, detail="标签不存在")
        if tag.version != body.version:
            raise HTTPException(status_code=409, detail="标签已更新，请刷新后重试")
        if not session.get(TagCategory, body.category_id):
            raise HTTPException(status_code=404, detail="标签分类不存在")
        tag.category_id = body.category_id
        tag.name = body.name.strip()
        tag.color = body.color
        tag.version += 1
        return _tag_payload(tag)


@app.delete("/tags/{tag_id}")
def delete_tag(tag_id: int):
    with SessionLocal.begin() as session:
        tag = session.get(Tag, tag_id)
        if tag is None:
            raise HTTPException(status_code=404, detail="标签不存在")
        for link in session.scalars(select(SecurityTag).where(SecurityTag.tag_id == tag_id)):
            session.delete(link)
        session.delete(tag)
    return {"success": True}


class SecurityTagsBody(BaseModel):
    symbols: list[str] = Field(min_length=1, max_length=100)
    add_tag_ids: list[int] = Field(default_factory=list)
    remove_tag_ids: list[int] = Field(default_factory=list)


@app.post("/security-tags/batch")
def update_security_tags(body: SecurityTagsBody):
    if set(body.add_tag_ids) & set(body.remove_tag_ids):
        raise HTTPException(status_code=422, detail="同一标签不能同时添加和移除")
    with SessionLocal.begin() as session:
        for symbol in body.symbols:
            require_security(session, symbol)
        for tag_id in set(body.add_tag_ids + body.remove_tag_ids):
            if not session.get(Tag, tag_id):
                raise HTTPException(status_code=404, detail=f"标签 {tag_id} 不存在")
        for symbol in set(body.symbols):
            for tag_id in body.add_tag_ids:
                if session.get(SecurityTag, (symbol, tag_id)) is None:
                    session.add(SecurityTag(symbol=symbol, tag_id=tag_id))
            for tag_id in body.remove_tag_ids:
                link = session.get(SecurityTag, (symbol, tag_id))
                if link:
                    session.delete(link)
    return {"affected": len(set(body.symbols))}


def _group_payload(session, group: StockGroup) -> dict:
    members = session.scalars(
        select(StockGroupItem.symbol).where(StockGroupItem.group_id == group.id)
    ).all()
    return {
        "id": group.id,
        "name": group.name,
        "kind": group.kind,
        "filter": json.loads(group.filter_json) if group.filter_json else None,
        "symbols": members,
        "version": group.version,
    }


@app.get("/groups")
def groups():
    with SessionLocal() as session:
        return {"items": [_group_payload(session, group) for group in session.scalars(select(StockGroup).order_by(StockGroup.id))]}


class GroupBody(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    kind: str = "fixed"
    symbols: list[str] = Field(default_factory=list)
    filter: dict | None = None


@app.post("/groups", status_code=201)
def create_group(body: GroupBody):
    if body.kind not in {"fixed", "dynamic"}:
        raise HTTPException(status_code=422, detail="分组类型只能是 fixed 或 dynamic")
    if body.kind == "dynamic" and not body.filter:
        raise HTTPException(status_code=422, detail="动态分组需要筛选条件")
    try:
        with SessionLocal.begin() as session:
            for symbol in set(body.symbols):
                require_security(session, symbol)
            group = StockGroup(
                name=body.name.strip(),
                kind=body.kind,
                filter_json=json.dumps(body.filter) if body.kind == "dynamic" else None,
            )
            session.add(group)
            session.flush()
            if body.kind == "fixed":
                for symbol in set(body.symbols):
                    session.add(StockGroupItem(group_id=group.id, symbol=symbol))
            session.flush()
            return _group_payload(session, group)
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="分组名称已存在") from exc


class GroupMembersBody(BaseModel):
    symbols: list[str] = Field(max_length=100)


@app.put("/groups/{group_id}/members")
def set_group_members(group_id: int, body: GroupMembersBody):
    with SessionLocal.begin() as session:
        group = session.get(StockGroup, group_id)
        if group is None:
            raise HTTPException(status_code=404, detail="分组不存在")
        if group.kind != "fixed":
            raise HTTPException(status_code=422, detail="动态分组成员由筛选条件决定")
        for symbol in set(body.symbols):
            require_security(session, symbol)
        old_items = session.scalars(
            select(StockGroupItem).where(StockGroupItem.group_id == group_id)
        ).all()
        for item in old_items:
            session.delete(item)
        session.flush()
        for symbol in set(body.symbols):
            session.add(StockGroupItem(group_id=group_id, symbol=symbol))
        group.version += 1
        session.flush()
        return _group_payload(session, group)


@app.delete("/groups/{group_id}")
def delete_group(group_id: int):
    with SessionLocal.begin() as session:
        group = session.get(StockGroup, group_id)
        if group is None:
            raise HTTPException(status_code=404, detail="分组不存在")
        for item in session.scalars(
            select(StockGroupItem).where(StockGroupItem.group_id == group_id)
        ):
            session.delete(item)
        session.delete(group)
    return {"success": True}


@app.get("/data-status")
def current_data_status():
    return data_status()


@app.get("/sync-jobs")
def sync_jobs(limit: int = 20):
    with SessionLocal() as session:
        jobs = session.scalars(
            select(SyncJob).order_by(SyncJob.id.desc()).limit(min(max(limit, 1), 100))
        ).all()
        return {"items": [serialize_job(job) for job in jobs]}


@app.get("/sync-jobs/{job_id}")
def sync_job(job_id: int):
    with SessionLocal() as session:
        job = session.get(SyncJob, job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="同步任务不存在")
        return serialize_job(job)


class SyncBody(BaseModel):
    dataset: str
    symbols: list[str] = Field(default_factory=list)


@app.post("/sync-jobs", status_code=202)
def start_sync(body: SyncBody):
    return create_sync_job(body.dataset, body.symbols)


class DataRowsBody(BaseModel):
    symbol: str | None = None
    start: date | None = None
    end: date | None = None
    offset: int = Field(default=0, ge=0)
    size: int = Field(default=50, ge=1, le=100)


@app.post("/datasets/daily/rows/query")
def daily_rows(body: DataRowsBody):
    with SessionLocal() as session:
        statement = select(DailyBar)
        if body.symbol:
            require_security(session, body.symbol)
            statement = statement.where(DailyBar.symbol == body.symbol)
        if body.start:
            statement = statement.where(DailyBar.trade_date >= body.start)
        if body.end:
            statement = statement.where(DailyBar.trade_date <= body.end)
        count = session.scalar(select(func.count()).select_from(statement.subquery())) or 0
        bars = session.scalars(
            statement.order_by(DailyBar.trade_date.desc(), DailyBar.symbol)
            .offset(body.offset)
            .limit(body.size)
        ).all()
        return {
            "items": [{"symbol": bar.symbol, **serialize_bar(bar)} for bar in bars],
            "total": count,
            "offset": body.offset,
            "size": body.size,
            "units": {"price": "CNY", "volume": "shares", "amount": "CNY"},
        }
