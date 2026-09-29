# A 股工作台数据服务

本服务向 AnythingLLM 提供已发布的沪深 A 股日线、共享标签、自选、分组、
比较组合与备注。
AnythingLLM 的 `/api/ashares` 路由负责用户鉴权；本服务仅接受内部令牌，默认只监听本机。

## 本地启动

需要 Python 3.12。先在工作区根目录建立虚拟环境并安装依赖：

```bash
python3 -m venv ./tmp/ashare-dev/venv
./tmp/ashare-dev/venv/bin/pip install -r ./anything-llm/ashare-service/requirements.txt
```

在运行环境中设置 `FUYAO_API_KEY` 和随机生成的 `ASHARE_SERVICE_TOKEN`，然后从
`anything-llm/ashare-service/` 启动：

```bash
../../tmp/ashare-dev/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8765
```

AnythingLLM 服务端使用相同的 `ASHARE_SERVICE_TOKEN`，并设置
`ASHARE_SERVICE_URL=http://127.0.0.1:8765`。凭据只通过环境变量或未纳入版本控制的
本地配置注入；`FUYAO_API_KEY` 不传给 AnythingLLM 浏览器或 Express 服务。

`ASHARE_DATABASE_URL` 未设置时使用 `storage/ashares.db`，适合单机试用。
共享部署应使用独立 PostgreSQL 数据库，连接串格式为
`postgresql+psycopg://user:password@host:5432/ashares`。数据库与
`storage/` 中的业务状态需要单独备份，不能把暂存下载文件当作备份。

## 首次使用

1. 在数据中心更新股票池，来源为 Fuyao A 股标的列表；只接纳明确的沪深主板、
   创业板和科创板代码段。
2. 同步最近 10 个交易日日线，建立全市场近期行情。页面显示实际最新交易日和覆盖率。
3. 按需提交全市场近 5 年回填，或针对最多 20 只股票回填近 5 年日线。

全量文件下载约 181 MB（2026-09-29 实测），回填需要额外的数据库与临时磁盘空间。
下载得到的 S3 签名地址只在当前进程内使用；临时 Parquet 与 DuckDB 溢出文件在任务
结束后清理。导入前核对源键、币种、周期、复权方式及 OHLC；失败任务保留已发布分项
和错误状态，重新提交采用证券与交易日唯一键幂等更新。

2026-09-29 的本地验证库包含 5,226 只目标股票和 5,944,056 根近五年未复权日线；
最新交易日 2026-09-28 覆盖 5,209 只。验证库位于 `storage/ashares.db`，属于
业务数据，重新安装依赖或重新构建前端时不应删除。

## 当前边界

当前只开放已验证的未复权日、周、月 K 线，周/月线由本地日线聚合。
前后复权、财务、公告、分钟线、AI 工具和完整的公司行动校验尚未接入，页面不显示模拟数据。
同步线程运行在单个 API 进程中；重启会将未完成任务标为失败，需手动重新提交。
正式多进程部署前应按 `docs/ashare-domain-integration-proposal.md` 拆出可恢复的 Worker、
租约和发布版本管理。
