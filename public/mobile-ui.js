export function initMobileSheets({ onRefresh } = {}) {
  const backdrop = document.getElementById("sheet-backdrop");
  const filters = document.getElementById("sheet-filters");
  const stats = document.getElementById("sheet-stats");

  function closeSheets() {
    filters?.classList.remove("is-open");
    stats?.classList.remove("is-open");
    filters?.setAttribute("aria-hidden", window.matchMedia("(max-width: 900px)").matches ? "true" : "false");
    stats?.setAttribute("aria-hidden", "true");
    if (backdrop) {
      backdrop.hidden = true;
      backdrop.classList.remove("is-open");
    }
    document.body.classList.remove("sheet-open");
  }

  function openSheet(name) {
    if (!window.matchMedia("(max-width: 900px)").matches) return;
    closeSheets();
    const target = name === "stats" ? stats : filters;
    if (!target) return;
    target.classList.add("is-open");
    target.setAttribute("aria-hidden", "false");
    if (backdrop) {
      backdrop.hidden = false;
      backdrop.classList.add("is-open");
    }
    document.body.classList.add("sheet-open");
  }

  document.querySelectorAll("[data-open-sheet]").forEach((btn) => {
    btn.addEventListener("click", () => openSheet(btn.getAttribute("data-open-sheet")));
  });

  document.querySelectorAll("[data-close-sheet]").forEach((btn) => {
    btn.addEventListener("click", closeSheets);
  });

  backdrop?.addEventListener("click", closeSheets);

  document.getElementById("refresh-btn-mobile")?.addEventListener("click", () => {
    if (typeof onRefresh === "function") onRefresh();
  });

  // Close sheets when a status card is chosen (filter applied)
  document.getElementById("status-grid")?.addEventListener("click", (e) => {
    if (e.target.closest(".status-card") && window.matchMedia("(max-width: 900px)").matches) {
      closeSheets();
    }
  });

  window.addEventListener("resize", () => {
    if (!window.matchMedia("(max-width: 900px)").matches) closeSheets();
  });

  return { openSheet, closeSheets };
}
