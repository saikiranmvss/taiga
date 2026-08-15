/** Fast comments sheet: latest + list + post. */

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(str) {
  return escapeHtml(str).replaceAll("'", "&#39;");
}

function isSafeHttpUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function looksLikeImageUrl(url) {
  try {
    const path = new URL(String(url)).pathname.toLowerCase();
    return /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(path) || path.includes("/media/attachments/");
  } catch {
    return false;
  }
}

function trimUrlMatch(url) {
  return String(url).replace(/[),.;!?]+$/g, "");
}

function proxyMediaUrl(url) {
  return `/api/proxy-media?url=${encodeURIComponent(url)}`;
}

function neatAttachmentHtml(url, alt = "Attachment") {
  const safe = escapeAttr(url);
  const proxied = escapeAttr(proxyMediaUrl(url));
  const label = escapeHtml(alt || "Attachment");
  return `<figure class="comment-attach" data-src="${safe}">
    <a class="comment-attach-open" href="${safe}" target="_blank" rel="noopener noreferrer">
      <img src="${proxied}" alt="${label}" loading="lazy" data-comment-img="1" />
      <span class="comment-attach-chip">Open image ↗</span>
    </a>
  </figure>`;
}

/** Client-side markdown fallback (server usually sends body_html). */
export function formatCommentHtml(raw) {
  let text = String(raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\\([\\`*_{}\[\]()#+\-.!|"'])/g, "$1")
    .trim();
  if (!text) return "";

  const tokens = [];
  const token = (html) => {
    const key = `@@CMT${tokens.length}@@`;
    tokens.push(html);
    return key;
  };

  text = text.replace(/!\[([^\]]*)\]\(\s*(https?:\/\/[^)\s]+)\s*\)/g, (full, alt, url) => {
    if (!isSafeHttpUrl(url)) return full;
    return token(neatAttachmentHtml(url, alt || "Attachment"));
  });

  text = text.replace(/\[([^\]]+)\]\(\s*(https?:\/\/[^)\s]+)\s*\)/g, (full, label, url) => {
    if (!isSafeHttpUrl(url)) return full;
    return token(
      `<a class="comment-link" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
    );
  });

  text = text.replace(/(https?:\/\/[^\s<]+)/g, (full) => {
    const url = trimUrlMatch(full);
    const trailing = full.slice(url.length);
    if (!isSafeHttpUrl(url)) return full;
    if (looksLikeImageUrl(url)) return token(neatAttachmentHtml(url)) + trailing;
    return (
      token(
        `<a class="comment-link" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`
      ) + trailing
    );
  });

  text = escapeHtml(text);
  text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/(^|[^*\w])\*(.+?)\*(?!\*)/g, "$1<em>$2</em>");
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
  text = text.replace(/(^|[\s(])@([a-zA-Z0-9._-]+)/g, '$1<span class="comment-mention">@$2</span>');
  text = text.replace(/\n/g, "<br>");

  tokens.forEach((html, i) => {
    text = text.replaceAll(`@@CMT${i}@@`, html);
  });

  return text
    .replace(/(?:<br>\s*){0,2}(<figure class="comment-attach")/g, "$1")
    .replace(/(<\/figure>)(?:\s*<br>){0,2}/g, "$1");
}

function commentBodyHtml(c) {
  if (c?.body_html) return c.body_html;
  return formatCommentHtml(c?.body || "");
}

function formatSnippet(text, max = 160) {
  const t = String(text || "")
    .replace(/!\[[^\]]*\]\(\s*https?:\/\/[^)\s]+\s*\)/g, "[image]")
    .replace(/https?:\/\/\S+/g, "[link]")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function bindCommentImages(root) {
  if (!root) return;
  root.querySelectorAll("[data-comment-img]").forEach((img) => {
    const figure = img.closest(".comment-attach");
    img.addEventListener("load", () => {
      figure?.classList.add("is-loaded");
      figure?.classList.remove("is-broken");
    });
    img.addEventListener("error", () => {
      figure?.classList.add("is-broken");
      figure?.classList.remove("is-loaded");
    });
  });
}

function renderCommentCard(c, { latest = false, relativeTime, formatDate } = {}) {
  return `
    <article class="comment-card${latest ? " is-latest" : ""}">
      ${latest ? `<div class="comment-latest-label">Latest comment</div>` : ""}
      <div class="comment-who">
        <strong>${escapeHtml(c.user_name || "Someone")}</strong>
        <span>${escapeHtml(relativeTime?.(c.created_at) || "")}${
          formatDate ? ` · ${escapeHtml(formatDate(c.created_at))}` : ""
        }</span>
      </div>
      <div class="comment-body">${commentBodyHtml(c)}</div>
    </article>`;
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

  let current = null;
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
        ? renderCommentCard(latest, { latest: true, relativeTime, formatDate })
        : `<div class="comments-empty">No comments yet — be the first.</div>`;
      bindCommentImages(latestEl);
    }

    if (listEl) {
      const others =
        latest && comments[0] === latest
          ? comments.slice(1)
          : latest
            ? comments.filter((c) => c.id !== latest.id)
            : comments;

      listEl.innerHTML = others.length
        ? `<div class="comments-list-label">Earlier</div>${others
            .map((c) => renderCommentCard(c, { relativeTime, formatDate }))
            .join("")}`
        : "";
      bindCommentImages(listEl);
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
    ? renderCommentCard(latest, { latest: true, relativeTime, formatDate })
    : `<div class="comments-empty">No comments yet.</div>`;

  const listHtml = others.length
    ? `<div class="comments-list-label">Earlier (${others.length})</div>${others
        .map((c) => renderCommentCard(c, { relativeTime, formatDate }))
        .join("")}`
    : "";

  target.innerHTML = `${latestHtml}${listHtml}`;
  bindCommentImages(target);
}
