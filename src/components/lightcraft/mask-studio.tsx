import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  Aperture,
  Brush,
  Download,
  Eraser,
  Hand,
  HardDriveDownload,
  ImagePlus,
  Maximize2,
  PanelRightOpen,
  Redo2,
  Scan,
  Undo2,
  WandSparkles,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Toaster, toast } from "sonner";
import { cn } from "@/lib/cn";
import { clamp, countMask, invertMask, maskEdges, paintSegment, wandSelect, type Rect } from "@/lib/mask-engine";
import type { MaskMode, PanelTab, Tool } from "@/lib/mask-types";
import { SAM3, downloadBlob, safeBaseName } from "@/lib/sam3";
import { MaskPanel, type MaskPanelProps } from "./mask-panel";
import { ModelDialog } from "./model-dialog";

const DEMO_SRC = "/demo/atelier-session.jpg";

type Doc = { name: string; kind: string; w: number; h: number };
type Stats = { coverage: number; has: boolean; undo: number; redo: number };
type Drag =
  | { kind: "pan"; startX: number; startY: number; panX: number; panY: number }
  | { kind: "paint"; x: number; y: number };

const TOOLS: { id: Tool; label: string; shortcut: string; icon: typeof WandSparkles }[] = [
  { id: "wand", label: "Magic wand", shortcut: "W", icon: WandSparkles },
  { id: "brush", label: "Add brush", shortcut: "B", icon: Brush },
  { id: "eraser", label: "Erase brush", shortcut: "E", icon: Eraser },
  { id: "pan", label: "Pan", shortcut: "H", icon: Hand },
];

