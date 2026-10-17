import { zipSync } from "fflate";
import { randomBytes } from "node:crypto";
import { t } from "@/lib/i18n";
import {
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_PREVIEW_DATA,
  MAX_STORED_DATA,
  MAX_THUMB_DATA,
  assertDataUrl,
  deriveReviewState,
  kindOf,
  planZipParts,
  safeFileName,
  sanitizeText,
  uniqueFileName,
} from "@/lib/room-logic";
import type {
  ActivityItem,
  Brand,
  Comment,
  CoCreator,
  DraftRoom,
  FileKind,
  ManagedRoom,
  Profile,
  PublicRoom,
  ReviewStatus,
  RoomCard,
  Testimonial,
} from "@/lib/types";
import {
  UserError,
  asJson,
  bool,
  brandFrom,
  clientMeta,
  db,
  deliverEmail,
  guardRate,
  hashAuthPassword,
  hashRoomPassword,
  hmacSecret,
  iso,
  isUniqueError,
  loadProfile,
  notifyOwner,
  num,
  ownRoom,
  readToken,
  recalcStorage,
  refreshReviewState,
  requireActiveProfile,
  sha256,
  signToken,
  str,
  type Rec,
  uid,
  verifyRoomPassword,
} from "@/lib/server/kit";
import {
  mailAccount,
  mailApproved,
  mailDelivery,
  mailDigest,
  mailExpiry,
  mailNotes,
  mailOpened,
  mailOpinion,
  mailReset,
} from "@/lib/server/mail";

const KINDS = new Set<FileKind>(["image", "video", "audio", "pdf", "file"]);

function emailOk(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function creators(value: unknown): CoCreator[] {
  const raw = asJson<unknown[]>(value, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object" || !("name" in item)) return "";
      return sanitizeText(String((item as { name: unknown }).name), 80);
    })
    .filter(Boolean)
    .slice(0, 3)
    .map((name) => ({ name }));
}

function mapProfile(row: Rec, email: string): Profile {
  return {
    id: str(row.id),
    email,
    role: str(row.role) === "admin" ? "admin" : "creator",
    displayName: str(row.display_name),
    avatarUrl: row.avatar_url ? str(row.avatar_url) : null,
    storageLimitBytes: num(row.storage_limit_bytes),
    storageUsedBytes: num(row.storage_used_bytes),
    mustChangePassword: bool(row.must_change_password),
    isActive: bool(row.is_active),
    notifyOpen: bool(row.notify_open),
    notifyComments: bool(row.notify_comments),
    notifyAccept: bool(row.notify_accept),
    notifyReviews: bool(row.notify_reviews),
    notifyDigest: bool(row.notify_digest),
    hidePoweredBy: bool(row.hide_powered_by),
  };
}

async function userRow(userId: string): Promise<Rec | null> {
  const sql = await db();
  const rows = await sql<Rec>`select id, name, email from "user" where id = ${userId}`;
  return rows[0] ?? null;
}

export async function bootstrapOpen(): Promise<boolean> {
  const sql = await db();
  const rows = await sql<Rec>`select id from profiles where role = 'admin' limit 1`;
  return rows.length === 0;
}

export async function ensureSelf(userId: string): Promise<{ blocked: true; reason: "inactive" | "none" } | { blocked: false; profile: Profile }> {
  const user = await userRow(userId);
  if (!user) return { blocked: true, reason: "none" };
  const email = str(user.email);
  const sql = await db();
  let profile = await loadProfile(userId);
  if (!profile) {
    const name = sanitizeText(str(user.name) || email.split("@")[0] || "Admin", 80);
    try {
      await sql`
        insert into profiles (id, role, display_name, must_change_password)
        values (${userId}, 'admin', ${name}, false)
      `;
    } catch (err) {
      if (!isUniqueError(err)) throw err;
    }
    profile = await loadProfile(userId);
  }
  if (!profile) return { blocked: true, reason: "none" };
  if (!bool(profile.is_active)) return { blocked: true, reason: "inactive" };
  await sql`update profiles set last_seen_at = now() where id = ${userId}`;
  return { blocked: false, profile: mapProfile(profile, email) };
}

async function defaultBrand(ownerId: string, hide: boolean): Promise<{ brand: Brand; hide: boolean }> {
  const sql = await db();
  const rows = await sql<Rec>`
    select * from brand_presets where owner_id = ${ownerId} and is_default = true
    order by created_at desc limit 1
  `;
  if (!rows[0]) {
    return {
      hide,
      brand: {
        logoUrl: null,
        accentColor: "#E07A3D",
        fontKey: "cormorant",
        theme: "dark",
        backgroundType: "preset",
        backgroundValue: "ember",
        layout: "grid",
      },
    };
  }
  return { hide, brand: brandFrom(rows[0]) };
}

function mapBrandInput(input: Brand): Brand {
  const type = input.backgroundType;
  let value = input.backgroundValue;
  if (type === "image") value = assertDataUrl(value, 1_500_000) || "ember";
  return {
    logoUrl: assertDataUrl(input.logoUrl, 500_000),
    accentColor: input.accentColor,
    fontKey: input.fontKey,
    theme: input.theme,
    backgroundType: type === "image" && !String(value).startsWith("data:image/") ? "preset" : type,
    backgroundValue: type === "image" && !String(value).startsWith("data:image/") ? "ember" : value,
    layout: input.layout,
  };
}

export async function listRooms(userId: string): Promise<RoomCard[]> {
  await requireActiveProfile(userId);
  const sql = await db();
  const rows = await sql<Rec>`
    select r.*,
      (select count(*) from room_files f where f.room_id = r.id and f.deleted_at is null) as file_count,
      (select coalesce(sum(f.size_bytes), 0) from room_files f where f.room_id = r.id and f.deleted_at is null) as total_bytes,
      (select count(*) from room_files f join file_reviews rv on rv.file_id = f.id
        where f.room_id = r.id and f.deleted_at is null and rv.status = 'approved') as approved_count,
      coalesce(
        (select thumb_data from room_files f where f.id = r.cover_file_id and f.deleted_at is null),
        (select thumb_data from room_files f where f.room_id = r.id and f.deleted_at is null and f.kind = 'image' order by f.position limit 1)
      ) as cover_thumb,
      exists(select 1 from room_events e where e.room_id = r.id and e.type = 'opened') as opened
    from rooms r
    where r.owner_id = ${userId}
    order by r.updated_at desc
  `;
  return rows.map((row) => ({
    id: str(row.id),
    slug: str(row.slug),
    title: str(row.title),
    clientName: str(row.client_name),
    status: (str(row.status) as RoomCard["status"]) || "draft",
    reviewState: (str(row.review_state) as RoomCard["reviewState"]) || "pending",
    expiresAt: iso(row.expires_at),
    fileCount: num(row.file_count),
    totalBytes: num(row.total_bytes),
    approvedCount: num(row.approved_count),
    coverThumb: row.cover_thumb ? str(row.cover_thumb) : null,
    updatedAt: iso(row.updated_at) || "",
    opened: bool(row.opened),
  }));
}

export async function createDraft(userId: string): Promise<{ id: string }> {
  const profile = await requireActiveProfile(userId);
  const preset = await defaultBrand(userId, bool(profile.hide_powered_by));
  const sql = await db();
  const id = uid();
  const slug = `${uid()}${uid()}`.slice(0, 12);
  const brand = preset.brand;
  await sql`
    insert into rooms (
      id, slug, owner_id, validity_days, hide_powered_by,
      accent_color, font_key, theme, background_type, background_value, layout, logo_url
    ) values (
      ${id}, ${slug}, ${userId}, 14, ${preset.hide},
      ${brand.accentColor}, ${brand.fontKey}, ${brand.theme}, ${brand.backgroundType},
      ${brand.backgroundValue}, ${brand.layout}, ${brand.logoUrl}
    )
  `;
  return { id };
}

