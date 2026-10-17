import { APP_NAME } from "@/lib/brand";
import { t } from "@/lib/i18n";
import type { Brand, DraftRoom } from "@/lib/types";
import { cn } from "@/lib/cn";

export const PRESET_STYLE: Record<string, string> = {
  ember:
    "radial-gradient(circle at 18% 18%, rgba(224,122,61,.95), transparent 42%), radial-gradient(circle at 82% 8%, rgba(36,64,120,.9), transparent 46%), linear-gradient(165deg, #0c1220, #1a120c 72%, #07080d)",
  dusk:
    "radial-gradient(circle at 20% 20%, rgba(120,86,196,.8), transparent 40%), radial-gradient(circle at 80% 30%, rgba(224,122,61,.45), transparent 42%), linear-gradient(180deg, #120e1c, #07060d)",
  ocean:
    "radial-gradient(circle at 30% 20%, rgba(47,111,235,.8), transparent 42%), radial-gradient(circle at 80% 70%, rgba(20,90,110,.8), transparent 40%), linear-gradient(180deg, #071018, #0b1c2e)",
  forest:
    "radial-gradient(circle at 20% 30%, rgba(63,166,107,.7), transparent 42%), radial-gradient(circle at 80% 10%, rgba(180,140,60,.45), transparent 40%), linear-gradient(180deg, #0c1410, #07110c)",
  noir: "linear-gradient(180deg, #161616, #050505)",
  blush:
    "radial-gradient(circle at 20% 20%, rgba(214,120,140,.75), transparent 42%), radial-gradient(circle at 80% 80%, rgba(80,40,50,.7), transparent 40%), linear-gradient(180deg, #1a1014, #0c080a)",
  gold:
    "radial-gradient(circle at 30% 20%, rgba(224,160,48,.8), transparent 40%), radial-gradient(circle at 80% 70%, rgba(90,60,20,.7), transparent 42%), linear-gradient(180deg, #14110c, #0c0a07)",
  ink: "linear-gradient(160deg, #101828, #070b14 60%, #1a120c)",
};

export function backdropStyle(brand: Brand): { background: string; image?: string } {
  if (brand.backgroundType === "color") return { background: brand.backgroundValue };
  if (brand.backgroundType === "image") return { background: "#0c1220", image: brand.backgroundValue };
  return { background: PRESET_STYLE[brand.backgroundValue] || PRESET_STYLE.ember! };
}

export function RoomBackdrop({ brand }: { brand: Brand }) {
  const style = backdropStyle(brand);
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 bg-room" aria-hidden="true">
      {style.image ? (
        <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${style.image})` }} />
      ) : (
        <div className="room-mesh absolute -inset-[20%] blur-3xl" style={{ background: style.background }} />
      )}
      <div className={cn("absolute inset-0", brand.theme === "light" ? "bg-white/55" : "bg-black/45")} />
    </div>
  );
}

export function RoomPreview({ draft }: { draft: DraftRoom }) {
  const light = draft.brand.theme === "light";
  return (
    <div className={cn("relative min-h-[420px] overflow-hidden p-4", light ? "text-ink" : "text-paper")}>
      <div className="absolute inset-0" style={{ background: backdropStyle(draft.brand).background, backgroundImage: draft.brand.backgroundType === "image" ? `url(${draft.brand.backgroundValue})` : undefined, backgroundSize: "cover" }} />
      <div className={cn("absolute inset-0", light ? "bg-white/50" : "bg-black/40")} />
      <div className="relative">
        <p className="text-[10px] tracking-[0.2em] uppercase opacity-70">{t("room.kicker")}</p>
        {draft.clientName ? <p className="mt-6 text-xs opacity-80">{t("room.prepared", { Klient: draft.clientName })}</p> : null}
        <h2 className="room-title mt-2 text-4xl leading-none font-semibold uppercase" data-font={draft.brand.fontKey}>
          {draft.title || t("wizard.titlePh")}
        </h2>
        <div className="mt-4 grid grid-cols-3 gap-1">
          {draft.files.slice(0, 6).map((file) => (
            <div key={file.id} className="aspect-[4/5] overflow-hidden rounded-md bg-black/30">
              {file.thumb ? <img src={file.thumb} alt="" className="h-full w-full object-cover" /> : null}
            </div>
          ))}
        </div>
        {!draft.hidePoweredBy ? <p className="mt-4 text-[10px] opacity-60">{t("room.powered", { APP_NAME })}</p> : null}
      </div>
    </div>
  );
}
