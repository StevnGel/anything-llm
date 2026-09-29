# AnythingLLM A 股工作台

本仓库基于 AnythingLLM 1.16.2，增加独立于 Workspace 的 A 股工作台。用户可以在同一
Web 应用中查看行情、维护共享标签与分组，并继续使用 AnythingLLM 原有的文档问答、聊天和
Agent 功能。A 股数据由独立的 Python 服务管理，浏览器只访问 AnythingLLM 的同源 API。

## 当前功能

| 页面 | 已实现能力 |
| --- | --- |
| 股票工作台 `/ashares` | 沪深 A 股列表、搜索、板块/自选/标签/分组筛选、排序、K 线预览和批量打标 |
| 股票详情 | 日/周/月 K 线、成交量、标签、自选和共享备注 |
| 多股比较 | 最多 6 只股票的图表与数据比较，保存和管理比较组合 |
| 标签与分组 | 标签分类、颜色、批量打标、固定/动态分组及成员维护 |
| 数据浏览 | 已发布日线的条件查询、分页和当前页 CSV 导出 |
| 数据中心 | 股票池、行情覆盖、同步任务状态与手动补数 |

行情范围是沪深主板、创业板和科创板。当前只发布**未复权**日线，周/月 K 线由日线聚合；
Fuyao 是行情主源，AKShare 用于板块核对。实时行情、分钟线、前后复权、财务、公告和
A 股专用 AI 工具尚未接入。页面不填充模拟行情。

股票、标签、自选、分组、备注和比较组合由所有进入应用的用户共享，**不属于某个
Workspace**。删除 Workspace 不应删除 A 股业务数据。同步任务运行在单个 A 股 API
进程中；服务重启后未完成任务会标记为失败，需要重新提交。

```text
浏览器
  └─ AnythingLLM React 页面
       └─ /api/ashares（Express：沿用 AnythingLLM 鉴权）
            └─ A 股 FastAPI（内部令牌）
                 ├─ SQLite 或 PostgreSQL：已发布行情和共享业务状态
                 └─ Fuyao：股票池与日线下载
```

源码和 Docker 镜像不附带行情数据库。2026-09-29 的一次本地验证库包含 5,226 只目标
股票和 5,944,056 根近五年日线；这是运行环境中的数据，不是新安装后的默认内容。

## 目录与要求

| 路径 | 作用 |
| --- | --- |
| `frontend/` | React 页面；开发时由 Vite 服务，构建后交给 Express 服务 |
| `server/` | AnythingLLM Express API、鉴权、Workspace 与 A 股请求转发 |
| `collector/` | 原有文档采集服务 |
| `ashare-service/` | FastAPI、同步任务、行情数据库与业务状态 |
| `docker/` | AnythingLLM 镜像和整套服务的 Compose 配置 |

本地开发需要 Node.js 18（见 `.nvmrc`）、Yarn 1、Python 3.12、`uv` 和可用的
`FUYAO_API_KEY`。Docker 部署需要 Docker Engine 与 Compose；建议为全市场回填预留
额外内存和磁盘空间。本文命令以 Linux、macOS 或 WSL 的 POSIX Shell 为例。

### 关键配置

| 变量 | 放置位置 | 用途 |
| --- | --- | --- |
| `FUYAO_API_KEY` | A 股服务环境 | 必填；只提供给 Python 服务，不进入浏览器或 Express |
| `ASHARE_SERVICE_TOKEN` | A 股服务和 Express | 必填；两端使用同一个随机值，供内部请求认证 |
| `ASHARE_SERVICE_URL` | Express 环境 | 本地为 `http://127.0.0.1:8765`；Compose 内为服务名地址 |
| `ASHARE_DATABASE_URL` | A 股服务环境 | 可选；默认 `ashare-service/storage/ashares.db` |
| `VITE_API_BASE` | 前端构建环境 | 使用 `/api`；开发时由 Vite 代理到 Express |
| `STORAGE_DIR` | Express 环境 | AnythingLLM 的持久化目录，与 A 股数据库分开 |

用 `openssl rand -hex 32` 生成内部令牌。`.env` 文件已经被 Git 忽略；不要把真实密钥
写进 README、前端环境变量或镜像。AnythingLLM 的 LLM Provider 还需要按实际使用的
模型单独配置，与 A 股行情密钥无关。

## 本地开发

以下命令从仓库根目录执行。首次安装依赖并准备 AnythingLLM 数据库：

```bash
corepack enable
yarn setup
uv venv --python 3.12 ashare-service/.venv
uv pip install --python ashare-service/.venv/bin/python -r ashare-service/requirements.txt
cp -n ashare-service/.env.example ashare-service/.env
```

`yarn setup` 会安装三部分 JavaScript 依赖、生成 Prisma Client、迁移数据库，并创建
`server/.env.development`、`frontend/.env` 和 `collector/.env`。检查
`frontend/.env` 中的 `VITE_API_BASE=/api`。已有数据的环境应先备份，再执行迁移。

填写 `ashare-service/.env` 中的 `FUYAO_API_KEY` 和 `ASHARE_SERVICE_TOKEN`；在
`server/.env.development` 中设置**相同**的 `ASHARE_SERVICE_TOKEN`，并设置：

