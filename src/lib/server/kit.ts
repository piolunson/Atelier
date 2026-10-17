import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { getSql, type Sql } from "@/lib/db";
import { t } from "@/lib/i18n";
import type { Brand, ReviewStatus } from "@/lib/types";
import {
  deriveReviewState,
  safeBgType,
  safeFont,
  safeHex,
  safeLayout,
  safePreset,
  safeTheme,
} from "@/lib/room-logic";

const scryptAsync = promisify(scrypt);

export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

export type Rec = Record<string, unknown>;

export async function db(): Promise<Sql> {
  return getSql();
}

export function uid(): string {
  return randomBytes(16).toString("hex");
}

export function iso(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toISOString();
}

export function num(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function bool(value: unknown): boolean {
  return value === true || value === "t" || value === "true" || value === 1;
}

export function str(value: unknown): string {
  return value == null ? "" : String(value);
}

export function asJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

export function isUniqueError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  const message = String((err as { message?: string })?.message ?? err).toLowerCase();
  return code === "23505" || message.includes("unique") || message.includes("duplicate");
}

export async function hmacSecret(): Promise<string> {
  const sql = await db();
  const rows = await sql<Rec>`select value from app_secrets where id = 'hmac'`;
  if (rows[0]) return str(rows[0].value);
  const value = randomBytes(32).toString("hex");
  await sql`insert into app_secrets (id, value) values ('hmac', ${value}) on conflict (id) do nothing`;
  const again = await sql<Rec>`select value from app_secrets where id = 'hmac'`;
  return str(again[0]?.value || value);
}

export function signToken(secret: string, payload: Record<string, unknown>, ttlSec: number): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlSec * 1000 })).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function readToken<T extends Record<string, unknown>>(secret: string, token: string | null | undefined): T | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp?: number };
    if (typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

export async function hashRoomPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scryptAsync(password, salt, 32)) as Buffer;
  return `scrypt$${salt}$${hash.toString("hex")}`;
}

export async function verifyRoomPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [algo, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const next = (await scryptAsync(password, salt, 32)) as Buffer;
  const prev = Buffer.from(hash, "hex");
  if (next.length !== prev.length) return false;
  return timingSafeEqual(next, prev);
}

