import { kindOf } from "@/lib/room-logic";
import type { FileKind } from "@/lib/types";

export type PreparedFile = {
  name: string;
  mime: string;
  sizeBytes: number;
  kind: FileKind;
  width: number | null;
  height: number | null;
  duration: number | null;
  thumb: string | null;
  preview: string | null;
  fileData: string | null;
  storedOriginal: boolean;
};

const STORE_LIMIT = 2_600_000;

function blobToData(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function decodeSize(file: File, max: number, typeName: string, quality: number): Promise<{ url: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / bitmap.width);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, typeName, quality));
  if (!blob) throw new Error("blob");
  return { url: await blobToData(blob), width, height };
}

async function videoPoster(file: File): Promise<{ thumb: string | null; duration: number | null }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    const finish = (thumb: string | null, duration: number | null) => {
      URL.revokeObjectURL(url);
      resolve({ thumb, duration });
    };
    video.onerror = () => finish(null, null);
    video.onloadeddata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : null;
      const w = video.videoWidth || 320;
      const h = video.videoHeight || 180;
      const scale = Math.min(1, 480 / w);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      const ctx = canvas.getContext("2d");
      try {
        ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(async (blob) => {
          finish(blob ? await blobToData(blob) : null, duration);
        }, "image/jpeg", 0.72);
      } catch {
        finish(null, duration);
      }
    };
  });
}

export async function prepareFile(file: File): Promise<PreparedFile> {
  const kind = kindOf({ name: file.name, type: file.type });
  const base = {
    name: file.name,
    mime: file.type || "application/octet-stream",
    sizeBytes: file.size,
    kind,
    width: null as number | null,
    height: null as number | null,
    duration: null as number | null,
    thumb: null as string | null,
    preview: null as string | null,
    fileData: null as string | null,
    storedOriginal: false,
  };
  if (kind === "image") {
    try {
      const thumb = await decodeSize(file, 480, "image/webp", 0.72);
      const preview = await decodeSize(file, 1600, "image/jpeg", 0.82);
      return {
        ...base,
        mime: "image/jpeg",
        width: preview.width,
        height: preview.height,
        thumb: thumb.url,
        preview: preview.url,
        fileData: preview.url.length < STORE_LIMIT ? preview.url : null,
        storedOriginal: preview.url.length < STORE_LIMIT,
      };
    } catch {
      /* fall through and store the original if it is small */
    }
  }
  if (kind === "video") {
    const poster = await videoPoster(file);
    let fileData: string | null = null;
    if (file.size < 2_400_000) {
      const data = await blobToData(file);
      if (data.length < STORE_LIMIT) fileData = data;
    }
    return {
      ...base,
      thumb: poster.thumb,
      preview: poster.thumb,
      duration: poster.duration,
      fileData,
      storedOriginal: Boolean(fileData),
    };
  }
  if (file.size < 2_400_000) {
    const data = await blobToData(file);
    if (data.length < STORE_LIMIT) {
      return { ...base, fileData: data, storedOriginal: true, thumb: null, preview: null };
    }
  }
  return base;
}
