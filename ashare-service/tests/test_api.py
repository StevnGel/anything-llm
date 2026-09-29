import atexit
import os
import tempfile
from datetime import date
from pathlib import Path

# 测试始终使用任务临时库，不能因外部环境变量误删业务库。
WORKSPACE_TMP = Path(__file__).resolve().parents[3] / "tmp"
WORKSPACE_TMP.mkdir(exist_ok=True)
TEST_DIR = tempfile.TemporaryDirectory(prefix="ashare-test-", dir=WORKSPACE_TMP)
atexit.register(TEST_DIR.cleanup)
os.environ["ASHARE_DATABASE_URL"] = f"sqlite:///{Path(TEST_DIR.name) / 'test.db'}"

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.db import Base, SessionLocal, engine
from app.main import app
from app.models import DailyBar, Security, SecurityTag, StockGroup, Tag, TagCategory
from app.service import _upsert_rows


def seed_securities():
    with SessionLocal.begin() as session:
        session.add_all(
            [
                Security(
                    symbol="600519.SH",
                    code="600519",
                    name="贵州茅台",
                    exchange="SH",
                    board="SSE_MAIN",
                ),
                Security(
                    symbol="300750.SZ",
                    code="300750",
                    name="宁德时代",
                    exchange="SZ",
                    board="CHINEXT",
                ),
            ]
        )


def bar_row(symbol, trade_date, close):
    return {
        "symbol": symbol,
        "trade_date": trade_date,
        "open": close,
        "high": close,
        "low": close,
        "close": close,
        "volume": 0,
        "amount": 0,
        "change_pct": None,
        "turnover_pct": None,
        "source": "test",
    }


def test_auth_target_date_and_idempotent_upsert(monkeypatch):
    monkeypatch.setenv("ASHARE_SERVICE_TOKEN", "test-token")
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    seed_securities()
    with SessionLocal.begin() as session:
        _upsert_rows(
            session,
            DailyBar,
            [bar_row("600519.SH", date(2026, 9, 28), 100)],
            ["symbol", "trade_date"],
        )
        _upsert_rows(
            session,
            DailyBar,
            [bar_row("600519.SH", date(2026, 9, 28), 101)],
            ["symbol", "trade_date"],
        )
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(DailyBar)) == 1

    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
        assert client.get("/data-status").status_code == 401
        response = client.post(
            "/securities/query",
            headers={"X-Internal-Token": "test-token"},
            json={"sort": {"field": "close", "direction": "desc"}},
        )
        assert response.status_code == 200
        result = response.json()
        assert result["target_trade_date"] == "2026-09-28"
        assert result["missing_count"] == 1
        assert result["items"][0]["close"] == 101
        assert result["items"][1]["close"] is None


def test_note_conflict_and_dynamic_group_filter(monkeypatch):
    monkeypatch.setenv("ASHARE_SERVICE_TOKEN", "test-token")
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    seed_securities()
    with SessionLocal.begin() as session:
        category = TagCategory(name="策略")
        session.add(category)
        session.flush()
        tag = Tag(category_id=category.id, name="关注")
        session.add(tag)
        session.flush()
        session.add(SecurityTag(symbol="300750.SZ", tag_id=tag.id))
        session.add(
            StockGroup(
                name="创业板关注",
                kind="dynamic",
                filter_json=f'{{"board":"CHINEXT","include_tag_ids":[{tag.id}]}}',
            )
        )

    headers = {"X-Internal-Token": "test-token"}
    with TestClient(app) as client:
        saved = client.put(
            "/securities/600519.SH/notes",
            headers=headers,
            json={"content": "观察", "version": 0},
        )
        assert saved.status_code == 200
        conflict = client.put(
            "/securities/600519.SH/notes",
            headers=headers,
            json={"content": "覆盖", "version": 0},
        )
        assert conflict.status_code == 409

        result = client.post(
            "/securities/query",
            headers=headers,
            json={"filter": {"group_id": 1}},
        ).json()
        assert [item["symbol"] for item in result["items"]] == ["300750.SZ"]


