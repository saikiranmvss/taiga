import { initMobileSheets } from "./mobile-ui.js";
import {
  applyFilters,
  collectFilters,
  readStore,
  setSelectValue,
  writeStore,
} from "./filter-persist.js";
import { bindStatusEditors, closeStatusMenu } from "./status-picker.js";

const FILTER_STORE_KEY = "tp_team_filters";
const FILTER_DEFAULTS = {
  q: "",
  type: "all",
  project: "",
  status: "",
  sprint: "",
  updated: "all",
  unread: "all",
  closed: "open",
  sort: "updated",
  teammate: "all",
  view: "list",
};

const views = {
  login: document.getElementById("view-login"),
  work: document.getElementById("view-team"),
  detail: document.getElementById("view-detail"),
};

const els = {
  headerUser: document.getElementById("header-user"),
  loginForm: document.getElementById("login-form"),
  loginError: document.getElementById("login-error"),
  searchInput: document.getElementById("search-input"),
  searchBtn: document.getElementById("search-btn"),
  filterType: document.getElementById("filter-type"),
  filterProject: document.getElementById("filter-project"),
  filterStatus: document.getElementById("filter-status"),
  filterSprint: document.getElementById("filter-sprint"),
  filterUpdated: document.getElementById("filter-updated"),
  filterUnread: document.getElementById("filter-unread"),
  filterClosed: document.getElementById("filter-closed"),
  filterSort: document.getElementById("filter-sort"),
  filterTeammate: document.getElementById("filter-teammate"),
  teammateMeta: document.getElementById("teammate-meta"),
  summaryGrid: document.getElementById("summary-grid"),
  statusGrid: document.getElementById("status-grid"),
  workStatus: document.getElementById("work-status"),
  workList: document.getElementById("work-list"),
  detailTitle: document.getElementById("detail-title"),
  detailMeta: document.getElementById("detail-meta"),
  detailBadges: document.getElementById("detail-badges"),
  detailSide: document.getElementById("detail-side"),
  historyList: document.getElementById("history-list"),
  commentInput: document.getElementById("comment-input"),
  commentError: document.getElementById("comment-error"),
  openTaigaBtn: document.getElementById("open-taiga-btn"),
};

function filterFieldMap() {
  return {
    q: els.searchInput,
    type: els.filterType,
    project: els.filterProject,
    status: els.filterStatus,
    sprint: els.filterSprint,
    updated: els.filterUpdated,
    unread: els.filterUnread,
    closed: els.filterClosed,
    sort: els.filterSort,
    teammate: els.filterTeammate,
  };
}

function saveFilters(extra = {}) {
  const state = {
    ...FILTER_DEFAULTS,
    ...collectFilters(filterFieldMap()),
    view: viewMode,
    ...extra,
  };
  writeStore(FILTER_STORE_KEY, state);
  if (state.teammate != null) {
    localStorage.setItem("tp_selected_teammate", String(state.teammate));
  }
}

function restoreFilters() {
  const legacyTeammate = localStorage.getItem("tp_selected_teammate");
  const saved = {
    ...readStore(FILTER_STORE_KEY),
    ...(legacyTeammate && !readStore(FILTER_STORE_KEY).teammate
      ? { teammate: legacyTeammate }
      : {}),
  };
  return applyFilters(filterFieldMap(), saved, FILTER_DEFAULTS);
}

function resetFiltersToDefaults() {
  applyFilters(filterFieldMap(), FILTER_DEFAULTS, FILTER_DEFAULTS);
  saveFilters({ view: viewMode });
  updateTeammateMeta();
}

