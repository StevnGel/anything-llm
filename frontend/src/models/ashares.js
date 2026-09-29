import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

async function request(path, { method = "GET", body, signal } = {}) {
  const response = await fetch(`${API_BASE}/ashares${path}`, {
    method,
    signal,
    headers: {
      ...baseHeaders(),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail || payload.error || `请求失败 (${response.status})`);
  }
  return payload;
}

const AShares = {
  request,
  capabilities: (signal) => request("/capabilities", { signal }),
  status: (signal) => request("/data-status", { signal }),
  query: (body, signal) => request("/securities/query", { method: "POST", body, signal }),
  search: (q, signal) => request(`/securities?q=${encodeURIComponent(q)}`, { signal }),
  detail: (symbol, signal) => request(`/securities/${encodeURIComponent(symbol)}`, { signal }),
  bars: (symbol, params, signal) => {
    const query = new URLSearchParams(params);
    return request(`/securities/${encodeURIComponent(symbol)}/bars?${query}`, { signal });
  },
  batchBars: (body, signal) => request("/bars/batch", { method: "POST", body, signal }),
  compare: (body, signal) => request("/comparisons/query", { method: "POST", body, signal }),
  categories: (signal) => request("/tag-categories", { signal }),
  createCategory: (body) => request("/tag-categories", { method: "POST", body }),
  deleteCategory: (id) => request(`/tag-categories/${id}`, { method: "DELETE" }),
  tags: (signal) => request("/tags", { signal }),
  createTag: (body) => request("/tags", { method: "POST", body }),
  updateTag: (id, body) => request(`/tags/${id}`, { method: "PATCH", body }),
  deleteTag: (id) => request(`/tags/${id}`, { method: "DELETE" }),
  setTags: (body) => request("/security-tags/batch", { method: "POST", body }),
  groups: (signal) => request("/groups", { signal }),
  createGroup: (body) => request("/groups", { method: "POST", body }),
  setGroupMembers: (id, body) => request(`/groups/${id}/members`, { method: "PUT", body }),
  deleteGroup: (id) => request(`/groups/${id}`, { method: "DELETE" }),
  watchlist: (symbol, enabled) => request(`/watchlists/default/items/${encodeURIComponent(symbol)}`, {
    method: enabled ? "PUT" : "DELETE",
  }),
  saveNote: (symbol, body) => request(`/securities/${encodeURIComponent(symbol)}/notes`, {
    method: "PUT",
    body,
  }),
  dailyRows: (body, signal) => request("/datasets/daily/rows/query", {
    method: "POST",
    body,
    signal,
  }),
  jobs: (signal) => request("/sync-jobs", { signal }),
  startJob: (body) => request("/sync-jobs", { method: "POST", body }),
};

export default AShares;