async function filesOf(roomId: string, coverId: string | null) {
  const sql = await db();
  const rows = await sql<Rec>`
    select id, original_name, kind, size_bytes, thumb_data, position, deleted_at
    from room_files where room_id = ${roomId} and deleted_at is null
    order by position, created_at
  `;
  return rows.map((row) => ({
    id: str(row.id),
    name: str(row.original_name),
    kind: (KINDS.has(str(row.kind) as FileKind) ? str(row.kind) : "file") as FileKind,
    sizeBytes: num(row.size_bytes),
    thumb: row.thumb_data ? str(row.thumb_data) : null,
    position: num(row.position),
    isCover: str(row.id) === coverId,
  }));
}

function mapDraft(row: Rec, files: DraftRoom["files"]): DraftRoom {
  return {
    id: str(row.id),
    slug: str(row.slug),
    title: str(row.title),
    clientName: str(row.client_name),
    clientEmail: str(row.client_email),
    message: str(row.message),
    coCreators: creators(row.co_creators),
    status: (str(row.status) as DraftRoom["status"]) || "draft",
    validityDays: row.validity_days == null ? null : num(row.validity_days),
    hasPassword: Boolean(row.password_hash),
    allowZip: bool(row.allow_zip),
    allowDownload: bool(row.allow_download),
    hidePoweredBy: bool(row.hide_powered_by),
    brand: brandFrom(row),
    files,
  };
}

export async function getDraft(userId: string, roomId: string): Promise<DraftRoom> {
  await requireActiveProfile(userId);
  const room = await ownRoom(userId, roomId);
  const files = await filesOf(str(room.id), room.cover_file_id ? str(room.cover_file_id) : null);
  return mapDraft(room, files);
}

export async function saveDraft(
  userId: string,
  input: {
    roomId: string;
    title: string;
    clientName: string;
    clientEmail: string;
    message: string;
    coCreators: string[];
    validityDays: number | null;
    password?: string;
    clearPassword?: boolean;
    allowZip: boolean;
    allowDownload: boolean;
    hidePoweredBy: boolean;
    brand: Brand;
  },
): Promise<DraftRoom> {
  await requireActiveProfile(userId);
  const room = await ownRoom(userId, input.roomId);
  const brand = mapBrandInput({
    ...input.brand,
    accentColor: input.brand.accentColor,
    fontKey: input.brand.fontKey,
    theme: input.brand.theme,
    backgroundType: input.brand.backgroundType,
    layout: input.brand.layout,
    backgroundValue: input.brand.backgroundValue,
    logoUrl: input.brand.logoUrl,
  });
  const people = input.coCreators.map((name) => sanitizeText(name, 80)).filter(Boolean).slice(0, 3);
  const email = input.clientEmail.trim().toLowerCase();
  if (email && !emailOk(email)) throw new UserError(t("app.errGeneric"));
  let passwordHash = room.password_hash ? str(room.password_hash) : null;
  if (input.clearPassword) passwordHash = null;
  if (input.password && input.password.trim()) {
    if (input.password.trim().length < 4) throw new UserError(t("room.badPassword"));
    passwordHash = await hashRoomPassword(input.password.trim());
  }
  const days = input.validityDays === 7 || input.validityDays === 14 || input.validityDays === 30 ? input.validityDays : null;
  const sql = await db();
  await sql`
    update rooms set
      title = ${sanitizeText(input.title, 160)},
      client_name = ${sanitizeText(input.clientName, 120)},
      client_email = ${email || null},
      message = ${sanitizeText(input.message, 2000)},
      co_creators = ${JSON.stringify(people.map((name) => ({ name })))}::jsonb,
      validity_days = ${days},
      password_hash = ${passwordHash},
      allow_zip = ${input.allowZip},
      allow_download = ${input.allowDownload},
      hide_powered_by = ${input.hidePoweredBy},
      accent_color = ${brand.accentColor},
      font_key = ${brand.fontKey},
      theme = ${brand.theme},
      background_type = ${brand.backgroundType},
      background_value = ${brand.backgroundValue},
      layout = ${brand.layout},
      logo_url = ${brand.logoUrl},
      updated_at = now()
    where id = ${input.roomId} and owner_id = ${userId}
  `;
  return getDraft(userId, input.roomId);
}

export async function publishRoom(userId: string, roomId: string): Promise<DraftRoom> {
  const profile = await requireActiveProfile(userId);
  const room = await ownRoom(userId, roomId);
  const files = await filesOf(roomId, room.cover_file_id ? str(room.cover_file_id) : null);
  if (!files.length) throw new UserError(t("app.errFile"));
  if (!str(room.title).trim()) throw new UserError(t("app.errTitle"));
  const days = room.validity_days == null ? null : num(room.validity_days);
  const snapshot = {
    ...brandFrom(room),
    ownerName: str(profile.display_name),
    ownerAvatar: profile.avatar_url ? str(profile.avatar_url) : null,
  };
  const sql = await db();
  await sql`
    update rooms set
      status = 'active',
      published_at = coalesce(published_at, now()),
      expires_at = case when ${days}::int is null then null else now() + (${days}::int * interval '1 day') end,
      expiry_reminded = false,
      brand_snapshot = ${JSON.stringify(snapshot)}::jsonb,
      updated_at = now()
    where id = ${roomId} and owner_id = ${userId}
  `;
  await refreshReviewState(roomId);
  return getDraft(userId, roomId);
}

export async function addFile(
  userId: string,
  input: {
    roomId: string;
    name: string;
    mime: string;
    sizeBytes: number;
    width?: number | null;
    height?: number | null;
    duration?: number | null;
    kind: string;
    thumb?: string | null;
    preview?: string | null;
    fileData?: string | null;
  },
): Promise<{ id: string }> {
  const profile = await requireActiveProfile(userId);
  const room = await ownRoom(userId, input.roomId);
  if (input.sizeBytes > MAX_FILE_BYTES) throw new UserError(t("wizard.limit"));
  if (num(profile.storage_used_bytes) + Math.max(0, input.sizeBytes) > num(profile.storage_limit_bytes)) {
    throw new UserError(t("app.errSpace"));
  }
  const sql = await db();
  const countRows = await sql<Rec>`select count(*) as n from room_files where room_id = ${input.roomId} and deleted_at is null`;
  if (num(countRows[0]?.n) >= MAX_FILES) throw new UserError(t("app.errGeneric"));
  const kind = KINDS.has(input.kind as FileKind) ? (input.kind as FileKind) : kindOf({ name: input.name, type: input.mime });
  const id = uid();
  const posRows = await sql<Rec>`select coalesce(max(position), 0) as n from room_files where room_id = ${input.roomId}`;
  const thumb = assertDataUrl(input.thumb, MAX_THUMB_DATA);
  const preview = assertDataUrl(input.preview, MAX_PREVIEW_DATA);
  const fileData = assertDataUrl(input.fileData, MAX_STORED_DATA);
  await sql`
    insert into room_files (
      id, room_id, original_name, mime, size_bytes, width, height, duration_seconds, position, kind, thumb_data, preview_data, file_data
    ) values (
      ${id}, ${input.roomId}, ${safeFileName(input.name)}, ${sanitizeText(input.mime || "application/octet-stream", 120)},
      ${Math.max(0, Math.round(input.sizeBytes))}, ${input.width ?? null}, ${input.height ?? null}, ${input.duration ?? null},
      ${num(posRows[0]?.n) + 1}, ${kind}, ${thumb}, ${preview}, ${fileData}
    )
  `;
  await sql`
    insert into file_reviews (file_id, status) values (${id}, 'pending')
    on conflict (file_id) do update set status = 'pending', updated_at = now()
  `;
  if (!room.cover_file_id && (thumb || preview)) {
    await sql`update rooms set cover_file_id = ${id} where id = ${input.roomId}`;
  }
  await sql`update rooms set updated_at = now() where id = ${input.roomId}`;
  await recalcStorage(userId);
  await refreshReviewState(input.roomId);
  return { id };
}

