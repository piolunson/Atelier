import type { FileKind, ReviewState, ReviewStatus } from "@/lib/types";

const SLUG_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export function makeSlug(len = 12): string {
  const size = Math.max(10, len);
  const bytes = new Uint8Array(size);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < size; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = "";
  for (let i = 0; i < size; i += 1) out += SLUG_ALPHABET[bytes[i]! % SLUG_ALPHABET.length];
  return out;
}

export function deriveReviewState(statuses: ReviewStatus[]): ReviewState {
  if (statuses.length === 0) return "pending";
  if (statuses.some((s) => s === "changes_requested")) return "changes";
  if (statuses.every((s) => s === "approved")) return "approved";
  return "pending";
}

export function sanitizeText(input: string, max: number): string {
  return input
    .replace(/[<>]/g, "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, max);
}

export function safeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "plik";
  const cleaned = base.replace(/[^\w.\- ()\u00C0-\u024F]+/g, "_").replace(/^\.+/, "").slice(0, 160);
  return cleaned || "plik";
}

export function uniqueFileName(name: string, used: Set<string>): string {
  const clean = safeFileName(name);
  if (!used.has(clean)) {
    used.add(clean);
    return clean;
  }
  const dot = clean.lastIndexOf(".");
  const base = dot > 0 ? clean.slice(0, dot) : clean;
  const ext = dot > 0 ? clean.slice(dot) : "";
  let i = 2;
  let next = `${base}-${i}${ext}`;
  while (used.has(next)) {
    i += 1;
    next = `${base}-${i}${ext}`;
  }
  used.add(next);
  return next;
}

export function kindOf(file: { name: string; type: string }): FileKind {
  const n = file.name.toLowerCase();
  if (/\.(cr2|cr3|nef|arw|dng|raf|rw2|orf|heic)$/.test(n)) return "file";
  if (file.type === "image/heic" || file.type === "image/heif") return "file";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/") || /\.(mp4|mov|webm|m4v)$/.test(n)) return "video";
  if (file.type.startsWith("audio/") || /\.(mp3|wav|aac|m4a|flac|ogg)$/.test(n)) return "audio";
  if (file.type === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  return "file";
}

export function safeHex(input: string, fallback = "#E07A3D"): string {
  return /^#[0-9a-fA-F]{6}$/.test(input) ? input : fallback;
}

export function safeFont(input: string): "cormorant" | "playfair" | "inter" {
  if (input === "playfair" || input === "inter" || input === "cormorant") return input;
  return "cormorant";
}

export function safeTheme(input: string): "dark" | "light" {
  return input === "light" ? "light" : "dark";
}

export function safeLayout(input: string): "grid" | "masonry" {
  return input === "masonry" ? "masonry" : "grid";
}

export function safeBgType(input: string): "image" | "preset" | "color" {
  if (input === "image" || input === "color" || input === "preset") return input;
  return "preset";
}

export const PRESET_IDS = ["ember", "dusk", "ocean", "forest", "noir", "blush", "gold", "ink"] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export function safePreset(input: string): PresetId {
  return (PRESET_IDS as readonly string[]).includes(input) ? (input as PresetId) : "ember";
}

export function assertDataUrl(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  if (value.length > max) throw new Error("TOO_BIG");
  const semi = value.indexOf(";");
  if (!value.startsWith("data:") || semi < 6 || !value.slice(semi).startsWith(";base64,")) {
    throw new Error("BAD_FILE");
  }
  const mime = value.slice(5, semi);
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(mime)) throw new Error("BAD_FILE");
  return value;
}

/** Split files into zip parts so a single response stays within a time/size budget. */
export function planZipParts(sizes: number[], maxBytes = 8_000_000): number[][] {
  const parts: number[][] = [];
  let current: number[] = [];
  let size = 0;
  sizes.forEach((bytes, index) => {
    const safe = Math.max(0, bytes);
    if (current.length > 0 && size + safe > maxBytes) {
      parts.push(current);
      current = [];
      size = 0;
    }
    current.push(index);
    size += safe;
  });
  if (current.length) parts.push(current);
  return parts.length ? parts : [];
}

export function canManageRoom(role: string, ownerId: string, userId: string): boolean {
  return role === "admin" || ownerId === userId;
}

export const MAX_FILE_BYTES = 5 * 1024 * 1024 * 1024;
export const MAX_STORED_DATA = 3_200_000;
export const MAX_PREVIEW_DATA = 1_600_000;
export const MAX_THUMB_DATA = 500_000;
export const MAX_FILES = 400;
