import "server-only";
import type { Page } from "playwright";
import { listLinks } from "../../db";
import type { PageRecord } from "../../../types";
import { DOWNLOAD_EXT, normalizeUrl, sameSite } from "../../../url";
import type { ScanContext } from "../context";
import { fetchChain, pMap, sleep } from "../util";

const SOCIAL = /(facebook\.com|fb\.com|twitter\.com|x\.com|linkedin\.com|instagram\.com|youtube\.com|youtu\.be|tiktok\.com|pinterest\.com|threads\.net|wa\.me|whatsapp\.com)/i;

function linkStatusMap(scanId: string) {
  const m = new Map<string, number | null>();
  for (const l of listLinks(scanId)) m.set(l.toUrl, l.statusCode);
  return m;
}

/** Checks all hrefs in a region against crawl status; HEAD-checks anything not seen during crawl. */
async function regionLinks(ctx: ScanContext, page: Page, selector: string) {
  const sel = selector.split(",").map((x) => `${x.trim()} a[href]`).join(", ");
  const hrefs = await page.$$eval(sel, (as) => as.map((a) => ({ href: (a as HTMLAnchorElement).href, text: (a.textContent ?? a.getAttribute("aria-label") ?? "").trim().slice(0, 40), target: a.getAttribute("target"), rel: a.getAttribute("rel") ?? "" }))).catch(() => [] as { href: string; text: string; target: string | null; rel: string }[]);
  const known = linkStatusMap(ctx.scanId);
  const uniq = [...new Map(hrefs.filter((h) => /^https?:/.test(h.href)).map((h) => [h.href, h])).values()].slice(0, 80);
  const res = await pMap(uniq, 6, async (h) => {
    let n = h.href;
    try { n = normalizeUrl(h.href); } catch {}
    const status = known.has(n) ? known.get(n)! : (await fetchChain(page.context().request, h.href, { method: "HEAD", readBody: false, timeout: 12000 })).status;
    return { ...h, status };
  });
  return { all: hrefs, checked: res, broken: res.filter((r) => r.status === null || r.status >= 400) };
}