export async function removeFile(userId: string, roomId: string, fileId: string): Promise<void> {
  await requireActiveProfile(userId);
  const room = await ownRoom(userId, roomId);
  const sql = await db();
  await sql`update room_files set deleted_at = now() where id = ${fileId} and room_id = ${roomId}`;
  if (str(room.cover_file_id) === fileId) {
    const next = await sql<Rec>`
      select id from room_files where room_id = ${roomId} and deleted_at is null order by position limit 1
    `;
    await sql`update rooms set cover_file_id = ${next[0] ? str(next[0].id) : null} where id = ${roomId}`;
  }
  await recalcStorage(userId);
  await refreshReviewState(roomId);
}

export async function reorderFiles(userId: string, roomId: string, ids: string[]): Promise<void> {
  await requireActiveProfile(userId);
  await ownRoom(userId, roomId);
  const sql = await db();
  for (let i = 0; i < ids.length; i += 1) {
    await sql`update room_files set position = ${i} where id = ${ids[i]} and room_id = ${roomId} and deleted_at is null`;
  }
  await sql`update rooms set updated_at = now() where id = ${roomId}`;
}

export async function setCover(userId: string, roomId: string, fileId: string): Promise<void> {
  await requireActiveProfile(userId);
  await ownRoom(userId, roomId);
  const sql = await db();
  const rows = await sql<Rec>`select id from room_files where id = ${fileId} and room_id = ${roomId} and deleted_at is null`;
  if (!rows[0]) throw new UserError(t("system.notFound"));
  await sql`update rooms set cover_file_id = ${fileId}, updated_at = now() where id = ${roomId}`;
}

export async function getManaged(userId: string, roomId: string): Promise<ManagedRoom> {
  const profile = await requireActiveProfile(userId);
  const room = await ownRoom(userId, roomId, str(profile.role));
  const sql = await db();
  const fileRows = await sql<Rec>`
    select f.id, f.original_name, f.kind, f.size_bytes, f.thumb_data, f.position, f.deleted_at,
      coalesce(rv.status, 'pending') as review_status,
      (select count(*) from file_comments c where c.file_id = f.id) as comment_count
    from room_files f
    left join file_reviews rv on rv.file_id = f.id
    where f.room_id = ${roomId}
    order by f.deleted_at is not null, f.position
  `;
  const events = await sql<Rec>`
    select id, type, actor_name, file_id, created_at from room_events
    where room_id = ${roomId} order by created_at desc limit 40
  `;
  const comments = await sql<Rec>`
    select c.id, c.file_id, c.author_type, c.author_name, c.body, c.created_at, f.original_name
    from file_comments c join room_files f on f.id = c.file_id
    where c.room_id = ${roomId} order by c.created_at desc limit 80
  `;
  const opens = await sql<Rec>`select count(*) as n from room_events where room_id = ${roomId} and type = 'opened'`;
  const downloads = await sql<Rec>`
    select count(*) as n from room_events where room_id = ${roomId} and type in ('downloaded_file', 'downloaded_zip')
  `;
  const live = fileRows.filter((row) => !row.deleted_at);
  const approved = live.filter((row) => str(row.review_status) === "approved").length;
  const activity: ActivityItem[] = events.map((row) => ({
    id: str(row.id),
    type: str(row.type),
    actorName: row.actor_name ? str(row.actor_name) : null,
    fileId: row.file_id ? str(row.file_id) : null,
    createdAt: iso(row.created_at) || "",
  }));
  return {
    id: str(room.id),
    slug: str(room.slug),
    title: str(room.title),
    clientName: str(room.client_name),
    clientEmail: str(room.client_email),
    message: str(room.message),
    status: str(room.status) as ManagedRoom["status"],
    reviewState: str(room.review_state) as ManagedRoom["reviewState"],
    expiresAt: iso(room.expires_at),
    validityDays: room.validity_days == null ? null : num(room.validity_days),
    hasPassword: Boolean(room.password_hash),
    allowZip: bool(room.allow_zip),
    allowDownload: bool(room.allow_download),
    hidePoweredBy: bool(room.hide_powered_by),
    brand: brandFrom(room),
    files: fileRows.map((row) => ({
      id: str(row.id),
      name: str(row.original_name),
      kind: (KINDS.has(str(row.kind) as FileKind) ? str(row.kind) : "file") as FileKind,
      sizeBytes: num(row.size_bytes),
      thumb: row.thumb_data ? str(row.thumb_data) : null,
      position: num(row.position),
      status: (str(row.review_status) as ReviewStatus) || "pending",
      commentCount: num(row.comment_count),
      deletedAt: iso(row.deleted_at),
    })),
    activity,
    comments: comments.map((row) => ({
      id: str(row.id),
      fileId: str(row.file_id),
      fileName: str(row.original_name),
      authorType: str(row.author_type) === "creator" ? "creator" : "client",
      authorName: str(row.author_name),
      body: str(row.body),
      createdAt: iso(row.created_at) || "",
    })),
    opens: num(opens[0]?.n),
    downloads: num(downloads[0]?.n),
    approved,
    total: live.length,
  };
}

export async function replyComment(userId: string, roomId: string, fileId: string, body: string): Promise<void> {
  const profile = await requireActiveProfile(userId);
  await ownRoom(userId, roomId, str(profile.role));
  const text = sanitizeText(body, 2000);
  if (!text) return;
  const sql = await db();
  const file = await sql<Rec>`select id from room_files where id = ${fileId} and room_id = ${roomId}`;
  if (!file[0]) throw new UserError(t("system.notFound"));
  await sql`
    insert into file_comments (id, file_id, room_id, author_type, author_name, body)
    values (${uid()}, ${fileId}, ${roomId}, 'creator', ${str(profile.display_name)}, ${text})
  `;
  const meta = await clientMeta();
  await sql`
    insert into room_events (id, room_id, file_id, type, actor_name, ip_hash, user_agent_short)
    values (${uid()}, ${roomId}, ${fileId}, 'commented', ${str(profile.display_name)}, ${meta.ipHash}, ${meta.ua})
  `;
}

export async function setRoomActive(userId: string, roomId: string, active: boolean): Promise<void> {
  const profile = await requireActiveProfile(userId);
  await ownRoom(userId, roomId, str(profile.role));
  const sql = await db();
  await sql`
    update rooms set status = ${active ? "active" : "disabled"}, updated_at = now()
    where id = ${roomId} and status <> 'draft'
  `;
}

export async function setExpiry(userId: string, roomId: string, isoDate: string | null): Promise<void> {
  const profile = await requireActiveProfile(userId);
  await ownRoom(userId, roomId, str(profile.role));
  const sql = await db();
  const when = isoDate ? new Date(isoDate).toISOString() : null;
  await sql`update rooms set expires_at = ${when}, expiry_reminded = false, updated_at = now() where id = ${roomId}`;
}

export async function duplicateRoom(userId: string, roomId: string): Promise<{ id: string }> {
  await requireActiveProfile(userId);
  const room = await ownRoom(userId, roomId);
  const sql = await db();
  const id = uid();
  const slug = uid().slice(0, 12);
  await sql`
    insert into rooms (
      id, slug, owner_id, title, client_name, client_email, message, co_creators, status, validity_days,
      allow_zip, allow_download, hide_powered_by, accent_color, font_key, theme, background_type,
      background_value, layout, logo_url
    )
    select ${id}, ${slug}, owner_id, left(title || ' (kopia)', 160), client_name, client_email, message, co_creators,
      'draft', validity_days, allow_zip, allow_download, hide_powered_by, accent_color, font_key, theme,
      background_type, background_value, layout, logo_url
    from rooms where id = ${roomId}
  `;
  const files = await sql<Rec>`
    select * from room_files where room_id = ${roomId} and deleted_at is null order by position
  `;
  let cover: string | null = null;
  for (const file of files) {
    const fileId = uid();
    if (str(room.cover_file_id) === str(file.id)) cover = fileId;
    await sql`
      insert into room_files (
        id, room_id, original_name, mime, size_bytes, width, height, duration_seconds, position, kind, thumb_data, preview_data, file_data
      ) values (
        ${fileId}, ${id}, ${str(file.original_name)}, ${str(file.mime)}, ${num(file.size_bytes)},
        ${file.width ?? null}, ${file.height ?? null}, ${file.duration_seconds ?? null}, ${num(file.position)},
        ${str(file.kind)}, ${file.thumb_data ?? null}, ${file.preview_data ?? null}, ${file.file_data ?? null}
      )
    `;
    await sql`insert into file_reviews (file_id, status) values (${fileId}, 'pending')`;
  }
  if (cover) await sql`update rooms set cover_file_id = ${cover} where id = ${id}`;
  await recalcStorage(userId);
  return { id };
}