```dotenv
SERVER_HOST=127.0.0.1
ASHARE_SERVICE_URL=http://127.0.0.1:8765
```

配置文件中的凭据值必须由部署者填写；示例文件不能直接用于生产。分别打开四个终端：

```bash
# 终端 1：A 股 API；.env 中的值按 Shell 语法填写，特殊字符需加引号。
cd ashare-service
set -a
. ./.env
set +a
.venv/bin/python -m uvicorn app.main:app \
  --host 127.0.0.1 \
  --port 8765
```

```bash
# 终端 2、3、4 分别在仓库根目录执行。
yarn dev:server
yarn dev:collector
yarn dev:frontend
```

打开 `http://127.0.0.1:3000/ashares`。Vite 在 3000 端口将 `/api` 转发到 Express
的 3001 端口；浏览器不需要直接访问 3001 或 8765。首次进入数据中心，先更新股票池，
再同步最近交易日；按需要运行近五年全量回填或指定股票的历史补数。

### 非容器生产部署

先按上面的步骤安装依赖、配置 A 股服务；生产环境的 Express 使用 `server/.env`，
其中要配置持久化的 `STORAGE_DIR`、随机生成的 `JWT_SECRET`、`SIG_KEY` 和 `SIG_SALT`，
以及 A 股服务地址与内部令牌。构建前端并放入 Express 的静态目录：

```bash
cd frontend
yarn build
cd ..
mkdir -p server/public
cp -a frontend/dist/. server/public/
cd server
npx prisma generate --schema=./prisma/schema.prisma
npx prisma migrate deploy --schema=./prisma/schema.prisma
```

随后运行 A 股 API；在 `server/` 目录执行 `NODE_ENV=production node index.js`，
在 `collector/` 目录执行相同的 Node 命令。生产环境应使用进程管理器保持三项服务运行。
对外只发布 Express 端口，并在反向代理中同时转发 HTTP 和 Agent WebSocket。

## Docker Compose 部署

Compose 构建 AnythingLLM 与 A 股服务两个镜像。Express 容器包含前端静态文件和
Collector，监听宿主机 3001；A 股服务只在容器内部网络监听 8765。默认使用持久化
SQLite，单实例运行。部署前先确认宿主机 3001 端口空闲。

```bash
cp -n docker/.env.example docker/.env
cp -n ashare-service/.env.example ashare-service/.env
mkdir -p ashare-service/storage
```

在 `docker/.env` 中填写 `ASHARE_SERVICE_TOKEN`，在 `ashare-service/.env` 中填写
`FUYAO_API_KEY`。Compose 会把 `docker/.env` 的令牌注入两个容器；A 股服务文件中的
同名变量在 Docker 模式下会被覆盖。按宿主机文件所有者调整 `docker/.env` 中的
`UID`、`GID`，确保容器可写两个 `storage/` 目录。不要把 Fuyao Key 放进
`docker/.env`，因为该文件会提供给 AnythingLLM 容器。

```bash
cd docker
docker compose up -d --build
docker compose ps
curl --fail http://127.0.0.1:3001/api/ping
```

确认 `docker compose ps` 中 A 股服务为 healthy，再打开
`http://127.0.0.1:3001/ashares`，登录后检查数据中心。新部署的行情库为空，仍需提交
股票池与日线同步任务。查看日志使用 `docker compose logs --tail=100 anything-llm ashare-service`；
停止服务使用 `docker compose down`，不会删除 bind mount 中的业务数据。

若使用 PostgreSQL，在 `ashare-service/.env` 设置
`ASHARE_DATABASE_URL=postgresql+psycopg://user:password@host:5432/ashares`，
并单独部署、备份 PostgreSQL。容器中的 `localhost` 指容器自身，数据库地址应使用
可从 A 股容器访问的主机名。

## 验证、备份与排障

- 页面持续显示加载状态时，先检查 3001 的 `/api/onboarding` 和
  `/api/ashares/data-status`。开发模式的 `VITE_API_BASE` 应为 `/api`；经端口转发访问
  时，不要把浏览器请求写死到 `127.0.0.1:3001`。
- A 股接口返回 503 时，检查 Python 服务是否存活、`ASHARE_SERVICE_URL` 是否可达，
  以及两端 `ASHARE_SERVICE_TOKEN` 是否一致。不要在日志中打印令牌。
- 删除 Workspace 不影响 A 股业务库；若 Express 进程异常退出，检查服务日志和
  `@lancedb/lancedb` 原生依赖是否完整安装。
- 备份 `server/storage/`、`ashare-service/storage/` 和受保护的配置文件；若改用
  PostgreSQL，还需备份该数据库。不要把临时下载文件当作业务备份。

代码检查可运行 `cd frontend && yarn lint:check`。A 股服务的测试从 `ashare-service/`
目录执行，先用 `uv pip install --python .venv/bin/python pytest httpx` 安装测试依赖，
再运行 `.venv/bin/python -m pytest tests`。根 README 是本分支的部署入口；
代码遵循 [MIT 许可](LICENSE)。