def test_tag_reference_and_group_version_conflicts(monkeypatch):
    monkeypatch.setenv("ASHARE_SERVICE_TOKEN", "test-token")
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    seed_securities()
    headers = {"X-Internal-Token": "test-token"}

    with TestClient(app) as client:
        blank_category = client.post(
            "/tag-categories", headers=headers, json={"name": "   "}
        )
        assert blank_category.status_code == 422
        first_category = client.post(
            "/tag-categories", headers=headers, json={"name": "策略"}
        ).json()
        second_category = client.post(
            "/tag-categories", headers=headers, json={"name": "状态"}
        ).json()
        category = client.patch(
            f"/tag-categories/{second_category['id']}",
            headers=headers,
            json={"name": "观察状态"},
        )
        assert category.status_code == 200

        tag = client.post(
            "/tags",
            headers=headers,
            json={"category_id": first_category["id"], "name": "关注"},
        ).json()
        duplicate = client.post(
            "/tags",
            headers=headers,
            json={"category_id": second_category["id"], "name": "关注"},
        )
        assert duplicate.status_code == 409

        invalid_group = client.post(
            "/groups",
            headers=headers,
            json={
                "name": "无效条件",
                "kind": "dynamic",
                "filter": {"include_tag_ids": []},
            },
        )
        assert invalid_group.status_code == 422

        dynamic = client.post(
            "/groups",
            headers=headers,
            json={
                "name": "动态关注",
                "kind": "dynamic",
                "filter": {"include_tag_ids": [tag["id"]]},
            },
        ).json()
        referenced = client.delete(f"/tags/{tag['id']}", headers=headers)
        assert referenced.status_code == 409

        fixed = client.post(
            "/groups",
            headers=headers,
            json={"name": "固定关注", "kind": "fixed", "symbols": []},
        ).json()
        updated = client.put(
            f"/groups/{fixed['id']}/members",
            headers=headers,
            json={"symbols": ["600519.SH"], "version": fixed["version"]},
        )
        assert updated.status_code == 200
        stale = client.put(
            f"/groups/{fixed['id']}/members",
            headers=headers,
            json={"symbols": [], "version": fixed["version"]},
        )
        assert stale.status_code == 409
        renamed = client.patch(
            f"/groups/{dynamic['id']}",
            headers=headers,
            json={"name": "动态策略", "version": dynamic["version"]},
        )
        assert renamed.status_code == 200


def test_saved_comparison_contract(monkeypatch):
    monkeypatch.setenv("ASHARE_SERVICE_TOKEN", "test-token")
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    seed_securities()
    headers = {"X-Internal-Token": "test-token"}
    body = {
        "name": "候选股",
        "symbols": ["600519.SH", "300750.SZ"],
        "period": "1w",
        "mode": "grid",
    }

    with TestClient(app) as client:
        saved = client.post("/comparison-sets", headers=headers, json=body)
        assert saved.status_code == 201
        comparison = saved.json()
        assert comparison["symbols"] == body["symbols"]
        assert (
            client.get("/comparison-sets", headers=headers).json()["items"][0]["name"]
            == "候选股"
        )

        updated = client.patch(
            f"/comparison-sets/{comparison['id']}",
            headers=headers,
            json={**body, "name": "重点候选", "version": comparison["version"]},
        )
        assert updated.status_code == 200
        stale = client.patch(
            f"/comparison-sets/{comparison['id']}",
            headers=headers,
            json={**body, "version": comparison["version"]},
        )
        assert stale.status_code == 409
        assert (
            client.delete(
                f"/comparison-sets/{comparison['id']}", headers=headers
            ).status_code
            == 200
        )


def test_comparison_uses_common_base_date(monkeypatch):
    monkeypatch.setenv("ASHARE_SERVICE_TOKEN", "test-token")
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    seed_securities()
    with SessionLocal.begin() as session:
        _upsert_rows(
            session,
            DailyBar,
            [
                bar_row("600519.SH", date(2026, 9, 25), 90),
                bar_row("600519.SH", date(2026, 9, 28), 100),
                bar_row("300750.SZ", date(2026, 9, 28), 200),
            ],
            ["symbol", "trade_date"],
        )

    headers = {"X-Internal-Token": "test-token"}
    with TestClient(app) as client:
        result = client.post(
            "/comparisons/query",
            headers=headers,
            json={"symbols": ["600519.SH", "300750.SZ"]},
        ).json()
        assert result["base_date"] == "2026-09-28"
        assert result["series"]["600519.SH"]["points"] == [
            {"date": "2026-09-28", "value": 100.0}
        ]
        assert result["series"]["300750.SZ"]["points"][0]["value"] == 100