export async function deleteRoom(userId: string, roomId: string): Promise<void> {
  const profile = await requireActiveProfile(userId);
  const room = await ownRoom(userId, roomId, str(profile.role));
  const sql = await db();
  await sql`delete from rooms where id = ${roomId}`;
  await recalcStorage(str(room.owner_id));
}

export async function getBrand(userId: string): Promise<Brand & { name: string }> {
  await requireActiveProfile(userId);
  const preset = await defaultBrand(userId, false);
  return { ...preset.brand, name: "Domyślny" };
}

export async function saveBrand(userId: string, brand: Brand, name: string): Promise<void> {
  await requireActiveProfile(userId);
  const clean = mapBrandInput(brand);
  const sql = await db();
  const existing = await sql<Rec>`select id from brand_presets where owner_id = ${userId} and is_default = true limit 1`;
  if (existing[0]) {
    await sql`
      update brand_presets set
        name = ${sanitizeText(name || "Domyślny", 80)},
        logo_url = ${clean.logoUrl}, accent_color = ${clean.accentColor}, font_key = ${clean.fontKey},
        theme = ${clean.theme}, background_type = ${clean.backgroundType}, background_value = ${clean.backgroundValue},
        layout = ${clean.layout}, is_default = true
      where id = ${str(existing[0].id)}
    `;
    return;
  }
  await sql`
    insert into brand_presets (
      id, owner_id, name, logo_url, accent_color, font_key, theme, background_type, background_value, layout, is_default
    ) values (
      ${uid()}, ${userId}, ${sanitizeText(name || "Domyślny", 80)}, ${clean.logoUrl}, ${clean.accentColor},
      ${clean.fontKey}, ${clean.theme}, ${clean.backgroundType}, ${clean.backgroundValue}, ${clean.layout}, true
    )
  `;
}

export async function saveSettings(
  userId: string,
  input: {
    displayName: string;
    avatarUrl?: string | null;
    notifyOpen: boolean;
    notifyComments: boolean;
    notifyAccept: boolean;
    notifyReviews: boolean;
    notifyDigest: boolean;
    hidePoweredBy: boolean;
  },
): Promise<Profile> {
  await requireActiveProfile(userId);
  const avatar = input.avatarUrl ? assertDataUrl(input.avatarUrl, 500_000) : null;
  const sql = await db();
  await sql`
    update profiles set
      display_name = ${sanitizeText(input.displayName, 80) || "Twórca"},
      avatar_url = ${avatar},
      notify_open = ${input.notifyOpen},
      notify_comments = ${input.notifyComments},
      notify_accept = ${input.notifyAccept},
      notify_reviews = ${input.notifyReviews},
      notify_digest = ${input.notifyDigest},
      hide_powered_by = ${input.hidePoweredBy}
    where id = ${userId}
  `;
  await sql`update "user" set name = ${sanitizeText(input.displayName, 80) || "Twórca"}, "updatedAt" = now() where id = ${userId}`;
  const session = await ensureSelf(userId);
  if (session.blocked) throw new UserError(t("auth.blocked"));
  return session.profile;
}

export async function clearMustChange(userId: string): Promise<void> {
  const sql = await db();
  await sql`update profiles set must_change_password = false where id = ${userId}`;
}

export async function listNotifications(userId: string): Promise<{ id: string; title: string; body: string; createdAt: string; read: boolean }[]> {
  await requireActiveProfile(userId);
  const sql = await db();
  const rows = await sql<Rec>`
    select id, title, body, created_at, read_at from notifications
    where user_id = ${userId} order by created_at desc limit 30
  `;
  return rows.map((row) => ({
    id: str(row.id),
    title: str(row.title),
    body: str(row.body),
    createdAt: iso(row.created_at) || "",
    read: Boolean(row.read_at),
  }));
}

export async function markNotificationsRead(userId: string): Promise<void> {
  await requireActiveProfile(userId);
  const sql = await db();
  await sql`update notifications set read_at = now() where user_id = ${userId} and read_at is null`;
}

export async function sendClientEmail(userId: string, roomId: string): Promise<void> {
  const profile = await requireActiveProfile(userId);
  const room = await ownRoom(userId, roomId);
  const email = str(room.client_email);
  if (!email) throw new UserError(t("app.errGeneric"));
  const meta = await clientMeta();
  const link = `${meta.origin}/d/${str(room.slug)}`;
  const mail = mailDelivery({
    name: str(room.client_name),
    sender: str(profile.display_name),
    title: str(room.title),
    message: str(room.message),
    until: room.expires_at ? new Date(str(room.expires_at)).toLocaleDateString("pl-PL") : null,
    url: link,
  });
  await deliverEmail({ to: email, ...mail, roomId, kind: "delivery" });
}

async function roomBySlug(slug: string): Promise<Rec | null> {
  const sql = await db();
  const rows = await sql<Rec>`select * from rooms where slug = ${slug}`;
  return rows[0] ?? null;
}

function expired(room: Rec): boolean {
  if (!room.expires_at) return false;
  const when = new Date(str(room.expires_at)).getTime();
  return Number.isFinite(when) && when < Date.now();
}

async function gate(room: Rec, token: string | null): Promise<"ok" | "locked"> {
  if (!room.password_hash) return "ok";
  const secret = await hmacSecret();
  const data = readToken<{ typ?: string; slug?: string }>(secret, token);
  if (data?.typ === "room" && data.slug === str(room.slug)) return "ok";
  return "locked";
}

function snapshotBrand(room: Rec): { brand: Brand; ownerName: string; ownerAvatar: string | null } {
  const snap = asJson<Record<string, unknown>>(room.brand_snapshot, {});
  if (snap.accentColor) {
    return {
      brand: brandFrom({
        logo_url: snap.logoUrl,
        accent_color: snap.accentColor,
        font_key: snap.fontKey,
        theme: snap.theme,
        background_type: snap.backgroundType,
        background_value: snap.backgroundValue,
        layout: snap.layout,
      }),
      ownerName: str(snap.ownerName),
      ownerAvatar: snap.ownerAvatar ? str(snap.ownerAvatar) : null,
    };
  }
  return { brand: brandFrom(room), ownerName: "", ownerAvatar: null };
}

