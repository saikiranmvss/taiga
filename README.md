# Cloudflare app (local first)

Sibling to the existing PHP portal. PHP files are untouched.

## Stack

- **Pages assets** → `public/`
- **Worker API** → `src/` (Hono)
- **D1** → unread / last-seen prefs only
- **Taiga API** → real tickets, comments, auth

## Setup (already scaffolded)

```bash
cd cf
npm install
npm run db:migrate:local
npm run dev
```

Open the URL Wrangler prints (usually `http://127.0.0.1:8787`).

## Local secrets

`.dev.vars` (gitignored pattern via parent):

```
SESSION_SECRET=any-long-random-string
```

API URL / LDAP type come from `wrangler.toml` `[vars]`.

## API routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Smoke test |
| POST | `/api/login` | Taiga LDAP login |
| POST | `/api/logout` | Clear cookie |
| GET | `/api/me` | Current user |
| GET | `/api/my-work` | Assigned open stories/tasks/issues |
| GET | `/api/items/:type/:id/history` | History + mark read |
| POST | `/api/items/:type/:id/comment` | Add comment |
| POST | `/api/items/:type/:id/read` | Mark read |

## Deploy later (not now)

1. Create D1 in Cloudflare dashboard / `wrangler d1 create taiga_portal`
2. Put real `database_id` in `wrangler.toml`
3. `npm run db:migrate:remote`
4. `npx wrangler secret put SESSION_SECRET`
5. `npm run deploy`
