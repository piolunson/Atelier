import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ImagePlus, Trash2, Upload } from "lucide-react";
import QRCode from "qrcode";
import { toast } from "sonner";
import {
  addFile,
  getDraft,
  publishRoom,
  removeFile,
  reorderFiles,
  saveBrand,
  saveDraft,
  sendClientEmail,
  setCover,
} from "@/lib/api";
import { t } from "@/lib/i18n";
import { roomLink } from "@/lib/format";
import { prepareFile } from "@/lib/prepare-file";
import { PRESET_IDS, safeFont, safeHex, safeLayout, safeTheme } from "@/lib/room-logic";
import type { Brand, DraftRoom } from "@/lib/types";
import { cn } from "@/lib/cn";
import { PRESET_STYLE, RoomPreview } from "@/components/room-bits";

const steps = ["wizard.files", "wizard.details", "wizard.look", "wizard.done"] as const;

async function idb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("atelier-queue", 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains("files")) req.result.createObjectStore("files", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function queuePut(roomId: string, file: File) {
  const db = await idb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").put({ key: `${roomId}:${file.name}:${file.size}:${file.lastModified}`, roomId, file });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function queueList(roomId: string): Promise<File[]> {
  const db = await idb();
  const rows = await new Promise<{ file: File }[]>((resolve, reject) => {
    const tx = db.transaction("files", "readonly");
    const req = tx.objectStore("files").getAll();
    req.onsuccess = () => resolve(req.result as { file: File; roomId: string }[]);
    req.onerror = () => reject(req.error);
  });
  return rows.filter((row) => (row as { roomId?: string }).roomId === roomId).map((row) => row.file);
}

async function queueDrop(roomId: string, file: File) {
  const db = await idb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").delete(`${roomId}:${file.name}:${file.size}:${file.lastModified}`);
    tx.oncomplete = () => resolve();
  });
}

async function filesFromList(list: FileList | File[]): Promise<File[]> {
  return [...list];
}

async function filesFromDrop(data: DataTransfer): Promise<File[]> {
  const items = [...data.items];
  const entries = items.map((item) => item.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
  if (!entries.length) return [...data.files];
  const out: File[] = [];
  const walk = async (entry: FileSystemEntry) => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      out.push(file);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      for (const child of batch) await walk(child);
    }
  };
  for (const entry of entries) await walk(entry);
  return out;
}