export async function getPublicRoom(slug: string, token: string | null): Promise<PublicRoom> {
  const room = await roomBySlug(sanitizeText(slug, 40));
  if (!room || str(room.status) === "draft") return { state: "missing" };
  if (str(room.status) === "disabled") return { state: "disabled" };
  if (expired(room)) return { state: "expired" };
  if ((await gate(room, token)) === "locked") return { state: "locked" };
  const sql = await db();
  const files = await sql<Rec>`
    select f.id, f.original_name, f.mime, f.kind, f.width, f.height, f.duration_seconds, f.thumb_data,
      (f.file_data is not null) as has_download,
      coalesce(rv.status, 'pending') as review_status,
      (select count(*) from file_comments c where c.file_id = f.id) as comment_count
    from room_files f
    left join file_reviews rv on rv.file_id = f.id
    where f.room_id = ${str(room.id)} and f.deleted_at is null
    order by f.position, f.created_at
  `;
  let cover: string | null = null;
  const coverId = room.cover_file_id ? str(room.cover_file_id) : files[0] ? str(files[0].id) : null;
  if (coverId) {
    const coverRows = await sql<Rec>`select coalesce(preview_data, thumb_data) as src from room_files where id = ${coverId} and deleted_at is null`;
    cover = coverRows[0]?.src ? str(coverRows[0].src) : null;
  }
  const snap = snapshotBrand(room);
  let ownerName = snap.ownerName;
  let ownerAvatar = snap.ownerAvatar;
  if (!ownerName) {
    const owner = await loadProfile(str(room.owner_id));
    ownerName = owner ? str(owner.display_name) : "";
    ownerAvatar = owner?.avatar_url ? str(owner.avatar_url) : null;
  }
  return {
    state: "ok",
    slug: str(room.slug),
    title: str(room.title),
    clientName: str(room.client_name),
    message: str(room.message),
    ownerName,
    ownerAvatar,
    coCreators: creators(room.co_creators),
    allowZip: bool(room.allow_zip),
    allowDownload: bool(room.allow_download),
    hidePoweredBy: bool(room.hide_powered_by),
    brand: snap.brand,
    coverPreview: cover,
    coverId,
    files: files.map((row) => ({
      id: str(row.id),
      name: str(row.original_name),
      kind: (KINDS.has(str(row.kind) as FileKind) ? str(row.kind) : "file") as FileKind,
      mime: str(row.mime),
      width: row.width == null ? null : num(row.width),
      height: row.height == null ? null : num(row.height),
      duration: row.duration_seconds == null ? null : num(row.duration_seconds),
      thumb: row.thumb_data ? str(row.thumb_data) : null,
      status: (str(row.review_status) as ReviewStatus) || "pending",
      commentCount: num(row.comment_count),
      hasDownload: bool(row.has_download),
    })),
  };
}

export async function getPublicStatus(slug: string, token: string | null): Promise<PublicRoom | { state: "ok"; files: { id: string; status: ReviewStatus; commentCount: number }[] }> {
  const room = await roomBySlug(sanitizeText(slug, 40));
  if (!room || str(room.status) === "draft") return { state: "missing" };
  if (str(room.status) === "disabled") return { state: "disabled" };
  if (expired(room)) return { state: "expired" };
  if ((await gate(room, token)) === "locked") return { state: "locked" };
  const sql = await db();
  const files = await sql<Rec>`
    select f.id, coalesce(rv.status, 'pending') as review_status,
      (select count(*) from file_comments c where c.file_id = f.id) as comment_count
    from room_files f
    left join file_reviews rv on rv.file_id = f.id
    where f.room_id = ${str(room.id)} and f.deleted_at is null
  `;
  return {
    state: "ok",
    files: files.map((row) => ({
      id: str(row.id),
      status: (str(row.review_status) as ReviewStatus) || "pending",
      commentCount: num(row.comment_count),
    })),
  };
}

export async function unlockRoom(slug: string, password: string): Promise<{ token: string }> {
  const clean = sanitizeText(slug, 40);
  const meta = await clientMeta();
  await guardRate(`room-pw:${clean}:${meta.ipHash}`, 8, 600);
  const room = await roomBySlug(clean);
  if (!room || str(room.status) !== "active" || expired(room)) throw new UserError(t("room.badPassword"));
  const ok = await verifyRoomPassword(password, room.password_hash ? str(room.password_hash) : null);
  if (!ok) throw new UserError(t("room.badPassword"));
  const secret = await hmacSecret();
  const token = signToken(secret, { typ: "room", slug: clean }, 60 * 60 * 12);
  try {
    const { setCookie, getRequestProtocol } = await import("@tanstack/react-start/server");
    setCookie(`dra_${clean}`, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12,
      secure: getRequestProtocol() === "https",
    });
  } catch {
    /* cookie is a bonus; the token is returned to the client */
  }
  return { token };
}

async function requireOpenRoom(slug: string, token: string | null): Promise<Rec> {
  const room = await roomBySlug(sanitizeText(slug, 40));
  if (!room || str(room.status) === "draft") throw new UserError(t("system.notFound"));
  if (str(room.status) === "disabled") throw new UserError(t("room.disabled"));
  if (expired(room)) throw new UserError(t("room.expired"));
  if ((await gate(room, token)) === "locked") throw new UserError(t("room.locked"));
  return room;
}

export async function recordOpen(slug: string, token: string | null, actorName: string): Promise<void> {
  const room = await requireOpenRoom(slug, token);
  const meta = await clientMeta();
  const sql = await db();
  const recent = await sql<Rec>`
    select id from room_events
    where room_id = ${str(room.id)} and type = 'opened' and ip_hash = ${meta.ipHash}
      and created_at > now() - interval '30 minutes' limit 1
  `;
  if (recent.length) return;
  const name = sanitizeText(actorName, 80);
  await sql`
    insert into room_events (id, room_id, type, actor_name, ip_hash, user_agent_short)
    values (${uid()}, ${str(room.id)}, 'opened', ${name || null}, ${meta.ipHash}, ${meta.ua})
  `;
  const owner = await loadProfile(str(room.owner_id));
  if (!owner) return;
  const origin = meta.origin;
  const mail = mailOpened({
    client: name || str(room.client_name) || "Klient",
    title: str(room.title),
    when: new Date().toLocaleString("pl-PL"),
    url: `${origin}/app/pokoj/${str(room.id)}`,
  });
  await notifyOwner({
    ownerId: str(owner.id),
    roomId: str(room.id),
    kind: "opened",
    title: mail.subject,
    body: mail.text,
    emailEnabled: bool(owner.notify_open),
    digest: bool(owner.notify_digest),
    email: owner ? { to: str((await userRow(str(owner.id)))?.email), ...mail } : null,
  });
}

export async function setFileReview(input: {
  slug: string;
  token: string | null;
  fileId: string;
  status: ReviewStatus;
  name: string;
}): Promise<{ status: ReviewStatus; state: string }> {
  if (input.status !== "approved" && input.status !== "changes_requested" && input.status !== "pending") {
    throw new UserError(t("app.errGeneric"));
  }
  const room = await requireOpenRoom(input.slug, input.token);
  const meta = await clientMeta();
  await guardRate(`review:${str(room.id)}:${meta.ipHash}`, 80, 600);
  const sql = await db();
  const file = await sql<Rec>`select id, original_name from room_files where id = ${input.fileId} and room_id = ${str(room.id)} and deleted_at is null`;
  if (!file[0]) throw new UserError(t("system.notFound"));
  const name = sanitizeText(input.name, 80) || str(room.client_name) || "Klient";
  await sql`
    insert into file_reviews (file_id, status, reviewer_name, updated_at)
    values (${input.fileId}, ${input.status}, ${name}, now())
    on conflict (file_id) do update set status = ${input.status}, reviewer_name = ${name}, updated_at = now()
  `;
  const eventType = input.status === "approved" ? "approved" : input.status === "changes_requested" ? "changes_requested" : "pending";
  await sql`
    insert into room_events (id, room_id, file_id, type, actor_name, ip_hash, user_agent_short)
    values (${uid()}, ${str(room.id)}, ${input.fileId}, ${eventType}, ${name}, ${meta.ipHash}, ${meta.ua})
  `;
  const state = await refreshReviewState(str(room.id));
  const owner = await loadProfile(str(room.owner_id));
  const user = owner ? await userRow(str(owner.id)) : null;
  const origin = meta.origin;
  if (owner && user && input.status === "changes_requested") {
    const pending = await sql<Rec>`
      select count(*) as n from room_files f join file_reviews rv on rv.file_id = f.id
      where f.room_id = ${str(room.id)} and f.deleted_at is null and rv.status = 'changes_requested'
    `;
    const mail = mailNotes({
      client: name,
      title: str(room.title),
      count: num(pending[0]?.n),
      url: `${origin}/app/pokoj/${str(room.id)}`,
    });
    await notifyOwner({
      ownerId: str(owner.id),
      roomId: str(room.id),
      kind: "changes",
      title: mail.subject,
      body: mail.text,
      emailEnabled: bool(owner.notify_comments),
      digest: bool(owner.notify_digest),
      email: { to: str(user.email), ...mail },
    });
  }
  if (owner && user && state === "approved") {
    await sql`
      insert into room_events (id, room_id, type, actor_name, ip_hash, user_agent_short)
      values (${uid()}, ${str(room.id)}, 'reviewed_all', ${name}, ${meta.ipHash}, ${meta.ua})
    `;
    const mail = mailApproved({ client: name, title: str(room.title), url: `${origin}/app/pokoj/${str(room.id)}` });
    await notifyOwner({
      ownerId: str(owner.id),
      roomId: str(room.id),
      kind: "approved",
      title: mail.subject,
      body: mail.text,
      emailEnabled: bool(owner.notify_accept),
      digest: bool(owner.notify_digest),
      email: { to: str(user.email), ...mail },
    });
  }
  return { status: input.status, state };
}

