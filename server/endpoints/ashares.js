const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");

const SERVICE_URL = process.env.ASHARE_SERVICE_URL || "http://127.0.0.1:8765";

async function forwardToAShares(request, response) {
  const serviceToken = process.env.ASHARE_SERVICE_TOKEN;
  if (!serviceToken) {
    return response.status(503).json({ error: "A 股数据服务尚未配置" });
  }

  const incoming = new URL(request.originalUrl, "http://anythingllm.local");
  const target = new URL(SERVICE_URL);
  target.pathname = incoming.pathname.replace(/^\/api\/ashares/, "") || "/";
  target.search = incoming.search;

  const headers = {
    "X-Internal-Token": serviceToken,
  };
  const options = {
    method: request.method,
    headers,
    signal: AbortSignal.timeout(35_000),
  };
  if (!["GET", "HEAD"].includes(request.method)) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(request.body || {});
  }

  try {
    const upstream = await fetch(target, options);
    const body = await upstream.text();
    return response
      .status(upstream.status)
      .type(upstream.headers.get("content-type") || "application/json")
      .send(body);
  } catch (error) {
    console.error("A 股数据服务请求失败:", error.message);
    return response.status(503).json({ error: "A 股数据服务暂时不可用" });
  }
}

function ashareEndpoints(app) {
  if (!app) return;

  app.post(
    "/ashares/sync-jobs",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    forwardToAShares
  );
  app.use("/ashares", validatedRequest, forwardToAShares);
}

module.exports = { ashareEndpoints };
