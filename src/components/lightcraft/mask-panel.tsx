import {
  Brush,
  Eraser,
  Eye,
  EyeOff,
  FlipHorizontal2,
  Lock,
  Minus,
  Plus,
  ScanText,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { MaskMode, PanelTab, Tool } from "@/lib/mask-types";

export type MaskPanelProps = {
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  tool: Tool;
  onTool: (tool: Tool) => void;
  mode: MaskMode;
  onMode: (mode: MaskMode) => void;
  tolerance: number;
  onTolerance: (value: number) => void;
  brush: number;
  onBrush: (value: number) => void;
  feather: number;
  onFeather: (value: number) => void;
  coverage: number;
  hasMask: boolean;
  showMask: boolean;
  onShowMask: (show: boolean) => void;
  onInvert: () => void;
  onClear: () => void;
  onSaveMask: () => void;
  onModel: () => void;
  onClose?: () => void;
};

const TABS: { id: PanelTab; label: string; sam: boolean }[] = [
  { id: "manual", label: "Manual", sam: false },
  { id: "object", label: "Object", sam: true },
  { id: "describe", label: "Describe", sam: true },
];

function Slider({
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold text-lc-muted">{label}</span>
        <span className="font-mono text-xs text-lc-faint">
          {value}
          {unit}
        </span>
      </span>
      <input
        type="range"
        className="lc-range mt-1"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
      />
    </label>
  );
}

function SamGate({ kind, onModel }: { kind: "object" | "describe"; onModel: () => void }) {
  return (
    <div className="space-y-5 p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-lc-line bg-lc-raised text-lc-accent">
          {kind === "object" ? (
            <WandSparkles className="size-4" aria-hidden="true" />
          ) : (
            <ScanText className="size-4" aria-hidden="true" />
          )}
        </span>
        <div>
          <h3 className="text-sm font-bold text-lc-fg">{kind === "object" ? "Object masks" : "Describe masks"}</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-lc-muted">
            {kind === "object"
              ? "Click any object for a precise cutout — hair, edges and all."
              : "Type what you want to isolate and SAM 3 finds it in the frame."}
          </p>
        </div>
      </div>

      {kind === "object" ? (
        <div className="relative overflow-hidden rounded-xl border border-dashed border-lc-line-strong bg-lc-raised/40 px-4 py-7 text-center">
          <span className="absolute top-2 left-2 size-2 border-t border-l border-lc-line-strong" aria-hidden="true" />
          <span className="absolute top-2 right-2 size-2 border-t border-r border-lc-line-strong" aria-hidden="true" />
          <span className="absolute bottom-2 left-2 size-2 border-b border-l border-lc-line-strong" aria-hidden="true" />
          <span className="absolute right-2 bottom-2 size-2 border-r border-b border-lc-line-strong" aria-hidden="true" />
          <WandSparkles className="mx-auto size-5 text-lc-faint" aria-hidden="true" />
          <p className="mt-2 text-xs font-semibold text-lc-muted">Click the ceramic vase to mask it</p>
          <p className="mt-1 text-xs text-lc-faint">Object masks are paused until SAM 3 is installed.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="rounded-xl border border-lc-line bg-lc-raised/50 px-3 py-2.5">
            <p className="text-xs text-lc-faint">Describe what to mask — e.g. “the dried stems and vase”</p>
            <div className="mt-2 flex items-center gap-2">
              <Sparkles className="size-3.5 text-lc-faint" aria-hidden="true" />
              <span className="h-1 w-24 rounded-full bg-lc-line-strong" aria-hidden="true" />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {["every coffee cup", "the red book", "her jacket"].map((chip) => (
              <span
                key={chip}
                className="rounded-full border border-lc-line px-2.5 py-1 text-xs text-lc-faint"
              >
                {chip}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-lc-accent/25 bg-lc-accent/8 p-3.5">
        <div className="flex items-center gap-2">
          <Lock className="size-3.5 text-lc-accent" aria-hidden="true" />
          <span className="text-xs font-bold tracking-wide text-lc-fg">SAM 3 model required</span>
          <span className="ml-auto rounded-full border border-lc-line px-2 py-0.5 text-[10px] font-semibold text-lc-muted">
            3.4 GB
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-lc-muted">
          A one-time download from Meta, stored on this machine. Everything else in the studio works without it.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="lc-btn lc-btn-primary min-h-9 px-3" onClick={onModel}>
            Set up SAM 3
          </button>
          <a
            href="https://huggingface.co/facebook/sam3/blob/main/LICENSE"
            target="_blank"
            rel="noreferrer"
            className="lc-btn lc-btn-quiet min-h-9 px-3 text-xs"
          >
            License
          </a>
        </div>
      </div>

      <p className="text-xs leading-relaxed text-lc-faint">
        {kind === "object"
          ? "Until then, the magic wand and brush make solid masks — then feather the edge and export a PNG cutout."
          : "Describe masks run entirely on your machine once the model files are in place. No uploads, no account."}
      </p>
    </div>
  );
}

export function MaskPanel(props: MaskPanelProps) {
  const {
    tab,
    onTab,
    tool,
    onTool,
    mode,
    onMode,
    tolerance,
    onTolerance,
    brush,
    onBrush,
    feather,
    onFeather,
    coverage,
    hasMask,
    showMask,
    onShowMask,
    onInvert,
    onClear,
    onSaveMask,
    onModel,
    onClose,
  } = props;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <h2 className="text-sm font-bold tracking-tight text-lc-fg">Masks</h2>
        <span className="rounded-full border border-lc-line px-2 py-0.5 text-[10px] font-semibold text-lc-faint">
          {hasMask ? "1 selection" : "none"}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            className="lc-icon-btn"
            onClick={() => onShowMask(!showMask)}
            aria-label={showMask ? "Hide mask overlay" : "Show mask overlay"}
            title={showMask ? "Hide overlay (\\)" : "Show overlay (\\)"}
          >
            {showMask ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
          </button>
          {onClose ? (
            <button type="button" className="lc-icon-btn lg:hidden" onClick={onClose} aria-label="Close masks panel">
              <X className="size-4" />
            </button>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        onClick={onModel}
        className="mx-4 mb-3 flex items-center gap-2 rounded-lg border border-lc-line bg-lc-raised/50 px-3 py-2 text-left text-xs transition-colors hover:border-lc-line-strong"
      >
        <span className="size-1.5 shrink-0 rounded-full bg-lc-accent" aria-hidden="true" />
        <span className="min-w-0 truncate text-lc-muted">
          SAM 3 not installed · <span className="text-lc-faint">Object &amp; Describe paused</span>
        </span>
        <span className="ml-auto shrink-0 font-semibold text-lc-accent">Set up</span>
      </button>

      <div className="mx-4 flex gap-1 rounded-xl border border-lc-line bg-lc-bg p-1">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="lc-tab"
            data-active={tab === item.id}
            onClick={() => onTab(item.id)}
            aria-pressed={tab === item.id}
          >
            {item.label}
            {item.sam ? (
              <span
                className={cn("size-1 rounded-full", tab === item.id ? "bg-lc-accent" : "bg-lc-faint")}
                aria-hidden="true"
              />
            ) : null}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "manual" ? (
          <div className="space-y-5 p-4">
            <div>
              <span className="lc-label">Tool</span>
              <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg border border-lc-line bg-lc-bg p-1">
                {(
                  [
                    { id: "wand", label: "Wand", icon: WandSparkles },
                    { id: "brush", label: "Brush", icon: Brush },
                    { id: "eraser", label: "Eraser", icon: Eraser },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onTool(item.id)}
                    aria-pressed={tool === item.id}
                    className={cn(
                      "flex min-h-9 items-center justify-center gap-1.5 rounded-md text-xs font-semibold transition-colors",
                      tool === item.id
                        ? "bg-lc-raised text-lc-fg shadow-[inset_0_0_0_1px_var(--color-lc-line-strong)]"
                        : "text-lc-muted hover:text-lc-fg",
                    )}
                  >
                    <item.icon className="size-3.5" aria-hidden="true" />
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="lc-label">Mode</span>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onMode("add")}
                  aria-pressed={mode === "add"}
                  className={cn(
                    "flex min-h-9 items-center justify-center gap-1.5 rounded-lg border text-xs font-semibold transition-colors",
                    mode === "add"
                      ? "border-lc-accent/50 bg-lc-accent/10 text-lc-fg"
                      : "border-lc-line text-lc-muted hover:text-lc-fg",
                  )}
                >
                  <Plus className="size-3.5 text-lc-accent" aria-hidden="true" />
                  Add to mask
                </button>
                <button
                  type="button"
                  onClick={() => onMode("subtract")}
                  aria-pressed={mode === "subtract"}
                  className={cn(
                    "flex min-h-9 items-center justify-center gap-1.5 rounded-lg border text-xs font-semibold transition-colors",
                    mode === "subtract"
                      ? "border-lc-accent/50 bg-lc-accent/10 text-lc-fg"
                      : "border-lc-line text-lc-muted hover:text-lc-fg",
                  )}
                >
                  <Minus className="size-3.5 text-lc-accent" aria-hidden="true" />
                  Subtract
                </button>
              </div>
            </div>

            <div className="space-y-4 rounded-xl border border-lc-line bg-lc-raised/30 p-3.5">
              {tool === "wand" ? (
                <Slider label="Tolerance" value={tolerance} min={4} max={90} onChange={onTolerance} />
              ) : tool === "pan" ? null : (
                <Slider label="Brush size" value={brush} min={4} max={140} unit=" px" onChange={onBrush} />
              )}
              <Slider label="Feather edge" value={feather} min={0} max={40} unit=" px" onChange={onFeather} />
            </div>

            <div>
              <div className="flex items-baseline justify-between">
                <span className="lc-label">Selection</span>
                <span className="font-mono text-xs text-lc-faint">{coverage.toFixed(1)}% of frame</span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-lc-line">
                <div
                  className="h-full rounded-full bg-lc-accent transition-[width] duration-200"
                  style={{ width: `${Math.min(100, Math.max(hasMask ? 1.5 : 0, coverage))}%` }}
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className="lc-btn lc-btn-quiet min-h-9 px-2 text-xs"
                  onClick={onInvert}
                  disabled={!hasMask}
                >
                  <FlipHorizontal2 className="size-3.5" aria-hidden="true" />
                  Invert
                </button>
                <button
                  type="button"
                  className="lc-btn lc-btn-quiet min-h-9 px-2 text-xs"
                  onClick={onSaveMask}
                  disabled={!hasMask}
                >
                  Save mask
                </button>
                <button
                  type="button"
                  className="lc-btn lc-btn-quiet col-span-2 min-h-9 px-2 text-xs text-lc-danger hover:text-lc-danger"
                  onClick={onClear}
                  disabled={!hasMask}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  Clear selection
                </button>
              </div>
            </div>

            <p className="border-t border-lc-line pt-4 text-xs leading-relaxed text-lc-faint">
              <span className="font-semibold text-lc-muted">W</span> wand ·{" "}
              <span className="font-semibold text-lc-muted">B</span> brush ·{" "}
              <span className="font-semibold text-lc-muted">E</span> eraser ·{" "}
              <span className="font-semibold text-lc-muted">H</span> pan ·{" "}
              <span className="font-semibold text-lc-muted">⌘Z</span> undo
            </p>
          </div>
        ) : (
          <SamGate kind={tab} onModel={onModel} />
        )}
      </div>
    </div>
  );
}
