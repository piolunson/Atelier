import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowUpRight,
  BoxSelect,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  TriangleAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { INSTALL_STEPS, SAM3, copyText } from "@/lib/sam3";

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

function StatusDot() {
  return <span className="lc-soft-pulse size-1.5 rounded-full bg-lc-accent" aria-hidden="true" />;
}

export function ModelDialog({ open, onOpenChange }: Props) {
  const [copied, setCopied] = useState<"folder" | "steps" | null>(null);

  async function copy(kind: "folder" | "steps") {
    const ok = await copyText(kind === "folder" ? SAM3.folder : INSTALL_STEPS);
    if (!ok) {
      toast.error("Couldn't reach the clipboard. Select the path and copy it manually.");
      return;
    }
    setCopied(kind);
    toast.success(kind === "folder" ? "Models folder copied" : "Install steps copied");
    window.setTimeout(() => setCopied(null), 2000);
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="lc-overlay" />
        <Dialog.Content className="lc-dialog lc-dialog-shadow">
          <div className="flex items-start gap-4 border-b border-lc-line px-5 py-4 sm:px-6">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-lc-line bg-lc-raised text-lc-accent">
              <BoxSelect className="size-5" strokeWidth={1.8} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-base font-bold tracking-tight text-lc-fg">
                Object &amp; Describe masks
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-lc-muted">
                <span className="inline-flex items-center gap-1.5">
                  <StatusDot /> SAM 3 · not installed
                </span>
                <span className="text-lc-faint" aria-hidden="true">
                  /
                </span>
                <span>{SAM3.size} one-time download</span>
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="lc-icon-btn -mt-1 shrink-0" aria-label="Close model setup">
                <X className="size-4" aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>

          <div className="lc-dialog-body px-5 py-5 sm:px-6">
            <p className="text-sm leading-relaxed text-lc-fg">
              Object and Describe masks use <span className="font-semibold">SAM 3</span>, Meta&apos;s segmentation
              model. It isn&apos;t part of LightCraft, and everything else works without it.
            </p>

            <div className="mt-4 rounded-xl border border-lc-line bg-lc-raised/60 p-3.5">
              <div className="flex items-center gap-2 lc-label">
                <FolderOpen className="size-3.5" aria-hidden="true" />
                Models folder
              </div>
              <div className="mt-2 flex items-start gap-2">
                <code className="lc-selectable min-w-0 flex-1 font-mono text-xs leading-relaxed break-all text-lc-fg">
                  {SAM3.folder}
                </code>
                <button
                  type="button"
                  onClick={() => void copy("folder")}
                  className="lc-icon-btn -mr-1 -mt-1 shrink-0"
                  aria-label="Copy models folder path"
                  title="Copy folder path"
                >
                  {copied === "folder" ? (
                    <Check className="size-4 text-lc-ok" aria-hidden="true" />
                  ) : (
                    <Copy className="size-4" aria-hidden="true" />
                  )}
                </button>
              </div>
              <p className="mt-1.5 text-xs text-lc-faint">Where Lightcraft looks for the model on this machine.</p>
            </div>

            <p className="mt-4 text-xs leading-relaxed text-lc-muted">
              Licence: SAM License ({SAM3.vendor}) — Meta&apos;s terms, not LightCraft&apos;s. Downloading it means
              accepting them.{" "}
              <a
                href={SAM3.licensePage}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-lc-fg underline decoration-lc-line-strong underline-offset-2 hover:decoration-lc-accent"
              >
                Read the SAM License
                <ArrowUpRight className="size-3" aria-hidden="true" />
              </a>
            </p>

            <div className="mt-5 flex gap-3 rounded-xl border border-lc-accent/25 bg-lc-accent/8 p-3.5">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-lc-accent" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-lc-fg">This build can&apos;t download the model yet.</p>
                <p className="mt-1 text-xs leading-relaxed text-lc-muted">
                  To install it by hand, put <span className="font-mono text-lc-fg">model.safetensors</span>,{" "}
                  <span className="font-mono text-lc-fg">vocab.json</span> and{" "}
                  <span className="font-mono text-lc-fg">merges.txt</span> from Meta&apos;s{" "}
                  <span className="font-semibold text-lc-fg">facebook/sam3</span> in the folder above: Object and
                  Describe work as soon as they are there.
                </p>
                <button
                  type="button"
                  disabled
                  className="mt-3 inline-flex items-center gap-2 rounded-lg border border-lc-line bg-lc-surface px-3 py-2 text-xs font-semibold text-lc-faint"
                  title="Automatic download is unavailable in this build"
                >
                  <Download className="size-3.5" aria-hidden="true" />
                  Download model automatically
                  <span className="rounded bg-lc-raised px-1.5 py-0.5 text-[10px] tracking-wide uppercase">
                    unavailable
                  </span>
                </button>
              </div>
            </div>

            <div className="mt-5">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="lc-label">Put these three files in the folder</h3>
                <a
                  href={SAM3.filesPage}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-lc-accent hover:underline"
                >
                  facebook/sam3
                  <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              </div>
              <ul className="mt-2 divide-y divide-lc-line overflow-hidden rounded-xl border border-lc-line">
                {SAM3.files.map((file) => (
                  <li key={file.name} className="flex items-center gap-3 bg-lc-raised/40 px-3.5 py-2.5">
                    <FileText className="size-3.5 shrink-0 text-lc-faint" aria-hidden="true" />
                    <span className="min-w-0 flex-1 font-mono text-xs break-all text-lc-fg">{file.name}</span>
                    <span className="shrink-0 text-xs text-lc-faint">{file.note}</span>
                  </li>
                ))}
              </ul>
            </div>

            <a
              href={SAM3.modelPage}
              target="_blank"
              rel="noreferrer"
              className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-lc-line px-3.5 py-3 transition-colors hover:border-lc-line-strong hover:bg-lc-raised/60"
            >
              <span>
                <span className="block text-sm font-semibold text-lc-fg">How to install the model</span>
                <span className="block text-xs text-lc-muted">
                  Download the files from Meta&apos;s model page, then copy them into the folder above.
                </span>
              </span>
              <ArrowUpRight className="size-4 shrink-0 text-lc-accent" aria-hidden="true" />
            </a>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-lc-line bg-lc-surface px-5 py-3.5 sm:px-6">
            <button type="button" className="lc-btn lc-btn-quiet" onClick={() => void copy("steps")}>
              {copied === "steps" ? <Check className="size-4 text-lc-ok" /> : <Copy className="size-4" />}
              Copy install steps
            </button>
            <div className="ml-auto flex items-center gap-2">
              <Dialog.Close asChild>
                <button type="button" className="lc-btn lc-btn-quiet">
                  Close
                </button>
              </Dialog.Close>
              <a
                href={SAM3.modelPage}
                target="_blank"
                rel="noreferrer"
                className="lc-btn lc-btn-primary"
                onClick={() => onOpenChange(false)}
              >
                Open model page
                <ExternalLink className="size-4" aria-hidden="true" />
              </a>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