export async function functionalPage(ctx: ScanContext, p: PageRecord, page: Page) {
  const url = p.url;
  const base = { category: "functional" as const, pageUrl: url };
  const origin = new URL(ctx.rootUrl).origin;
  const isHome = p.depth === 0;

  // ---------- page load ----------
  ctx.check({ ...base, checkKey: "fun.page-load", title: "Page loads", description: "Page returns HTTP 200 and renders content", expected: "HTTP 200 with visible body content", actual: `HTTP ${p.statusCode ?? "?"}; body text ${await page.evaluate(() => document.body.innerText.trim().length)} chars`, severity: "Critical", recommendation: "Investigate server errors / blank renders." }, (p.statusCode ?? 200) < 400 && (await page.evaluate(() => document.body.innerText.trim().length)) > 20);

  // ---------- header & navigation (site chrome checked on homepage + full scans) ----------
  if (isHome || ctx.full) {
    const logo = await page.evaluate(() => {
      const cand = document.querySelector<HTMLAnchorElement>("header a[class*=logo i], header .logo a, a.logo, a[class*=brand i], header a:has(img), header a:has(svg), .navbar-brand");
      return cand ? { href: cand.href, label: cand.getAttribute("aria-label") ?? cand.querySelector("img")?.alt ?? cand.textContent?.trim() ?? "" } : null;
    });
    if (!logo) ctx.check({ ...base, checkKey: "fun.logo", title: "Logo redirection", description: "Header logo links to the homepage", expected: "Logo link → homepage", actual: "No logo link found in header", severity: "Medium", recommendation: "Wrap the header logo in <a href=\"/\" aria-label=\"Company home\">." }, "warn");
    else {
      const target = new URL(logo.href);
      const ok = target.origin === origin && (target.pathname === "/" || target.pathname === new URL(ctx.rootUrl).pathname || /^\/[a-z]{2}(-[a-z]{2})?\/?$/i.test(target.pathname));
      ctx.check({ ...base, checkKey: "fun.logo", title: "Logo redirection", description: "Header logo links to the homepage", expected: `Logo href = ${origin}/`, actual: `${logo.href}${logo.label ? ` (label: "${logo.label}")` : " (no accessible label)"}`, severity: "Medium", recommendation: ok ? null : "Point the logo link at the homepage." }, ok);
    }

    const nav = await regionLinks(ctx, page, "header, nav, [role=navigation]");
    ctx.check({ ...base, checkKey: "fun.nav-links", title: "Navigation links", description: "Every header/navigation link resolves", expected: "All nav links HTTP 2xx/3xx", actual: nav.checked.length ? (nav.broken.length ? nav.broken.map((b) => `${b.status ?? "ERR"} "${b.text}" ${b.href}`).join("\n") : `${nav.checked.length} link(s) OK`) : "No navigation links found", severity: "High", recommendation: nav.broken.length ? "Fix broken navigation links." : null }, nav.checked.length ? nav.broken.length === 0 : "warn");

    const active = await page.evaluate(() => {
      const here = location.href.replace(/[#?].*$/, "").replace(/\/$/, "");
      const links = [...document.querySelectorAll<HTMLAnchorElement>("header a[href], nav a[href]")].filter((a) => a.href.replace(/[#?].*$/, "").replace(/\/$/, "") === here);
      return { matches: links.length, marked: links.filter((a) => a.getAttribute("aria-current") || /active|current|selected/i.test(a.className + " " + (a.parentElement?.className ?? ""))).length };
    });
    if (active.matches) ctx.check({ ...base, checkKey: "fun.active-menu", title: "Active menu state", description: "The nav link for the current page is highlighted", expected: 'aria-current="page" or active class', actual: `${active.marked}/${active.matches} matching nav link(s) marked active`, severity: "Low", recommendation: active.marked ? null : 'Add aria-current="page" and an active style to the current nav item.' }, active.marked > 0 ? true : "warn");

    const ext = nav.all.concat((await regionLinks(ctx, page, "footer")).all).filter((h) => /^https?:/.test(h.href) && !sameSite(h.href, url));
    const unsafe = ext.filter((h) => h.target === "_blank" && !/noopener|noreferrer/.test(h.rel));
    const sameTab = ext.filter((h) => h.target !== "_blank");
    ctx.check({ ...base, checkKey: "fun.external-links", title: "External links", description: 'External links open in a new tab with rel="noopener"', expected: 'target="_blank" rel="noopener noreferrer"', actual: ext.length ? [`${ext.length} external link(s)`, ...unsafe.slice(0, 5).map((u) => `Missing rel=noopener: ${u.href}`), ...sameTab.slice(0, 5).map((u) => `Opens in same tab: ${u.href}`)].join("\n") : "No external links in header/footer", severity: "Low", recommendation: unsafe.length || sameTab.length ? 'Use target="_blank" rel="noopener noreferrer" on external links.' : null }, unsafe.length ? false : sameTab.length ? "warn" : true);

    // dropdowns
    const dd = await page.evaluate(() => {
      const items = [...document.querySelectorAll<HTMLElement>("nav li, header li")].filter((li) => li.querySelector(":scope > ul, :scope > div ul, :scope > .dropdown-menu, :scope > [class*=sub]"));
      items.slice(0, 6).forEach((li, i) => li.setAttribute("data-qa-dd", String(i)));
      return items.length;
    });
    if (dd) {
      const fails: string[] = [];
      for (let i = 0; i < Math.min(dd, 6); i++) {
        const li = page.locator(`[data-qa-dd="${i}"]`);
        const trigger = li.locator(":scope > a, :scope > button").first();
        const sub = li.locator(":scope > ul, :scope > div, :scope > .dropdown-menu, :scope > [class*=sub]").first();
        if (!(await trigger.isVisible().catch(() => false))) continue;
        await trigger.hover({ timeout: 3000 }).catch(() => {});
        await sleep(400);
        let open = await sub.isVisible().catch(() => false);
        if (!open) {
          const tag = await trigger.evaluate((e) => e.tagName).catch(() => "");
          if (tag === "BUTTON") { await trigger.click({ timeout: 3000 }).catch(() => {}); await sleep(300); open = await sub.isVisible().catch(() => false); }
        }
        if (!open) fails.push(`"${(await trigger.textContent().catch(() => ""))?.trim().slice(0, 30)}" submenu did not open on hover/click`);
        await page.mouse.move(0, 0);
      }
      ctx.check({ ...base, checkKey: "fun.dropdowns", title: "Dropdown functionality", description: "Submenus open on hover (or click for button triggers)", expected: "Every submenu becomes visible", actual: fails.length ? fails.join("\n") : `${Math.min(dd, 6)} dropdown(s) opened`, severity: "High", screenshot: fails.length ? await ctx.shot(page, "dropdown-fail") : null, recommendation: fails.length ? "Ensure submenus show on :hover/:focus-within and on click for touch devices." : null }, fails.length === 0);
    }

    // sticky header
    const sticky = await page.evaluate(async () => {
      const h = document.querySelector<HTMLElement>("header, [role=banner], .header, #header");
      if (!h) return null;
      const tall = document.documentElement.scrollHeight > innerHeight * 2;
      window.scrollTo(0, Math.min(1200, document.documentElement.scrollHeight));
      await new Promise((r) => setTimeout(r, 500));
      const r = h.getBoundingClientRect();
      const pos = getComputedStyle(h).position;
      const visible = r.bottom > 0 && r.top < 50 && getComputedStyle(h).visibility !== "hidden";
      window.scrollTo(0, 0);
      return { pos, visible, tall };
    });
    if (sticky?.tall) ctx.add({ ...base, checkKey: "fun.sticky-header", title: "Sticky header", description: "Header behaviour after scrolling 1200px", expected: "Header stays visible (if designed sticky)", actual: `position: ${sticky.pos}; visible after scroll: ${sticky.visible ? "yes" : "no"}`, status: sticky.visible ? "PASS" : "WARNING", severity: "Low", recommendation: sticky.visible ? null : "If the design specifies a sticky header, apply position: sticky/fixed; ignore if not required." });

    // mobile menu
    const m = await ctx.openPage(url, { context: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } });
    try {
      const toggle = m.page.locator("button[aria-controls], button[aria-expanded], .hamburger, .menu-toggle, .navbar-toggler, [class*=burger], button[aria-label*=menu i], button:has-text('Menu')").filter({ visible: true }).first();
      if (!(await toggle.count())) {
        const navVisible = await m.page.locator("header nav a, nav a").filter({ visible: true }).count();
        ctx.check({ ...base, checkKey: "fun.mobile-menu", viewport: "mobile-390", title: "Mobile menu", description: "A menu toggle opens the navigation on mobile", expected: "Visible toggle that reveals nav links", actual: navVisible ? `No toggle; ${navVisible} nav link(s) visible inline` : "No toggle and no visible nav links", severity: "High", screenshot: navVisible ? null : await ctx.shot(m.page, "mobile-menu-missing"), recommendation: navVisible ? null : "Add an accessible menu button (aria-expanded, aria-controls)." }, navVisible ? "warn" : false);
      } else {
        const before = await m.page.locator("nav a, [role=navigation] a").filter({ visible: true }).count();
        await toggle.click({ timeout: 4000 }).catch(() => {});
        await sleep(600);
        const after = await m.page.locator("nav a, [role=navigation] a, [role=dialog] a, .mobile-menu a, [class*=offcanvas] a, [class*=drawer] a").filter({ visible: true }).count();
        const expanded = await toggle.getAttribute("aria-expanded").catch(() => null);
        const shot = await ctx.shot(m.page, "mobile-menu-open");
        const opened = after > before;
        ctx.check({ ...base, checkKey: "fun.mobile-menu", viewport: "mobile-390", title: "Mobile menu", description: "Tapping the menu toggle reveals navigation links", expected: "More nav links visible after tap; aria-expanded=true", actual: `Visible links ${before} → ${after}; aria-expanded=${expanded ?? "not set"}`, severity: "High", screenshot: shot, recommendation: !opened ? "Fix the mobile menu toggle handler." : expanded !== "true" ? "Toggle aria-expanded on the menu button." : null }, opened ? (expanded === "true" ? true : "warn") : false);
        await m.page.keyboard.press("Escape").catch(() => {});
      }
    } finally {
      await m.ctx.close();
    }
  }

  // ---------- UI components ----------
  const comp = await page.evaluate(() => {
    const visible = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"; };
    const buttons = [...document.querySelectorAll<HTMLElement>("button, a.btn, a[class*=button], [role=button], input[type=submit], input[type=button]")].filter(visible);
    const deadCtas = buttons.filter((b) => b.tagName === "A" && /^(#|javascript:)/.test(b.getAttribute("href") ?? "") && !b.hasAttribute("aria-controls") && !b.getAttribute("data-bs-toggle")).map((b) => `"${(b.textContent ?? "").trim().slice(0, 30)}" href="${b.getAttribute("href")}"`);
    const unnamed = buttons.filter((b) => !(b.textContent ?? "").trim() && !b.getAttribute("aria-label") && !b.getAttribute("title") && !(b as HTMLInputElement).value && !b.querySelector("img[alt]:not([alt=''])")).length;
    const carousel = document.querySelector(".swiper, .slick-slider, .splide, .owl-carousel, .carousel, .glide, .flickity-enabled, [aria-roledescription=carousel]");
    const tablist = document.querySelector("[role=tablist]");
    const accordions = document.querySelectorAll("details, [data-bs-toggle=collapse], .accordion-button, [aria-expanded][aria-controls]").length;
    const modals = document.querySelectorAll("[data-bs-toggle=modal], [aria-haspopup=dialog], [data-modal-target], [data-toggle=modal], [data-fancybox], [data-lightbox]").length;
    const search = document.querySelector<HTMLInputElement>("input[type=search], input[name=q], input[name=s], input[name=search], input[name=query]");
    const pagination = [...document.querySelectorAll<HTMLAnchorElement>(".pagination a, nav[aria-label*=pagination i] a, .page-numbers a, a[rel=next]")].map((a) => a.href);
    const breadcrumb = document.querySelector("nav[aria-label*=breadcrumb i], .breadcrumb, .breadcrumbs, [itemtype*=BreadcrumbList]");
    return { buttons: buttons.length, deadCtas, unnamed, carousel: !!carousel, tablist: !!tablist, accordions, modals, search: !!search && visible(search), pagination, breadcrumb: breadcrumb ? [...breadcrumb.querySelectorAll<HTMLAnchorElement>("a")].map((a) => a.href) : null };
  });
  ctx.check({ ...base, checkKey: "fun.buttons", title: "Buttons and CTAs", description: "CTAs have an action (no dead # links) and a label", expected: "0 dead CTAs, 0 unlabelled buttons", actual: `${comp.buttons} button(s); ${comp.deadCtas.length} dead CTA(s); ${comp.unnamed} without label${comp.deadCtas.length ? "\n" + comp.deadCtas.slice(0, 8).join("\n") : ""}`, severity: "Medium", recommendation: comp.deadCtas.length || comp.unnamed ? "Link CTAs to real destinations; use <button> for actions; label icon buttons with aria-label." : null }, comp.deadCtas.length ? false : comp.unnamed ? "warn" : true);

  if (comp.carousel) {
    const r = await page.evaluate(async () => {
      const c = document.querySelector<HTMLElement>(".swiper, .slick-slider, .splide, .owl-carousel, .carousel, .glide, .flickity-enabled, [aria-roledescription=carousel]")!;
      const sig = () => { const a = c.querySelector(".swiper-slide-active, .slick-active, .is-active, .active, [aria-current=true]"); const w = c.querySelector(".swiper-wrapper, .slick-track, .splide__list, .owl-stage, .glide__slides"); return (a?.textContent ?? "").slice(0, 50) + "|" + (w ? getComputedStyle(w).transform : ""); };
      const s0 = sig();
      const next = c.querySelector<HTMLElement>(".swiper-button-next, .slick-next, .splide__arrow--next, .owl-next, .carousel-control-next, .glide__arrow--right, .next, [aria-label*=next i]") ?? c.parentElement?.querySelector<HTMLElement>(".swiper-button-next, .slick-next, [aria-label*=next i]");
      if (!next) { await new Promise((r) => setTimeout(r, 3500)); return { hasNext: false, changed: sig() !== s0, labelled: false }; }
      next.click();
      await new Promise((r) => setTimeout(r, 900));
      return { hasNext: true, changed: sig() !== s0, labelled: !!(next.getAttribute("aria-label") || next.textContent?.trim()) };
    });
    ctx.check({ ...base, checkKey: "fun.carousel", title: "Sliders and carousels", description: "Next control (or autoplay) advances the slide", expected: "Active slide changes", actual: `${r.hasNext ? "Next button clicked" : "No next button; waited for autoplay"} → slide ${r.changed ? "changed" : "did NOT change"}${r.hasNext && !r.labelled ? "; next button has no label" : ""}`, severity: "Medium", screenshot: r.changed ? null : await ctx.shot(page, "carousel"), recommendation: r.changed ? (r.hasNext && !r.labelled ? "Add aria-label to slider arrows." : null) : "Check slider initialisation and controls." }, r.changed ? (r.hasNext && !r.labelled ? "warn" : true) : false);
  }

  if (comp.tablist) {
    const tabs = page.locator("[role=tablist] [role=tab]");
    const n = await tabs.count();
    if (n > 1) {
      const t = tabs.nth(1);
      await t.click({ timeout: 3000 }).catch(() => {});
      await sleep(300);
      const sel = await t.getAttribute("aria-selected");
      const panelId = await t.getAttribute("aria-controls");
      const panelVisible = panelId ? await page.locator(`#${CSS_escape(panelId)}`).isVisible().catch(() => false) : false;
      ctx.check({ ...base, checkKey: "fun.tabs", title: "Tabs", description: "Clicking a tab selects it and shows its panel", expected: "aria-selected=true and panel visible", actual: `aria-selected=${sel}; panel ${panelId ?? "(no aria-controls)"} visible=${panelVisible}`, severity: "Medium", recommendation: sel === "true" && panelVisible ? null : "Follow the WAI-ARIA tabs pattern: toggle aria-selected and hidden on panels." }, sel === "true" && panelVisible);
    }
  }

  if (comp.accordions) {
    const acc = page.locator("details > summary, .accordion-button, button[aria-expanded][aria-controls]").filter({ visible: true }).first();
    if (await acc.count()) {
      const tag = await acc.evaluate((e) => e.tagName);
      const stateBefore = tag === "SUMMARY" ? await acc.evaluate((e) => (e.parentElement as HTMLDetailsElement).open) : await acc.getAttribute("aria-expanded");
      await acc.click({ timeout: 3000 }).catch(() => {});
      await sleep(500);
      const stateAfter = tag === "SUMMARY" ? await acc.evaluate((e) => (e.parentElement as HTMLDetailsElement).open) : await acc.getAttribute("aria-expanded");
      ctx.check({ ...base, checkKey: "fun.accordion", title: "Accordions / collapsibles", description: "Clicking a header toggles its panel", expected: "Expanded state toggles", actual: `${String(stateBefore)} → ${String(stateAfter)}`, severity: "Medium", recommendation: stateBefore !== stateAfter ? null : "Ensure the accordion toggles and updates aria-expanded." }, stateBefore !== stateAfter);
    }
  }

  if (comp.modals) {
    const trig = page.locator("[data-bs-toggle=modal], [aria-haspopup=dialog], [data-modal-target], [data-toggle=modal]").filter({ visible: true }).first();
    if (await trig.count()) {
      await trig.click({ timeout: 3000 }).catch(() => {});
      await sleep(700);
      const dialog = page.locator("[role=dialog]:visible, dialog[open], .modal.show, .modal.is-open").first();
      const opened = (await dialog.count()) > 0;
      const shot = await ctx.shot(page, "modal-open");
      const focusInside = opened ? await page.evaluate(() => !!document.activeElement?.closest("[role=dialog], dialog, .modal")) : false;
      await page.keyboard.press("Escape");
      await sleep(400);
      const closed = opened ? !(await dialog.isVisible().catch(() => false)) : false;
      ctx.check({ ...base, checkKey: "fun.modal", title: "Modals and popups", description: "Trigger opens a dialog; focus moves inside; Escape closes it", expected: "Opens, focus inside, closes on Esc", actual: `Opened: ${opened}; focus inside: ${focusInside}; closed on Esc: ${closed}`, severity: "Medium", screenshot: shot, recommendation: opened && focusInside && closed ? null : "Move focus into the dialog on open, trap it, close on Escape and return focus to the trigger." }, !opened ? false : focusInside && closed ? true : "warn");
    }
  }

  if (comp.search) {
    const input = page.locator("input[type=search], input[name=q], input[name=s], input[name=search], input[name=query]").filter({ visible: true }).first();
    const before = page.url();
    await input.fill("test").catch(() => {});
    await Promise.all([page.waitForLoadState("load", { timeout: 10000 }).catch(() => {}), input.press("Enter").catch(() => {})]);
    await sleep(1200);
    const after = page.url();
    const hasResults = await page.evaluate(() => /result|found|search/i.test(document.body.innerText.slice(0, 5000)));
    ctx.check({ ...base, checkKey: "fun.search", title: "Search functionality", description: 'Submitting "test" shows a results page or live results', expected: "Results view rendered", actual: `URL ${before === after ? "unchanged" : `→ ${after}`}; results text present: ${hasResults}`, severity: "Medium", screenshot: await ctx.shot(page, "search"), recommendation: hasResults ? null : "Verify the search form action and results template (including the empty state)." }, hasResults ? true : "warn");
    if (before !== after) await page.goto(before, { waitUntil: "load" }).catch(() => {});
  }

  if (comp.pagination.length) {
    const r = await pMap([...new Set(comp.pagination)].slice(0, 10), 4, (h) => fetchChain(page.context().request, h, { method: "HEAD", readBody: false }));
    const bad = r.filter((x) => x.status === null || x.status >= 400);
    ctx.check({ ...base, checkKey: "fun.pagination", title: "Pagination", description: "Pagination links resolve", expected: "All pages load", actual: bad.length ? bad.map((b) => `${b.status ?? b.error} ${b.url}`).join("\n") : `${r.length} pagination link(s) OK`, severity: "Medium", recommendation: bad.length ? "Fix pagination URLs." : null }, bad.length === 0);
  }

  // ---------- breadcrumbs ----------
  if (!isHome) {
    if (comp.breadcrumb) {
      const homeLinked = comp.breadcrumb.some((h) => { try { const u = new URL(h); return u.origin === origin && (u.pathname === "/" || u.pathname === ""); } catch { return false; } });
      ctx.check({ ...base, checkKey: "fun.breadcrumbs", title: "Breadcrumbs", description: "Breadcrumb trail present with a link back to home", expected: "Breadcrumb with home link", actual: `${comp.breadcrumb.length} breadcrumb link(s); home linked: ${homeLinked}`, severity: "Low", recommendation: homeLinked ? null : "Include the homepage as the first breadcrumb item." }, homeLinked ? true : "warn");
    } else if (p.depth >= 2) ctx.check({ ...base, checkKey: "fun.breadcrumbs", title: "Breadcrumbs", description: "Deep pages show a breadcrumb trail", expected: "Breadcrumb present on depth ≥ 2 pages", actual: "No breadcrumb found", severity: "Low", recommendation: "Add breadcrumbs (with BreadcrumbList schema) to inner pages." }, "warn");
  }

  // ---------- footer / social / downloads ----------
  const footer = await regionLinks(ctx, page, "footer");
  if (footer.all.length) ctx.check({ ...base, checkKey: "fun.footer-links", title: "Footer links", description: "All footer links resolve", expected: "All 2xx/3xx", actual: footer.broken.length ? footer.broken.map((b) => `${b.status ?? "ERR"} "${b.text}" ${b.href}`).join("\n") : `${footer.checked.length} link(s) OK`, severity: "Medium", recommendation: footer.broken.length ? "Fix broken footer links." : null }, footer.broken.length === 0);
  else if (isHome) ctx.check({ ...base, checkKey: "fun.footer-links", title: "Footer links", description: "Page has a footer with links", expected: "Footer present", actual: "No <footer> links found", severity: "Low", recommendation: "Use a semantic <footer> element." }, "warn");

  if (isHome || ctx.full) {
    const all = await page.$$eval("a[href]", (as) => as.map((a) => ({ href: (a as HTMLAnchorElement).href, target: a.getAttribute("target"), label: a.getAttribute("aria-label") ?? a.textContent?.trim() ?? "" })));
    const social = [...new Map(all.filter((a) => SOCIAL.test(a.href)).map((a) => [a.href, a])).values()];
    if (social.length) {
      const generic = social.filter((s) => { try { return new URL(s.href).pathname.split("/").filter(Boolean).length === 0; } catch { return true; } });
      const noLabel = social.filter((s) => !s.label);
      ctx.check({ ...base, checkKey: "fun.social-links", title: "Social media links", description: "Social icons point at the company profiles, open in a new tab, and are labelled", expected: "Profile URLs (not platform homepages), target=_blank, aria-label", actual: [`${social.length} social link(s): ${social.map((s) => s.href).join(", ")}`, ...generic.map((g) => `Points at platform homepage: ${g.href}`), ...noLabel.map((n) => `No accessible label: ${n.href}`)].join("\n"), severity: "Low", recommendation: generic.length || noLabel.length ? "Link to the real profile pages and add aria-label (e.g. \"LinkedIn\")." : null }, generic.length ? false : noLabel.length ? "warn" : true);
    }
    const downloads = [...new Set(all.map((a) => a.href).filter((h) => { try { return DOWNLOAD_EXT.test(new URL(h).pathname); } catch { return false; } }))].slice(0, 20);
    if (downloads.length) {
      const r = await pMap(downloads, 4, (h) => fetchChain(page.context().request, h, { method: "HEAD", readBody: false }));
      const bad = r.filter((x) => x.status === null || x.status >= 400);
      ctx.check({ ...base, checkKey: "fun.downloads", title: "Download links", description: "Downloadable files (PDF, DOCX, ZIP…) exist", expected: "All return 200", actual: bad.length ? bad.map((b) => `${b.status ?? b.error} ${b.url}`).join("\n") : r.map((x) => `${x.status} ${Math.round(x.bytes / 1024)} KB ${x.url}`).join("\n"), severity: "Medium", recommendation: bad.length ? "Upload the missing files or update the links." : null }, bad.length === 0);
    }
  }
}

/** Site-level: custom 404 page. */
export async function functionalSite(ctx: ScanContext) {
  const origin = new URL(ctx.rootUrl).origin;
  const probe = `${origin}/qa-platform-missing-page-${Date.now().toString(36)}`;
  const { ctx: bctx, page, resp } = await ctx.openPage(probe).catch(() => ({ ctx: null, page: null, resp: null }) as never);
  if (!page) {
    ctx.notTested({ category: "functional", pageUrl: probe, checkKey: "fun.404", title: "404 page", description: "Custom not-found page", reason: "Could not load probe URL", severity: "Medium" });
    return;
  }
  try {
    const status = resp?.status() ?? 0;
    const info = await page.evaluate(() => ({ text: document.body.innerText.slice(0, 600), links: document.querySelectorAll("a[href]").length, hasNav: !!document.querySelector("header, nav") }));
    const custom = info.links > 2 && info.hasNav;
    const shot = await ctx.shot(page, "404-page");
    ctx.check({ category: "functional", pageUrl: probe, checkKey: "fun.404", title: "404 page", description: "Unknown URLs return HTTP 404 with a branded page offering navigation", expected: "HTTP 404 + custom page with navigation", actual: `HTTP ${status}; ${custom ? "custom page with navigation" : "bare/default page"}; "${info.text.replace(/\s+/g, " ").slice(0, 120)}"`, severity: status === 200 ? "High" : "Medium", screenshot: shot, recommendation: status !== 404 ? "Return a real 404 status for missing pages (soft-404s hurt SEO)." : !custom ? "Design a helpful 404 page with search and links home." : null }, status === 404 ? (custom ? true : "warn") : false);
  } finally {
    await bctx.close();
  }
}

function CSS_escape(s: string) {
  return s.replace(/([^a-zA-Z0-9_-])/g, "\\$1");
}