let currentUser = null;
let currentItem = null;
let itemsCache = [];
let teammatesCache = [];
let searchTimer = null;
let viewMode =
  readStore(FILTER_STORE_KEY).view || localStorage.getItem("tp_team_view_mode") || "list";

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function show(view) {
  Object.values(views).forEach((el) => el.classList.add("hidden"));
  views[view].classList.remove("hidden");
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function initials(name = "") {
  return (
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() || "")
      .join("") || "?"
  );
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function relativeTime(value) {
  if (!value) return "";
  const t = Date.parse(value);
  if (!t) return "";
  const sec = Math.round((Date.now() - t) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 86400 * 7) return `${Math.floor(sec / 86400)}d ago`;
  return formatDate(value);
}

function typeLabel(type) {
  if (type === "userstory") return "Story";
  if (type === "task") return "Task";
  if (type === "issue") return "Issue";
  return type;
}

function statusVars(color) {
  const c = color || "#2f6f5e";
  return `--status-color:${escapeHtml(c)}`;
}

function statusControlHtml(item, { mode = "badge", emptyLabel = "—" } = {}) {
  const name = item.status_name || emptyLabel;
  if (mode === "badge" && !item.status_name) return "";
  const cls = mode === "pill" ? "status-pill status-edit" : "badge status-badge status-edit";
  return `<button type="button" class="${cls}" style="${statusVars(item.status_color)}"
      data-status-edit="1"
      data-type="${escapeHtml(item.type)}"
      data-id="${item.id}"
      data-project="${item.project_id || ""}"
      data-status-id="${item.status_id || ""}"
      data-stop="1"
      title="Change status">
      ${mode === "pill" ? `<i class="dot" aria-hidden="true"></i>` : ""}
      <span class="status-edit-label">${escapeHtml(name)}</span>
      <span class="status-caret" aria-hidden="true">▾</span>
    </button>`;
}

function statusBadgeHtml(item) {
  return statusControlHtml(item, { mode: "badge" });
}

function statusPillHtml(item, emptyLabel = "—") {
  return statusControlHtml(item, { mode: "pill", emptyLabel });
}

function taigaLink(item) {
  if (!item?.taiga_url) return "";
  return `<a class="btn btn-ghost btn-tiny btn-linkish" href="${escapeHtml(item.taiga_url)}" target="_blank" rel="noopener noreferrer" data-stop="1">Taiga ↗</a>`;
}

function setViewMode(mode) {
  viewMode = mode || "list";
  localStorage.setItem("tp_team_view_mode", viewMode);
  saveFilters({ view: viewMode });
  document.querySelectorAll(".view-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-view") === viewMode);
  });
  els.workList.classList.remove("view-list", "view-grid", "view-table");
  els.workList.classList.add(`view-${viewMode}`);
  renderWork(itemsCache, lastSummary, lastWarnings);
}

let lastSummary = null;
let lastWarnings = [];

function renderHeader(user) {
  if (!user) {
    els.headerUser.classList.add("hidden");
    els.headerUser.innerHTML = "";
    return;
  }
  els.headerUser.classList.remove("hidden");
  els.headerUser.innerHTML = `
    <div class="user-meta">
      <div>${escapeHtml(user.full_name_display || user.username)}</div>
      <small>${escapeHtml(user.email || "")}</small>
    </div>
    <div class="avatar">${escapeHtml(initials(user.full_name_display || user.username))}</div>
    <button class="btn btn-ghost" id="logout-btn" type="button">Logout</button>
  `;
  document.getElementById("logout-btn").onclick = async () => {
    await api("/api/logout", { method: "POST", body: "{}" });
    currentUser = null;
    renderHeader(null);
    show("login");
  };
}

function fillSelect(select, options) {
  const first = select.options[0]?.outerHTML || "";
  const extra =
    select.id === "filter-sprint" ? `<option value="__none__">No sprint</option>` : "";
  select.innerHTML =
    first +
    extra +
    options
      .map((o) => {
        if (typeof o === "string") {
          return `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`;
        }
        return `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`;
      })
      .join("");
}

function selectedTeammate() {
  const raw = els.filterTeammate?.value || "all";
  if (raw === "all") return { id: "all", full_name_display: "All teammates" };
  const id = Number(raw);
  if (!id) return null;
  return teammatesCache.find((t) => t.id === id) || { id };
}

function updateTeammateMeta() {
  const mate = selectedTeammate();
  if (!mate) {
    els.teammateMeta.textContent = "Choose All or a teammate to load the board.";
    return;
  }
  if (mate.id === "all") {
    els.teammateMeta.textContent = `Showing tickets assigned to all teammates (${teammatesCache.length}). Use filters/search to narrow.`;
    return;
  }
  const label = mate.full_name_display || mate.username || `User #${mate.id}`;
  const uname = mate.username ? ` · @${mate.username}` : "";
  els.teammateMeta.textContent = `Showing tickets assigned to ${label}${uname}`;
}

