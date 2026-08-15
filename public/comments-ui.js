/** Fast comments sheet: latest + list + post. */

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatSnippet(text, max = 160) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export function initCommentsUi({
  api,
  relativeTime,
  formatDate,
  onPosted,
} = {}) {
  const sheet = document.getElementById("comments-sheet");
  const backdrop = document.getElementById("comments-backdrop");
  const titleEl = document.getElementById("comments-sheet-title");
  const metaEl = document.getElementById("comments-sheet-meta");
  const latestEl = document.getElementById("comments-latest");
  const listEl = document.getElementById("comments-list");
  const inputEl = document.getElementById("comments-sheet-input");
  const postBtn = document.getElementById("comments-sheet-post");
  const errorEl = document.getElementById("comments-sheet-error");

  let current = null; // { type, id, subject, ref }
  let busy = false;

  function closeComments() {
    sheet?.classList.remove("is-open");
    sheet?.setAttribute("aria-hidden", "true");
    if (backdrop) {
      backdrop.hidden = true;
      backdrop.classList.remove("is-open");
    }
    document.body.classList.remove("comments-open");
    current = null;
  }

  function renderCommentCard(c, { latest = false } = {}) {
    return `
      <article class="comment-card${latest ? " is-latest" : ""}">
        ${latest ? `<div class="comment-latest-label">Latest comment</div>` : ""}
        <div class="comment-who">
          <strong>${escapeHtml(c.user_name || "Someone")}</strong>
          <span>${escapeHtml(relativeTime?.(c.created_at) || "")}${
            formatDate ? ` · ${escapeHtml(formatDate(c.created_at))}` : ""
          }</span>
        </div>
        <div class="comment-body">${escapeHtml(c.body || "")}</div>
      </article>`;
  }

  function renderComments(data) {
    const comments = data.comments || [];
    const latest = data.latest || comments[0] || null;

    if (metaEl) {
      metaEl.textContent = `${data.count || comments.length} comment${
        (data.count || comments.length) === 1 ? "" : "s"
      }`;
    }

    if (latestEl) {
      latestEl.innerHTML = latest
        ? renderCommentCard(latest, { latest: true })
        : `<div class="comments-empty">No comments yet — be the first.</div>`;
    }

    if (listEl) {
      const rest = latest ? comments.filter((c) => c !== latest && c.id !== latest.id) : comments;
      // Prefer filter by id; if ids missing, skip first when latest shown
      const others =
        latest && comments[0] === latest
          ? comments.slice(1)
          : rest.length
            ? rest
            : comments.slice(latest ? 1 : 0);

      listEl.innerHTML = others.length
        ? `<div class="comments-list-label">Earlier</div>${others.map((c) => renderCommentCard(c)).join("")}`
        : latest
          ? ""
          : "";
    }
  }

  async function loadComments() {
    if (!current || !listEl) return;
    latestEl.innerHTML = `<div class="comments-empty">Loading…</div>`;
    listEl.innerHTML = "";
    try {
      const data = await api(`/api/items/${current.type}/${current.id}/comments`);
      renderComments(data);
    } catch (e) {
      latestEl.innerHTML = `<div class="alert">${escapeHtml(e.message)}</div>`;
    }
  }

  async function openComments(item) {
    if (!sheet || !item?.type || !item?.id) return;
    current = item;
    if (titleEl) {
      titleEl.textContent = item.subject
        ? formatSnippet(item.subject, 60)
        : `${item.type} #${item.ref ?? item.id}`;
    }
    if (metaEl) metaEl.textContent = "Loading comments…";
    if (inputEl) inputEl.value = "";
    if (errorEl) {
      errorEl.classList.add("hidden");
      errorEl.textContent = "";
    }

    sheet.classList.add("is-open");
    sheet.setAttribute("aria-hidden", "false");
    if (backdrop) {
      backdrop.hidden = false;
      backdrop.classList.add("is-open");
    }
    document.body.classList.add("comments-open");
    await loadComments();
    inputEl?.focus();
  }

  async function postComment() {
    if (!current || busy) return;
    const comment = (inputEl?.value || "").trim();
    if (!comment) {
      if (errorEl) {
        errorEl.textContent = "Comment is required";
        errorEl.classList.remove("hidden");
      }
      return;
    }
    busy = true;
    if (postBtn) postBtn.disabled = true;
    if (errorEl) errorEl.classList.add("hidden");
    try {
      await api(`/api/items/${current.type}/${current.id}/comment`, {
        method: "POST",
        body: JSON.stringify({ comment }),
      });
      if (inputEl) inputEl.value = "";
      await loadComments();
      if (typeof onPosted === "function") onPosted(current);
    } catch (e) {
      if (errorEl) {
        errorEl.textContent = e.message || "Failed to post";
        errorEl.classList.remove("hidden");
      }
    } finally {
      busy = false;
      if (postBtn) postBtn.disabled = false;
    }
  }

  document.querySelectorAll("[data-close-comments]").forEach((btn) => {
    btn.addEventListener("click", closeComments);
  });
  backdrop?.addEventListener("click", closeComments);
  postBtn?.addEventListener("click", postComment);
  inputEl?.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      postComment();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sheet?.classList.contains("is-open")) closeComments();
  });

  return {
    openComments,
    closeComments,
    reload: loadComments,
    formatSnippet,
  };
}

export function commentsButtonHtml(item) {
  const count = item.total_comments != null ? Number(item.total_comments) : null;
  const label = count != null ? `Comments (${count})` : "Comments";
  return `<button class="btn btn-ghost btn-tiny btn-comments" type="button" data-comments="${item.type}:${item.id}" data-stop="1">${label}</button>`;
}

export function bindCommentButtons(root, { openComments, findItem }) {
  if (!root) return;
  root.querySelectorAll("[data-comments]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const [type, idRaw] = (btn.getAttribute("data-comments") || "").split(":");
      const id = Number(idRaw);
      const item = typeof findItem === "function" ? findItem(type, id) : { type, id };
      openComments(item || { type, id });
    });
  });
}

export function renderDetailComments(target, data, { relativeTime, formatDate }) {
  if (!target) return;
  const comments = data.comments || [];
  const latest = data.latest || comments[0] || null;
  const others = latest ? comments.slice(1) : comments;

  const latestHtml = latest
    ? `
      <article class="comment-card is-latest">
        <div class="comment-latest-label">Latest comment</div>
        <div class="comment-who">
          <strong>${escapeHtml(latest.user_name || "Someone")}</strong>
          <span>${escapeHtml(relativeTime?.(latest.created_at) || "")}${
            formatDate ? ` · ${escapeHtml(formatDate(latest.created_at))}` : ""
          }</span>
        </div>
        <div class="comment-body">${escapeHtml(latest.body || "")}</div>
      </article>`
    : `<div class="comments-empty">No comments yet.</div>`;

  const listHtml = others.length
    ? `<div class="comments-list-label">Earlier (${others.length})</div>${others
        .map(
          (c) => `
        <article class="comment-card">
          <div class="comment-who">
            <strong>${escapeHtml(c.user_name || "Someone")}</strong>
            <span>${escapeHtml(relativeTime?.(c.created_at) || "")}</span>
          </div>
          <div class="comment-body">${escapeHtml(c.body || "")}</div>
        </article>`
        )
        .join("")}`
    : "";

  target.innerHTML = `${latestHtml}${listHtml}`;
}
