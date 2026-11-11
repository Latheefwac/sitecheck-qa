import "server-only";
import type { Page, Request } from "playwright";
import type { PageRecord } from "../../../types";
import type { ScanContext } from "../context";
import { sleep } from "../util";

interface FormInfo {
  idx: number;
  id: string;
  action: string;
  method: string;
  fields: { name: string; type: string; required: boolean }[];
  hasEmail: boolean;
  hasTel: boolean;
  hasPassword: boolean;
  isSearch: boolean;
  captcha: string | null;
  novalidate: boolean;
}

async function listForms(page: Page): Promise<FormInfo[]> {
  return page.evaluate(() => {
    const visible = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    return [...document.querySelectorAll("form")].filter(visible).map((f, idx) => {
      f.setAttribute("data-qa-form", String(idx));
      const inputs = [...f.querySelectorAll<HTMLInputElement>("input, textarea, select")].filter((i) => !["hidden", "submit", "button", "reset", "image"].includes(i.type));
      const html = f.outerHTML + (f.closest("body")?.querySelector("script[src*=recaptcha], script[src*=hcaptcha], script[src*=turnstile]") ? " page-captcha" : "");
      const captcha = /g-recaptcha|recaptcha/i.test(html) ? "reCAPTCHA" : /h-captcha|hcaptcha/i.test(html) ? "hCaptcha" : /cf-turnstile|turnstile/i.test(html) ? "Turnstile" : null;
      return {
        idx, id: f.id || f.getAttribute("name") || f.className.toString().split(" ")[0] || `form-${idx}`,
        action: f.action, method: (f.method || "get").toLowerCase(),
        fields: inputs.map((i) => ({ name: i.name || i.id || i.type, type: i.type || i.tagName.toLowerCase(), required: i.required || i.getAttribute("aria-required") === "true" })),
        hasEmail: inputs.some((i) => i.type === "email" || /e-?mail/i.test(i.name)),
        hasTel: inputs.some((i) => i.type === "tel" || /phone|mobile|tel/i.test(i.name)),
        hasPassword: inputs.some((i) => i.type === "password"),
        isSearch: inputs.length <= 2 && inputs.some((i) => i.type === "search" || /^(q|s|search|query|keyword)$/i.test(i.name)),
        captcha, novalidate: f.noValidate,
      };
    });
  });
}

/** Reads validation feedback: native validity + visible error text / aria-invalid. */
async function feedback(page: Page, idx: number) {
  return page.evaluate((idx) => {
    const f = document.querySelector<HTMLFormElement>(`[data-qa-form="${idx}"]`)!;
    const invalid = [...f.querySelectorAll<HTMLInputElement>("input, textarea, select")].filter((i) => !i.checkValidity() || i.getAttribute("aria-invalid") === "true").map((i) => i.name || i.id || i.type);
    const scope = f.parentElement ?? f;
    const errText = [...scope.querySelectorAll<HTMLElement>(".error, .invalid-feedback, .wpcf7-not-valid-tip, [role=alert], .help-block, .field-error, [class*=error], [aria-live]")].filter((e) => e.getBoundingClientRect().height > 0 && (e.textContent ?? "").trim()).map((e) => (e.textContent ?? "").trim().slice(0, 80));
    return { invalid, errText: [...new Set(errText)].slice(0, 5), valid: f.checkValidity() };
  }, idx);
}

async function submit(page: Page, idx: number) {
  const btn = page.locator(`[data-qa-form="${idx}"] [type=submit], [data-qa-form="${idx}"] button:not([type=button]):not([type=reset])`).first();
  if (await btn.count()) await btn.click({ timeout: 4000, force: true }).catch(() => {});
  else await page.locator(`[data-qa-form="${idx}"]`).evaluate((f) => (f as HTMLFormElement).requestSubmit()).catch(() => {});
  await sleep(700);
}

