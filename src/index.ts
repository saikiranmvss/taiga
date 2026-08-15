import { Hono } from "hono";
import { upsertUserPrefs, touchAppSeen, markTicketRead, listTicketReads } from "./db";
import { normalizeHistoryEntry } from "./history";
import {
  buildSession,
  clearSessionCookie,
  requireSession,
  sessionCookie,
  signSession,
  toSessionUser,
} from "./session";
import { TaigaClient, normalizeItem, type ItemType } from "./taiga";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

type WorkItem = ReturnType<typeof normalizeItem> & {
  last_seen_at: string | null;
  is_unread: boolean;
};

function parseTypes(raw: string | undefined): ItemType[] {
  if (!raw || raw === "all") return ["userstory", "task", "issue"];
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t): t is ItemType => ["userstory", "task", "issue"].includes(t));
}

function withinUpdated(item: WorkItem, updated: string): boolean {
  if (!updated || updated === "all") return true;
  if (!item.modified_date) return false;
  const age = Date.now() - Date.parse(item.modified_date);
  const day = 24 * 60 * 60 * 1000;
  if (updated === "24h") return age <= day;
  if (updated === "7d") return age <= 7 * day;
  if (updated === "30d") return age <= 30 * day;
  return true;
}

function matchesQuery(item: WorkItem, q: string): boolean {
  if (!q) return true;
  const hay = [
    item.subject,
    item.ref,
    item.id,
    item.project_name,
    item.milestone_name,
    item.status_name,
    item.type,
    ...(item.tags || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((part) => hay.includes(part));
}

function summarize(items: WorkItem[]) {
  const byStatus: Record<string, { name: string; color: string | null; count: number }> = {};
  const byProject: Record<string, { id: number | null; name: string; count: number; unread: number }> = {};
  const byType: Record<string, number> = { userstory: 0, task: 0, issue: 0 };
  let unread = 0;
  let blocked = 0;

  for (const item of items) {
    byType[item.type] = (byType[item.type] || 0) + 1;
    if (item.is_unread) unread += 1;
    if (item.is_blocked) blocked += 1;

    const statusKey = item.status_name || "Unknown";
    if (!byStatus[statusKey]) {
      byStatus[statusKey] = { name: statusKey, color: item.status_color, count: 0 };
    }
    byStatus[statusKey].count += 1;

    const projectKey = String(item.project_id ?? item.project_name ?? "none");
    if (!byProject[projectKey]) {
      byProject[projectKey] = {
        id: item.project_id,
        name: item.project_name || "Unknown project",
        count: 0,
        unread: 0,
      };
    }
    byProject[projectKey].count += 1;
    if (item.is_unread) byProject[projectKey].unread += 1;
  }

  return {
    total: items.length,
    unread,
    blocked,
    by_type: byType,
    by_status: Object.values(byStatus).sort((a, b) => b.count - a.count),
    by_project: Object.values(byProject).sort((a, b) => b.count - a.count),
  };
}

async function loadAssignedWork(
  taiga: TaigaClient,
  token: string,
  userId: number,
  opts: {
    types: ItemType[];
    closed: "open" | "closed" | "all";
    project?: number;
    q?: string;
    webBase?: string;
  }
) {
  const results = await Promise.all(
    opts.types.map((type) =>
      taiga.listAssigned(token, type, userId, {
        closed: opts.closed,
        project: opts.project,
        q: opts.q || undefined,
      })
    )
  );

  const warnings: string[] = [];
  const items: ReturnType<typeof normalizeItem>[] = [];

  results.forEach((res, idx) => {
    const type = opts.types[idx];
    if (!res.ok) {
      warnings.push(`${type}: ${res.error}`);
      return;
    }
    if (Array.isArray(res.data)) {
      items.push(...res.data.map((row) => normalizeItem(type, row, opts.webBase)));
    }
  });

  return { items, warnings };
}

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    app: c.env.APP_NAME || "Taiga Portal",
    time: new Date().toISOString(),
  })
);

app.get("/api/config", (c) =>
  c.json({
    ok: true,
    app: c.env.APP_NAME || "Taiga Portal",
    taiga_web_url: (c.env.TAIGA_WEB_URL || "https://taiga.cloudiumedge.com").replace(/\/$/, ""),
  })
);

