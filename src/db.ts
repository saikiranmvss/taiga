import type { SessionUser } from "./types";

export async function upsertUserPrefs(db: D1Database, user: SessionUser): Promise<void> {
  await db
    .prepare(
      `INSERT INTO user_prefs (taiga_user_id, email, username, last_login_at, last_app_seen_at, updated_at)
       VALUES (?, ?, ?, datetime('now'), datetime('now'), datetime('now'))
       ON CONFLICT(taiga_user_id) DO UPDATE SET
         email = excluded.email,
         username = excluded.username,
         last_login_at = excluded.last_login_at,
         last_app_seen_at = excluded.last_app_seen_at,
         updated_at = excluded.updated_at`
    )
    .bind(user.id, user.email, user.username)
    .run();
}

export async function touchAppSeen(db: D1Database, userId: number): Promise<void> {
  await db
    .prepare(
      `UPDATE user_prefs
       SET last_app_seen_at = datetime('now'), updated_at = datetime('now')
       WHERE taiga_user_id = ?`
    )
    .bind(userId)
    .run();
}

export async function markTicketRead(
  db: D1Database,
  userId: number,
  itemType: string,
  itemId: number
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ticket_reads (taiga_user_id, item_type, item_id, last_seen_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(taiga_user_id, item_type, item_id)
       DO UPDATE SET last_seen_at = excluded.last_seen_at`
    )
    .bind(userId, itemType, itemId)
    .run();
}

export async function listTicketReads(db: D1Database, userId: number) {
  return db
    .prepare(
      `SELECT item_type, item_id, last_seen_at
       FROM ticket_reads
       WHERE taiga_user_id = ?`
    )
    .bind(userId)
    .all<{ item_type: string; item_id: number; last_seen_at: string }>();
}
