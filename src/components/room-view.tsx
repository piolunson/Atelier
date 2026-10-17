import { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Clock, Download, FileText, MessageCircle, Music, Play, X } from "lucide-react";
import { toast } from "sonner";
import {
  addClientComment,
  addTestimonial,
  getDownloadTicket,
  getFilePreview,
  getPublicRoom,
  getPublicStatus,
  getZipTicket,
  listFileComments,
  recordOpen,
  setFileReview,
  unlockRoom,
} from "@/lib/api";
import { t } from "@/lib/i18n";
import { formatDuration, formatRelative } from "@/lib/format";
import type { Comment, PublicFile, PublicRoomOk, ReviewStatus } from "@/lib/types";
import { cn } from "@/lib/cn";
import { RoomBackdrop } from "@/components/room-bits";
import { Modal, Stars } from "@/components/ui";

const TOKEN = (slug: string) => `atelier-token-${slug}`;
const NAME = "atelier-name";
const COOKIE = "atelier-cookie-ok";

function iconFor(kind: string) {
  if (kind === "pdf") return FileText;
  if (kind === "audio") return Music;
  return FileText;
}

export function ClientRoom({ slug }: { slug: string }) {
  const [room, setRoom] = useState<PublicRoomOk | null>(null);
  const [state, setState] = useState<"loading" | "missing" | "expired" | "disabled" | "locked" | "ok" | "error">("loading");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [local, setLocal] = useState<Record<string, ReviewStatus>>({});
  const [active, setActive] = useState<number | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [comment, setComment] = useState("");
  const [nameOpen, setNameOpen] = useState(false);
  const [name, setName] = useState("");
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [preview, setPreview] = useState<{ preview: string | null; media: string | null; mime: string; kind: string } | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [reviewBody, setReviewBody] = useState("");
  const [role, setRole] = useState("");
  const [consent, setConsent] = useState(false);
  const [cookieOk, setCookieOk] = useState(true);
  const [zipNote, setZipNote] = useState("");
  const [zipUrls, setZipUrls] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function load(nextToken: string | null) {
    try {
      const result = await getPublicRoom({ data: { slug, token: nextToken } });
      if (result.state !== "ok") {
        setState(result.state);
        setRoom(null);
        return;
      }
      setRoom(result);
      setState("ok");
      const seen = sessionStorage.getItem(`opened-${slug}`);
      if (!seen) {
        sessionStorage.setItem(`opened-${slug}`, "1");
        const stored = localStorage.getItem(NAME) || "";
        void recordOpen({ data: { slug, token: nextToken, name: stored } });
      }
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    const stored = sessionStorage.getItem(TOKEN(slug));
    setToken(stored);
    setCookieOk(localStorage.getItem(COOKIE) === "1");
    setName(localStorage.getItem(NAME) || "");
    void load(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => {
    if (state !== "ok") return;
    const timer = window.setInterval(async () => {
      const status = await getPublicStatus({ data: { slug, token } }).catch(() => null);
      if (!status || status.state !== "ok" || !("files" in status)) {
        if (status && status.state !== "ok") setState(status.state);
        return;
      }
      setRoom((current) => {
        if (!current) return current;
        return {
          ...current,
          files: current.files.map((file) => {
            const next = status.files.find((item) => item.id === file.id);
            return next ? { ...file, status: next.status, commentCount: next.commentCount } : file;
          }),
        };
      });
    }, 4000);
    return () => window.clearInterval(timer);
  }, [state, slug, token]);

  const files = room?.files ?? [];
  const approved = files.filter((file) => (local[file.id] ?? file.status) === "approved").length;

  function withName(action: () => void) {
    const stored = localStorage.getItem(NAME);
    if (stored) {
      action();
      return;
    }
    setPendingAction(() => action);
    setNameOpen(true);
  }

  async function review(file: PublicFile, status: ReviewStatus) {
    const previous = local[file.id] ?? file.status;
    setLocal((prev) => ({ ...prev, [file.id]: status }));
    try {
      await setFileReview({ data: { slug, token, fileId: file.id, status, name: localStorage.getItem(NAME) || "" } });
      toast.success(status === "approved" ? t("room.accepted") : t("room.changesSent"));
      if (status === "approved") {
        const nextApproved = files.filter((item) => (item.id === file.id ? status : local[item.id] ?? item.status) === "approved").length;
        if (nextApproved === files.length) maybeAskReview();
      }
    } catch (error) {
      setLocal((prev) => ({ ...prev, [file.id]: previous }));
      toast.error(error instanceof Error ? error.message : t("app.errGeneric"));
    }
  }

  function maybeAskReview() {
    if (localStorage.getItem(`review-${slug}`)) return;
    setReviewOpen(true);
  }

  async function openFile(index: number) {
    setActive(index);
    const file = files[index];
    if (!file) return;
    const data = await getFilePreview({ data: { slug, token, fileId: file.id } });
    setPreview(data);
    setComments(await listFileComments({ data: { slug, token, fileId: file.id } }));
  }

  useEffect(() => {
    if (active == null) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (event.key === "Escape") setActive(null);
      if (event.key === "ArrowRight") void openFile(Math.min(files.length - 1, active + 1));
      if (event.key === "ArrowLeft") void openFile(Math.max(0, active - 1));
      if (event.key.toLowerCase() === "a" && files[active]) withName(() => void review(files[active]!, "approved"));
      if (event.key.toLowerCase() === "x" && files[active]) withName(() => void review(files[active]!, "changes_requested"));
      if (event.key.toLowerCase() === "c") document.getElementById("room-comment")?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, files, token]);

  const activeFile = active != null ? files[active] : null;
  const light = room?.brand.theme === "light";

  const delivered = useMemo(() => {
    if (!room) return "";
    const names = [room.ownerName, ...room.coCreators.map((person) => person.name)].filter(Boolean);
    if (names.length === 0) return "";
    if (names.length === 1) return t("room.delivered", { tworca: names[0]! });
    return `${t("room.delivered", { tworca: names[0]! })} ${t("room.and")} ${names.slice(1).join(", ")}`;
  }, [room]);

  if (state === "loading") {
    return <div className="grid min-h-screen place-items-center text-paper">{t("app.loading")}</div>;
  }
  if (state === "error") {
    return (
      <main className="grid min-h-screen place-items-center px-6 text-center text-paper">
        <div>
          <p>{t("room.net")}</p>
          <button type="button" className="btn btn-primary mt-4" onClick={() => void load(token)}>{t("room.retry")}</button>
        </div>
      </main>
    );
  }
  if (state === "expired" || state === "disabled" || state === "missing") {
    return (
      <main className="grid min-h-screen place-items-center bg-room px-6 text-center text-paper">
        <div className="max-w-md">
          <h1 className="text-4xl font-semibold" style={{ fontFamily: "var(--font-serif)" }}>
            {state === "expired" ? t("room.expired") : state === "disabled" ? t("room.disabled") : t("system.notFound")}
          </h1>
          <p className="mt-3 text-white/70">{state === "expired" ? t("room.expiredHint") : t("system.notFoundBody")}</p>
        </div>
      </main>
    );
  }
  if (state === "locked" || !room) {
    return (
      <main className="grid min-h-screen place-items-center bg-room px-6 text-paper">
        <form
          className="w-full max-w-sm space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              const result = await unlockRoom({ data: { slug, password } });
              sessionStorage.setItem(TOKEN(slug), result.token);
              setToken(result.token);
              await load(result.token);
            } catch {
              toast.error(t("room.badPassword"));
            }
          }}
        >
          <h1 className="text-3xl font-semibold" style={{ fontFamily: "var(--font-serif)" }}>{t("room.locked")}</h1>
          <label className="block text-sm">{t("room.password")}
            <input className="field mt-1 text-ink" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <button className="btn btn-primary w-full" type="submit">{t("room.unlock")}</button>
        </form>
      </main>
    );
  }

  return (
    <div className={cn("min-h-screen", light ? "text-ink" : "text-paper")} style={{ ["--room-accent" as string]: room.brand.accentColor }}>
      <RoomBackdrop brand={room.brand} />
      <header className="sticky top-0 z-20 flex h-10 items-center justify-between bg-black/35 px-3 text-paper backdrop-blur">
        <div className="flex items-center gap-2">
          {room.ownerAvatar ? (
            <img src={room.ownerAvatar} alt="" className="size-6 rounded-full object-cover" />
          ) : (
            <span className="grid size-6 place-items-center rounded-full bg-white/20 text-[10px] font-bold">{room.ownerName.slice(0, 1)}</span>
          )}
          <span>
            <span className="block text-xs leading-none font-bold">{room.ownerName}</span>
            <span className="text-[9px] tracking-[0.18em] text-white/60">{t("room.kicker")}</span>
          </span>
        </div>
        {room.hidePoweredBy ? null : <span className="text-[10px] text-white/60">{t("room.powered")}</span>}
      </header>

      <main className="mx-auto max-w-5xl px-4 pt-10 pb-28">
        <section className="grid items-end gap-8 md:grid-cols-2">
          <div className="order-2 md:order-1">
            {room.clientName ? <p className="text-sm text-white/80">{t("room.prepared", { Klient: room.clientName })}</p> : null}
            {delivered ? (
              <p className="mt-2 text-sm">
                {delivered.split(room.ownerName).map((part, index) => (
                  <span key={index}>
                    {index > 0 ? <span className="underline">{room.ownerName}</span> : null}
                    {part}
                  </span>
                ))}
                <span className="ml-1 inline-grid size-4 place-items-center rounded-full bg-accent text-[10px] text-accent-ink" aria-label={room.ownerName}>✓</span>
              </p>
            ) : null}
            <h1 className="room-title mt-4 text-5xl leading-[0.9] font-semibold text-white uppercase md:text-7xl" data-font={room.brand.fontKey}>
              {room.title}
            </h1>
            {room.allowZip ? (
              <button
                type="button"
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-black px-4 py-3 text-sm font-semibold text-white md:w-auto"
                onClick={async () => {
                  setBusy(true);
                  setZipNote(t("room.zipWait"));
                  try {
                    const ticket = await getZipTicket({ data: { slug, token } });
                    if (ticket.empty) {
                      toast.error(t("room.noOriginal"));
                      setZipNote("");
                    } else {
                      setZipUrls(ticket.urls);
                      setZipNote(ticket.parts > 1 ? t("room.zipParts", { n: ticket.parts }) : "");
                      if (ticket.urls[0]) window.location.href = ticket.urls[0];
                      maybeAskReview();
                    }
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : t("app.errGeneric"));
                  } finally {
                    setBusy(false);
                  }
                }}
                disabled={busy}
              >
                <Download size={16} /> {t("room.downloadAll", { n: files.length })}
              </button>
            ) : null}
            {zipNote ? <p className="mt-2 text-sm">{zipNote}</p> : null}
            {zipUrls.length > 1 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {zipUrls.map((url, index) => (
                  <a key={url} className="rounded-full border border-white/30 px-3 py-2 text-xs" href={url}>
                    {t("room.downloadPart", { n: index + 1 })}
                  </a>
                ))}
              </div>
            ) : null}
          </div>
          <div className="order-1 md:order-2">
            <div className="mx-auto aspect-[4/5] max-w-md overflow-hidden rounded-xl shadow-2xl">
              {room.coverPreview ? <img src={room.coverPreview} alt="" className="h-full w-full object-cover" /> : <div className="h-full w-full bg-white/10" />}
            </div>
          </div>
        </section>

        <section className="mt-14">
          <h2 className="text-sm font-semibold">
            {t("room.materials")} <span style={{ color: room.brand.accentColor }}>{files.length}</span>
          </h2>
          {files.length === 0 ? <p className="mt-4">{t("room.empty")}</p> : null}
          <div className={cn("mt-3", room.brand.layout === "masonry" ? "masonry" : "grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-4")}>
            {files.map((file, index) => {
              const status = local[file.id] ?? file.status;
              const Icon = iconFor(file.kind);
              return (
                <article key={file.id} className={cn("group relative overflow-hidden bg-black/40", room.brand.layout === "grid" && "aspect-[4/5]")}>
                  <button type="button" className="block h-full w-full text-left" onClick={() => void openFile(index)}>
                    {file.thumb ? (
                      <img src={file.thumb} alt={file.name} className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <span className="grid min-h-40 place-items-center gap-2 p-4 text-center text-xs">
                        <Icon />
                        {file.name.split(".").pop()?.toUpperCase()}
                      </span>
                    )}
                    {file.kind === "video" ? (
                      <span className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[11px]">
                        <Play size={12} /> {formatDuration(file.duration)}
                      </span>
                    ) : null}
                  </button>
                  <span className={cn("tile-ribbon", status === "approved" && "bg-ok", status === "changes_requested" && "bg-danger", status === "pending" && "bg-wait")} aria-label={status === "approved" ? t("room.ribbonOk") : status === "changes_requested" ? t("room.ribbonFix") : t("room.ribbonWait")}>
                    {status === "approved" ? <Check className="absolute top-1 right-1" size={12} /> : status === "changes_requested" ? <X className="absolute top-1 right-1" size={12} /> : <Clock className="absolute top-1 right-1" size={12} />}
                  </span>
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                    <div className="pointer-events-auto flex items-end gap-1">
                      <p className="min-w-0 flex-1 truncate text-[11px] font-bold">{file.name}</p>
                      <button type="button" aria-label={t("room.askChanges")} title={t("room.askChanges")} className={cn("grid size-8 place-items-center rounded-full border border-white/80", status === "changes_requested" && "bg-danger")} onClick={() => withName(() => void review(file, "changes_requested"))}>
                        <X size={14} />
                      </button>
                      <button type="button" aria-label={t("room.accept")} title={t("room.accept")} className={cn("grid size-8 place-items-center rounded-full border border-white/80", status === "approved" && "bg-ok")} onClick={() => withName(() => void review(file, "approved"))}>
                        <Check size={14} />
                      </button>
                      <button type="button" aria-label={t("room.comment")} title={t("room.comment")} className="relative grid size-8 place-items-center rounded-full border border-white/80" style={file.commentCount ? { background: room.brand.accentColor } : undefined} onClick={() => withName(() => void openFile(index))}>
                        <MessageCircle size={14} />
                        {file.commentCount ? <span className="absolute -top-1 -right-1 text-[9px]">{file.commentCount}</span> : null}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
        <p className="mt-10 text-center text-xs tracking-wide text-white/60">{t("room.footer")}</p>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-3 bg-black/70 px-4 py-3 text-sm text-paper backdrop-blur">
        <p>{t("room.progress", { n: approved, m: files.length })}</p>
        <button type="button" className="btn btn-primary" onClick={() => setConfirmAll(true)}>{t("room.approveAll")}</button>
      </div>

      {activeFile ? (
        <div className="fixed inset-0 z-40 grid bg-black/90 text-paper md:grid-cols-[1fr_320px]" role="dialog" aria-modal="true" aria-label={activeFile.name}
          onTouchStart={(event) => {
            (event.currentTarget as HTMLElement).dataset.x = String(event.changedTouches[0]?.clientX ?? 0);
          }}
          onTouchEnd={(event) => {
            const start = Number((event.currentTarget as HTMLElement).dataset.x || 0);
            const dx = (event.changedTouches[0]?.clientX ?? 0) - start;
            if (dx > 40 && active != null) void openFile(Math.max(0, active - 1));
            if (dx < -40 && active != null) void openFile(Math.min(files.length - 1, active + 1));
          }}
        >
          <div className="relative grid place-items-center p-4">
            <button type="button" className="absolute top-3 right-3 rounded-full border border-white/30 px-3 py-2 md:hidden" onClick={() => setActive(null)}>{t("room.close")}</button>
            <button type="button" aria-label={t("room.prev")} className="absolute left-3 grid size-11 place-items-center rounded-full border border-white/30" onClick={() => active != null && void openFile(Math.max(0, active - 1))}><ChevronLeft /></button>
            {preview?.kind === "video" && preview.media ? (
              <video src={preview.media} poster={preview.preview ?? undefined} controls className="max-h-[80vh] max-w-full" />
            ) : preview?.kind === "audio" && preview.media ? (
              <audio src={preview.media} controls />
            ) : preview?.kind === "pdf" && preview.media ? (
              <iframe title={activeFile.name} src={preview.media} className="h-[80vh] w-full bg-paper" />
            ) : preview?.preview || activeFile.thumb ? (
              <img src={preview?.preview || activeFile.thumb || ""} alt={activeFile.name} className="max-h-[80vh] max-w-full object-contain" />
            ) : (
              <p>{t("room.noPreview")}</p>
            )}
            <button type="button" aria-label={t("room.next")} className="absolute right-3 grid size-11 place-items-center rounded-full border border-white/30" onClick={() => active != null && void openFile(Math.min(files.length - 1, active + 1))}><ChevronRight /></button>
            <div className="absolute bottom-4 flex gap-2">
              {room.allowDownload ? (
                <button type="button" className="btn btn-ghost text-ink" onClick={async () => {
                  try {
                    const ticket = await getDownloadTicket({ data: { slug, token, fileId: activeFile.id } });
                    window.location.href = ticket.url;
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : t("room.noOriginal"));
                  }
                }}>{t("room.download")}</button>
              ) : null}
              <button type="button" className="btn bg-ok text-paper" onClick={() => withName(() => void review(activeFile, "approved"))}>{t("room.accept")}</button>
              <button type="button" className="btn bg-danger text-paper" onClick={() => withName(() => void review(activeFile, "changes_requested"))}>{t("room.askChanges")}</button>
            </div>
          </div>
          <aside className="flex max-h-[40vh] flex-col border-t border-white/10 bg-black/70 p-4 md:max-h-none md:border-t-0 md:border-l">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">{t("room.comment")}</h2>
              <button type="button" className="hidden md:inline" onClick={() => setActive(null)} aria-label={t("room.close")}>×</button>
            </div>
            <div className="flex-1 space-y-3 overflow-auto">
              {comments.length === 0 ? <p className="text-sm text-white/60">{t("room.noComments")}</p> : null}
              {comments.map((item) => (
                <article key={item.id}>
                  <p className="text-xs text-white/60">{item.authorName} · {formatRelative(item.createdAt)}</p>
                  <p className="text-sm whitespace-pre-wrap">{item.body}</p>
                </article>
              ))}
            </div>
            <form className="mt-3 space-y-2" onSubmit={(event) => {
              event.preventDefault();
              withName(async () => {
                const body = comment;
                setComment("");
                const optimistic: Comment = { id: `tmp-${Date.now()}`, authorType: "client", authorName: localStorage.getItem(NAME) || "", body, createdAt: new Date().toISOString() };
                setComments((prev) => [...prev, optimistic]);
                try {
                  const saved = await addClientComment({ data: { slug, token, fileId: activeFile.id, name: localStorage.getItem(NAME) || "", body } });
                  setComments((prev) => prev.map((item) => (item.id === optimistic.id ? saved : item)));
                  toast.success(t("room.thanks", { Nadawca: room.ownerName }));
                } catch {
                  setComments((prev) => prev.filter((item) => item.id !== optimistic.id));
                  toast.error(t("app.errGeneric"));
                }
              });
            }}>
              <label className="sr-only" htmlFor="room-comment">{t("room.commentPh")}</label>
              <textarea id="room-comment" className="field text-ink" placeholder={t("room.commentPh")} value={comment} onChange={(event) => setComment(event.target.value)} />
              <button className="btn btn-primary w-full" type="submit">{t("room.send")}</button>
            </form>
          </aside>
        </div>
      ) : null}

      <Modal open={nameOpen} title={t("room.nameAsk")} onClose={() => setNameOpen(false)}>
        <form className="space-y-3 text-ink" onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          localStorage.setItem(NAME, name.trim());
          setNameOpen(false);
          pendingAction?.();
          setPendingAction(null);
        }}>
          <p className="text-sm text-muted">{t("room.nameHint")}</p>
          <input className="field" value={name} onChange={(event) => setName(event.target.value)} />
          <button className="btn btn-primary w-full" type="submit">{t("room.continue")}</button>
        </form>
      </Modal>

      <Modal open={confirmAll} title={t("room.approveAll")} onClose={() => setConfirmAll(false)}>
        <div className="space-y-4 text-ink">
          <p className="text-sm">{t("room.approveAllAsk")}</p>
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmAll(false)}>{t("app.cancel")}</button>
            <button type="button" className="btn btn-primary" onClick={() => withName(async () => {
              setConfirmAll(false);
              for (const file of files) await review(file, "approved");
            })}>{t("room.approveAll")}</button>
          </div>
        </div>
      </Modal>

      <Modal open={reviewOpen} title={t("review.title")} onClose={() => { localStorage.setItem(`review-${slug}`, "1"); setReviewOpen(false); }}>
        <form className="space-y-3 text-ink" onSubmit={async (event) => {
          event.preventDefault();
          if (!rating) {
            toast.error(t("review.pick"));
            return;
          }
          await addTestimonial({ data: { slug, token, rating, body: reviewBody, authorName: name || localStorage.getItem(NAME) || "", authorRole: role, consent } });
          localStorage.setItem(`review-${slug}`, "1");
          setReviewOpen(false);
          toast.success(t("review.thanks"));
        }}>
          <p className="text-sm text-muted">{t("review.lead")}</p>
          <div className="flex gap-1">
            {Array.from({ length: 5 }, (_, index) => (
              <button key={index} type="button" aria-label={t("review.stars", { n: index + 1 })} onClick={() => setRating(index + 1)}>
                <Stars value={rating > index ? index + 1 : 0} />
              </button>
            ))}
          </div>
          <input className="field" placeholder={t("review.name")} value={name} onChange={(event) => setName(event.target.value)} />
          <input className="field" placeholder={t("review.role")} value={role} onChange={(event) => setRole(event.target.value)} />
          <textarea className="field min-h-24" placeholder={t("review.body")} value={reviewBody} onChange={(event) => setReviewBody(event.target.value)} />
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> {t("review.consent")}</label>
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => { localStorage.setItem(`review-${slug}`, "1"); setReviewOpen(false); }}>{t("review.skip")}</button>
            <button className="btn btn-primary" type="submit">{t("review.send")}</button>
          </div>
        </form>
      </Modal>

      {!cookieOk ? (
        <div className="fixed right-3 bottom-20 left-3 z-30 rounded-2xl bg-paper p-4 text-sm text-ink shadow-xl md:left-auto md:max-w-sm">
          <p>{t("room.cookies")}</p>
          <button type="button" className="btn btn-primary mt-3" onClick={() => { localStorage.setItem(COOKIE, "1"); setCookieOk(true); }}>{t("room.cookiesOk")}</button>
        </div>
      ) : null}
    </div>
  );
}