function queryFromFilters() {
  const params = new URLSearchParams();
  const mate = selectedTeammate();
  if (mate?.id === "all") params.set("user_id", "all");
  else if (mate?.id) params.set("user_id", String(mate.id));
  const q = els.searchInput.value.trim();
  if (q) params.set("q", q);
  params.set("type", els.filterType.value);
  if (els.filterProject.value) params.set("project", els.filterProject.value);
  if (els.filterStatus.value) params.set("status", els.filterStatus.value);
  if (els.filterSprint.value) params.set("sprint", els.filterSprint.value);
  params.set("updated", els.filterUpdated.value);
  params.set("unread", els.filterUnread.value);
  params.set("closed", els.filterClosed.value);
  params.set("sort", els.filterSort.value);
  return params.toString();
}

function renderSummary(summary) {
  if (!summary) {
    els.summaryGrid.innerHTML = "";
    return;
  }
  els.summaryGrid.innerHTML = `
    <div class="stat-card"><span>Showing</span><strong>${summary.total}</strong></div>
    <div class="stat-card"><span>Unread</span><strong>${summary.unread}</strong></div>
    <div class="stat-card"><span>Stories / Tasks / Issues</span><strong>${summary.by_type.userstory || 0} / ${summary.by_type.task || 0} / ${summary.by_type.issue || 0}</strong></div>
    <div class="stat-card"><span>Blocked</span><strong>${summary.blocked || 0}</strong></div>
  `;
}

function renderStatusGrid(summary) {
  const statuses = summary?.by_status || [];
  if (!statuses.length) {
    els.statusGrid.innerHTML = "";
    return;
  }
  els.statusGrid.innerHTML = statuses
    .map(
      (s) => `
      <button class="status-card" type="button" data-status="${escapeHtml(s.name)}" style="${statusVars(s.color)}">
        <span><i class="dot" aria-hidden="true"></i>${escapeHtml(s.name)}</span>
        <strong>${s.count}</strong>
      </button>`
    )
    .join("");

  els.statusGrid.querySelectorAll(".status-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      setSelectValue(els.filterStatus, btn.getAttribute("data-status") || "");
      saveFilters();
      loadWork();
    });
  });
}

function badgesHtml(item) {
  return `
    <div class="badge-row">
      <span class="badge type-${item.type}">${escapeHtml(typeLabel(item.type))}</span>
      <span class="badge">#${item.ref ?? item.id}</span>
      ${item.is_unread ? `<span class="badge unread">Unread</span>` : ""}
      ${item.is_blocked ? `<span class="badge blocked">Blocked</span>` : ""}
      ${statusBadgeHtml(item)}
    </div>`;
}

function bindStopLinks(root) {
  root.querySelectorAll("[data-stop]").forEach((el) => {
    el.addEventListener("click", (e) => e.stopPropagation());
  });
}

function renderList(items) {
  const showAssignee = selectedTeammate()?.id === "all";
  return items
    .map(
      (item) => `
      <div class="work-item" data-type="${item.type}" data-id="${item.id}">
        ${badgesHtml(item)}
        <div class="top"><div class="subject">${escapeHtml(item.subject)}</div></div>
        <div class="meta">
          ${showAssignee ? `${escapeHtml(item.assigned_name || "Unassigned")} · ` : ""}
          ${escapeHtml(item.project_name || "Project")}
          · ${escapeHtml(item.milestone_name || "No sprint")}
          · updated ${escapeHtml(relativeTime(item.modified_date))}
          ${item.total_comments != null ? ` · ${item.total_comments} comment(s)` : ""}
        </div>
        <div class="item-actions">
          <button class="btn btn-primary btn-tiny" type="button" data-open="${item.type}:${item.id}">View</button>
          ${taigaLink(item)}
        </div>
      </div>`
    )
    .join("");
}

function renderGrid(items) {
  const showAssignee = selectedTeammate()?.id === "all";
  return items
    .map(
      (item) => `
      <article class="ticket-card" data-type="${item.type}" data-id="${item.id}">
        <div class="card-ref">${escapeHtml(typeLabel(item.type))} #${item.ref ?? item.id}</div>
        ${badgesHtml(item)}
        <div class="subject">${escapeHtml(item.subject)}</div>
        ${statusPillHtml(item, "No status")}
        <div class="meta">
          ${showAssignee ? `${escapeHtml(item.assigned_name || "Unassigned")}<br />` : ""}
          ${escapeHtml(item.project_name || "Project")}<br />
          ${escapeHtml(item.milestone_name || "No sprint")} · ${escapeHtml(relativeTime(item.modified_date))}
        </div>
        <div class="card-actions">
          <button class="btn btn-primary btn-tiny" type="button" data-open="${item.type}:${item.id}">View</button>
          ${taigaLink(item)}
        </div>
      </article>`
    )
    .join("");
}