export async function listFileComments(slug: string, token: string | null, fileId: string): Promise<Comment[]> {
  const room = await requireOpenRoom(slug, token);
  const sql = await db();
  const rows = await sql<Rec>`
    select id, author_type, author_name, body, created_at from file_comments
    where room_id = ${str(room.id)} and file_id = ${fileId}
    order by created_at
  `;
  return rows.map((row) => ({
    id: str(row.id),
    authorType: str(row.author_type) === "creator" ? "creator" : "client",
    authorName: str(row.author_name),
    body: str(row.body),
    createdAt: iso(row.created_at) || "",
  }));
}

export async function addClientComment(input: {
  slug: string;
  token: string | null;
  fileId: string;
  name: string;
  body: string;
}): Promise<Comment> {
  const room = await requireOpenRoom(input.slug, input.token);
  const meta = await clientMeta();
  await guardRate(`comment:${str(room.id)}:${meta.ipHash}`, 30, 600);
  const body = sanitizeText(input.body, 2000);
  const name = sanitizeText(input.name, 80);
  if (!body || !name) throw new UserError(t("room.nameAsk"));
  const sql = await db();
  const file = await sql<Rec>`select id from room_files where id = ${input.fileId} and room_id = ${str(room.id)} and deleted_at is null`;
  if (!file[0]) throw new UserError(t("system.notFound"));
  const id = uid();
  await sql`
    insert into file_comments (id, file_id, room_id, author_type, author_name, body)
    values (${id}, ${input.fileId}, ${str(room.id)}, 'client', ${name}, ${body})
  `;
  await sql`
    insert into room_events (id, room_id, file_id, type, actor_name, ip_hash, user_agent_short)
    values (${uid()}, ${str(room.id)}, ${input.fileId}, 'commented', ${name}, ${meta.ipHash}, ${meta.ua})
  `;
  const owner = await loadProfile(str(room.owner_id));
  const user = owner ? await userRow(str(owner.id)) : null;
  if (owner && user) {
    const mail = mailNotes({
      client: name,
      title: str(room.title),
      count: 1,
      url: `${meta.origin}/app/pokoj/${str(room.id)}`,
    });
    await notifyOwner({
      ownerId: str(owner.id),
      roomId: str(room.id),
      kind: "comment",
      title: t("app.newComment", { Klient: name }),
      body: body,
      emailEnabled: bool(owner.notify_comments),
      digest: bool(owner.notify_digest),
      email: { to: str(user.email), ...mail },
    });
  }
  return { id, authorType: "client", authorName: name, body, createdAt: new Date().toISOString() };
}

export async function getFilePreview(slug: string, token: string | null, fileId: string): Promise<{
  preview: string | null;
  media: string | null;
  mime: string;
  name: string;
  kind: FileKind;
}> {
  const room = await requireOpenRoom(slug, token);
  const sql = await db();
  const rows = await sql<Rec>`
    select original_name, mime, kind, preview_data, thumb_data, file_data
    from room_files where id = ${fileId} and room_id = ${str(room.id)} and deleted_at is null
  `;
  if (!rows[0]) throw new UserError(t("system.notFound"));
  const row = rows[0];
  return {
    preview: row.preview_data ? str(row.preview_data) : row.thumb_data ? str(row.thumb_data) : null,
    media: row.file_data ? str(row.file_data) : null,
    mime: str(row.mime),
    name: str(row.original_name),
    kind: (KINDS.has(str(row.kind) as FileKind) ? str(row.kind) : "file") as FileKind,
  };
}

export async function addTestimonial(input: {
  slug: string;
  token: string | null;
  rating: number;
  body: string;
  authorName: string;
  authorRole: string;
  consent: boolean;
}): Promise<void> {
  const room = await requireOpenRoom(input.slug, input.token);
  const meta = await clientMeta();
  await guardRate(`review-form:${str(room.id)}:${meta.ipHash}`, 5, 3600);
  const rating = Math.round(input.rating);
  if (rating < 1 || rating > 5) throw new UserError(t("review.pick"));
  const body = sanitizeText(input.body, 2000);
  const name = sanitizeText(input.authorName, 80);
  if (!body || !name) throw new UserError(t("app.errGeneric"));
  const sql = await db();
  const existing = await sql<Rec>`select id, status from testimonials where room_id = ${str(room.id)} and status = 'approved' limit 1`;
  if (existing.length) return;
  await sql`
    insert into testimonials (id, room_id, rating, body, author_name, author_role, consent_public, status)
    values (${uid()}, ${str(room.id)}, ${rating}, ${body}, ${name}, ${sanitizeText(input.authorRole, 80) || null}, ${input.consent}, 'pending')
  `;
  const owner = await loadProfile(str(room.owner_id));
  const user = owner ? await userRow(str(owner.id)) : null;
  if (owner && user) {
    const mail = mailOpinion({
      client: name,
      title: str(room.title),
      rating,
      body,
      url: `${meta.origin}/admin`,
    });
    await notifyOwner({
      ownerId: str(owner.id),
      roomId: str(room.id),
      kind: "testimonial",
      title: mail.subject,
      body: mail.text,
      emailEnabled: bool(owner.notify_reviews),
      digest: bool(owner.notify_digest),
      email: { to: str(user.email), ...mail },
    });
  }
}

export async function listPublicTestimonials(): Promise<Testimonial[]> {
  const sql = await db();
  const rows = await sql<Rec>`
    select id, rating, body, author_name, author_role from testimonials
    where status = 'approved' and consent_public = true
    order by rating desc, created_at desc
    limit 12
  `;
  return rows.map((row) => ({
    id: str(row.id),
    rating: num(row.rating),
    body: str(row.body),
    authorName: str(row.author_name),
    authorRole: row.author_role ? str(row.author_role) : null,
  }));
}

export async function requestAccess(email: string, company: string): Promise<void> {
  if (company.trim()) return;
  const meta = await clientMeta();
  await guardRate(`contact:${meta.ipHash}`, 5, 3600);
  const clean = email.trim().toLowerCase();
  if (!emailOk(clean)) throw new UserError(t("app.errGeneric"));
  const sql = await db();
  await sql`insert into contact_requests (id, email) values (${uid()}, ${clean})`;
}

export async function requestPasswordReset(email: string): Promise<void> {
  const meta = await clientMeta();
  await guardRate(`reset:${meta.ipHash}`, 5, 3600);
  const clean = email.trim().toLowerCase();
  if (!emailOk(clean)) return;
  const sql = await db();
  const users = await sql<Rec>`select id from "user" where lower(email) = ${clean}`;
  if (!users[0]) return;
  const token = randomBytes(32).toString("hex");
  await sql`
    insert into password_resets (id, user_id, token_hash, expires_at)
    values (${uid()}, ${str(users[0].id)}, ${sha256(token)}, now() + interval '1 hour')
  `;
  const mail = mailReset({ url: `${meta.origin}/reset?token=${token}` });
  await deliverEmail({ to: clean, ...mail, kind: "reset" });
}

