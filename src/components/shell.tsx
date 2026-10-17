import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Images, Palette, Settings } from "lucide-react";
import { APP_NAME } from "@/lib/brand";
import { t } from "@/lib/i18n";
import { ensureSelf, listNotifications, markNotificationsRead } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/cn";
import { UserButton } from "@/lib/auth/gates";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { Skeleton } from "@/components/ui";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, isPending } = useCurrentUserState();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: ["me"],
    queryFn: () => ensureSelf(),
    enabled: Boolean(user) && !isPending,
  });
  const notes = useQuery({
    queryKey: ["notes"],
    queryFn: () => listNotifications(),
    enabled: Boolean(session.data && !session.data.blocked),
    refetchInterval: 8000,
  });
  const [openNotes, setOpenNotes] = useState(false);

  useEffect(() => {
    if (!session.data || session.data.blocked) return;
    if (session.data.profile.mustChangePassword && path !== "/app/haslo") {
      window.location.replace("/app/haslo");
    }
  }, [session.data, path]);

  if (isPending || session.isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <Skeleton className="h-12" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (!user) return <RedirectToSignIn />;
  if (!session.data || session.data.blocked) {
    return (
      <main className="grid min-h-screen place-items-center px-6 text-center">
        <div className="max-w-md space-y-4">
          <h1 className="text-2xl font-extrabold">{t("auth.noAccess")}</h1>
          <p className="text-muted">
            {session.data?.reason === "inactive" ? t("auth.blocked") : t("auth.noAccess")}
          </p>
          <UserButton />
        </div>
      </main>
    );
  }

  const profile = session.data.profile;
  const unread = (notes.data ?? []).filter((note) => !note.read).length;
  const links = [
    { to: "/app", label: t("nav.rooms"), icon: Images },
    { to: "/app/brand", label: t("nav.brand"), icon: Palette },
    { to: "/app/ustawienia", label: t("nav.settings"), icon: Settings },
  ] as const;

  return (
    <div className="min-h-screen bg-soft pb-24 md:pb-8">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <Link to="/app" className="mr-auto text-lg font-extrabold tracking-tight text-accent">
            {APP_NAME}
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {links.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={cn(
                  "rounded-full px-3 py-2 text-sm font-semibold",
                  path === link.to ? "bg-soft text-ink" : "text-muted",
                )}
              >
                {link.label}
              </Link>
            ))}
            {profile.role === "admin" ? (
              <Link to="/admin" className="rounded-full px-3 py-2 text-sm font-semibold text-accent">
                {t("nav.admin")}
              </Link>
            ) : null}
          </nav>
          <button
            type="button"
            className="relative grid size-11 place-items-center rounded-full border border-line"
            aria-label={t("app.notifications")}
            onClick={() => setOpenNotes((value) => !value)}
          >
            <Bell size={18} />
            {unread > 0 ? (
              <span className="absolute top-1 right-1 grid size-4 place-items-center rounded-full bg-accent text-[10px] text-accent-ink">
                {unread}
              </span>
            ) : null}
          </button>
        </div>
        {openNotes ? (
          <div className="mx-auto max-w-6xl px-4 pb-4">
            <div className="card max-h-80 overflow-auto p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-bold">{t("app.notifications")}</p>
                <button
                  type="button"
                  className="text-sm font-semibold text-accent"
                  onClick={async () => {
                    await markNotificationsRead();
                    await queryClient.invalidateQueries({ queryKey: ["notes"] });
                  }}
                >
                  {t("app.markRead")}
                </button>
              </div>
              {(notes.data ?? []).length === 0 ? <p className="text-sm text-muted">{t("app.noNotifs")}</p> : null}
              {(notes.data ?? []).map((note) => (
                <div key={note.id} className="border-t border-line py-2 text-sm">
                  <p className="font-semibold">{note.title}</p>
                  <p className="text-muted">{note.body}</p>
                  <p className="text-xs text-muted">{formatRelative(note.createdAt)}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </header>
      <div className="mx-auto max-w-6xl px-4 py-6">{children}</div>
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-line bg-paper md:hidden">
        {links.map((link) => {
          const Icon = link.icon;
          const active = path === link.to;
          return (
            <Link key={link.to} to={link.to} className={cn("grid min-h-14 place-items-center text-xs font-semibold", active ? "text-accent" : "text-muted")}>
              <span className="grid justify-items-center gap-1">
                <Icon size={18} />
                {link.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