function renderTable(items) {
  const showAssignee = selectedTeammate()?.id === "all";
  const rows = items
    .map(
      (item) => `
      <tr>
        <td><strong>#${item.ref ?? item.id}</strong></td>
        <td><span class="badge type-${item.type}">${escapeHtml(typeLabel(item.type))}</span></td>
        <td class="subject-cell">${escapeHtml(item.subject)}</td>
        ${showAssignee ? `<td>${escapeHtml(item.assigned_name || "—")}</td>` : ""}
        <td>${statusPillHtml(item)}</td>
        <td>${escapeHtml(item.project_name || "—")}</td>
        <td>${escapeHtml(item.milestone_name || "—")}</td>
        <td>${item.is_unread ? `<span class="badge unread">Unread</span>` : `<span class="badge">Seen</span>`}</td>
        <td>${escapeHtml(relativeTime(item.modified_date))}</td>
        <td class="actions-cell">
          <button class="btn btn-primary btn-tiny" type="button" data-open="${item.type}:${item.id}">View</button>
          ${taigaLink(item)}
        </td>
      </tr>`
    )
    .join("");

  return `
    <table class="tickets-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Type</th>
          <th>Subject</th>
          ${showAssignee ? "<th>Assignee</th>" : ""}
          <th>Status</th>
          <th>Project</th>
          <th>Sprint</th>
          <th>Read</th>
          <th>Updated</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderWork(items, summary, warnings = []) {
  itemsCache = items;
  lastSummary = summary;
  lastWarnings = warnings;
  renderSummary(summary);
  renderStatusGrid(summary);

  const warn = warnings?.length ? ` · ${warnings.join("; ")}` : "";
  els.workStatus.textContent = `${items.length} ticket(s) · ${viewMode} view${warn}`;

  els.workList.classList.remove("view-list", "view-grid", "view-table");
  els.workList.classList.add(`view-${viewMode}`);

  if (!items.length) {
    els.workList.innerHTML = `<div class="panel"><p class="muted" style="margin:0">No tickets match. Clear filters or broaden search.</p></div>`;
    return;
  }

  if (viewMode === "grid") els.workList.innerHTML = renderGrid(items);
  else if (viewMode === "table") els.workList.innerHTML = renderTable(items);
  else els.workList.innerHTML = renderList(items);

  bindStopLinks(els.workList);
  bindStatusEditors(els.workList, {
    api,
    findItem: (type, id) => itemsCache.find((i) => i.type === type && i.id === id),
    onChanged: async () => {
      closeStatusMenu();
      await loadWork();
    },
  });
  els.workList.querySelectorAll("[data-open]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const [type, id] = btn.getAttribute("data-open").split(":");
      openItem(type, Number(id));
    });
  });
}

function renderHistory(events) {
  if (!events?.length) {
    els.historyList.innerHTML = `<p class="muted">No activity yet.</p>`;
    return;
  }

  els.historyList.innerHTML = events
    .map((ev) => {
      const changes = (ev.changes || [])
        .map(
          (ch) =>
            `<div><strong>${escapeHtml(ch.field)}</strong>: <em>${escapeHtml(ch.from)}</em> → <strong>${escapeHtml(ch.to)}</strong></div>`
        )
        .join("");
      return `
        <article class="history-item">
          <div class="who">
            <strong>${escapeHtml(ev.user_name)}</strong>
            <span class="meta">${escapeHtml(relativeTime(ev.created_at))} · ${escapeHtml(formatDate(ev.created_at))}</span>
          </div>
          <div class="event-title">${escapeHtml(ev.title)}</div>
          ${ev.body ? `<div class="body">${escapeHtml(ev.body)}</div>` : ""}
          ${changes ? `<div class="change-list">${changes}</div>` : ""}
        </article>`;
    })
    .join("");
}

function setOpenTaiga(url) {
  if (!els.openTaigaBtn) return;
  if (url) {
    els.openTaigaBtn.href = url;
    els.openTaigaBtn.classList.remove("hidden");
  } else {
    els.openTaigaBtn.href = "#";
    els.openTaigaBtn.classList.add("hidden");
  }
}

function bindDetailStatusEditors() {
  bindStatusEditors(els.detailBadges, {
    api,
    findItem: () => currentItem,
    onChanged: async (item) => {
      if (item) currentItem = { ...currentItem, ...item };
      await openItem(currentItem.type, currentItem.id);
    },
  });
  bindStatusEditors(els.detailSide, {
    api,
    findItem: () => currentItem,
    onChanged: async (item) => {
      if (item) currentItem = { ...currentItem, ...item };
      await openItem(currentItem.type, currentItem.id);
    },
  });
}

function renderDetailChrome(type, id) {
  els.detailBadges.innerHTML = `
    <span class="badge type-${type}">${escapeHtml(typeLabel(type))}</span>
    <span class="badge">#${currentItem.ref ?? id}</span>
    ${statusBadgeHtml(currentItem)}
    ${currentItem.is_unread ? `<span class="badge unread">Unread</span>` : ""}
  `;
  els.detailTitle.textContent = currentItem.subject || `${type} #${id}`;
  els.detailMeta.textContent = `${currentItem.project_name || ""} · ${currentItem.milestone_name || "No sprint"} · updated ${relativeTime(currentItem.modified_date)}`;
  setOpenTaiga(currentItem.taiga_url || null);
  els.detailSide.innerHTML = `
    <div class="row"><span>Type</span><strong>${escapeHtml(typeLabel(type))}</strong></div>
    <div class="row"><span>Ref</span><strong>#${currentItem.ref ?? id}</strong></div>
    <div class="row"><span>Status</span><strong>${statusPillHtml(currentItem)}</strong></div>
    <div class="row"><span>Project</span><strong>${escapeHtml(currentItem.project_name || "—")}</strong></div>
    <div class="row"><span>Sprint</span><strong>${escapeHtml(currentItem.milestone_name || "—")}</strong></div>
    ${
      currentItem.is_blocked != null
        ? `<div class="row"><span>Blocked</span><strong>${currentItem.is_blocked ? "Yes" : "No"}</strong></div>`
        : ""
    }
    <div class="row"><span>Updated</span><strong>${escapeHtml(formatDate(currentItem.modified_date))}</strong></div>
    ${
      currentItem.created_date
        ? `<div class="row"><span>Created</span><strong>${escapeHtml(formatDate(currentItem.created_date))}</strong></div>`
        : ""
    }
    ${
      currentItem.taiga_url
        ? `<div class="row"><span>Taiga</span><strong><a href="${escapeHtml(currentItem.taiga_url)}" target="_blank" rel="noopener noreferrer">Open ticket ↗</a></strong></div>`
        : ""
    }
  `;
  bindDetailStatusEditors();
}

