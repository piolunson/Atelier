import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { Brand, ReviewStatus } from "@/lib/types";

async function impl() {
  return import("@/lib/server/impl");
}

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") throw new Error("BAD_INPUT");
  return input as Record<string, unknown>;
}

export const bootstrapOpen = createServerFn({ method: "GET" }).handler(async () => (await impl()).bootstrapOpen());

export const listPublicTestimonials = createServerFn({ method: "GET" }).handler(async () => (await impl()).listPublicTestimonials());

export const requestAccess = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const row = asRecord(input);
    return { email: String(row.email ?? ""), company: String(row.company ?? "") };
  })
  .handler(async ({ data }) => (await impl()).requestAccess(data.email, data.company));

export const requestPasswordReset = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ email: String(asRecord(input).email ?? "") }))
  .handler(async ({ data }) => (await impl()).requestPasswordReset(data.email));

export const completePasswordReset = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const row = asRecord(input);
    return { token: String(row.token ?? ""), password: String(row.password ?? "") };
  })
  .handler(async ({ data }) => (await impl()).completePasswordReset(data.token, data.password));

export const getPublicRoom = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const row = asRecord(input);
    return { slug: String(row.slug ?? ""), token: row.token ? String(row.token) : null };
  })
  .handler(async ({ data }) => (await impl()).getPublicRoom(data.slug, data.token));

export const getPublicStatus = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const row = asRecord(input);
    return { slug: String(row.slug ?? ""), token: row.token ? String(row.token) : null };
  })
  .handler(async ({ data }) => (await impl()).getPublicStatus(data.slug, data.token));

export const unlockRoom = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const row = asRecord(input);
    return { slug: String(row.slug ?? ""), password: String(row.password ?? "") };
  })
  .handler(async ({ data }) => (await impl()).unlockRoom(data.slug, data.password));

export const recordOpen = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const row = asRecord(input);
    return { slug: String(row.slug ?? ""), token: row.token ? String(row.token) : null, name: String(row.name ?? "") };
  })
  .handler(async ({ data }) => (await impl()).recordOpen(data.slug, data.token, data.name));

export const setFileReview = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const row = asRecord(input);
    return {
      slug: String(row.slug ?? ""),
      token: row.token ? String(row.token) : null,
      fileId: String(row.fileId ?? ""),
      status: String(row.status ?? "pending") as ReviewStatus,
      name: String(row.name ?? ""),
    };
  })
  .handler(async ({ data }) => (await impl()).setFileReview(data));

export const listFileComments = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const row = asRecord(input);
    return { slug: String(row.slug ?? ""), token: row.token ? String(row.token) : null, fileId: String(row.fileId ?? "") };
  })
  .handler(async ({ data }) => (await impl()).listFileComments(data.slug, data.token, data.fileId));

export const addClientComment = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const row = asRecord(input);
    return {
      slug: String(row.slug ?? ""),
      token: row.token ? String(row.token) : null,
      fileId: String(row.fileId ?? ""),
      name: String(row.name ?? ""),
      body: String(row.body ?? ""),
    };
  })
  .handler(async ({ data }) => (await impl()).addClientComment(data));

export const getFilePreview = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const row = asRecord(input);
    return { slug: String(row.slug ?? ""), token: row.token ? String(row.token) : null, fileId: String(row.fileId ?? "") };
  })
  .handler(async ({ data }) => (await impl()).getFilePreview(data.slug, data.token, data.fileId));

export const addTestimonial = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const row = asRecord(input);
    return {
      slug: String(row.slug ?? ""),
      token: row.token ? String(row.token) : null,
      rating: Number(row.rating ?? 0),
      body: String(row.body ?? ""),
      authorName: String(row.authorName ?? ""),
      authorRole: String(row.authorRole ?? ""),
      consent: Boolean(row.consent),
    };
  })
  .handler(async ({ data }) => (await impl()).addTestimonial(data));

export const getDownloadTicket = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const row = asRecord(input);
    return { slug: String(row.slug ?? ""), token: row.token ? String(row.token) : null, fileId: String(row.fileId ?? "") };
  })
  .handler(async ({ data }) => (await impl()).getDownloadTicket(data.slug, data.token, data.fileId));

export const getZipTicket = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const row = asRecord(input);
    return { slug: String(row.slug ?? ""), token: row.token ? String(row.token) : null };
  })
  .handler(async ({ data }) => (await impl()).getZipTicket(data.slug, data.token));

export const ensureSelf = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => (await impl()).ensureSelf(context.userId));

export const listRooms = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => (await impl()).listRooms(context.userId));

export const createDraft = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => (await impl()).createDraft(context.userId));

export const getDraft = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ roomId: String(asRecord(input).roomId ?? "") }))
  .handler(async ({ context, data }) => (await impl()).getDraft(context.userId, data.roomId));

export const saveDraft = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => input as Parameters<Awaited<ReturnType<typeof impl>>["saveDraft"]>[1])
  .handler(async ({ context, data }) => (await impl()).saveDraft(context.userId, data));

export const publishRoom = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ roomId: String(asRecord(input).roomId ?? "") }))
  .handler(async ({ context, data }) => (await impl()).publishRoom(context.userId, data.roomId));

export const addFile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => input as Parameters<Awaited<ReturnType<typeof impl>>["addFile"]>[1])
  .handler(async ({ context, data }) => (await impl()).addFile(context.userId, data));

