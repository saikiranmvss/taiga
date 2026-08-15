/** Click-to-change status popover for ticket status badges/pills. */

let menuEl = null;
let outsideHandler = null;
let keyHandler = null;
const statusCache = new Map();

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function closeStatusMenu() {
  if (outsideHandler) {
    document.removeEventListener("mousedown", outsideHandler, true);
    outsideHandler = null;
  }
  if (keyHandler) {
    document.removeEventListener("keydown", keyHandler, true);
    keyHandler = null;
  }
  if (menuEl) {
    menuEl.remove();
    menuEl = null;
  }
}

async function loadStatuses(api, type, projectId) {
  const key = `${type}:${projectId}`;
  if (statusCache.has(key)) return statusCache.get(key);
  const data = await api(`/api/statuses?type=${encodeURIComponent(type)}&project=${projectId}`);
  const statuses = data.statuses || [];
  statusCache.set(key, statuses);
  return statuses;
}

function placeMenu(anchor) {
  if (!menuEl || !anchor) return;
  const rect = anchor.getBoundingClientRect();
  const menuRect = menuEl.getBoundingClientRect();
  const pad = 8;
  let top = rect.bottom + 6;
  let left = rect.left;

  if (top + menuRect.height > window.innerHeight - pad) {
    top = Math.max(pad, rect.top - menuRect.height - 6);
  }
  if (left + menuRect.width > window.innerWidth - pad) {
    left = Math.max(pad, window.innerWidth - menuRect.width - pad);
  }
  if (left < pad) left = pad;

  menuEl.style.top = `${Math.round(top)}px`;
  menuEl.style.left = `${Math.round(left)}px`;
}

export async function openStatusMenu({ anchor, item, api, onChanged }) {
  closeStatusMenu();
  if (!item?.type || !item?.id || !item?.project_id) {
    throw new Error("Missing ticket/project for status change");
  }

  menuEl = document.createElement("div");
  menuEl.className = "status-menu";
  menuEl.setAttribute("role", "listbox");
  menuEl.innerHTML = `<div class="status-menu-loading">Loading statuses…</div>`;
  document.body.appendChild(menuEl);
  placeMenu(anchor);

  outsideHandler = (e) => {
    if (!menuEl) return;
    if (menuEl.contains(e.target) || anchor.contains?.(e.target)) return;
    closeStatusMenu();
  };
  keyHandler = (e) => {
    if (e.key === "Escape") closeStatusMenu();
  };
  document.addEventListener("mousedown", outsideHandler, true);
  document.addEventListener("keydown", keyHandler, true);

  let statuses;
  try {
    statuses = await loadStatuses(api, item.type, item.project_id);
  } catch (e) {
    menuEl.innerHTML = `<div class="status-menu-error">${escapeHtml(e.message || "Failed to load")}</div>`;
    placeMenu(anchor);
    return;
  }

  if (!statuses.length) {
    menuEl.innerHTML = `<div class="status-menu-error">No statuses available</div>`;
    placeMenu(anchor);
    return;
  }

  menuEl.innerHTML = statuses
    .map((s) => {
      const active = Number(s.id) === Number(item.status_id);
      const color = s.color || "#2f6f5e";
      return `
        <button type="button" class="status-menu-item${active ? " is-active" : ""}" data-status-id="${s.id}" role="option" aria-selected="${active}">
          <i class="dot" style="background:${escapeHtml(color)}" aria-hidden="true"></i>
          <span>${escapeHtml(s.name)}</span>
          ${active ? `<span class="status-menu-check">✓</span>` : ""}
        </button>`;
    })
    .join("");
  placeMenu(anchor);

  menuEl.querySelectorAll("[data-status-id]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const statusId = Number(btn.getAttribute("data-status-id"));
      if (!statusId || statusId === Number(item.status_id)) {
        closeStatusMenu();
        return;
      }

      menuEl.querySelectorAll("button").forEach((b) => {
        b.disabled = true;
      });
      btn.classList.add("is-saving");
      const label = btn.querySelector("span");
      if (label) label.textContent = "Saving…";

      try {
        const data = await api(`/api/items/${item.type}/${item.id}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status_id: statusId }),
        });
        closeStatusMenu();
        if (typeof onChanged === "function") onChanged(data.item || null);
      } catch (err) {
        closeStatusMenu();
        alert(err.message || "Failed to update status");
      }
    });
  });
}

export function bindStatusEditors(root, { api, findItem, onChanged }) {
  if (!root) return;
  root.querySelectorAll("[data-status-edit]").forEach((el) => {
    el.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const type = el.getAttribute("data-type");
      const id = Number(el.getAttribute("data-id"));
      const projectId = Number(el.getAttribute("data-project"));
      const statusId = Number(el.getAttribute("data-status-id")) || null;
      const fromCache = typeof findItem === "function" ? findItem(type, id) : null;
      const item = {
        type,
        id,
        project_id: projectId || fromCache?.project_id,
        status_id: statusId || fromCache?.status_id,
        status_name: fromCache?.status_name,
        status_color: fromCache?.status_color,
        ...(fromCache || {}),
      };
      try {
        await openStatusMenu({
          anchor: el,
          item,
          api,
          onChanged,
        });
      } catch (err) {
        alert(err.message || "Cannot change status");
      }
    });
  });
}