export async function completePasswordReset(token: string, password: string): Promise<void> {
  if (password.length < 10) throw new UserError(t("auth.short"));
  const sql = await db();
  const rows = await sql<Rec>`
    select id, user_id from password_resets
    where token_hash = ${sha256(token)} and used_at is null and expires_at > now()
    limit 1
  `;
  if (!rows[0]) throw new UserError(t("auth.resetExpired"));
  const hash = await hashAuthPassword(password);
  const userId = str(rows[0].user_id);
  await sql`update "account" set password = ${hash}, "updatedAt" = now() where "userId" = ${userId} and "providerId" = 'credential'`;
  await sql`update password_resets set used_at = now() where id = ${str(rows[0].id)}`;
  await sql`update profiles set must_change_password = false where id = ${userId}`;
}

export async function getDownloadTicket(slug: string, token: string | null, fileId: string): Promise<{ url: string }> {
  const room = await requireOpenRoom(slug, token);
  if (!bool(room.allow_download)) throw new UserError(t("room.noOriginal"));
  const sql = await db();
  const rows = await sql<Rec>`select id, file_data from room_files where id = ${fileId} and room_id = ${str(room.id)} and deleted_at is null`;
  if (!rows[0]?.file_data) throw new UserError(t("room.noOriginal"));
  const secret = await hmacSecret();
  const ticket = signToken(secret, { typ: "file", slug: str(room.slug), fileId }, 60);
  return { url: `/api/file/${fileId}?t=${encodeURIComponent(ticket)}` };
}

export async function getZipTicket(slug: string, token: string | null): Promise<{ parts: number; urls: string[]; empty: boolean }> {
  const room = await requireOpenRoom(slug, token);
  if (!bool(room.allow_zip)) throw new UserError(t("room.noOriginal"));
  const sql = await db();
  const files = await sql<Rec>`
    select file_data from room_files
    where room_id = ${str(room.id)} and deleted_at is null and file_data is not null
    order by position
  `;
  const sizes = files.map((row) => Math.floor(str(row.file_data).length * 0.75));
  if (!sizes.length) return { parts: 0, urls: [], empty: true };
  const parts = planZipParts(sizes);
  const secret = await hmacSecret();
  const ticket = signToken(secret, { typ: "zip", slug: str(room.slug) }, 600);
  return {
    parts: parts.length,
    empty: false,
    urls: parts.map((_, index) => `/api/zip/${str(room.slug)}?t=${encodeURIComponent(ticket)}&part=${index + 1}`),
  };
}

function dataUrlBytes(value: string | null): { mime: string; bytes: Uint8Array } | null {
  if (!value) return null;
  const idx = value.indexOf(";base64,");
  if (!value.startsWith("data:") || idx < 0) return null;
  return { mime: value.slice(5, idx), bytes: new Uint8Array(Buffer.from(value.slice(idx + 8), "base64")) };
}

