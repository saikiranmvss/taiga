/** Persist filter UI state in localStorage across refresh/navigation. */

export function readStore(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeStore(key, state) {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // ignore quota / private mode
  }
}

export function setSelectValue(select, value) {
  if (!select) return;
  const val = value == null ? "" : String(value);
  if (
    select.tagName === "SELECT" &&
    val !== "" &&
    ![...select.options].some((o) => o.value === val)
  ) {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = val;
    select.appendChild(opt);
  }
  select.value = val;
}

export function collectFilters(map) {
  const state = {};
  for (const [key, el] of Object.entries(map)) {
    if (!el) continue;
    state[key] = el.value ?? "";
  }
  return state;
}

export function applyFilters(map, state, defaults = {}) {
  const merged = { ...defaults, ...(state || {}) };
  for (const [key, el] of Object.entries(map)) {
    if (!el) continue;
    const val = merged[key];
    if (val === undefined) continue;
    setSelectValue(el, val);
  }
  return merged;
}
