# 构建阶段：下载与当前 Python 版本匹配的依赖制品。
FROM python:3.12-slim-bookworm AS build

WORKDIR /build

COPY requirements.txt ./

RUN python -m pip wheel \
    --no-cache-dir \
    --wheel-dir /wheels \
    -r requirements.txt

# 依赖阶段：安装离线制品，供检查与运行阶段复用。
FROM python:3.12-slim-bookworm AS dependencies

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY --from=build /wheels /wheels
COPY requirements.txt ./

RUN python -m pip install \
    --no-cache-dir \
    --no-index \
    --find-links=/wheels \
    -r requirements.txt \
    && rm -rf /wheels

COPY app ./app

# 检查阶段：验证服务模块可导入；可用 --target test 单独执行。
FROM dependencies AS test

RUN python -c "import app.main"

# 运行阶段：仅保留服务代码和运行依赖；业务数据由 Compose 挂载。
FROM dependencies AS runtime

RUN mkdir -p /app/storage

EXPOSE 8765

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8765"]
