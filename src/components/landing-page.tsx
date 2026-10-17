import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, Cloud, Folder, Images, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { APP_NAME } from "@/lib/brand";
import { t } from "@/lib/i18n";
import { requestAccess } from "@/lib/api";
import type { Testimonial } from "@/lib/types";
import { Constellation } from "@/components/constellation";
import { Modal, Stars } from "@/components/ui";

const features = [
  { title: "landing.f1t", body: "landing.f1d" },
  { title: "landing.f2t", body: "landing.f2d" },
  { title: "landing.f3t", body: "landing.f3d" },
  { title: "landing.f4t", body: "landing.f4d" },
] as const;

function LogoMark() {
  const cut = Math.ceil(APP_NAME.length / 2);
  return (
    <span className="text-lg tracking-tight">
      <span className="font-light">{APP_NAME.slice(0, cut)}</span>
      <span className="font-extrabold text-accent">{APP_NAME.slice(cut)}</span>
    </span>
  );
}

function DiskMock() {
  const rows = ["IMG_2041.CR3", "IMG_2048.CR3", "selects_v3.zip", "notes.txt"];
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-soft text-left shadow-sm">
      <div className="flex items-center gap-2 border-b border-line bg-paper px-4 py-3 text-xs font-semibold text-muted">
        <Folder size={14} /> {t("landing.mockDisk")}
        <span className="ml-auto">{t("landing.mockShared")}</span>
      </div>
      {rows.map((row) => (
        <div key={row} className="flex items-center gap-3 border-b border-line px-4 py-3 text-sm last:border-0">
          <span className="grid size-8 place-items-center rounded-md bg-paper text-muted">
            <Images size={14} />
          </span>
          <span className="truncate">{row}</span>
        </div>
      ))}
    </div>
  );
}

function RoomMock() {
  return (
    <div className="overflow-hidden rounded-2xl bg-room p-4 text-left text-paper shadow-sm">
      <p className="text-[10px] tracking-[0.22em] text-white/60">POKÓJ DOSTAW</p>
      <p className="room-title mt-3 text-3xl leading-none font-semibold text-white uppercase" data-font="cormorant">
        Sesja
        <br />
        poranna
      </p>
      <div className="mt-4 grid grid-cols-3 gap-1">
        {["#c56a32", "#1d3e78", "#d7a15a", "#243044", "#8c3d2f", "#315c4a"].map((color) => (
          <div key={color} className="aspect-[4/5] rounded-md" style={{ background: `linear-gradient(160deg, ${color}, #0c1220)` }} />
        ))}
      </div>
    </div>
  );
}