export async function hashAuthPassword(password: string): Promise<string> {
  const { auth } = await import("@/lib/auth/server");
  const ctx = await auth.$context;
  return ctx.password.hash(password);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function clientMeta(): Promise<{ ipHash: string; ua: string; origin: string }> {
  let ip = "0";
  let ua = "";
  let origin = "";
  try {
    const { getRequestHeader, getRequestIP, getRequestUrl } = await import("@tanstack/react-start/server");
    ip = getRequestIP({ xForwardedFor: true }) || getRequestHeader("x-forwarded-for") || "0";
    ua = (getRequestHeader("user-agent") || "").slice(0, 160);
    origin = getRequestUrl({ xForwardedHost: true, xForwardedProto: true }).origin;
  } catch {
    origin = (process.env.BETTER_AUTH_URL || "").replace(/\/$/, "");
  }
  return { ipHash: sha256(ip.split(",")[0]?.trim() || "0").slice(0, 16), ua, origin };
}

export async function rateLimit(bucket: string, limit: number, windowSec: number): Promise<boolean> {
  const sql = await db();
  const rows = await sql<Rec>`select count, window_start from rate_limits where bucket = ${bucket}`;
  const now = Date.now();
  const start = rows[0] ? new Date(str(rows[0].window_start)).getTime() : 0;
  if (!rows[0] || !Number.isFinite(start) || now - start > windowSec * 1000) {
    await sql`
      insert into rate_limits (bucket, count, window_start) values (${bucket}, 1, now())
      on conflict (bucket) do update set count = 1, window_start = now()
    `;
    return true;
  }
  if (num(rows[0].count) >= limit) return false;
  await sql`update rate_limits set count = count + 1 where bucket = ${bucket}`;
  return true;
}

export async function guardRate(bucket: string, limit: number, windowSec: number): Promise<void> {
  const ok = await rateLimit(bucket, limit, windowSec);
  if (!ok) throw new UserError(t("app.errGeneric"));
}

export function brandFrom(row: Rec): Brand {
  const type = safeBgType(str(row.background_type));
  let value = str(row.background_value || "ember");
  if (type === "preset") value = safePreset(value);
  if (type === "color") value = safeHex(value, "#0c1220");
  if (type === "image" && !value.startsWith("data:image/")) {
    return {
      logoUrl: row.logo_url ? str(row.logo_url) : null,
      accentColor: safeHex(str(row.accent_color)),
      fontKey: safeFont(str(row.font_key)),
      theme: safeTheme(str(row.theme)),
      backgroundType: "preset",
      backgroundValue: "ember",
      layout: safeLayout(str(row.layout)),
    };
  }
  return {
    logoUrl: row.logo_url ? str(row.logo_url) : null,
    accentColor: safeHex(str(row.accent_color)),
    fontKey: safeFont(str(row.font_key)),
    theme: safeTheme(str(row.theme)),
    backgroundType: type,
    backgroundValue: value,
    layout: safeLayout(str(row.layout)),
  };
}

export async function recalcStorage(ownerId: string): Promise<void> {
  const sql = await db();
  await sql`
    update profiles set storage_used_bytes = coalesce((
      select sum(f.size_bytes) from room_files f
      join rooms r on r.id = f.room_id
      where r.owner_id = ${ownerId} and f.deleted_at is null
    ), 0)
    where id = ${ownerId}
  `;
}

export async function refreshReviewState(roomId: string): Promise<"pending" | "changes" | "approved"> {
  const sql = await db();
  const rows = await sql<Rec>`
    select coalesce(rv.status, 'pending') as status
    from room_files f
    left join file_reviews rv on rv.file_id = f.id
    where f.room_id = ${roomId} and f.deleted_at is null
  `;
  const state = deriveReviewState(rows.map((row) => str(row.status) as ReviewStatus));
  await sql`update rooms set review_state = ${state}, updated_at = now() where id = ${roomId}`;
  return state;
}

export async function deliverEmail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
  roomId?: string | null;
  kind?: string | null;
}): Promise<void> {
  const sql = await db();
  await sql`
    insert into outbox_emails (id, to_email, subject, body_text, body_html, room_id, kind)
    values (${uid()}, ${input.to}, ${input.subject}, ${input.text}, ${input.html}, ${input.roomId ?? null}, ${input.kind ?? null})
  `;
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key || !input.to) return;
  const from = process.env.EMAIL_FROM?.trim() || `${process.env.VITE_APP_NAME || "Atelier"} <noreply@example.com>`;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: input.to, subject: input.subject, html: input.html, text: input.text }),
  }).catch(() => undefined);
}

export async function notifyOwner(input: {
  ownerId: string;
  roomId: string;
  kind: string;
  title: string;
  body: string;
  emailEnabled: boolean;
  digest: boolean;
  email?: { to: string; subject: string; text: string; html: string } | null;
}): Promise<void> {
  const sql = await db();
  await sql`
    insert into notifications (id, user_id, room_id, kind, title, body, digest_sent)
    values (${uid()}, ${input.ownerId}, ${input.roomId}, ${input.kind}, ${input.title}, ${input.body}, ${!input.digest && !!input.email})
  `;
  if (!input.email || !input.emailEnabled || input.digest || !input.email.to) return;
  const recent = await sql<Rec>`
    select id from outbox_emails
    where room_id = ${input.roomId} and kind = ${input.kind}
      and created_at > now() - interval '10 minutes'
    limit 1
  `;
  if (recent.length) return;
  await deliverEmail({ ...input.email, roomId: input.roomId, kind: input.kind });
}

export async function loadProfile(userId: string): Promise<Rec | null> {
  const sql = await db();
  const rows = await sql<Rec>`select * from profiles where id = ${userId}`;
  return rows[0] ?? null;
}

export async function requireActiveProfile(userId: string): Promise<Rec> {
  const profile = await loadProfile(userId);
  if (!profile || !bool(profile.is_active)) throw new UserError(t("auth.blocked"));
  return profile;
}

export async function ownRoom(userId: string, roomId: string, role?: string): Promise<Rec> {
  const sql = await db();
  const rows =
    role === "admin"
      ? await sql<Rec>`select * from rooms where id = ${roomId}`
      : await sql<Rec>`select * from rooms where id = ${roomId} and owner_id = ${userId}`;
  if (!rows[0]) throw new UserError(t("system.notFound"));
  return rows[0];
}
