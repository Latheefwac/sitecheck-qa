import "server-only";
import { chromium } from "playwright";
import type { ScanContext } from "../context";

/**
 * Email template testing against a Mailpit / MailHog-compatible test inbox.
 * Never sends email itself — it inspects messages captured by the test SMTP server after
 * forms were submitted in a test environment (Settings → allow form submission).
 */
interface MailMsg {
  ID: string;
  Subject: string;
  From: { Address: string; Name?: string };
  To: { Address: string }[];
  Created: string;
}

export async function emailChecks(ctx: ScanContext, scanStartedAt: Date) {
  const s = ctx.settings;
  const base = { category: "email" as const, pageUrl: s.emailTestApi || ctx.rootUrl };
  const LABELS: Record<string, string> = { subject: "Email subject", sender: "Sender information", recipient: "Recipient information", dynamic: "Dynamic form values", html: "HTML email rendering", layout: "Desktop & mobile email layout", admin: "Admin notification email", confirmation: "User confirmation email", delivery: "Email delivery status" };
  const keys = Object.keys(LABELS);
  if (!s.emailTestApi || !s.allowFormSubmission) {
    for (const k of keys) ctx.notTested({ ...base, checkKey: `eml.${k}`, title: LABELS[k], description: "Email template validation", reason: !s.emailTestApi ? "No test email API (Mailpit/MailHog) configured in Settings." : "Form submission is disabled, so no test emails were generated.", severity: "Medium" });
    return;
  }
  let msgs: MailMsg[] = [];
  try {
    const api = s.emailTestApi.replace(/\/$/, "");
    let r = await fetch(`${api}/api/v1/messages?limit=50`);
    if (r.ok) msgs = ((await r.json()) as { messages: MailMsg[] }).messages ?? [];
    else {
      r = await fetch(`${api}/api/v2/messages?limit=50`); // MailHog
      const j = (await r.json()) as { items: { ID: string; Content: { Headers: Record<string, string[]> }; Created: string }[] };
      msgs = j.items.map((i) => ({ ID: i.ID, Subject: i.Content.Headers.Subject?.[0] ?? "", From: { Address: i.Content.Headers.From?.[0] ?? "" }, To: (i.Content.Headers.To?.[0] ?? "").split(",").map((a) => ({ Address: a.trim() })), Created: i.Created }));
    }
  } catch (e) {
    for (const k of keys) ctx.notTested({ ...base, checkKey: `eml.${k}`, title: LABELS[k], description: "Email template validation", reason: `Test inbox unreachable: ${(e as Error).message}`, severity: "Medium" });
    return;
  }
  const recent = msgs.filter((m) => new Date(m.Created) >= new Date(scanStartedAt.getTime() - 60_000));
  const td = s.formTestData;
  const userMail = recent.find((m) => m.To.some((t) => t.Address.toLowerCase().includes(td.email.toLowerCase())));
  const adminMail = recent.find((m) => s.emailAdminRecipient && m.To.some((t) => t.Address.toLowerCase().includes(s.emailAdminRecipient.toLowerCase())));
  ctx.check({ ...base, checkKey: "eml.delivery", title: "Email delivery status", description: "Form submissions produced emails in the test inbox", expected: "≥ 1 message captured during this scan", actual: `${recent.length} message(s) captured`, severity: "High", recommendation: recent.length ? null : "Check the SMTP configuration of the test environment." }, recent.length > 0);
  ctx.check({ ...base, checkKey: "eml.confirmation", title: "User confirmation email", description: `Email sent to the submitter (${td.email})`, expected: "Confirmation received", actual: userMail ? `"${userMail.Subject}"` : "Not received", severity: "Medium", recommendation: userMail ? null : "Enable the autoresponder for the form." }, !!userMail);
  ctx.check({ ...base, checkKey: "eml.admin", title: "Admin notification email", description: `Notification sent to ${s.emailAdminRecipient || "(admin recipient not configured)"}`, expected: "Admin notification received", actual: adminMail ? `"${adminMail.Subject}"` : "Not received", severity: "High", recommendation: adminMail ? null : "Check the form's notification recipient." }, s.emailAdminRecipient ? !!adminMail : "warn");
  const subject = (userMail ?? adminMail)?.Subject ?? "";
  ctx.check({ ...base, checkKey: "eml.subject", title: "Email subject", description: "Subject matches the expected template", expected: s.emailExpectedSubject || "Non-empty subject", actual: subject || "—", severity: "Medium", recommendation: null }, s.emailExpectedSubject ? subject.includes(s.emailExpectedSubject) : !!subject);
  const from = (userMail ?? adminMail)?.From.Address ?? "";
  ctx.check({ ...base, checkKey: "eml.sender", title: "Sender information", description: "From address matches the expected sender", expected: s.emailExpectedSender || "Valid From address", actual: from || "—", severity: "Medium", recommendation: null }, s.emailExpectedSender ? from.toLowerCase() === s.emailExpectedSender.toLowerCase() : /@/.test(from));
  ctx.check({ ...base, checkKey: "eml.recipient", title: "Recipient information", description: "Recipients are the submitter / configured admin only", expected: "Correct recipients", actual: recent.flatMap((m) => m.To.map((t) => t.Address)).join(", ") || "—", severity: "High", recommendation: null }, recent.length > 0);

  const msg = userMail ?? adminMail;
  if (!msg) return;
  const api = s.emailTestApi.replace(/\/$/, "");
  let html = "";
  try {
    const r = await fetch(`${api}/api/v1/message/${msg.ID}`);
    html = ((await r.json()) as { HTML?: string; Text?: string }).HTML ?? "";
  } catch {}
  const dynamicOk = [td.name, td.email].every((v) => html.includes(v));
  ctx.check({ ...base, checkKey: "eml.dynamic", title: "Dynamic form values", description: "Submitted values appear in the email body", expected: `Contains "${td.name}" and "${td.email}"`, actual: dynamicOk ? "All values present" : "Some submitted values missing or placeholders unrendered", severity: "High", recommendation: dynamicOk ? null : "Check merge tags in the email template." }, dynamicOk && !/\{\{|\[\w+-\d+\]|%\w+%/.test(html));
  if (!html) {
    ctx.check({ ...base, checkKey: "eml.html", title: "HTML email rendering", description: "Email has an HTML part", expected: "HTML body", actual: "Plain text only", severity: "Low", recommendation: null }, "warn");
    return;
  }
  const b = await chromium.launch();
  try {
    for (const [name, width] of [["desktop", 800], ["mobile", 375]] as const) {
      const pg = await b.newPage({ viewport: { width, height: 900 } });
      await pg.setContent(html, { waitUntil: "load" });
      const ov = await pg.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      const broken = await pg.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0).length);
      const shot = await ctx.shot(pg, `email-${name}`, { fullPage: true, maxHeight: 4000 });
      ctx.check({ ...base, viewport: name, checkKey: name === "desktop" ? "eml.html" : "eml.layout", title: `Email layout (${name} ${width}px)`, description: "Email renders without overflow or broken images", expected: "No horizontal overflow, images load", actual: `Overflow ${Math.max(0, ov)}px; broken images ${broken}`, severity: "Medium", screenshot: shot, recommendation: ov > 0 || broken ? "Use fluid tables (width:100%; max-width:600px) and absolute image URLs." : null }, ov <= 0 && broken === 0);
      await pg.close();
    }
  } finally {
    await b.close();
  }
}