app.post("/api/login", async (c) => {
  let body: { username?: string; password?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const username = (body.username || "").trim();
  const password = body.password || "";
  if (!username || !password) {
    return c.json({ error: "Username and password are required" }, 400);
  }

  const taiga = new TaigaClient(c.env.TAIGA_API_URL, c.env.TAIGA_AUTH_TYPE);
  const result = await taiga.login(username, password);
  if (!result.ok || !result.data?.auth_token) {
    return c.json({ error: result.error || "Login failed" }, result.status || 401);
  }

  const user = toSessionUser(result.data);
  const session = buildSession(result.data, user);
  const signed = await signSession(session, c.env.SESSION_SECRET);

  try {
    await upsertUserPrefs(c.env.DB, user);
  } catch (e) {
    console.error("D1 upsert failed", e);
  }

  c.header("Set-Cookie", sessionCookie(signed));
  return c.json({ ok: true, user });
});

app.post("/api/logout", (c) => {
  c.header("Set-Cookie", clearSessionCookie());
  return c.json({ ok: true });
});

app.get("/api/me", async (c) => {
  const session = await requireSession(c);
  if (session instanceof Response) return session;

  const taiga = new TaigaClient(c.env.TAIGA_API_URL, c.env.TAIGA_AUTH_TYPE);
  const me = await taiga.me(session.token);
  if (!me.ok || !me.data) {
    return c.json({ error: me.error || "Unable to load profile" }, me.status || 401);
  }

  const user = toSessionUser(me.data);
  try {
    await touchAppSeen(c.env.DB, user.id);
  } catch (e) {
    console.error("D1 touch failed", e);
  }

  return c.json({ ok: true, user });
});

app.get("/api/projects", async (c) => {
  const session = await requireSession(c);
  if (session instanceof Response) return session;

  const taiga = new TaigaClient(c.env.TAIGA_API_URL, c.env.TAIGA_AUTH_TYPE);
  const result = await taiga.projectsForMember(session.token, session.user.id);
  if (!result.ok) {
    return c.json({ error: result.error || "Failed to load projects" }, result.status || 500);
  }

  const projects = (result.data || []).map((p) => ({
    id: Number(p.id),
    name: String(p.name || ""),
    slug: String(p.slug || ""),
  }));

  return c.json({ ok: true, projects });
});

app.get("/api/teammates", async (c) => {
  const session = await requireSession(c);
  if (session instanceof Response) return session;

  const taiga = new TaigaClient(c.env.TAIGA_API_URL, c.env.TAIGA_AUTH_TYPE);
  const projects = await taiga.projectsForMember(session.token, session.user.id);
  if (!projects.ok || !Array.isArray(projects.data)) {
    return c.json({ error: projects.error || "Failed to load projects" }, projects.status || 500);
  }

  const map = new Map<
    number,
    { id: number; username: string; full_name: string; full_name_display: string; color: string | null }
  >();

  await Promise.all(
    projects.data.map(async (p) => {
      const projectId = Number(p.id);
      if (!projectId) return;
      const users = await taiga.usersForProject(session.token, projectId);
      if (!users.ok || !Array.isArray(users.data)) return;
      for (const u of users.data) {
        const id = Number(u.id);
        if (!id || map.has(id)) continue;
        map.set(id, {
          id,
          username: String(u.username || ""),
          full_name: String(u.full_name || u.full_name_display || u.username || ""),
          full_name_display: String(u.full_name_display || u.full_name || u.username || ""),
          color: u.color ? String(u.color) : null,
        });
      }
    })
  );

  const teammates = Array.from(map.values()).sort((a, b) =>
    a.full_name_display.localeCompare(b.full_name_display)
  );

  return c.json({ ok: true, teammates, count: teammates.length });
});

app.get("/api/my-work", async (c) => {
  const session = await requireSession(c);
  if (session instanceof Response) return session;

  const q = (c.req.query("q") || "").trim();
  const type = c.req.query("type") || "all";
  const project = c.req.query("project") ? Number(c.req.query("project")) : undefined;
  const status = (c.req.query("status") || "").trim();
  const sprint = (c.req.query("sprint") || "").trim();
  const unread = c.req.query("unread") || "all"; // all | unread | read
  const updated = c.req.query("updated") || "all"; // all | 24h | 7d | 30d
  const closed = (c.req.query("closed") || "open") as "open" | "closed" | "all";
  const sort = c.req.query("sort") || "updated"; // updated | created | ref | subject
  const requestedUserId = c.req.query("user_id") ? Number(c.req.query("user_id")) : NaN;
  const targetUserId =
    Number.isFinite(requestedUserId) && requestedUserId > 0
      ? requestedUserId
      : session.user.id;

  const taiga = new TaigaClient(c.env.TAIGA_API_URL, c.env.TAIGA_AUTH_TYPE);
  const types = parseTypes(type);

  const [{ items, warnings }, reads] = await Promise.all([
    loadAssignedWork(taiga, session.token, targetUserId, {
      types,
      closed,
      project: Number.isFinite(project) ? project : undefined,
      webBase: c.env.TAIGA_WEB_URL,
    }),
    listTicketReads(c.env.DB, session.user.id).catch(() => ({
      results: [] as { item_type: string; item_id: number; last_seen_at: string }[],
    })),
  ]);

  const readMap = new Map(
    (reads.results || []).map((r) => [`${r.item_type}:${r.item_id}`, r.last_seen_at])
  );

  let withRead: WorkItem[] = items.map((item) => {
    const lastSeen = readMap.get(`${item.type}:${item.id}`) || null;
    const modified = item.modified_date ? Date.parse(item.modified_date) : 0;
    const seenAt = lastSeen ? Date.parse(lastSeen) : 0;
    return {
      ...item,
      last_seen_at: lastSeen,
      is_unread: !lastSeen || modified > seenAt,
    };
  });

  // Facets from full assigned set (before narrow filters except type/project/closed already applied upstream)
  const facetsBase = withRead;

  withRead = withRead.filter((item) => {
    if (q && !matchesQuery(item, q)) return false;
    if (status && (item.status_name || "") !== status) return false;
    if (sprint === "__none__" && item.milestone_name) return false;
    if (sprint && sprint !== "__none__" && (item.milestone_name || "") !== sprint) return false;
    if (unread === "unread" && !item.is_unread) return false;
    if (unread === "read" && item.is_unread) return false;
    if (!withinUpdated(item, updated)) return false;
    return true;
  });

  withRead.sort((a, b) => {
    if (sort === "subject") return a.subject.localeCompare(b.subject);
    if (sort === "ref") return (b.ref || b.id) - (a.ref || a.id);
    if (sort === "created") {
      return (Date.parse(b.created_date || "") || 0) - (Date.parse(a.created_date || "") || 0);
    }
    return (Date.parse(b.modified_date || "") || 0) - (Date.parse(a.modified_date || "") || 0);
  });

  const sprints = Array.from(
    new Set(facetsBase.map((i) => i.milestone_name).filter(Boolean) as string[])
  ).sort((a, b) => a.localeCompare(b));

  const statuses = Array.from(
    new Set(facetsBase.map((i) => i.status_name).filter(Boolean) as string[])
  ).sort((a, b) => a.localeCompare(b));

  return c.json({
    ok: true,
    count: withRead.length,
    assigned_to: targetUserId,
    items: withRead,
    summary: summarize(withRead),
    facets: {
      sprints,
      statuses,
      types: ["userstory", "task", "issue"],
    },
    warnings,
  });
});

app.get("/api/items/:type/:id", async (c) => {
  const session = await requireSession(c);
  if (session instanceof Response) return session;

  const type = c.req.param("type") as ItemType;
  const id = Number(c.req.param("id"));
  if (!["userstory", "task", "issue"].includes(type) || !id) {
    return c.json({ error: "Invalid item" }, 400);
  }

  const taiga = new TaigaClient(c.env.TAIGA_API_URL, c.env.TAIGA_AUTH_TYPE);
  const result = await taiga.getItem(session.token, type, id);
  if (!result.ok || !result.data) {
    return c.json({ error: result.error || "Not found" }, result.status || 404);
  }

  return c.json({ ok: true, item: normalizeItem(type, result.data, c.env.TAIGA_WEB_URL), raw: result.data });
});

app.get("/api/items/:type/:id/history", async (c) => {
  const session = await requireSession(c);
  if (session instanceof Response) return session;

  const type = c.req.param("type") as ItemType;
  const id = Number(c.req.param("id"));
  if (!["userstory", "task", "issue"].includes(type) || !id) {
    return c.json({ error: "Invalid item" }, 400);
  }

  const taiga = new TaigaClient(c.env.TAIGA_API_URL, c.env.TAIGA_AUTH_TYPE);
  const history = await taiga.history(session.token, type, id);
  if (!history.ok) {
    return c.json({ error: history.error || "Failed to load history" }, history.status || 500);
  }

  try {
    await markTicketRead(c.env.DB, session.user.id, type, id);
  } catch (e) {
    console.error("mark read failed", e);
  }

  const events = (history.data || []).map((row) => normalizeHistoryEntry(row)).reverse();

  return c.json({ ok: true, events, history: history.data || [] });
});

app.post("/api/items/:type/:id/comment", async (c) => {
  const session = await requireSession(c);
  if (session instanceof Response) return session;

  const type = c.req.param("type") as ItemType;
  const id = Number(c.req.param("id"));
  if (!["userstory", "task", "issue"].includes(type) || !id) {
    return c.json({ error: "Invalid item" }, 400);
  }

  let body: { comment?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const comment = (body.comment || "").trim();
  if (!comment) return c.json({ error: "Comment is required" }, 400);

  const taiga = new TaigaClient(c.env.TAIGA_API_URL, c.env.TAIGA_AUTH_TYPE);
  const result = await taiga.createComment(session.token, type, id, comment);
  if (!result.ok) {
    return c.json({ error: result.error || "Failed to post comment" }, result.status || 500);
  }

  try {
    await markTicketRead(c.env.DB, session.user.id, type, id);
  } catch (e) {
    console.error("mark read failed", e);
  }

  return c.json({ ok: true, data: result.data });
});

app.post("/api/items/:type/:id/read", async (c) => {
  const session = await requireSession(c);
  if (session instanceof Response) return session;

  const type = c.req.param("type");
  const id = Number(c.req.param("id"));
  if (!type || !id) return c.json({ error: "Invalid item" }, 400);

  await markTicketRead(c.env.DB, session.user.id, type, id);
  return c.json({ ok: true });
});

app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return app.fetch(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },
};
