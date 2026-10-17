/** Everything SAM 3 related lives here so the copy and links stay in one place. */

export const SAM3 = {
  name: "SAM 3",
  vendor: "Meta",
  size: "3.4 GB",
  // Portable form of the same location, so the public build never embeds a
  // personal Windows profile path.
  folder: "%APPDATA%\\LightCraft\\models\\sam3",
  modelPage: "https://huggingface.co/facebook/sam3",
  filesPage: "https://huggingface.co/facebook/sam3/tree/main",
  licensePage: "https://huggingface.co/facebook/sam3/blob/main/LICENSE",
  files: [
    { name: "model.safetensors", note: "weights · about 3.4 GB" },
    { name: "vocab.json", note: "tokenizer vocabulary" },
    { name: "merges.txt", note: "tokenizer merges" },
  ],
} as const;

export const INSTALL_STEPS = `SAM 3 — Object & Describe masks
1. Download model.safetensors, vocab.json and merges.txt from ${SAM3.modelPage}
2. Move the three files into: ${SAM3.folder}
3. Restart Lightcraft. Object and Describe work as soon as the files are there.

Licence: SAM License (Meta) — Meta's terms, not LightCraft's.
${SAM3.licensePage}`;

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const field = document.createElement("textarea");
      field.value = text;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(field);
      return ok;
    } catch {
      return false;
    }
  }
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function safeBaseName(name: string): string {
  return (
    name
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[^\w\s-]+/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase() || "mask"
  );
}
