export type HistoryEvent = {
  id: string | number | null;
  created_at: string | null;
  user_name: string;
  type: "comment" | "status" | "field" | "create" | "other";
  title: string;
  body: string | null;
  changes: Array<{ field: string; from: string; to: string }>;
};

function stripHtml(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function asText(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return stripHtml(value) || "—";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 2 && (typeof value[0] === "string" || typeof value[0] === "number" || value[0] == null)) {
      // often [old, new] but handled elsewhere
      return value.map(asText).join(", ");
    }
    return value.map(asText).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (obj.name) return String(obj.name);
    if (obj.full_name_display) return String(obj.full_name_display);
    if (obj.username) return String(obj.username);
    return JSON.stringify(value);
  }
  return String(value);
}

function pairChange(field: string, raw: unknown): { field: string; from: string; to: string } | null {
  if (Array.isArray(raw) && raw.length >= 2) {
    const from = asText(raw[0]);
    const to = asText(raw[1]);
    if (from === to) return null;
    return { field, from, to };
  }
  if (typeof raw === "string" && raw.trim()) {
    return { field, from: "—", to: asText(raw) };
  }
  return null;
}

const SKIP_FIELDS = new Set([
  "description_html",
  "description_diff",
  "content_html",
  "blocked_note_html",
]);

const FIELD_LABELS: Record<string, string> = {
  subject: "Subject",
  status: "Status",
  assigned_to: "Assignee",
  milestone: "Sprint",
  description: "Description",
  description_diff: "Description",
  tags: "Tags",
  is_blocked: "Blocked",
  due_date: "Due date",
  priority: "Priority",
  severity: "Severity",
  type: "Type",
  points: "Points",
  kanban_order: "Kanban order",
  sprint_order: "Sprint order",
  backlog_order: "Backlog order",
};

function labelField(key: string): string {
  return FIELD_LABELS[key] || key.replace(/_/g, " ");
}

export function normalizeHistoryEntry(entry: Record<string, unknown>): HistoryEvent {
  const user = entry.user as { name?: string; username?: string } | null | undefined;
  const userName = user?.name || user?.username || "Someone";
  const createdAt = entry.created_at ? String(entry.created_at) : null;
  const comment = entry.comment ? stripHtml(String(entry.comment)) : "";
  const diff = (entry.values_diff || {}) as Record<string, unknown>;
  const changes: HistoryEvent["changes"] = [];

  for (const [key, raw] of Object.entries(diff)) {
    if (SKIP_FIELDS.has(key)) continue;

    if (key === "description" || key === "description_diff") {
      const text =
        typeof raw === "string"
          ? stripHtml(raw)
          : Array.isArray(raw)
            ? stripHtml(asText(raw[1] ?? raw[0]))
            : "";
      if (text) {
        changes.push({
          field: "Description",
          from: "previous",
          to: text.length > 280 ? `${text.slice(0, 280)}…` : text,
        });
      }
      continue;
    }

    if (key === "status") {
      // status often [[oldId, oldName], [newId, newName]] or [old, new]
      if (Array.isArray(raw) && raw.length >= 2) {
        const from = Array.isArray(raw[0]) ? asText(raw[0][1] ?? raw[0][0]) : asText(raw[0]);
        const to = Array.isArray(raw[1]) ? asText(raw[1][1] ?? raw[1][0]) : asText(raw[1]);
        changes.push({ field: "Status", from, to });
        continue;
      }
    }

    const change = pairChange(labelField(key), raw);
    if (change) changes.push(change);
  }

  if (comment) {
    return {
      id: (entry.id as string | number) ?? null,
      created_at: createdAt,
      user_name: userName,
      type: "comment",
      title: "Comment",
      body: comment,
      changes,
    };
  }

  if (changes.length === 1 && changes[0].field === "Status") {
    return {
      id: (entry.id as string | number) ?? null,
      created_at: createdAt,
      user_name: userName,
      type: "status",
      title: `Status · ${changes[0].from} → ${changes[0].to}`,
      body: null,
      changes,
    };
  }

  if (changes.length) {
    const title =
      changes.length === 1
        ? `${changes[0].field} updated`
        : `${changes.length} fields updated`;
    return {
      id: (entry.id as string | number) ?? null,
      created_at: createdAt,
      user_name: userName,
      type: "field",
      title,
      body: null,
      changes,
    };
  }

  const typeKey = String(entry.type || 1);
  if (typeKey === "1" || entry.delete === false) {
    return {
      id: (entry.id as string | number) ?? null,
      created_at: createdAt,
      user_name: userName,
      type: "create",
      title: "Created",
      body: null,
      changes: [],
    };
  }

  return {
    id: (entry.id as string | number) ?? null,
    created_at: createdAt,
    user_name: userName,
    type: "other",
    title: "Updated",
    body: null,
    changes: [],
  };
}