async function openItem(type, id) {
  currentItem =
    itemsCache.find((i) => i.type === type && i.id === id) || {
      type,
      id,
      subject: "Ticket",
    };

  renderDetailChrome(type, id);
  els.historyList.innerHTML = `<p class="muted">Loading activity…</p>`;
  els.commentError.classList.add("hidden");
  show("detail");

  try {
    const [detail, hist] = await Promise.all([
      api(`/api/items/${type}/${id}`).catch(() => null),
      api(`/api/items/${type}/${id}/history`),
    ]);

    if (detail?.item) {
      currentItem = { ...currentItem, ...detail.item };
      renderDetailChrome(type, id);
    }

    renderHistory(hist.events || []);
  } catch (e) {
    els.historyList.innerHTML = `<div class="alert">${escapeHtml(e.message)}</div>`;
  }
}

async function loadTeammates() {
  const data = await api("/api/teammates");
  teammatesCache = data.teammates || [];
  const saved = readStore(FILTER_STORE_KEY);
  const previous =
    els.filterTeammate.value ||
    saved.teammate ||
    localStorage.getItem("tp_selected_teammate") ||
    "all";
  els.filterTeammate.innerHTML =
    `<option value="all">All teammates</option>` +
    teammatesCache
      .map((t) => {
        const label = `${t.full_name_display || t.username}${t.username ? ` (@${t.username})` : ""}`;
        return `<option value="${t.id}">${escapeHtml(label)}</option>`;
      })
      .join("");
  if (previous === "all" || teammatesCache.some((t) => String(t.id) === String(previous))) {
    setSelectValue(els.filterTeammate, String(previous));
  } else {
    setSelectValue(els.filterTeammate, "all");
  }
  updateTeammateMeta();
}

async function loadProjects() {
  try {
    const data = await api("/api/projects");
    const saved = readStore(FILTER_STORE_KEY);
    const current = els.filterProject.value || saved.project || "";
    fillSelect(
      els.filterProject,
      (data.projects || []).map((p) => ({ value: String(p.id), label: p.name }))
    );
    setSelectValue(els.filterProject, current);
  } catch {
    // ignore
  }
}

