"""行情与共享业务资产；业务数据不以 AnythingLLM 用户或 Workspace 分区。"""

from datetime import date, datetime, timezone

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Security(Base):
    __tablename__ = "securities"

    symbol: Mapped[str] = mapped_column(String(9), primary_key=True)
    code: Mapped[str] = mapped_column(String(6), index=True)
    name: Mapped[str] = mapped_column(String(100), index=True)
    exchange: Mapped[str] = mapped_column(String(2))
    board: Mapped[str] = mapped_column(String(20), index=True)
    industry: Mapped[str | None] = mapped_column(String(100))
    listed_on: Mapped[date | None] = mapped_column(Date)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class DailyBar(Base):
    __tablename__ = "bars_daily"

    symbol: Mapped[str] = mapped_column(ForeignKey("securities.symbol"), primary_key=True)
    trade_date: Mapped[date] = mapped_column(Date, primary_key=True)
    open: Mapped[float] = mapped_column(Float)
    high: Mapped[float] = mapped_column(Float)
    low: Mapped[float] = mapped_column(Float)
    close: Mapped[float] = mapped_column(Float)
    volume: Mapped[float | None] = mapped_column(Float)
    amount: Mapped[float | None] = mapped_column(Float)
    change_pct: Mapped[float | None] = mapped_column(Float)
    turnover_pct: Mapped[float | None] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(40), default="akshare_eastmoney")
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class TagCategory(Base):
    __tablename__ = "tag_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("tag_categories.id"))
    name: Mapped[str] = mapped_column(String(80))
    color: Mapped[str] = mapped_column(String(7), default="#4f8071")
    version: Mapped[int] = mapped_column(Integer, default=1)


class SecurityTag(Base):
    __tablename__ = "security_tag_links"

    symbol: Mapped[str] = mapped_column(ForeignKey("securities.symbol"), primary_key=True)
    tag_id: Mapped[int] = mapped_column(ForeignKey("tags.id"), primary_key=True)


class WatchlistItem(Base):
    __tablename__ = "watchlist_items"

    symbol: Mapped[str] = mapped_column(ForeignKey("securities.symbol"), primary_key=True)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class SecurityNote(Base):
    __tablename__ = "security_notes"

    symbol: Mapped[str] = mapped_column(ForeignKey("securities.symbol"), primary_key=True)
    content: Mapped[str] = mapped_column(Text, default="")
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class StockGroup(Base):
    __tablename__ = "stock_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    kind: Mapped[str] = mapped_column(String(10), default="fixed")
    filter_json: Mapped[str | None] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, default=1)


class StockGroupItem(Base):
    __tablename__ = "stock_group_items"

    group_id: Mapped[int] = mapped_column(ForeignKey("stock_groups.id"), primary_key=True)
    symbol: Mapped[str] = mapped_column(ForeignKey("securities.symbol"), primary_key=True)


class SyncJob(Base):
    __tablename__ = "sync_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    dataset: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(20), default="queued")
    targets_json: Mapped[str] = mapped_column(Text, default="[]")
    total: Mapped[int] = mapped_column(Integer, default=0)
    completed: Mapped[int] = mapped_column(Integer, default=0)
    failed: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
