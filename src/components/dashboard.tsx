import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { createDraft, listRooms } from "@/lib/api";
import { t } from "@/lib/i18n";
import { formatBytes, formatWhen } from "@/lib/format";
import type { RoomCard } from "@/lib/types";
import { Skeleton } from "@/components/ui";

function badge(room: RoomCard): { label: string; className: string } {
  if (room.status === "draft") return { label: t("app.draft"), className: "bg-soft text-muted" };
  if (room.status === "disabled") return { label: t("app.disabled"), className: "bg-soft text-danger" };
  if (room.expiresAt && new Date(room.expiresAt).getTime() < Date.now()) {
    return { label: t("app.expired"), className: "bg-soft text-muted" };
  }
  if (room.reviewState === "approved") return { label: t("app.approved"), className: "bg-ok/10 text-ok" };
  if (room.reviewState === "changes") return { label: t("app.changes"), className: "bg-danger/10 text-danger" };
  return { label: t("app.waiting"), className: "bg-wait/15 text-ink" };
}

export function Dashboard() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [creating, setCreating] = useState(false);
  const rooms = useQuery({ queryKey: ["rooms"], queryFn: () => listRooms() });

  const filtered = useMemo(() => {
    return (rooms.data ?? []).filter((room) => {
      const hay = `${room.title} ${room.clientName}`.toLowerCase();
      if (query && !hay.includes(query.toLowerCase())) return false;
      const label = badge(room).label;
      if (filter === "all") return true;
      return label === filter;
    });
  }, [rooms.data, query, filter]);

  async function start() {
    setCreating(true);
    try {
      const draft = await createDraft();
      await navigate({ to: "/app/nowa", search: { draft: draft.id } });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">{t("app.title")}</h1>
        </div>
        <button type="button" className="btn btn-primary" onClick={start} disabled={creating}>
          {t("app.new")}
        </button>
      </div>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <input className="field" placeholder={t("app.search")} value={query} onChange={(event) => setQuery(event.target.value)} />
        <select className="field sm:max-w-52" value={filter} onChange={(event) => setFilter(event.target.value)} aria-label={t("admin.status")}>
          <option value="all">{t("app.all")}</option>
          {[t("app.draft"), t("app.active"), t("app.waiting"), t("app.changes"), t("app.approved"), t("app.expired"), t("app.disabled")].map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
      </div>
      {rooms.isLoading ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      ) : null}
      {rooms.data && rooms.data.length === 0 ? (
        <div className="card mt-8 p-8 text-center">
          <h2 className="text-xl font-extrabold">{t("app.emptyTitle")}</h2>
          <p className="mx-auto mt-2 max-w-md text-muted">{t("app.emptyBody")}</p>
          <button type="button" className="btn btn-primary mt-6" onClick={start}>
            {t("app.emptyCta")}
          </button>
        </div>
      ) : null}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {filtered.map((room) => {
          const pill = badge(room);
          const total = room.fileCount || 1;
          const pct = Math.round((room.approvedCount / total) * 100);
          const href = room.status === "draft" ? `/app/nowa?draft=${room.id}` : `/app/pokoj/${room.id}`;
          return (
            <Link key={room.id} to={href} className="card overflow-hidden text-left">
              <div className="aspect-[16/9] bg-soft">
                {room.coverThumb ? <img src={room.coverThumb} alt="" className="h-full w-full object-cover" /> : null}
              </div>
              <div className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-extrabold">{room.title || t("app.draft")}</h2>
                    <p className="text-sm text-muted">{room.clientName}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs font-bold ${pill.className}`}>{pill.label}</span>
                </div>
                <p className="text-sm text-muted">
                  {room.fileCount} · {formatBytes(room.totalBytes)} · {formatWhen(room.updatedAt)}
                  {room.opened ? ` · ${t("app.opened")}` : ""}
                </p>
                <div className="h-1.5 overflow-hidden rounded-full bg-soft" aria-hidden="true">
                  <div className="h-full bg-ok" style={{ width: `${room.fileCount ? pct : 0}%` }} />
                </div>
                <p className="text-xs text-muted">{t("room.progress", { n: room.approvedCount, m: room.fileCount })}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