async function loadWork() {
  saveFilters();
  const mate = selectedTeammate();
  if (!mate?.id) {
    els.workStatus.textContent = "Select All or a teammate to load tickets.";
    els.summaryGrid.innerHTML = "";
    els.statusGrid.innerHTML = "";
    els.workList.innerHTML = `<div class="panel"><p class="muted" style="margin:0">Pick All teammates or one person above.</p></div>`;
    return;
  }

  els.workStatus.textContent = "Loading…";
  try {
    const data = await api(`/api/my-work?${queryFromFilters()}`);
    const saved = readStore(FILTER_STORE_KEY);
    const statusVal = els.filterStatus.value || saved.status || "";
    const sprintVal = els.filterSprint.value || saved.sprint || "";
    fillSelect(els.filterStatus, data.facets?.statuses || []);
    fillSelect(els.filterSprint, data.facets?.sprints || []);
    setSelectValue(els.filterStatus, statusVal);
    setSelectValue(els.filterSprint, sprintVal);
    saveFilters();
    renderWork(data.items || [], data.summary, data.warnings || []);
  } catch (e) {
    els.workStatus.textContent = e.message;
    els.workList.innerHTML = "";
  }
}

async function enterTeamBoard() {
  renderHeader(currentUser);
  show("work");
  restoreFilters();
  setViewMode(viewMode);
  await Promise.all([loadProjects(), loadTeammates()]);
  await loadWork();
}

async function loadMe() {
  try {
    const data = await api("/api/me");
    currentUser = data.user;
    await enterTeamBoard();
  } catch {
    currentUser = null;
    renderHeader(null);
    show("login");
  }
}

els.loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.loginError.classList.add("hidden");
  const fd = new FormData(els.loginForm);
  try {
    const data = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username: fd.get("username"),
        password: fd.get("password"),
      }),
    });
    currentUser = data.user;
    await enterTeamBoard();
  } catch (err) {
    els.loginError.textContent = err.message;
    els.loginError.classList.remove("hidden");
  }
});

document.getElementById("refresh-btn").addEventListener("click", loadWork);
document.getElementById("back-btn").addEventListener("click", async () => {
  show("work");
  await loadWork();
});

document.querySelectorAll(".view-btn").forEach((btn) => {
  btn.addEventListener("click", () => setViewMode(btn.getAttribute("data-view")));
});

els.filterTeammate.addEventListener("change", () => {
  saveFilters();
  updateTeammateMeta();
  loadWork();
});

els.searchBtn.addEventListener("click", () => {
  saveFilters();
  loadWork();
});
els.searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    saveFilters();
    loadWork();
  }
});
els.searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    saveFilters();
    loadWork();
  }, 350);
});

[
  els.filterType,
  els.filterProject,
  els.filterStatus,
  els.filterSprint,
  els.filterUpdated,
  els.filterUnread,
  els.filterClosed,
  els.filterSort,
].forEach((el) =>
  el.addEventListener("change", () => {
    saveFilters();
    loadWork();
  })
);

document.querySelectorAll("#quick-chips, #quick-chips-mobile").forEach((root) => {
  root.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-quick]");
    if (!btn) return;
    const q = btn.getAttribute("data-quick");
    if (q === "clear") {
      resetFiltersToDefaults();
    } else if (q === "unread") els.filterUnread.value = "unread";
    else if (q === "24h" || q === "7d") els.filterUpdated.value = q;
    else if (q === "issue") els.filterType.value = "issue";
    else if (q === "task") els.filterType.value = "task";
    else if (q === "story") els.filterType.value = "userstory";
    saveFilters();
    loadWork();
  });
});

document.getElementById("comment-btn").addEventListener("click", async () => {
  if (!currentItem) return;
  els.commentError.classList.add("hidden");
  const comment = els.commentInput.value.trim();
  if (!comment) {
    els.commentError.textContent = "Comment is required";
    els.commentError.classList.remove("hidden");
    return;
  }
  try {
    await api(`/api/items/${currentItem.type}/${currentItem.id}/comment`, {
      method: "POST",
      body: JSON.stringify({ comment }),
    });
    els.commentInput.value = "";
    await openItem(currentItem.type, currentItem.id);
  } catch (e) {
    els.commentError.textContent = e.message;
    els.commentError.classList.remove("hidden");
  }
});

restoreFilters();
loadMe();
initMobileSheets({ onRefresh: loadWork });
