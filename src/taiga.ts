type TaigaResult<T> = {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
  headers?: Headers;
};

export type ItemType = "userstory" | "task" | "issue";

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export class TaigaClient {
  constructor(
    private baseUrl: string,
    private authType: string
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  login(username: string, password: string) {
    return this.request<Record<string, unknown>>("POST", "/auth", {
      username,
      password,
      type: this.authType || "ldap",
    });
  }

  me(token: string) {
    return this.request<Record<string, unknown>>("GET", "/users/me", null, token);
  }

  projectsForMember(token: string, memberId: number) {
    return this.request<Record<string, unknown>[]>(
      "GET",
      `/projects${qs({ member: memberId })}`,
      null,
      token
    );
  }

  listAssigned(
    token: string,
    kind: ItemType,
    userId: number,
    opts: { closed?: "open" | "closed" | "all"; project?: number; q?: string } = {}
  ) {
    const path =
      kind === "userstory" ? "/userstories" : kind === "task" ? "/tasks" : "/issues";

    const params: Record<string, string | number | boolean | undefined> = {
      assigned_to: userId,
      project: opts.project,
      q: opts.q,
    };

    if (opts.closed === "open") params["status__is_closed"] = false;
    if (opts.closed === "closed") params["status__is_closed"] = true;

    return this.request<Record<string, unknown>[]>(
      "GET",
      `${path}${qs(params)}`,
      null,
      token
    );
  }

  getItem(token: string, type: ItemType, id: number) {
    const path =
      type === "userstory" ? `/userstories/${id}` : type === "task" ? `/tasks/${id}` : `/issues/${id}`;
    return this.request<Record<string, unknown>>("GET", path, null, token);
  }

  history(token: string, type: ItemType, id: number) {
    return this.request<Record<string, unknown>[]>(
      "GET",
      `/history/${type}/${id}`,
      null,
      token
    );
  }

  createComment(token: string, type: ItemType, id: number, comment: string) {
    return this.request<Record<string, unknown>>(
      "POST",
      `/history/${type}/${id}/comment`,
      { comment },
      token
    );
  }

  private async request<T>(
    method: string,
    path: string,
    body: Record<string, unknown> | null = null,
    token: string | null = null
  ): Promise<TaigaResult<T>> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      const text = await res.text();
      let data: unknown = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }

      if (!res.ok) {
        const errObj = data as Record<string, unknown> | null;
        const error =
          (errObj &&
            String(
              errObj._error_message || errObj.detail || errObj.message || "Request failed"
            )) ||
          "Request failed";
        return { ok: false, status: res.status, data: null, error, headers: res.headers };
      }

      return { ok: true, status: res.status, data: data as T, error: null, headers: res.headers };
    } catch (e) {
      return {
        ok: false,
        status: 0,
        data: null,
        error: e instanceof Error ? e.message : "Network error",
      };
    }
  }
}

export function normalizeItem(type: ItemType, item: Record<string, unknown>) {
  const status = item.status_extra_info as { name?: string; color?: string; is_closed?: boolean } | undefined;
  const project = item.project_extra_info as { name?: string; slug?: string } | undefined;
  const milestone = item.milestone_extra_info as { name?: string; id?: number } | null | undefined;
  const assigned = item.assigned_to_extra_info as { full_name_display?: string; username?: string } | null | undefined;
  const tags = Array.isArray(item.tags)
    ? item.tags.map((t) => (Array.isArray(t) ? String(t[0]) : String(t)))
    : [];

  return {
    type,
    id: Number(item.id),
    ref: item.ref != null ? Number(item.ref) : null,
    subject: String(item.subject || "Untitled"),
    status_id: item.status != null ? Number(item.status) : null,
    status_name: status?.name || null,
    status_color: status?.color || null,
    project_id: item.project != null ? Number(item.project) : null,
    project_name: project?.name || null,
    project_slug: project?.slug || null,
    milestone_id: milestone?.id != null ? Number(milestone.id) : item.milestone != null ? Number(item.milestone) : null,
    milestone_name: milestone?.name || null,
    assigned_name: assigned?.full_name_display || assigned?.username || null,
    modified_date: item.modified_date ? String(item.modified_date) : null,
    created_date: item.created_date ? String(item.created_date) : null,
    is_closed: Boolean(item.is_closed ?? status?.is_closed),
    tags,
    due_date: item.due_date ? String(item.due_date) : null,
    is_blocked: Boolean(item.is_blocked),
    total_comments: item.total_comments != null ? Number(item.total_comments) : null,
  };
}