export const removeFile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = asRecord(input);
    return { roomId: String(row.roomId ?? ""), fileId: String(row.fileId ?? "") };
  })
  .handler(async ({ context, data }) => (await impl()).removeFile(context.userId, data.roomId, data.fileId));

export const reorderFiles = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = asRecord(input);
    return { roomId: String(row.roomId ?? ""), ids: Array.isArray(row.ids) ? row.ids.map(String) : [] };
  })
  .handler(async ({ context, data }) => (await impl()).reorderFiles(context.userId, data.roomId, data.ids));

export const setCover = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = asRecord(input);
    return { roomId: String(row.roomId ?? ""), fileId: String(row.fileId ?? "") };
  })
  .handler(async ({ context, data }) => (await impl()).setCover(context.userId, data.roomId, data.fileId));

export const getManaged = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ roomId: String(asRecord(input).roomId ?? "") }))
  .handler(async ({ context, data }) => (await impl()).getManaged(context.userId, data.roomId));

export const replyComment = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = asRecord(input);
    return { roomId: String(row.roomId ?? ""), fileId: String(row.fileId ?? ""), body: String(row.body ?? "") };
  })
  .handler(async ({ context, data }) => (await impl()).replyComment(context.userId, data.roomId, data.fileId, data.body));

export const setRoomActive = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = asRecord(input);
    return { roomId: String(row.roomId ?? ""), active: Boolean(row.active) };
  })
  .handler(async ({ context, data }) => (await impl()).setRoomActive(context.userId, data.roomId, data.active));

export const setExpiry = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = asRecord(input);
    return { roomId: String(row.roomId ?? ""), isoDate: row.isoDate ? String(row.isoDate) : null };
  })
  .handler(async ({ context, data }) => (await impl()).setExpiry(context.userId, data.roomId, data.isoDate));

export const duplicateRoom = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ roomId: String(asRecord(input).roomId ?? "") }))
  .handler(async ({ context, data }) => (await impl()).duplicateRoom(context.userId, data.roomId));

export const deleteRoom = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ roomId: String(asRecord(input).roomId ?? "") }))
  .handler(async ({ context, data }) => (await impl()).deleteRoom(context.userId, data.roomId));

export const getBrand = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => (await impl()).getBrand(context.userId));

export const saveBrand = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = asRecord(input);
    return { brand: row.brand as Brand, name: String(row.name ?? "Domyślny") };
  })
  .handler(async ({ context, data }) => (await impl()).saveBrand(context.userId, data.brand, data.name));

export const saveSettings = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => input as Parameters<Awaited<ReturnType<typeof impl>>["saveSettings"]>[1])
  .handler(async ({ context, data }) => (await impl()).saveSettings(context.userId, data));

export const clearMustChange = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => (await impl()).clearMustChange(context.userId));

export const listNotifications = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => (await impl()).listNotifications(context.userId));

export const markNotificationsRead = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => (await impl()).markNotificationsRead(context.userId));

export const sendClientEmail = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ roomId: String(asRecord(input).roomId ?? "") }))
  .handler(async ({ context, data }) => (await impl()).sendClientEmail(context.userId, data.roomId));

export const adminStats = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => (await impl()).adminStats(context.userId));

export const adminUsers = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => (await impl()).adminUsers(context.userId));

export const adminCreateUser = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = asRecord(input);
    return {
      name: String(row.name ?? ""),
      email: String(row.email ?? ""),
      limitGb: Number(row.limitGb ?? 5),
      sendMail: Boolean(row.sendMail),
    };
  })
  .handler(async ({ context, data }) => (await impl()).adminCreateUser(context.userId, data));

export const adminResetPassword = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ targetId: String(asRecord(input).targetId ?? "") }))
  .handler(async ({ context, data }) => (await impl()).adminResetPassword(context.userId, data.targetId));

export const adminSetActive = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = asRecord(input);
    return { targetId: String(row.targetId ?? ""), active: Boolean(row.active) };
  })
  .handler(async ({ context, data }) => (await impl()).adminSetActive(context.userId, data.targetId, data.active));

export const adminDeleteUser = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ targetId: String(asRecord(input).targetId ?? "") }))
  .handler(async ({ context, data }) => (await impl()).adminDeleteUser(context.userId, data.targetId));

export const adminSetLimit = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = asRecord(input);
    return { targetId: String(row.targetId ?? ""), limitGb: Number(row.limitGb ?? 5) };
  })
  .handler(async ({ context, data }) => (await impl()).adminSetLimit(context.userId, data.targetId, data.limitGb));

export const adminRooms = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => (await impl()).adminRooms(context.userId));

export const adminTestimonials = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => (await impl()).adminTestimonials(context.userId));

export const adminModerate = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = asRecord(input);
    return { id: String(row.id ?? ""), status: String(row.status ?? "hidden") as "approved" | "rejected" | "hidden" };
  })
  .handler(async ({ context, data }) => (await impl()).adminModerate(context.userId, data.id, data.status));

export const adminOutbox = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => (await impl()).adminOutbox(context.userId));

export const adminContacts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => (await impl()).adminContacts(context.userId));

export const runMaintenance = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const mod = await impl();
    await mod.adminStats(context.userId);
    return mod.runMaintenance();
  });