export async function formsPage(ctx: ScanContext, p: PageRecord) {
  const { ctx: bctx, page } = await ctx.openPage(p.url);
  const allow = ctx.settings.allowFormSubmission;
  const sent: Request[] = [];
  // SAFETY: unless submission is explicitly allowed (test/staging only), every non-GET request is aborted so no
  // data reaches production back-ends or triggers real emails.
  await page.route("**/*", (route) => {
    const r = route.request();
    if (r.method() !== "GET" && r.method() !== "HEAD" && r.method() !== "OPTIONS") {
      sent.push(r);
      if (!allow) return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  try {
    const forms = (await listForms(page)).filter((f) => !f.isSearch);
    if (!forms.length) return;
    for (const f of forms.slice(0, ctx.full ? 4 : 2)) {
      const base = { category: "forms" as const, pageUrl: p.url, meta: { form: f.id } };
      const label = `form "${f.id}"`;
      if (f.hasPassword) {
        ctx.notTested({ ...base, checkKey: "frm.login", title: `Login form (${label})`, description: "Credential forms are excluded from automated submission", reason: "Skipped: password field present", severity: "Low" });
        continue;
      }
      const required = f.fields.filter((x) => x.required);

      // 1) required validation with empty submit
      await page.reload({ waitUntil: "load" });
      await listForms(page);
      sent.length = 0;
      await submit(page, f.idx);
      const fb = await feedback(page, f.idx);
      const blocked = fb.invalid.length > 0 || fb.errText.length > 0;
      if (!required.length) ctx.check({ ...base, checkKey: "frm.required", title: `Required field validation (${label})`, description: "Mandatory fields are marked required", expected: "Required fields flagged (required / aria-required)", actual: `No required fields declared among ${f.fields.length} field(s); empty submit ${blocked ? "was blocked by custom validation" : sent.length ? "sent a request" : "did nothing visible"}`, severity: "Medium", recommendation: blocked ? null : "Mark mandatory fields with required and aria-required=\"true\"." }, blocked ? true : "warn");
      else ctx.check({ ...base, checkKey: "frm.required", title: `Required field validation (${label})`, description: "Submitting an empty form is blocked with clear messages", expected: "Submission prevented; invalid fields flagged", actual: `Invalid fields: ${fb.invalid.join(", ") || "none"}; messages: ${fb.errText.join(" | ") || "none (native browser tooltips only)"}; requests attempted: ${sent.length}`, severity: "High", screenshot: await ctx.shot(page, `form-${f.idx}-required`), recommendation: blocked ? (fb.errText.length ? null : "Show inline, accessible error messages instead of relying on browser tooltips.") : "Add client-side validation for required fields." }, blocked ? (fb.errText.length || !f.novalidate ? true : "warn") : false);

      // 2) email & phone validation (invalid input handling)
      for (const kind of ["email", "tel"] as const) {
        if (kind === "email" ? !f.hasEmail : !f.hasTel) continue;
        await page.reload({ waitUntil: "load" });
        await listForms(page);
        const sel = kind === "email" ? `[data-qa-form="${f.idx}"] input[type=email], [data-qa-form="${f.idx}"] input[name*=mail i]` : `[data-qa-form="${f.idx}"] input[type=tel], [data-qa-form="${f.idx}"] input[name*=phone i], [data-qa-form="${f.idx}"] input[name*=mobile i]`;
        const bad = kind === "email" ? "not-an-email@" : "abc!!12";
        await page.locator(sel).first().fill(bad).catch(() => {});
        await submit(page, f.idx);
        const res = await feedback(page, f.idx);
        const flagged = res.invalid.some((n) => (kind === "email" ? /mail/i : /phone|tel|mobile/i).test(n)) || res.errText.some((t) => (kind === "email" ? /mail|valid/i : /phone|number|valid/i).test(t));
        ctx.check({ ...base, checkKey: `frm.${kind}`, title: `${kind === "email" ? "Email" : "Phone"} validation (${label})`, description: `Entering "${bad}" is rejected`, expected: "Field flagged invalid with a message", actual: flagged ? `Rejected; ${res.errText.join(" | ") || "native validation"}` : "Accepted invalid value", severity: kind === "email" ? "High" : "Medium", recommendation: flagged ? null : kind === "email" ? 'Use <input type="email"> plus server-side validation.' : 'Use <input type="tel" pattern="[0-9+()\\-\\s]{7,}"> and validate server-side.' }, flagged);
      }

      // 3) CAPTCHA integration
      ctx.check({ ...base, checkKey: "frm.captcha", title: `CAPTCHA integration (${label})`, description: "Public forms are protected against spam", expected: "reCAPTCHA / hCaptcha / Turnstile present", actual: f.captcha ? `${f.captcha} detected` : "No CAPTCHA detected", severity: "Medium", recommendation: f.captcha ? null : "Add reCAPTCHA v3 (or a honeypot + rate limit) to public forms." }, f.captcha ? true : "warn");

      // 4) real submission — only when explicitly allowed
      const submissionChecks = ["frm.submit", "frm.api-response", "frm.duplicate", "frm.messages"] as const;
      if (!allow) {
        for (const k of submissionChecks) ctx.notTested({ ...base, checkKey: k, title: `${{ "frm.submit": "Successful form submission", "frm.api-response": "API response validation", "frm.duplicate": "Duplicate submission prevention", "frm.messages": "Success & error messages" }[k]} (${label})`, description: "Requires real submission", reason: "Form submission is disabled (safe default). Enable it in Settings only for staging/test environments.", severity: "Medium" });
        continue;
      }
      await page.reload({ waitUntil: "load" });
      await listForms(page);
      const td = ctx.settings.formTestData;
      await page.evaluate(({ idx, td }) => {
        const f = document.querySelector<HTMLFormElement>(`[data-qa-form="${idx}"]`)!;
        f.querySelectorAll<HTMLInputElement>("input, textarea, select").forEach((i) => {
          const n = `${i.name} ${i.id} ${i.placeholder}`.toLowerCase();
          if (["hidden", "submit", "button"].includes(i.type)) return;
          if (i.type === "checkbox" || i.type === "radio") { if (i.required) i.checked = true; return; }
          if (i.tagName === "SELECT") { const s = i as unknown as HTMLSelectElement; if (s.options.length > 1) s.selectedIndex = 1; return; }
          i.value = i.type === "email" || n.includes("mail") ? td.email : i.type === "tel" || /phone|mobile/.test(n) ? td.phone : i.tagName === "TEXTAREA" || n.includes("message") ? td.message : i.type === "number" ? "1" : i.type === "date" ? "2030-01-01" : i.type === "url" ? "https://example.test" : td.name;
          i.dispatchEvent(new Event("input", { bubbles: true }));
          i.dispatchEvent(new Event("change", { bubbles: true }));
        });
      }, { idx: f.idx, td });
      sent.length = 0;
      const respPromise = page.waitForResponse((r) => r.request().method() !== "GET", { timeout: 15000 }).catch(() => null);
      const btn = page.locator(`[data-qa-form="${f.idx}"] [type=submit], [data-qa-form="${f.idx}"] button:not([type=button])`).first();
      await btn.dblclick({ timeout: 4000 }).catch(() => submit(page, f.idx));
      const resp = await respPromise;
      await sleep(2500);
      const posts = sent.filter((r) => r.method() !== "GET").length;
      const status = resp?.status() ?? null;
      let body = "";
      try { body = (await resp?.text())?.slice(0, 500) ?? ""; } catch {}
      const msg = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[role=alert], .alert, .success, .wpcf7-response-output, [class*=success], [class*=thank], [aria-live]")].filter((e) => e.getBoundingClientRect().height > 0 && (e.textContent ?? "").trim()).map((e) => (e.textContent ?? "").trim().slice(0, 120))[0] ?? "");
      const navigatedThanks = /thank|success|submitted/i.test(page.url());
      const shot = await ctx.shot(page, `form-${f.idx}-submitted`);
      const ok = status !== null && status < 400;
      ctx.check({ ...base, checkKey: "frm.submit", title: `Successful form submission (${label})`, description: "Valid test data submits successfully", expected: "Request sent, 2xx response", actual: status === null ? "No submission request observed" : `HTTP ${status} from ${resp?.url()}`, severity: "Critical", screenshot: shot, recommendation: ok ? null : "Check the form endpoint, CSRF token and server logs." }, ok);
      let jsonOk: boolean | "warn" = ok ? "warn" : false;
      try { const j = JSON.parse(body); jsonOk = ok && (j.success === true || j.status === "mail_sent" || j.ok === true || j.status === "success") ? true : ok ? "warn" : false; } catch { jsonOk = ok ? true : false; }
      ctx.check({ ...base, checkKey: "frm.api-response", title: `API response validation (${label})`, description: "The submission endpoint returns a success payload", expected: "2xx with a success indicator", actual: status === null ? "No response" : `HTTP ${status}; ${body ? body.replace(/\s+/g, " ").slice(0, 200) : "(empty body)"}`, severity: "High", recommendation: jsonOk === true ? null : "Return a structured response (e.g. { success: true }) so the UI can confirm delivery." }, jsonOk);
      ctx.check({ ...base, checkKey: "frm.duplicate", title: `Duplicate submission prevention (${label})`, description: "Double-clicking submit sends only one request", expected: "1 request", actual: `${posts} request(s) sent on double-click`, severity: "Medium", recommendation: posts > 1 ? "Disable the submit button while the request is in flight." : null }, posts <= 1);
      ctx.check({ ...base, checkKey: "frm.messages", title: `Success & error messages (${label})`, description: "User sees confirmation after submitting", expected: "Visible success message or thank-you page", actual: msg ? `"${msg}"` : navigatedThanks ? `Redirected to ${page.url()}` : "No visible confirmation", severity: "High", screenshot: shot, recommendation: msg || navigatedThanks ? null : "Show a clear success message (role=status) after submission." }, !!msg || navigatedThanks);
    }
  } finally {
    await bctx.close();
  }
}