function attachmentName(name: string): string {
  const ascii = name.replace(/[^\w.\- ]+/g, "_") || "plik";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function downloadFile(request: Request, fileId: string): Promise<Response> {
  const url = new URL(request.url);
  const ticket = url.searchParams.get("t");
  const secret = await hmacSecret();
  const data = readToken<{ typ?: string; slug?: string; fileId?: string }>(secret, ticket);
  if (!data || data.typ !== "file" || data.fileId !== fileId) return new Response("forbidden", { status: 403 });
  const room = await roomBySlug(str(data.slug));
  if (!room || str(room.status) !== "active" || expired(room) || !bool(room.allow_download)) {
    return new Response("forbidden", { status: 403 });
  }
  const sql = await db();
  const rows = await sql<Rec>`
    select original_name, mime, file_data from room_files
    where id = ${fileId} and room_id = ${str(room.id)} and deleted_at is null
  `;
  const parsed = dataUrlBytes(rows[0]?.file_data ? str(rows[0].file_data) : null);
  if (!parsed) return new Response("missing", { status: 404 });
  const meta = await clientMeta();
  await sql`
    insert into room_events (id, room_id, file_id, type, ip_hash, user_agent_short)
    values (${uid()}, ${str(room.id)}, ${fileId}, 'downloaded_file', ${meta.ipHash}, ${meta.ua})
  `;
  return new Response(Buffer.from(parsed.bytes), {
    headers: {
      "Content-Type": parsed.mime || str(rows[0]?.mime) || "application/octet-stream",
      "Content-Disposition": attachmentName(str(rows[0]?.original_name)),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export async function downloadZip(request: Request, slug: string): Promise<Response> {
  const url = new URL(request.url);
  const secret = await hmacSecret();
  const data = readToken<{ typ?: string; slug?: string }>(secret, url.searchParams.get("t"));
  if (!data || data.typ !== "zip" || data.slug !== slug) return new Response("forbidden", { status: 403 });
  const room = await roomBySlug(slug);
  if (!room || str(room.status) !== "active" || expired(room) || !bool(room.allow_zip)) {
    return new Response("forbidden", { status: 403 });
  }
  const part = Math.max(1, Number(url.searchParams.get("part") || "1"));
  const sql = await db();
  const rows = await sql<Rec>`
    select original_name, file_data from room_files
    where room_id = ${str(room.id)} and deleted_at is null and file_data is not null
    order by position, created_at
  `;
  const decoded = rows
    .map((row) => ({ name: str(row.original_name), parsed: dataUrlBytes(str(row.file_data)) }))
    .filter((row) => row.parsed);
  const parts = planZipParts(decoded.map((row) => row.parsed!.bytes.byteLength));
  const chosen = parts[part - 1] || [];
  const used = new Set<string>();
  const archive: Record<string, Uint8Array> = {};
  for (const index of chosen) {
    const item = decoded[index];
    if (!item?.parsed) continue;
    archive[uniqueFileName(item.name, used)] = item.parsed.bytes;
  }
  const zipped = zipSync(archive);
  const meta = await clientMeta();
  await sql`
    insert into room_events (id, room_id, type, actor_name, ip_hash, user_agent_short)
    values (${uid()}, ${str(room.id)}, 'downloaded_zip', ${String(part)}, ${meta.ipHash}, ${meta.ua})
  `;
  const day = new Date().toISOString().slice(0, 10);
  const base = safeFileName(str(room.title) || "dostawa");
  const filename = parts.length > 1 ? `${base}-${day}-czesc-${part}.zip` : `${base}-${day}.zip`;
  return new Response(Buffer.from(zipped), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": attachmentName(filename),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function requireAdmin(userId: string): Promise<Rec> {
  const profile = await requireActiveProfile(userId);
  if (str(profile.role) !== "admin") throw new UserError(t("auth.noAccess"));
  return profile;
}

export async function adminStats(userId: string) {
  await requireAdmin(userId);
  const sql = await db();
  const users = await sql<Rec>`select count(*) as n from profiles`;
  const rooms = await sql<Rec>`select count(*) as n from rooms`;
  const storage = await sql<Rec>`select coalesce(sum(storage_used_bytes), 0) as n from profiles`;
  const pending = await sql<Rec>`select count(*) as n from testimonials where status = 'pending'`;
  return {
    users: num(users[0]?.n),
    rooms: num(rooms[0]?.n),
    storage: num(storage[0]?.n),
    pendingReviews: num(pending[0]?.n),
  };
}

export async function adminUsers(userId: string) {
  await requireAdmin(userId);
  const sql = await db();
  const rows = await sql<Rec>`
    select p.*, u.email,
      (select count(*) from rooms r where r.owner_id = p.id) as rooms
    from profiles p join "user" u on u.id = p.id
    order by p.created_at desc
  `;
  return rows.map((row) => ({
    id: str(row.id),
    email: str(row.email),
    displayName: str(row.display_name),
    role: str(row.role),
    storageUsedBytes: num(row.storage_used_bytes),
    storageLimitBytes: num(row.storage_limit_bytes),
    rooms: num(row.rooms),
    isActive: bool(row.is_active),
    lastSeenAt: iso(row.last_seen_at),
  }));
}

function tempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(12);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("") + "a7";
}

export async function adminCreateUser(userId: string, input: { name: string; email: string; limitGb: number; sendMail: boolean }) {
  await requireAdmin(userId);
  const email = input.email.trim().toLowerCase();
  const name = sanitizeText(input.name, 80);
  if (!emailOk(email) || !name) throw new UserError(t("app.errGeneric"));
  const sql = await db();
  const existing = await sql<Rec>`select id from "user" where lower(email) = ${email}`;
  if (existing.length) throw new UserError(t("admin.exists"));
  const password = tempPassword();
  const id = uid();
  const now = new Date().toISOString();
  const hash = await hashAuthPassword(password);
  const limit = Math.max(1, Math.min(100, Math.round(input.limitGb || 5))) * 1024 * 1024 * 1024;
  await sql`
    insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
    values (${id}, ${name}, ${email}, true, ${now}, ${now})
  `;
  await sql`
    insert into "account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")
    values (${uid()}, ${id}, 'credential', ${id}, ${hash}, ${now}, ${now})
  `;
  await sql`
    insert into profiles (id, role, display_name, storage_limit_bytes, must_change_password)
    values (${id}, 'creator', ${name}, ${limit}, true)
  `;
  if (input.sendMail) {
    const meta = await clientMeta();
    const mail = mailAccount({ name, password, url: `${meta.origin}/login` });
    await deliverEmail({ to: email, ...mail, kind: "account" });
  }
  return { email, password };
}

export async function adminResetPassword(userId: string, targetId: string): Promise<{ password: string }> {
  await requireAdmin(userId);
  const password = tempPassword();
  const hash = await hashAuthPassword(password);
  const sql = await db();
  const updated = await sql<Rec>`
    update "account" set password = ${hash}, "updatedAt" = now()
    where "userId" = ${targetId} and "providerId" = 'credential'
    returning "id"
  `;
  if (!updated.length) throw new UserError(t("app.errGeneric"));
  await sql`update profiles set must_change_password = true where id = ${targetId}`;
  return { password };
}

export async function adminSetActive(userId: string, targetId: string, active: boolean): Promise<void> {
  await requireAdmin(userId);
  if (targetId === userId) throw new UserError(t("app.errGeneric"));
  const sql = await db();
  await sql`update profiles set is_active = ${active} where id = ${targetId} and role <> 'admin'`;
}

export async function adminDeleteUser(userId: string, targetId: string): Promise<void> {
  await requireAdmin(userId);
  if (targetId === userId) throw new UserError(t("app.errGeneric"));
  const sql = await db();
  await sql`delete from "user" where id = ${targetId}`;
}

export async function adminSetLimit(userId: string, targetId: string, limitGb: number): Promise<void> {
  await requireAdmin(userId);
  const sql = await db();
  const limit = Math.max(1, Math.min(100, Math.round(limitGb))) * 1024 * 1024 * 1024;
  await sql`update profiles set storage_limit_bytes = ${limit} where id = ${targetId}`;
}

export async function adminRooms(userId: string) {
  await requireAdmin(userId);
  const sql = await db();
  const rows = await sql<Rec>`
    select r.id, r.slug, r.title, r.client_name, r.status, r.review_state, r.expires_at, r.created_at, p.display_name
    from rooms r join profiles p on p.id = r.owner_id
    order by r.created_at desc limit 200
  `;
  return rows.map((row) => ({
    id: str(row.id),
    slug: str(row.slug),
    title: str(row.title),
    clientName: str(row.client_name),
    status: str(row.status),
    reviewState: str(row.review_state),
    expiresAt: iso(row.expires_at),
    createdAt: iso(row.created_at) || "",
    ownerName: str(row.display_name),
  }));
}

export async function adminTestimonials(userId: string) {
  await requireAdmin(userId);
  const sql = await db();
  const rows = await sql<Rec>`
    select t.*, r.title from testimonials t join rooms r on r.id = t.room_id
    order by t.created_at desc limit 100
  `;
  return rows.map((row) => ({
    id: str(row.id),
    roomTitle: str(row.title),
    rating: num(row.rating),
    body: str(row.body),
    authorName: str(row.author_name),
    authorRole: row.author_role ? str(row.author_role) : null,
    consent: bool(row.consent_public),
    status: str(row.status),
    createdAt: iso(row.created_at) || "",
  }));
}

export async function adminModerate(userId: string, id: string, status: "approved" | "rejected" | "hidden"): Promise<void> {
  await requireAdmin(userId);
  const sql = await db();
  await sql`update testimonials set status = ${status}, moderated_at = now() where id = ${id}`;
}

export async function adminOutbox(userId: string) {
  await requireAdmin(userId);
  const sql = await db();
  const rows = await sql<Rec>`select id, to_email, subject, created_at from outbox_emails order by created_at desc limit 40`;
  return rows.map((row) => ({
    id: str(row.id),
    to: str(row.to_email),
    subject: str(row.subject),
    createdAt: iso(row.created_at) || "",
  }));
}

export async function adminContacts(userId: string) {
  await requireAdmin(userId);
  const sql = await db();
  const rows = await sql<Rec>`select id, email, created_at from contact_requests order by created_at desc limit 40`;
  return rows.map((row) => ({ id: str(row.id), email: str(row.email), createdAt: iso(row.created_at) || "" }));
}

export async function runMaintenance(): Promise<{ removedRooms: number; digested: number }> {
  const sql = await db();
  const doomed = await sql<Rec>`
    delete from rooms
    where expires_at is not null and expires_at < now() - interval '14 days'
    returning id
  `;
  await sql`
    update room_files set thumb_data = null, preview_data = null, file_data = null
    where deleted_at is not null and deleted_at < now() - interval '14 days'
  `;
  await sql`delete from room_events where created_at < now() - interval '180 days'`;
  await sql`delete from contact_requests where created_at < now() - interval '180 days'`;
  await sql`delete from outbox_emails where created_at < now() - interval '90 days'`;
  const owners = await sql<Rec>`select id from profiles`;
  for (const owner of owners) await recalcStorage(str(owner.id));

  const soon = await sql<Rec>`
    select r.*, u.email as owner_email, p.display_name
    from rooms r
    join profiles p on p.id = r.owner_id
    join "user" u on u.id = p.id
    where r.status = 'active' and r.expiry_reminded = false
      and r.expires_at is not null
      and r.expires_at < now() + interval '3 days'
      and r.expires_at > now()
  `;
  const meta = await clientMeta();
  for (const room of soon) {
    const mail = mailExpiry({
      title: str(room.title),
      when: new Date(str(room.expires_at)).toLocaleDateString("pl-PL"),
      url: `${meta.origin}/app/pokoj/${str(room.id)}`,
    });
    await deliverEmail({ to: str(room.owner_email), ...mail, roomId: str(room.id), kind: "expiry" });
    if (room.client_email) {
      await deliverEmail({
        to: str(room.client_email),
        ...mailExpiry({
          title: str(room.title),
          when: new Date(str(room.expires_at)).toLocaleDateString("pl-PL"),
          url: `${meta.origin}/d/${str(room.slug)}`,
        }),
        roomId: str(room.id),
        kind: "expiry-client",
      });
    }
    await sql`update rooms set expiry_reminded = true where id = ${str(room.id)}`;
  }

  const notes = await sql<Rec>`
    select n.user_id, n.title, u.email
    from notifications n
    join profiles p on p.id = n.user_id
    join "user" u on u.id = p.id
    where p.notify_digest = true and n.digest_sent = false
      and n.created_at > now() - interval '2 days'
  `;
  const grouped = new Map<string, { email: string; lines: string[] }>();
  for (const note of notes) {
    const id = str(note.user_id);
    const bucket = grouped.get(id) ?? { email: str(note.email), lines: [] };
    bucket.lines.push(str(note.title));
    grouped.set(id, bucket);
  }
  for (const [id, bucket] of grouped) {
    const mail = mailDigest({ lines: bucket.lines.slice(0, 20), url: `${meta.origin}/app` });
    await deliverEmail({ to: bucket.email, ...mail, kind: "digest" });
    await sql`update notifications set digest_sent = true where user_id = ${id} and digest_sent = false`;
  }
  return { removedRooms: doomed.length, digested: grouped.size };
}

export { deriveReviewState };
