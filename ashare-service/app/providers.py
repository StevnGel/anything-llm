"""Fuyao 行情与 AKShare 交易所名单适配。"""

import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pyarrow.parquet as parquet
import requests

SHANGHAI = ZoneInfo("Asia/Shanghai")
FUYAO_BASE_URL = "https://fuyao.aicubes.cn"
DAILY_COLUMNS = {
    "thscode",
    "currency",
    "interval",
    "adjusted",
    "date_ms",
    "open_price",
    "high_price",
    "low_price",
    "close_price",
    "volume",
    "turnover",
}


class ProviderError(Exception):
    pass


def board_for(symbol: str) -> str | None:
    """只纳入已确认的沪深 A 股代码段，未知代码等待名单核对。"""
    code, _, exchange = symbol.partition(".")
    if len(code) != 6 or not code.isdigit():
        return None
    if exchange == "SH":
        if code.startswith(("688", "689")):
            return "STAR"
        if code.startswith(("600", "601", "603", "605")):
            return "SSE_MAIN"
    if exchange == "SZ":
        if code.startswith(("300", "301")):
            return "CHINEXT"
        if code.startswith(("000", "001", "002", "003")):
            return "SZSE_MAIN"
    return None


def trade_date_from_ms(value: int):
    return datetime.fromtimestamp(value / 1000, SHANGHAI).date()


def utc_milliseconds(value: datetime) -> int:
    return int(value.astimezone(timezone.utc).timestamp() * 1000)


class FuyaoClient:
    def __init__(self, api_key: str | None = None):
        self.api_key = api_key or os.getenv("FUYAO_API_KEY")
        if not self.api_key:
            raise ProviderError("未配置 FUYAO_API_KEY")
        self.session = requests.Session()
        self.session.headers.update({"X-api-key": self.api_key})

    def get(self, path: str, params: dict | None = None) -> dict:
        try:
            response = self.session.get(
                f"{FUYAO_BASE_URL}{path}", params=params, timeout=30
            )
            response.raise_for_status()
            payload = response.json()
        except (requests.RequestException, ValueError) as exc:
            raise ProviderError("Fuyao 请求失败，请稍后重试或检查网络") from exc

        if payload.get("code") != 0:
            code = payload.get("code")
            request_id = payload.get("request_id", "unknown")
            raise ProviderError(f"Fuyao 返回业务错误 {code}，request_id={request_id}")
        return payload.get("data") or {}

    def securities(self) -> list[dict]:
        items = []
        offset = 0
        page_size = 5000
        while True:
            page = self.get(
                "/api/meta/tickers/list",
                {"asset_type": "a-share", "limit": page_size, "offset": offset},
            ).get("item", [])
            items.extend(page)
            if len(page) < page_size:
                return items
            offset += page_size

    def bars(self, symbol: str, start_ms: int, end_ms: int) -> list[dict]:
        return self.get(
            "/api/a-share/prices/historical",
            {
                "thscode": symbol,
                "interval": "1d",
                "start": start_ms,
                "end": end_ms,
                "adjust": "none",
            },
        ).get("item", [])

    def recent_dump(self, destination: Path) -> Path:
        data = self.get("/api/dump/market-dumps/daily-k-10d/download-url")
        url = data.get("presigned_url")
        if not isinstance(url, str) or not url.startswith("https://"):
            raise ProviderError("Fuyao 未返回有效的近期日线下载地址")

        # 预签名 URL 只在内存中使用，不写入文件名、数据库或错误日志。
        try:
            with requests.get(url, stream=True, timeout=(15, 120)) as response:
                response.raise_for_status()
                with destination.open("wb") as output:
                    for chunk in response.iter_content(chunk_size=1024 * 1024):
                        output.write(chunk)
        except requests.RequestException as exc:
            raise ProviderError("Fuyao 近期日线下载失败，请重新发起同步") from exc
        return destination


def load_recent_dump(client: FuyaoClient, storage_dir: Path) -> list[dict]:
    """下载文件仅在一次同步中使用，退出临时目录时清除。"""
    storage_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="fuyao-", dir=storage_dir) as temp_dir:
        dump_path = client.recent_dump(Path(temp_dir) / "daily.parquet")
        source = parquet.ParquetFile(dump_path)
        if not DAILY_COLUMNS.issubset(source.schema.names):
            raise ProviderError("Fuyao 日线文件字段与已验证契约不符")

        rows = []
        seen = set()
        for batch in source.iter_batches(batch_size=5000):
            for row in batch.to_pylist():
                key = (row["thscode"], row["date_ms"])
                if key in seen:
                    raise ProviderError("Fuyao 日线文件包含重复证券与日期，未发布")
                seen.add(key)
                rows.append(row)
        return rows


def akshare_board_names() -> dict[str, str]:
    """交易所接口可用时提供独立板块核对；失败不伪造核对结果。"""
    import akshare as ak

    result = {}
    ak.stock_info_sh_name_code.cache_clear()
    ak.stock_info_sz_name_code.cache_clear()
    for label, board in (("主板A股", "SSE_MAIN"), ("科创板", "STAR")):
        frame = ak.stock_info_sh_name_code(symbol=label)
        for code in frame["证券代码"].astype(str).str.zfill(6):
            result[f"{code}.SH"] = board

    frame = ak.stock_info_sz_name_code(symbol="A股列表")
    for _, row in frame.iterrows():
        board = "CHINEXT" if row["板块"] == "创业板" else "SZSE_MAIN"
        result[f"{str(row['A股代码']).zfill(6)}.SZ"] = board
    return result