export function Wizard({ draftId }: { draftId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const draft = useQuery({ queryKey: ["draft", draftId], queryFn: () => getDraft({ data: { roomId: draftId } }), enabled: Boolean(draftId) });
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<DraftRoom | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [uploading, setUploading] = useState(false);
  const [qr, setQr] = useState("");
  const [frame, setFrame] = useState<"desktop" | "phone">("desktop");
  const busy = useRef(false);

  useEffect(() => {
    if (draft.data) setForm(draft.data);
  }, [draft.data]);

  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      if (!uploading) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [uploading]);

  useEffect(() => {
    if (!form || step !== 3) return;
    void QRCode.toDataURL(roomLink(form.slug), { margin: 1, width: 280 }).then(setQr);
  }, [form, step]);

  async function persist(next: DraftRoom) {
    setForm(next);
    await saveDraft({
      data: {
        roomId: next.id,
        title: next.title,
        clientName: next.clientName,
        clientEmail: next.clientEmail,
        message: next.message,
        coCreators: next.coCreators.map((person) => person.name),
        validityDays: next.validityDays,
        allowZip: next.allowZip,
        allowDownload: next.allowDownload,
        hidePoweredBy: next.hidePoweredBy,
        brand: next.brand,
      },
    });
  }

  async function uploadOne(file: File) {
    const key = `${file.name}:${file.size}`;
    setProgress((prev) => ({ ...prev, [key]: 15 }));
    try {
      await queuePut(draftId, file);
      const prepared = await prepareFile(file);
      setProgress((prev) => ({ ...prev, [key]: 70 }));
      if (file.size > 5 * 1024 * 1024 * 1024) throw new Error("limit");
      await addFile({ data: { roomId: draftId, ...prepared } });
      await queueDrop(draftId, file);
      if (!prepared.storedOriginal && prepared.kind !== "image") toast.message(t("wizard.tooBig"));
      setProgress((prev) => ({ ...prev, [key]: 100 }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      toast.error(message.includes("miejsca") ? t("app.errSpace") : t("app.errUpload", { name: file.name }));
      setProgress((prev) => ({ ...prev, [key]: 0 }));
    }
  }

  async function uploadMany(files: File[]) {
    if (!files.length || busy.current) return;
    busy.current = true;
    setUploading(true);
    const queue = [...files];
    const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length) {
        const file = queue.shift();
        if (file) await uploadOne(file);
      }
    });
    await Promise.all(workers);
    setUploading(false);
    busy.current = false;
    await queryClient.invalidateQueries({ queryKey: ["draft", draftId] });
  }

  useEffect(() => {
    if (!draftId) return;
    void queueList(draftId).then((files) => {
      if (files.length) {
        toast.message(t("wizard.resume"));
        void uploadMany(files);
      }
    });
    // resume once per draft
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  const totalProgress = useMemo(() => {
    const values = Object.values(progress);
    if (!values.length) return 0;
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  }, [progress]);

  if (!form) return <p className="text-muted">{t("app.loading")}</p>;

  async function next() {
    if (step === 0 && form.files.length === 0) {
      toast.error(t("app.errFile"));
      return;
    }
    if (step === 1 && !form.title.trim()) {
      toast.error(t("app.errTitle"));
      return;
    }
    if (step === 2) {
      await persist(form);
      const published = await publishRoom({ data: { roomId: form.id } });
      setForm(published);
      toast.success(t("app.toastSaved"));
    } else if (step === 1) {
      await persist(form);
      toast.success(t("app.toastChanges"));
    }
    setStep((value) => Math.min(3, value + 1));
  }

  return (
    <div>
      <p className="text-sm font-semibold text-muted">{t("wizard.step", { n: step + 1 })}</p>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {steps.map((key, index) => (
          <button key={key} type="button" className={cn("h-1.5 rounded-full", index <= step ? "bg-accent" : "bg-line")} aria-label={t(key)} onClick={() => index < step && setStep(index)} />
        ))}
      </div>
      <h1 className="mt-4 text-3xl font-extrabold tracking-tight">{t(steps[step] ?? "wizard.files")}</h1>

      {step === 0 ? (
        <div className="mt-6 space-y-4">
          <label
            className="card grid min-h-48 place-items-center border-dashed p-6 text-center"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void filesFromDrop(event.dataTransfer).then(uploadMany);
            }}
          >
            <span>
              <Upload className="mx-auto text-accent" />
              <span className="mt-3 block font-semibold">{t("wizard.drop")}</span>
              <span className="mt-1 block text-sm text-muted">{t("wizard.limit")}</span>
              <span className="mt-1 block text-sm text-muted">{t("wizard.hostNote")}</span>
            </span>
            <input
              className="sr-only"
              type="file"
              multiple
              onChange={(event) => {
                if (event.target.files) void filesFromList(event.target.files).then(uploadMany);
                event.target.value = "";
              }}
            />
          </label>
          <label className="btn btn-ghost">
            {t("wizard.folder")}
            <input
              className="sr-only"
              type="file"
              multiple
              {...{ webkitdirectory: "", directory: "" }}
              onChange={(event) => {
                if (event.target.files) void filesFromList(event.target.files).then(uploadMany);
              }}
            />
          </label>
          {uploading ? (
            <p className="text-sm font-semibold" role="status">
              {t("wizard.uploading", { n: totalProgress })}
              <span className="mt-1 block text-muted">{t("wizard.stay")}</span>
            </p>
          ) : null}
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {form.files.map((file, index) => (
              <li key={file.id} className="card overflow-hidden">
                <div className="relative aspect-square bg-soft">
                  {file.thumb ? <img src={file.thumb} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-xs">{file.kind}</div>}
                  {file.isCover ? <span className="absolute top-2 left-2 rounded-full bg-paper px-2 py-1 text-xs font-bold">{t("wizard.coverSet")}</span> : null}
                </div>
                <div className="space-y-2 p-2">
                  <p className="truncate text-xs font-bold">{file.name}</p>
                  <div className="flex flex-wrap gap-1">
                    <button type="button" className="rounded-full border border-line px-2 py-1 text-xs" onClick={() => setCover({ data: { roomId: form.id, fileId: file.id } }).then(() => queryClient.invalidateQueries({ queryKey: ["draft", draftId] }))}>
                      {t("wizard.setCover")}
                    </button>
                    <button type="button" className="rounded-full border border-line px-2 py-1 text-xs" disabled={index === 0} onClick={() => {
                      const ids = form.files.map((item) => item.id);
                      const swap = ids[index - 1];
                      if (!swap) return;
                      ids[index - 1] = ids[index]!;
                      ids[index] = swap;
                      void reorderFiles({ data: { roomId: form.id, ids } }).then(() => queryClient.invalidateQueries({ queryKey: ["draft", draftId] }));
                    }}>↑</button>
                    <button type="button" aria-label={t("app.remove")} className="grid size-8 place-items-center rounded-full border border-line" onClick={() => removeFile({ data: { roomId: form.id, fileId: file.id } }).then(() => queryClient.invalidateQueries({ queryKey: ["draft", draftId] }))}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="mt-6 grid gap-4">
          <label className="text-sm font-semibold">{t("wizard.title")}
            <input className="field mt-1" placeholder={t("wizard.titlePh")} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </label>
          <label className="text-sm font-semibold">{t("wizard.client")}
            <input className="field mt-1" placeholder={t("wizard.clientPh")} value={form.clientName} onChange={(event) => setForm({ ...form, clientName: event.target.value })} />
          </label>
          <label className="text-sm font-semibold">{t("wizard.clientEmail")}
            <input className="field mt-1" type="email" value={form.clientEmail} onChange={(event) => setForm({ ...form, clientEmail: event.target.value })} />
          </label>
          <div>
            <p className="text-sm font-semibold">{t("wizard.by")}</p>
            {form.coCreators.map((person, index) => (
              <div key={index} className="mt-2 flex gap-2">
                <input className="field" value={person.name} placeholder={t("wizard.personPh")} onChange={(event) => {
                  const coCreators = [...form.coCreators];
                  coCreators[index] = { name: event.target.value };
                  setForm({ ...form, coCreators });
                }} />
                <button type="button" className="btn btn-ghost" onClick={() => setForm({ ...form, coCreators: form.coCreators.filter((_, i) => i !== index) })}>{t("wizard.removePerson")}</button>
              </div>
            ))}
            {form.coCreators.length < 3 ? (
              <button type="button" className="mt-2 text-sm font-semibold text-accent" onClick={() => setForm({ ...form, coCreators: [...form.coCreators, { name: "" }] })}>{t("wizard.addPerson")}</button>
            ) : null}
          </div>
          <label className="text-sm font-semibold">{t("wizard.message")}
            <textarea className="field mt-1 min-h-28" placeholder={t("wizard.messagePh")} value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} />
          </label>
          <label className="text-sm font-semibold">{t("wizard.valid")}
            <select className="field mt-1" value={form.validityDays ?? "none"} onChange={(event) => setForm({ ...form, validityDays: event.target.value === "none" ? null : Number(event.target.value) })}>
              <option value={7}>{t("wizard.d7")}</option>
              <option value={14}>{t("wizard.d14")}</option>
              <option value={30}>{t("wizard.d30")}</option>
              <option value="none">{t("wizard.forever")}</option>
            </select>
          </label>
          <label className="text-sm font-semibold">{t("wizard.password")}
            <input className="field mt-1" type="password" placeholder={form.hasPassword ? t("app.passwordSet") : ""} onChange={(event) => setForm({ ...form, message: form.message, title: form.title })} onBlur={(event) => {
              const password = event.target.value;
              if (!password) return;
              void saveDraft({
                data: {
                  roomId: form.id,
                  title: form.title,
                  clientName: form.clientName,
                  clientEmail: form.clientEmail,
                  message: form.message,
                  coCreators: form.coCreators.map((person) => person.name),
                  validityDays: form.validityDays,
                  password,
                  allowZip: form.allowZip,
                  allowDownload: form.allowDownload,
                  hidePoweredBy: form.hidePoweredBy,
                  brand: form.brand,
                },
              });
            }} />
          </label>
          <label className="flex items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={form.allowZip} onChange={(event) => setForm({ ...form, allowZip: event.target.checked })} /> {t("wizard.zip")}</label>
          <label className="flex items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={form.allowDownload} onChange={(event) => setForm({ ...form, allowDownload: event.target.checked })} /> {t("wizard.single")}</label>
          <label className="flex items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={form.hidePoweredBy} onChange={(event) => setForm({ ...form, hidePoweredBy: event.target.checked })} /> {t("wizard.hide")}</label>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-[280px_1fr]">
          <div className="space-y-4">
            <p className="text-sm font-semibold">{t("wizard.bg")}</p>
            <div className="grid grid-cols-4 gap-2">
              {PRESET_IDS.map((preset) => (
                <button key={preset} type="button" aria-label={preset} className={cn("h-12 rounded-xl border", form.brand.backgroundValue === preset ? "border-accent" : "border-transparent")} style={{ background: PRESET_STYLE[preset] }} onClick={() => setForm({ ...form, brand: { ...form.brand, backgroundType: "preset", backgroundValue: preset } })} />
              ))}
            </div>
            <label className="text-sm font-semibold">{t("wizard.color")}
              <input className="field mt-1" type="color" value={safeHex(form.brand.backgroundType === "color" ? form.brand.backgroundValue : "#0c1220")} onChange={(event) => setForm({ ...form, brand: { ...form.brand, backgroundType: "color", backgroundValue: event.target.value } })} />
            </label>
            <label className="btn btn-ghost">
              <ImagePlus size={16} /> {t("wizard.image")}
              <input className="sr-only" type="file" accept="image/*" onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const prepared = await prepareFile(file);
                if (prepared.preview) setForm({ ...form, brand: { ...form.brand, backgroundType: "image", backgroundValue: prepared.preview } });
              }} />
            </label>
            <label className="btn btn-ghost">
              {t("wizard.logo")}
              <input className="sr-only" type="file" accept="image/*" onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const prepared = await prepareFile(file);
                if (prepared.thumb) setForm({ ...form, brand: { ...form.brand, logoUrl: prepared.thumb } });
              }} />
            </label>
            <label className="text-sm font-semibold">{t("wizard.accent")}
              <input className="field mt-1" type="color" value={safeHex(form.brand.accentColor)} onChange={(event) => setForm({ ...form, brand: { ...form.brand, accentColor: event.target.value } })} />
            </label>
            <label className="text-sm font-semibold">{t("wizard.font")}
              <select className="field mt-1" value={form.brand.fontKey} onChange={(event) => setForm({ ...form, brand: { ...form.brand, fontKey: safeFont(event.target.value) } })}>
                <option value="cormorant">Cormorant Garamond</option>
                <option value="playfair">Playfair Display</option>
                <option value="inter">Inter</option>
              </select>
            </label>
            <div className="flex gap-2">
              <button type="button" className={cn("btn", form.brand.theme === "dark" ? "btn-primary" : "btn-ghost")} onClick={() => setForm({ ...form, brand: { ...form.brand, theme: safeTheme("dark") } })}>{t("wizard.themeDark")}</button>
              <button type="button" className={cn("btn", form.brand.theme === "light" ? "btn-primary" : "btn-ghost")} onClick={() => setForm({ ...form, brand: { ...form.brand, theme: "light" } })}>{t("wizard.themeLight")}</button>
            </div>
            <div className="flex gap-2">
              <button type="button" className={cn("btn", form.brand.layout === "grid" ? "btn-primary" : "btn-ghost")} onClick={() => setForm({ ...form, brand: { ...form.brand, layout: safeLayout("grid") } })}>{t("wizard.grid")}</button>
              <button type="button" className={cn("btn", form.brand.layout === "masonry" ? "btn-primary" : "btn-ghost")} onClick={() => setForm({ ...form, brand: { ...form.brand, layout: "masonry" } })}>{t("wizard.masonry")}</button>
            </div>
            <button type="button" className="text-sm font-semibold text-accent" onClick={async () => {
              await saveBrand({ data: { brand: form.brand, name: "Domyślny" } });
              toast.success(t("wizard.savedDefault"));
            }}>{t("wizard.saveDefault")}</button>
          </div>
          <div>
            <div className="mb-3 flex gap-2">
              <button type="button" className={cn("btn", frame === "desktop" ? "btn-primary" : "btn-ghost")} onClick={() => setFrame("desktop")}>{t("wizard.desktop")}</button>
              <button type="button" className={cn("btn", frame === "phone" ? "btn-primary" : "btn-ghost")} onClick={() => setFrame("phone")}>{t("wizard.phone")}</button>
            </div>
            <div className={cn("mx-auto overflow-hidden rounded-[1.5rem] border border-line", frame === "phone" ? "max-w-[320px]" : "max-w-full")}>
              <RoomPreview draft={form} />
            </div>
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="card mt-6 space-y-4 p-6">
          <p>{t("wizard.readyLead")}</p>
          <p className="break-all rounded-xl bg-soft p-3 text-sm">{roomLink(form.slug)}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" onClick={async () => {
              await navigator.clipboard.writeText(roomLink(form.slug));
              toast.success(t("app.toastCopied"));
            }}>{t("wizard.copy")}</button>
            <button type="button" className="btn btn-ghost" disabled={!form.clientEmail} onClick={async () => {
              await sendClientEmail({ data: { roomId: form.id } });
              toast.success(t("app.toastSent", { email: form.clientEmail }));
            }}>{t("wizard.mail")}</button>
            <button type="button" className="btn btn-ghost" onClick={() => navigate({ to: "/app/nowa", search: { draft: "" } })}>{t("wizard.another")}</button>
          </div>
          {qr ? <img src={qr} alt={t("wizard.qr")} className="h-40 w-40 rounded-xl bg-paper" /> : null}
          <p className="flex items-center gap-2 text-sm text-ok"><Check size={16} /> {form.status === "active" ? t("app.active") : t("app.draftHint")}</p>
        </div>
      ) : null}

      <div className="mt-8 flex justify-between gap-3">
        <button type="button" className="btn btn-ghost" disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}>{t("wizard.back")}</button>
        {step < 3 ? (
          <button type="button" className="btn btn-primary" onClick={() => void next()}>{step === 2 ? t("wizard.publish") : t("wizard.next")}</button>
        ) : null}
      </div>
    </div>
  );
}

export type { Brand };