export function MaskStudio() {
  const [doc, setDoc] = useState<Doc>({ name: "Studio still life", kind: "JPEG", w: 1792, h: 1008 });
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [tool, setTool] = useState<Tool>("wand");
  const [mode, setMode] = useState<MaskMode>("add");
  const [tolerance, setTolerance] = useState(34);
  const [brushSize, setBrushSize] = useState(52);
  const [feather, setFeather] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [spaceDown, setSpaceDown] = useState(false);
  const [dragging, setDragging] = useState<Drag["kind"] | null>(null);
  const cursorRingRef = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<Stats>({ coverage: 0, has: false, undo: 0, redo: 0 });
  const [showMask, setShowMask] = useState(true);
  // `\` is a momentary peek; it must not overwrite the panel's own toggle.
  const [peek, setPeek] = useState(false);
  const maskVisible = showMask && !peek;
  const [tab, setTab] = useState<PanelTab>("manual");
  const [modelOpen, setModelOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const [reducedMotion, setReducedMotion] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const tintRef = useRef<HTMLCanvasElement>(null);
  const antsRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const photoRef = useRef<HTMLImageElement | null>(null);
  const pixelsRef = useRef<Uint8ClampedArray | null>(null);
  const maskRef = useRef<Uint8Array>(new Uint8Array(0));
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskImageRef = useRef<ImageData | null>(null);
  const edgesRef = useRef<Int32Array | null>(null);
  const antsImageRef = useRef<ImageData | null>(null);
  const historyRef = useRef<Uint8Array[]>([]);
  const futureRef = useRef<Uint8Array[]>([]);
  const dragRef = useRef<Drag | null>(null);
  const hasMaskRef = useRef(false);
  const actionsRef = useRef({ undo: () => {}, redo: () => {}, clear: () => {} });

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    setLoadError(false);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      setDoc((current) => ({
        ...current,
        w: img.naturalWidth,
        h: img.naturalHeight,
      }));
      setPhoto(img);
    };
    img.onerror = () => setLoadError(true);
    img.src = DEMO_SRC;
  }, [attempt]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setStageSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!photo) return;
    photoRef.current = photo;
    const w = photo.naturalWidth;
    const h = photo.naturalHeight;

    const base = baseRef.current;
    const tint = tintRef.current;
    const ants = antsRef.current;
    if (!base || !tint || !ants) return;

    for (const canvas of [base, tint, ants]) {
      canvas.width = w;
      canvas.height = h;
    }

    const baseCtx = base.getContext("2d", { willReadFrequently: true });
    if (!baseCtx) return;
    baseCtx.clearRect(0, 0, w, h);
    baseCtx.drawImage(photo, 0, 0);

    try {
      pixelsRef.current = baseCtx.getImageData(0, 0, w, h).data;
    } catch {
      pixelsRef.current = null;
    }

    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = w;
    maskCanvas.height = h;
    maskCanvasRef.current = maskCanvas;

    const image = new ImageData(w, h);
    for (let i = 0; i < w * h; i += 1) {
      image.data[i * 4] = 255;
      image.data[i * 4 + 1] = 255;
      image.data[i * 4 + 2] = 255;
    }
    maskImageRef.current = image;
    antsImageRef.current = new ImageData(w, h);
    maskCanvas.getContext("2d")?.putImageData(image, 0, 0);

    maskRef.current = new Uint8Array(w * h);
    edgesRef.current = null;
    historyRef.current = [];
    futureRef.current = [];
    hasMaskRef.current = false;
    setStats({ coverage: 0, has: false, undo: 0, redo: 0 });
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setReady(true);
  }, [photo]);

  const renderOverlay = useCallback(() => {
    const tint = tintRef.current;
    const maskCanvas = maskCanvasRef.current;
    if (!tint || !maskCanvas) return;
    const ctx = tint.getContext("2d");
    if (!ctx) return;
    const w = tint.width;
    const h = tint.height;
    ctx.clearRect(0, 0, w, h);
    if (!maskVisible || !hasMaskRef.current) return;

    ctx.save();
    ctx.filter = feather > 0 ? `blur(${feather}px)` : "none";
    ctx.drawImage(maskCanvas, 0, 0);
    ctx.filter = "none";
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = "rgba(226, 177, 94, 0.46)";
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }, [feather, maskVisible]);

  useEffect(() => {
    if (!ready) return;
    renderOverlay();
  }, [ready, renderOverlay, stats.has]);

  useEffect(() => {
    const ctx = antsRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (!stats.has || !maskVisible) return;

    const w = ctx.canvas.width;
    const image = antsImageRef.current;
    if (!image) return;

    let phase = 0;
    let raf = 0;
    let last = 0;

    const draw = () => {
      const edges = edgesRef.current;
      image.data.fill(0);
      if (edges) {
        for (let i = 0; i < edges.length; i += 1) {
          const index = edges[i] ?? 0;
          const x = index % w;
          const y = (index - x) / w;
          const on = (x + y + phase) % 14 < 7;
          const p = index * 4;
          const tone = on ? 255 : 8;
          image.data[p] = tone;
          image.data[p + 1] = tone;
          image.data[p + 2] = tone;
          image.data[p + 3] = 255;
        }
      }
      ctx.putImageData(image, 0, 0);
    };

    if (reducedMotion) {
      draw();
      return;
    }

    const loop = (time: number) => {
      if (time - last > 130) {
        last = time;
        phase += 1;
        draw();
      }
      raf = requestAnimationFrame(loop);
    };
    draw();
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [stats.has, maskVisible, reducedMotion, doc.w, doc.h]);

  const fit = useMemo(() => {
    if (!doc.w || !doc.h || !stageSize.w || !stageSize.h) return 0.4;
    const scale = Math.min((stageSize.w - 56) / doc.w, (stageSize.h - 56) / doc.h);
    return Math.max(0.02, Math.min(1, scale));
  }, [doc.w, doc.h, stageSize.w, stageSize.h]);

  const screenScale = fit * zoom;
  const brushRadius = Math.max(1, brushSize / 2 / Math.max(0.05, screenScale));

  // Keep the photo reachable: at fit zoom there is nothing to pan, and when
  // zoomed in you can travel exactly to the edges and no further.
  const panLimits = useCallback(
    (level: number) => ({
      x: Math.max(0, (doc.w * fit * level - stageSize.w) / 2),
      y: Math.max(0, (doc.h * fit * level - stageSize.h) / 2),
    }),
    [doc.w, doc.h, fit, stageSize.w, stageSize.h],
  );

  useEffect(() => {
    const limits = panLimits(zoom);
    setPan((current) => {
      const next = { x: clamp(current.x, -limits.x, limits.x), y: clamp(current.y, -limits.y, limits.y) };
      return next.x === current.x && next.y === current.y ? current : next;
    });
  }, [panLimits, zoom]);

  function refreshMaskCanvas(rect?: Rect) {
    const canvas = maskCanvasRef.current;
    const image = maskImageRef.current;
    const mask = maskRef.current;
    if (!canvas || !image || mask.length === 0) return;
    const w = image.width;
    const x0 = rect ? Math.max(0, rect.x) : 0;
    const y0 = rect ? Math.max(0, rect.y) : 0;
    const x1 = rect ? Math.min(w, rect.x + rect.w) : image.width;
    const y1 = rect ? Math.min(image.height, rect.y + rect.h) : image.height;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const index = y * w + x;
        image.data[index * 4 + 3] = mask[index] ?? 0;
      }
    }
    canvas.getContext("2d")?.putImageData(image, 0, 0, x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0));
  }

  function syncHistoryStats() {
    setStats((current) => ({
      ...current,
      undo: historyRef.current.length,
      redo: futureRef.current.length,
    }));
  }

  function commitMask() {
    refreshMaskCanvas();
    const mask = maskRef.current;
    const count = countMask(mask);
    const has = count > 0;
    hasMaskRef.current = has;
    edgesRef.current = has ? maskEdges(mask, doc.w, doc.h) : null;
    setStats({
      coverage: mask.length ? (count / mask.length) * 100 : 0,
      has,
      undo: historyRef.current.length,
      redo: futureRef.current.length,
    });
    renderOverlay();
  }

  function pushHistory() {
    historyRef.current.push(maskRef.current.slice());
    if (historyRef.current.length > 16) historyRef.current.shift();
    futureRef.current = [];
    syncHistoryStats();
  }

  function undo() {
    const previous = historyRef.current.pop();
    if (!previous) return;
    futureRef.current.push(maskRef.current.slice());
    maskRef.current = previous;
    commitMask();
  }

  function redo() {
    const next = futureRef.current.pop();
    if (!next) return;
    historyRef.current.push(maskRef.current.slice());
    maskRef.current = next;
    commitMask();
  }

  function clearMask() {
    if (!hasMaskRef.current) return;
    pushHistory();
    maskRef.current.fill(0);
    commitMask();
    toast("Selection cleared");
  }

  function invertSelection() {
    if (!hasMaskRef.current) return;
    pushHistory();
    invertMask(maskRef.current);
    commitMask();
  }

  function saveMaskPng() {
    if (!hasMaskRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = doc.w;
    canvas.height = doc.h;
    const ctx = canvas.getContext("2d");
    const maskCanvas = maskCanvasRef.current;
    if (!ctx || !maskCanvas) return;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, doc.w, doc.h);
    if (feather > 0) ctx.filter = `blur(${feather}px)`;
    ctx.drawImage(maskCanvas, 0, 0);
    ctx.filter = "none";
    canvas.toBlob((blob) => {
      if (!blob) return;
      downloadBlob(blob, `${safeBaseName(doc.name)}-mask.png`);
      toast.success("Mask saved as PNG");
    }, "image/png");
  }

  function exportCutout() {
    const image = photoRef.current;
    const maskCanvas = maskCanvasRef.current;
    if (!image || !maskCanvas || !hasMaskRef.current) {
      toast("Mask something first", {
        description: "The magic wand is the quickest start — click a surface, then export a cutout.",
      });
      setTab("manual");
      setSheetOpen(true);
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = doc.w;
    canvas.height = doc.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(image, 0, 0);
    ctx.globalCompositeOperation = "destination-in";
    if (feather > 0) ctx.filter = `blur(${feather}px)`;
    ctx.drawImage(maskCanvas, 0, 0);
    ctx.filter = "none";
    canvas.toBlob((blob) => {
      if (!blob) return;
      downloadBlob(blob, `${safeBaseName(doc.name)}-cutout.png`);
      toast.success("Cutout exported", { description: "PNG with a transparent background." });
    }, "image/png");
  }

  function openPhoto() {
    fileRef.current?.click();
  }

  function onFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("That file isn't an image");
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      setDoc({
        name: file.name.replace(/\.[a-z0-9]+$/i, "") || "Untitled photo",
        kind: (file.type.split("/")[1] ?? "IMAGE").toUpperCase(),
        w: image.naturalWidth,
        h: image.naturalHeight,
      });
      setPhoto(image);
      setReady(false);
      URL.revokeObjectURL(url);
      toast.success("Photo opened", { description: file.name });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      toast.error("Couldn't open that photo");
    };
    image.src = url;
  }

  function zoomBy(factor: number) {
    setZoom((current) => clamp(current * factor, 0.35, 6));
  }

  function resetView() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  function toImage(clientX: number, clientY: number) {
    const canvas = baseRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: clamp(Math.floor(((clientX - rect.left) / rect.width) * doc.w), 0, doc.w - 1),
      y: clamp(Math.floor(((clientY - rect.top) / rect.height) * doc.h), 0, doc.h - 1),
    };
  }

  actionsRef.current = { undo, redo, clear: clearMask };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      if (modelOpen) return;
      if (event.key === "Escape" && sheetOpen) {
        setSheetOpen(false);
        return;
      }
      if (sheetOpen) return;
      const key = event.key.toLowerCase();
      const meta = event.metaKey || event.ctrlKey;
      // Space is our temporary pan modifier, but it still has to activate a
      // focused button or link the way every other page does.
      const onControl = Boolean(target && target.closest("button, a, [role='button']"));

      if (meta && key === "z") {
        event.preventDefault();
        if (event.shiftKey) actionsRef.current.redo();
        else actionsRef.current.undo();
        return;
      }
      if (meta && key === "y") {
        event.preventDefault();
        actionsRef.current.redo();
        return;
      }
      if (event.code === "Space" && !meta && !event.altKey && !onControl) {
        event.preventDefault();
        setSpaceDown(true);
        return;
      }
      if (event.key === "\\") {
        setPeek(true);
        return;
      }
      if (meta || event.altKey) return;

      if (key === "w") setTool("wand");
      else if (key === "b") setTool("brush");
      else if (key === "e") setTool("eraser");
      else if (key === "h") setTool("pan");
      else if (key === "[") setBrushSize((current) => clamp(current - 6, 4, 140));
      else if (key === "]") setBrushSize((current) => clamp(current + 6, 4, 140));
      else if (key === "0") resetView();
      else if (key === "=" || key === "+") zoomBy(1.25);
      else if (key === "-") zoomBy(1 / 1.25);
      else if (key === "backspace" || key === "delete") {
        event.preventDefault();
        actionsRef.current.clear();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpaceDown(false);
      if (event.key === "\\") setPeek(false);
    };
    const onBlur = () => {
      setSpaceDown(false);
      setPeek(false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [modelOpen, sheetOpen]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom((current) => clamp(current * Math.exp(-event.deltaY * 0.0015), 0.35, 6));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!photo || !ready || event.button === 2) return;
    if (tool === "pan" || spaceDown || event.button === 1) {
      dragRef.current = { kind: "pan", startX: event.clientX, startY: event.clientY, panX: pan.x, panY: pan.y };
      setDragging("pan");
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    const point = toImage(event.clientX, event.clientY);

    if (tool === "wand") {
      const pixels = pixelsRef.current;
      if (!pixels) return;
      pushHistory();
      const changed = wandSelect(
        maskRef.current,
        pixels,
        doc.w,
        doc.h,
        point.x,
        point.y,
        tolerance,
        mode === "add" ? 255 : 0,
      );
      if (changed) {
        commitMask();
      } else {
        historyRef.current.pop();
        syncHistoryStats();
        toast("Nothing new to select here", { description: "Try a higher tolerance or use the brush." });
      }
      return;
    }

    if (tool === "brush" || tool === "eraser") {
      pushHistory();
      const antsCtx = antsRef.current?.getContext("2d");
      if (antsCtx) antsCtx.clearRect(0, 0, antsCtx.canvas.width, antsCtx.canvas.height);
      const value: 0 | 255 = tool === "eraser" || mode === "subtract" ? 0 : 255;
      const rect = paintSegment(
        maskRef.current,
        doc.w,
        doc.h,
        point.x,
        point.y,
        point.x,
        point.y,
        brushRadius,
        value,
      );
      if (rect) refreshMaskCanvas(rect);
      renderOverlay();
      dragRef.current = { kind: "paint", x: point.x, y: point.y };
      setDragging("paint");
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;

    if (drag.kind === "pan") {
      const limits = panLimits(zoom);
      setPan({
        x: clamp(drag.panX + (event.clientX - drag.startX), -limits.x, limits.x),
        y: clamp(drag.panY + (event.clientY - drag.startY), -limits.y, limits.y),
      });
      return;
    }

    const point = toImage(event.clientX, event.clientY);
    if (point.x === drag.x && point.y === drag.y) return;
    const value: 0 | 255 = tool === "eraser" || mode === "subtract" ? 0 : 255;
    const rect = paintSegment(
      maskRef.current,
      doc.w,
      doc.h,
      drag.x,
      drag.y,
      point.x,
      point.y,
      brushRadius,
      value,
    );
    if (rect) refreshMaskCanvas(rect);
    renderOverlay();
    dragRef.current = { kind: "paint", x: point.x, y: point.y };
  }

  function endPointer() {
    if (dragRef.current?.kind === "paint") commitMask();
    dragRef.current = null;
    setDragging(null);
  }

  const panelProps: MaskPanelProps = {
    tab,
    onTab: setTab,
    tool,
    onTool: setTool,
    mode,
    onMode: setMode,
    tolerance,
    onTolerance: setTolerance,
    brush: brushSize,
    onBrush: setBrushSize,
    feather,
    onFeather: setFeather,
    coverage: stats.coverage,
    hasMask: stats.has,
    showMask,
    onShowMask: setShowMask,
    onInvert: invertSelection,
    onClear: clearMask,
    onSaveMask: saveMaskPng,
    onModel: () => setModelOpen(true),
    onClose: () => setSheetOpen(false),
  };

  const cursorRadius = Math.max(4, brushSize / 2);
  const drawingTool = tool === "brush" || tool === "eraser";
  const panning = tool === "pan" || spaceDown || dragging === "pan";

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-lc-bg text-lc-fg">
      <Toaster
        theme="dark"
        position="bottom-center"
        offset={88}
        toastOptions={{
          style: {
            background: "var(--color-lc-raised)",
            border: "1px solid var(--color-lc-line)",
            color: "var(--color-lc-fg)",
          },
        }}
      />

      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-lc-line bg-lc-surface px-3 sm:gap-3 sm:px-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-lc-line bg-lc-raised text-lc-accent">
          <Aperture className="size-5" strokeWidth={1.7} aria-hidden="true" />
        </span>
        <div className="hidden leading-none sm:block">
          <span className="block text-sm font-extrabold tracking-tight text-lc-fg">lightcraft</span>
          <span className="mt-1 block text-[9px] font-bold tracking-[0.24em] text-lc-faint uppercase">studio</span>
        </div>

        <div className="mx-1 hidden h-6 w-px bg-lc-line sm:block" aria-hidden="true" />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-lc-fg">{doc.name}</span>
            <span className="size-1 shrink-0 rounded-full bg-lc-accent" aria-label="Unsaved edits" />
          </div>
          <p className="mt-0.5 hidden truncate text-xs text-lc-faint sm:block">
            {doc.kind} · {doc.w} × {doc.h}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setModelOpen(true)}
          className="lc-chip-btn shrink-0"
          aria-label="SAM 3 model settings"
        >
          <span className="size-1.5 rounded-full bg-lc-accent" aria-hidden="true" />
          <span className="font-semibold text-lc-fg">SAM 3</span>
          <span className="hidden text-lc-muted sm:inline">not installed</span>
        </button>

        <div className="hidden items-center gap-0.5 md:flex">
          <button
            type="button"
            className="lc-icon-btn"
            onClick={undo}
            disabled={stats.undo === 0}
            aria-label="Undo (Ctrl+Z)"
            title="Undo"
          >
            <Undo2 className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="lc-icon-btn"
            onClick={redo}
            disabled={stats.redo === 0}
            aria-label="Redo (Ctrl+Shift+Z)"
            title="Redo"
          >
            <Redo2 className="size-4" aria-hidden="true" />
          </button>
        </div>

        <button
          type="button"
          className="lc-icon-btn shrink-0"
          onClick={openPhoto}
          aria-label="Open a photo"
          title="Open a photo"
        >
          <ImagePlus className="size-4" aria-hidden="true" />
        </button>
        <button type="button" onClick={exportCutout} className="lc-btn lc-btn-primary shrink-0 px-3 sm:px-4">
          <Download className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">Export PNG</span>
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav
          className="hidden w-14 shrink-0 flex-col items-center gap-1 border-r border-lc-line bg-lc-surface py-3 lg:flex"
          aria-label="Canvas tools"
        >
          {TOOLS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="lc-tool"
              data-active={tool === item.id}
              onClick={() => setTool(item.id)}
              title={`${item.label} (${item.shortcut})`}
              aria-label={item.label}
              aria-pressed={tool === item.id}
            >
              <item.icon className="size-4.5" aria-hidden="true" />
            </button>
          ))}
          <div className="my-2 h-px w-7 bg-lc-line" aria-hidden="true" />
          <button type="button" className="lc-tool" onClick={() => zoomBy(1.25)} aria-label="Zoom in" title="Zoom in">
            <ZoomIn className="size-4.5" aria-hidden="true" />
          </button>
          <button type="button" className="lc-tool" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out" title="Zoom out">
            <ZoomOut className="size-4.5" aria-hidden="true" />
          </button>
          <button type="button" className="lc-tool" onClick={resetView} aria-label="Fit to screen" title="Fit (0)">
            <Maximize2 className="size-4.5" aria-hidden="true" />
          </button>
          <div className="mt-auto">
            <button
              type="button"
              className="lc-tool"
              data-active={modelOpen}
              onClick={() => setModelOpen(true)}
              aria-label="Model settings"
              title="Model settings"
            >
              <HardDriveDownload className="size-4.5" aria-hidden="true" />
            </button>
          </div>
        </nav>

        <main className="flex min-w-0 flex-1 flex-col">
          <div
            ref={stageRef}
            className={cn("lc-stage relative min-h-0 flex-1 overflow-hidden", panning ? "cursor-grab" : "")}
            onPointerMove={(event) => {
              // The brush ring is moved through the DOM directly: a React state
              // update on every pointer move re-renders the whole studio.
              const stage = stageRef.current;
              const ring = cursorRingRef.current;
              if (!stage || !ring) return;
              const stageRect = stage.getBoundingClientRect();
              const photoRect = baseRef.current?.getBoundingClientRect();
              const overPhoto = Boolean(
                photoRect &&
                  event.clientX >= photoRect.left &&
                  event.clientX <= photoRect.right &&
                  event.clientY >= photoRect.top &&
                  event.clientY <= photoRect.bottom,
              );
              ring.style.opacity = overPhoto ? "1" : "0";
              ring.style.transform = `translate(${event.clientX - stageRect.left - cursorRadius}px, ${
                event.clientY - stageRect.top - cursorRadius
              }px)`;
            }}
            onPointerLeave={() => {
              const ring = cursorRingRef.current;
              if (ring) ring.style.opacity = "0";
            }}
          >
            {photo ? (
              <div className="flex h-full w-full items-center justify-center">
                <div
                  className={cn(
                    "lc-frame relative touch-none bg-lc-bg select-none",
                    panning ? "cursor-grab" : drawingTool ? "cursor-none" : "cursor-crosshair",
                    dragging === "pan" ? "cursor-grabbing" : "",
                    dragging ? "" : "transition-transform duration-150 ease-out",
                  )}
                  style={{
                    width: doc.w * fit,
                    height: doc.h * fit,
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  }}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={endPointer}
                  onPointerCancel={endPointer}
                >
                  <canvas ref={baseRef} className="absolute inset-0 h-full w-full" />
                  <canvas ref={tintRef} className="pointer-events-none absolute inset-0 h-full w-full" />
                  <canvas ref={antsRef} className="pointer-events-none absolute inset-0 h-full w-full" />
                </div>
              </div>
            ) : loadError ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <ImagePlus className="size-6 text-lc-faint" aria-hidden="true" />
                <p className="text-sm font-semibold text-lc-fg">The sample photo didn&apos;t load</p>
                <p className="max-w-sm text-xs text-lc-muted">Open your own photo, or try the sample again.</p>
                <div className="flex gap-2">
                  <button type="button" className="lc-btn lc-btn-quiet min-h-9 px-3 text-xs" onClick={() => setAttempt((n) => n + 1)}>
                    Try again
                  </button>
                  <button type="button" className="lc-btn lc-btn-primary min-h-9 px-3 text-xs" onClick={openPhoto}>
                    Open a photo
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center">
                <div className="flex items-center gap-2 text-xs text-lc-faint">
                  <span className="size-2 animate-pulse rounded-full bg-lc-accent" aria-hidden="true" />
                  Loading the studio…
                </div>
              </div>
            )}

            {drawingTool ? (
              <div
                ref={cursorRingRef}
                className="pointer-events-none absolute top-0 left-0 rounded-full border border-lc-fg/90 opacity-0"
                style={{
                  width: cursorRadius * 2,
                  height: cursorRadius * 2,
                  boxShadow: "0 0 0 1px rgba(0,0,0,0.5)",
                }}
                aria-hidden="true"
              />
            ) : null}

            {photo ? (
              <div className="absolute top-3 right-3 flex items-center gap-0.5 rounded-lg border border-lc-line bg-lc-surface/90 p-1 shadow-lg backdrop-blur">
                <button type="button" className="lc-icon-btn size-7" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out">
                  <ZoomOut className="size-3.5" aria-hidden="true" />
                </button>
                <span className="min-w-11 text-center font-mono text-xs text-lc-muted">{Math.round(zoom * 100)}%</span>
                <button type="button" className="lc-icon-btn size-7" onClick={() => zoomBy(1.25)} aria-label="Zoom in">
                  <ZoomIn className="size-3.5" aria-hidden="true" />
                </button>
                <span className="mx-0.5 h-4 w-px bg-lc-line" aria-hidden="true" />
                <button type="button" className="lc-icon-btn size-7" onClick={resetView} aria-label="Fit to screen" title="Fit">
                  <Maximize2 className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            ) : null}

            {photo && !stats.has && tab === "manual" ? (
              <div className="pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-lc-line bg-lc-surface/90 px-3.5 py-2 text-xs text-lc-muted shadow-lg backdrop-blur lc-rise">
                <WandSparkles className="size-3.5 text-lc-accent" aria-hidden="true" />
                {tool === "wand"
                  ? "Click any surface to start a mask"
                  : drawingTool
                    ? "Paint on the photo to start a mask"
                    : "Pick the wand or brush to start a mask"}
              </div>
            ) : null}
          </div>

          <footer className="hidden h-8 shrink-0 items-center gap-3 border-t border-lc-line bg-lc-surface px-4 text-xs text-lc-faint sm:flex">
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-lc-ok" aria-hidden="true" />
              On-device · nothing uploaded
            </span>
            <span className="h-3 w-px bg-lc-line" aria-hidden="true" />
            <span>{stats.has ? `${stats.coverage.toFixed(1)}% selected` : "No selection"}</span>
            <span className="ml-auto hidden items-center gap-1.5 md:flex">
              <Scan className="size-3" aria-hidden="true" />
              Hold <kbd className="rounded border border-lc-line px-1 font-mono text-[10px]">\</kbd> to hide the mask
            </span>
            <span className="font-mono">
              {doc.w} × {doc.h}
            </span>
          </footer>
        </main>

        <aside className="hidden w-[336px] shrink-0 flex-col border-l border-lc-line bg-lc-surface lg:flex">
          <MaskPanel {...panelProps} />
        </aside>
      </div>

      <div className="flex h-16 shrink-0 items-center justify-around border-t border-lc-line bg-lc-surface px-2 lg:hidden">
        {TOOLS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="lc-tool size-11"
            data-active={tool === item.id}
            onClick={() => setTool(item.id)}
            aria-label={item.label}
            aria-pressed={tool === item.id}
          >
            <item.icon className="size-5" aria-hidden="true" />
          </button>
        ))}
        <button
          type="button"
          className="lc-tool size-11"
          onClick={() => setSheetOpen(true)}
          aria-label="Open masks panel"
        >
          <PanelRightOpen className="size-5" aria-hidden="true" />
        </button>
      </div>

      {sheetOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-lc-void/75 backdrop-blur-sm"
            onClick={() => setSheetOpen(false)}
            aria-label="Close masks panel"
          />
          <div className="lc-rise absolute inset-x-0 bottom-0 flex h-[min(84dvh,44rem)] flex-col overflow-hidden rounded-t-2xl border-t border-lc-line bg-lc-surface pb-[env(safe-area-inset-bottom)]">
            <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-lc-line-strong" aria-hidden="true" />
            <MaskPanel {...panelProps} onClose={() => setSheetOpen(false)} />
          </div>
        </div>
      ) : null}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          onFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      <ModelDialog open={modelOpen} onOpenChange={setModelOpen} />

      <p className="sr-only">{SAM3.name} model: {SAM3.size}, not installed. Object and Describe masks require it.</p>
    </div>
  );
}