export function LandingPage({ testimonials }: { testimonials: Testimonial[] }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const best = testimonials[0];
  const rest = testimonials.slice(1);
  const year = new Date().getFullYear();

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="sticky top-0 z-40 border-b border-line bg-paper/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
          <a href="#start" className="mr-auto">
            <LogoMark />
          </a>
          <a href="#funkcje" className="hidden text-sm font-semibold sm:inline">
            {t("nav.features")}
          </a>
          {testimonials.length > 0 ? (
            <a href="#opinie" className="hidden text-sm font-semibold sm:inline">
              {t("nav.reviews")}
            </a>
          ) : null}
          <Link to="/login" className="text-sm font-semibold">
            {t("nav.login")}
          </Link>
          <button type="button" className="btn btn-primary px-4 text-sm" onClick={() => setOpen(true)}>
            {t("nav.request")}
          </button>
        </div>
      </header>

      <main id="start">
        <section className="relative overflow-hidden">
          <Constellation />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-[radial-gradient(circle_at_center,rgba(47,111,235,0.18),transparent_68%)]" />
          <div className="relative mx-auto max-w-6xl px-4 pt-16 pb-24 md:pt-28">
            <div className="chip-float absolute top-16 left-6 hidden items-center gap-2 rounded-2xl bg-paper px-3 py-2 text-sm font-semibold shadow-[var(--shadow-float)] md:flex">
              <Cloud size={16} className="text-accent" /> {t("landing.chipSpace")}
            </div>
            <div className="chip-float absolute top-24 right-8 hidden items-center gap-2 rounded-2xl bg-paper px-3 py-2 text-sm font-semibold shadow-[var(--shadow-float)] md:flex" style={{ animationDelay: "1s" }}>
              <Images size={16} className="text-accent" /> {t("landing.chipRooms")}
            </div>
            <div className="chip-float absolute bottom-16 left-10 hidden items-center gap-2 rounded-2xl bg-paper px-3 py-2 text-sm font-semibold shadow-[var(--shadow-float)] lg:flex">
              <Folder size={16} className="text-accent" /> {t("landing.chipPortfolio")}
            </div>
            <div className="chip-float absolute right-12 bottom-20 hidden items-center gap-2 rounded-2xl bg-paper px-3 py-2 text-sm font-semibold shadow-[var(--shadow-float)] lg:flex">
              <ShieldCheck size={16} className="text-accent" /> {t("landing.chipApprovals")}
            </div>
            <div className="mx-auto max-w-3xl text-center">
              <h1 className="display-hero">{t("landing.h1")}</h1>
              <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted">{t("landing.lead")}</p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link to="/login" className="btn btn-primary w-full sm:w-auto">
                  {t("landing.ctaCreate")} <ArrowRight size={18} />
                </Link>
                <Link to="/login" className="btn btn-ghost w-full sm:w-auto">
                  {t("landing.ctaLogin")}
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-20">
          <h2 className="mx-auto max-w-3xl text-center text-4xl font-extrabold tracking-tight md:text-5xl">
            {t("landing.compareTitle")}
          </h2>
          <div className="mt-12 grid gap-8 md:grid-cols-2">
            <div>
              <p className="mb-4 inline-flex rounded-full bg-soft px-3 py-1 text-xs font-bold tracking-[0.16em] text-muted">
                {t("landing.disk")}
              </p>
              <DiskMock />
              <ul className="mt-5 divide-y divide-line text-sm">
                {[t("landing.bad1"), t("landing.bad2"), t("landing.bad3")].map((item) => (
                  <li key={item} className="flex gap-3 py-3 text-muted">
                    <X className="mt-0.5 shrink-0 text-muted" size={16} aria-hidden="true" /> {item}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-4 inline-flex rounded-full bg-accent px-3 py-1 text-xs font-bold tracking-[0.16em] text-accent-ink">
                {t("landing.room")}
              </p>
              <RoomMock />
              <ul className="mt-5 divide-y divide-line text-sm">
                {[t("landing.good1"), t("landing.good2"), t("landing.good3")].map((item) => (
                  <li key={item} className="flex gap-3 py-3">
                    <Check className="mt-0.5 shrink-0 text-accent" size={16} aria-hidden="true" /> {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section id="funkcje" className="mx-auto grid max-w-6xl gap-4 px-4 pb-20 sm:grid-cols-2">
          {features.map((feature) => (
            <article key={feature.title} className="card p-6">
              <h3 className="text-xl font-extrabold">{t(feature.title)}</h3>
              <p className="mt-2 leading-relaxed text-muted">{t(feature.body)}</p>
            </article>
          ))}
        </section>

        {best ? (
          <section id="opinie" className="mx-auto max-w-5xl px-4 pb-20 text-center">
            <p className="text-xs font-bold tracking-[0.22em] text-muted">{t("landing.reviewsLabel")}</p>
            <div className="mt-4 flex justify-center">
              <Stars value={best.rating} size={22} />
            </div>
            <blockquote className="mx-auto mt-6 max-w-3xl text-3xl font-extrabold tracking-tight md:text-4xl">
              “{best.body}”
            </blockquote>
            <p className="mt-6 text-sm font-bold tracking-[0.16em] uppercase">{best.authorName}</p>
            {best.authorRole ? <p className="text-sm text-muted">{best.authorRole}</p> : null}
            {rest.length > 0 ? (
              <>
                <div className="mx-auto my-10 h-px max-w-xs bg-line" />
                <div className="grid gap-4 text-left md:grid-cols-3">
                  {rest.map((item) => (
                    <article key={item.id} className="card p-5">
                      <Stars value={item.rating} />
                      <p className="mt-3 text-sm leading-relaxed">“{item.body}”</p>
                      <p className="mt-4 text-xs font-bold tracking-wider uppercase">{item.authorName}</p>
                      {item.authorRole ? <p className="text-xs text-muted">{item.authorRole}</p> : null}
                    </article>
                  ))}
                </div>
              </>
            ) : null}
          </section>
        ) : null}

        <section className="px-4 pb-16">
          <div className="mx-auto max-w-6xl rounded-[2rem] bg-ink px-6 py-16 text-center text-paper md:px-16">
            <h2 className="text-4xl font-extrabold tracking-tight md:text-5xl">{t("landing.ctaEnd")}</h2>
            <Link to="/login" className="btn btn-primary mt-8">
              {t("landing.ctaEndBtn")}
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line px-4 py-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>{t("landing.footer", { rok: year })}</p>
          <div className="flex gap-4">
            <Link to="/polityka">{t("landing.privacy")}</Link>
            <Link to="/regulamin">{t("landing.terms")}</Link>
          </div>
        </div>
      </footer>

      <Modal open={open} title={t("landing.requestTitle")} onClose={() => setOpen(false)}>
        {sent ? (
          <p>{t("landing.requestDone")}</p>
        ) : (
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                await requestAccess({ data: { email, company } });
                setSent(true);
              } catch {
                toast.error(t("app.errGeneric"));
              }
            }}
          >
            <p className="text-sm text-muted">{t("landing.requestLead")}</p>
            <label className="block text-sm font-semibold">
              {t("landing.email")}
              <input className="field mt-1" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <input className="hidden" tabIndex={-1} autoComplete="off" value={company} onChange={(event) => setCompany(event.target.value)} aria-hidden="true" />
            <button className="btn btn-primary w-full" type="submit">
              {t("landing.sendRequest")}
            </button>
          </form>
        )}
      </Modal>
    </div>
  );
}
