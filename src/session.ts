import type { Context } from "hono";
import type { AppEnv, SessionData, SessionUser } from "./types";

const COOKIE = "tp_session";
const MAX_AGE_SEC = 60 * 60 * 12;

function b64url(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const bin = atob(padded + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function signSession(payload: SessionData, secret: string): Promise<string> {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return `${body}.${sig}`;
}

export async function verifySession(token: string, secret: string): Promise<SessionData | null> {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    b64urlToBytes(sig),
    new TextEncoder().encode(body)
  );
  if (!ok) return null;

  try {
    const data = JSON.parse(new TextDecoder().decode(b64urlToBytes(body))) as SessionData;
    if (!data?.token || !data?.user?.id || !data.exp) return null;
    if (Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

export function sessionCookie(value: string, maxAge = MAX_AGE_SEC): string {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function readCookie(header: string | undefined, name = COOKIE): string | null {
  if (!header) return null;
  const parts = header.split(";").map((p) => p.trim());
  for (const part of parts) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    if (part.slice(0, i) === name) return part.slice(i + 1);
  }
  return null;
}

export function buildSession(auth: Record<string, unknown>, user: SessionUser): SessionData {
  return {
    token: String(auth.auth_token || ""),
    refresh: auth.refresh ? String(auth.refresh) : undefined,
    user,
    exp: Date.now() + MAX_AGE_SEC * 1000,
  };
}

export function toSessionUser(data: Record<string, unknown>): SessionUser {
  return {
    id: Number(data.id),
    username: String(data.username || ""),
    full_name: String(data.full_name || ""),
    full_name_display: String(data.full_name_display || data.full_name || data.username || ""),
    email: String(data.email || ""),
    color: data.color ? String(data.color) : undefined,
    roles: Array.isArray(data.roles) ? data.roles.map(String) : [],
    photo: (data.photo as string | null) ?? null,
  };
}

export async function requireSession(c: Context<AppEnv>): Promise<SessionData | Response> {
  const raw = readCookie(c.req.header("Cookie"));
  if (!raw) return c.json({ error: "Unauthorized" }, 401);
  const session = await verifySession(raw, c.env.SESSION_SECRET);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  c.set("session", session);
  return session;
}
