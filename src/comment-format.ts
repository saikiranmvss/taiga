/** Sanitize / normalize Taiga comment HTML for safe display. */

const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "a",
  "img",
  "figure",
  "figcaption",
  "span",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
]);

function decodeBasicEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

export function looksLikeHtml(input: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(input);
}

function isSafeHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function proxyMediaUrl(src: string): string {
  return `/api/proxy-media?url=${encodeURIComponent(src)}`;
}

function neatAttachment(src: string, alt = "Attachment"): string {
  const safeSrc = escapeAttr(src);
  const proxied = escapeAttr(proxyMediaUrl(src));
  const label = escapeHtml(alt || "Attachment");
  return `<figure class="comment-attach" data-src="${safeSrc}">
    <img class="comment-attach-img" src="${proxied}" alt="${label}" loading="lazy" data-comment-img="1" />
    <a class="comment-attach-chip" href="${proxied}" target="_blank" rel="noopener noreferrer">Open full size</a>
  </figure>`;
}

function escapeHtml(str: string): string {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(str: string): string {
  return escapeHtml(str).replaceAll("'", "&#39;");
}

/** Keep safe tags; rewrite images to proxied neat attachments. */
export function sanitizeCommentHtml(rawHtml: string): string {
  let html = String(rawHtml || "");
  if (!html.trim()) return "";

  html = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  // Convert <img> to neat attachment figures with proxy
  html = html.replace(/<img\b([^>]*)\/?>/gi, (_full, attrs: string) => {
    const src =
      attrs.match(/\bsrc\s*=\s*"([^"]+)"/i)?.[1] ||
      attrs.match(/\bsrc\s*=\s*'([^']+)'/i)?.[1] ||
      "";
    const alt =
      attrs.match(/\balt\s*=\s*"([^"]*)"/i)?.[1] ||
      attrs.match(/\balt\s*=\s*'([^']*)'/i)?.[1] ||
      "Attachment";
    if (!src || !isSafeHttpUrl(decodeBasicEntities(src))) return "";
    return neatAttachment(decodeBasicEntities(src), alt);
  });

  // Rewrite anchors: keep http(s) only
  html = html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_full, attrs: string, inner: string) => {
    const href =
      attrs.match(/\bhref\s*=\s*"([^"]+)"/i)?.[1] ||
      attrs.match(/\bhref\s*=\s*'([^']+)'/i)?.[1] ||
      "";
    const decoded = decodeBasicEntities(href);
    if (!decoded || !isSafeHttpUrl(decoded)) return inner;
    return `<a class="comment-link" href="${escapeAttr(decoded)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
  });

  // Strip disallowed tags (keep inner text)
  html = html.replace(/<\/?([a-z0-9]+)(\s[^>]*)?>/gi, (full, tag: string) => {
    const name = String(tag).toLowerCase();
    if (ALLOWED_TAGS.has(name)) {
      if (full.startsWith("</")) return `</${name}>`;
      if (name === "br") return "<br>";
      if (name === "img" || name === "figure") return full; // already handled img
      if (name === "a") return full;
      // drop attributes on other allowed tags
      if (full.endsWith("/>")) return `<${name} />`;
      return full.startsWith("</") ? `</${name}>` : `<${name}>`;
    }
    return "";
  });

  return html.trim();
}

/** Plain/markdown comment → safe HTML. */
export function formatCommentMarkdown(raw: string): string {
  let text = decodeBasicEntities(String(raw || "")).replace(/\r\n/g, "\n").trim();
  if (!text) return "";

  // Unescape common markdown escapes left in Taiga text
  text = text.replace(/\\([\\`*_{}\[\]()#+\-.!|"'])/g, "$1");

  const tokens: string[] = [];
  const token = (html: string) => {
    const key = `@@CMT${tokens.length}@@`;
    tokens.push(html);
    return key;
  };

  // Markdown images
  text = text.replace(/!\[([^\]]*)\]\(\s*(https?:\/\/[^)\s]+)\s*\)/g, (full, alt, url) => {
    if (!isSafeHttpUrl(url)) return full;
    return token(neatAttachment(url, alt || "Attachment"));
  });

  // Markdown links
  text = text.replace(/\[([^\]]+)\]\(\s*(https?:\/\/[^)\s]+)\s*\)/g, (full, label, url) => {
    if (!isSafeHttpUrl(url)) return full;
    return token(
      `<a class="comment-link" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
    );
  });

  // Bare URLs / attachment URLs
  text = text.replace(/(https?:\/\/[^\s<]+)/g, (full) => {
    const url = full.replace(/[),.;!?]+$/g, "");
    const trailing = full.slice(url.length);
    if (!isSafeHttpUrl(url)) return full;
    const path = (() => {
      try {
        return new URL(url).pathname.toLowerCase();
      } catch {
        return "";
      }
    })();
    const isImage =
      /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(path) || path.includes("/media/attachments/");
    if (isImage) return token(neatAttachment(url)) + trailing;
    return (
      token(
        `<a class="comment-link" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`
      ) + trailing
    );
  });

  text = escapeHtml(text);

  // Bold / italic after escape
  text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/(^|[^*\w])\*(.+?)\*(?!\*)/g, "$1<em>$2</em>");
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Mentions
  text = text.replace(/(^|[\s(])@([a-zA-Z0-9._-]+)/g, '$1<span class="comment-mention">@$2</span>');

  text = text.replace(/\n/g, "<br>");

  tokens.forEach((html, i) => {
    text = text.replaceAll(`@@CMT${i}@@`, html);
  });

  text = text
    .replace(/(?:<br>\s*){0,2}(<figure class="comment-attach")/g, "$1")
    .replace(/(<\/figure>)(?:\s*<br>){0,2}/g, "$1");

  return text;
}

export function buildCommentHtml(rawComment: string): { body: string; body_html: string } {
  const raw = String(rawComment || "");
  if (!raw.trim()) return { body: "", body_html: "" };

  if (looksLikeHtml(raw)) {
    const plain = raw
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/[ \t]{2,}/g, " ")
      .trim();
    return { body: plain, body_html: sanitizeCommentHtml(raw) };
  }

  // Plain / markdown — also run through markdown formatter
  const plain = raw
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .trim();
  return { body: plain, body_html: formatCommentMarkdown(plain) };
}

/** Map attachment API rows → signed download URLs keyed by pathname / filename. */
export function buildAttachmentUrlMap(attachments: Array<Record<string, unknown>>): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of attachments) {
    const signed = String(row.url || "").trim();
    if (!signed) continue;
    try {
      const u = new URL(signed);
      map.set(u.pathname, signed);
      const file = u.pathname.split("/").filter(Boolean).pop();
      if (file) map.set(file, signed);
    } catch {
      // ignore bad urls
    }
  }
  return map;
}

export function resolveProtectedMediaUrl(rawUrl: string, signedMap?: Map<string, string>): string {
  const url = String(rawUrl || "").trim();
  if (!url) return url;
  try {
    const u = new URL(url);
    if (signedMap?.has(u.pathname)) return signedMap.get(u.pathname)!;
    const file = u.pathname.split("/").filter(Boolean).pop();
    if (file && signedMap?.has(file)) return signedMap.get(file)!;
    // Media-protected installs often need a token query to start refresh
    if (u.pathname.includes("/media/") && !u.searchParams.has("token")) {
      u.searchParams.set("token", "1");
      return u.toString();
    }
  } catch {
    return url;
  }
  return url;
}

/** Rewrite media URLs in already-built HTML to signed / tokenized URLs. */
export function rewriteCommentMediaUrls(html: string, signedMap?: Map<string, string>): string {
  if (!html) return html;
  return html.replace(/https?:\/\/[^\s"'<>]+\/media\/[^\s"'<>]+/g, (match) => {
    const cleaned = match.replace(/[),.;]+$/g, "");
    const trailing = match.slice(cleaned.length);
    return resolveProtectedMediaUrl(cleaned, signedMap) + trailing;
  });
}
