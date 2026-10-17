import { APP_NAME } from "@/lib/brand";
import { t } from "@/lib/i18n";

function esc(value: string): string {
  return value
    .replaceAll("&", "&")
    .replaceAll("<", "<")
    .replaceAll(">", ">")
    .replaceAll('"', """);
}

function shell(paragraphs: string[], cta?: { href: string; label: string }): string {
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:#1a1a1a">${p}</p>`)
    .join("");
  const button = cta
    ? `<p style="margin:24px 0 0"><a href="${esc(cta.href)}" style="display:inline-block;background:#2F6FEB;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:700">${esc(cta.label)}</a></p>`
    : "";
  return `<!doctype html><html lang="pl"><body style="margin:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px">
    <div style="background:#ffffff;border-radius:16px;padding:32px">
      <div style="font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:#2F6FEB;font-weight:700">${esc(APP_NAME)}</div>
      <div style="margin-top:18px">${body}${button}</div>
    </div>
  </div></body></html>`;
}

export function mailDelivery(input: {
  name: string;
  sender: string;
  title: string;
  message: string;
  until: string | null;
  url: string;
}) {
  const subject = t("email.deliverySubject", { Nadawca: input.sender, tytul: input.title });
  const lines = [
    t("email.deliveryHello", { imie: input.name || input.title }),
    t("email.deliveryBody", { Nadawca: input.sender, tytul: input.title }),
    input.message,
    input.until ? t("email.deliveryValid", { data: input.until }) : t("email.deliveryForever"),
  ].filter(Boolean);
  return {
    subject,
    text: `${lines.join("\n\n")}\n\n${t("email.open")}: ${input.url}`,
    html: shell(lines.map(esc), { href: input.url, label: t("email.open") }),
  };
}

export function mailOpened(input: { client: string; title: string; when: string; url: string }) {
  const subject = t("email.openedSubject", { Klient: input.client });
  const body = t("email.openedBody", { tytul: input.title, data: input.when });
  return { subject, text: `${body}\n${input.url}`, html: shell([esc(body)], { href: input.url, label: t("email.seeActivity") }) };
}

export function mailNotes(input: { client: string; title: string; count: number; url: string }) {
  const subject = t("email.notesSubject", { Klient: input.client });
  const body = t("email.notesBody", { n: input.count, tytul: input.title });
  return { subject, text: `${body}\n${input.url}`, html: shell([esc(body)], { href: input.url, label: t("email.seeComments") }) };
}

export function mailApproved(input: { client: string; title: string; url: string }) {
  const subject = t("email.approvedSubject");
  const body = t("email.approvedBody", { Klient: input.client, tytul: input.title });
  return { subject, text: `${body}\n${input.url}`, html: shell([esc(body)], { href: input.url, label: t("email.seeActivity") }) };
}

export function mailOpinion(input: { client: string; title: string; rating: number; body: string; url: string }) {
  const subject = t("email.opinionSubject", { Klient: input.client });
  const lead = t("email.opinionBody", { Klient: input.client, tytul: input.title, n: input.rating });
  const text = `${lead}\n\n${input.body}\n\n${t("email.opinionNote")}`;
  return {
    subject,
    text,
    html: shell([esc(lead), esc(input.body), esc(t("email.opinionNote"))], { href: input.url, label: t("admin.reviews") }),
  };
}

export function mailAccount(input: { name: string; password: string; url: string }) {
  const subject = t("email.accountSubject");
  const hello = t("email.accountBody", { imie: input.name });
  const pw = t("email.accountPassword", { haslo: input.password });
  return {
    subject,
    text: `${hello}\n${pw}\n${input.url}`,
    html: shell([esc(hello), esc(pw)], { href: input.url, label: t("email.login") }),
  };
}

export function mailReset(input: { url: string }) {
  const subject = t("email.resetSubject");
  const body = t("email.resetBody");
  return { subject, text: `${body}\n${input.url}`, html: shell([esc(body)], { href: input.url, label: t("email.resetCta") }) };
}

export function mailExpiry(input: { title: string; when: string; url: string }) {
  const subject = t("email.expirySubject", { tytul: input.title });
  const body = t("email.expiryBody", { tytul: input.title, data: input.when });
  return { subject, text: `${body}\n${input.url}`, html: shell([esc(body)], { href: input.url, label: t("email.seeActivity") }) };
}

export function mailDigest(input: { lines: string[]; url: string }) {
  const subject = t("email.digestSubject");
  const intro = t("email.digestIntro");
  return {
    subject,
    text: `${intro}\n\n${input.lines.join("\n")}\n${input.url}`,
    html: shell([esc(intro), ...input.lines.map(esc)], { href: input.url, label: t("email.seeActivity") }),
  };
}
