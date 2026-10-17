function readName(): string {
  try {
    const value = import.meta.env?.VITE_APP_NAME;
    if (typeof value === "string" && value.trim()) return value.trim();
  } catch {
    /* node tests */
  }
  return "Atelier";
}

/** Single source for {APP_NAME}. Override with VITE_APP_NAME. */
export const APP_NAME = readName();
