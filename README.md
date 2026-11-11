# Sitecheck QA — Corporate Website Testing Platform

Sitecheck QA is a tool for UI development teams. It crawls a website before handover to QA or deployment, runs automated checks against the real site, scores the results and produces PDF, Excel and CSV reports.

Built with Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, shadcn-style Radix components, Playwright, Lighthouse, axe-core, Recharts, SQLite and Vitest.

## Quick start

```bash
npm install
npx playwright install chromium firefox webkit   # browser engines
npm run build && npm start                       # http://localhost:3000
```

For development, use `npm run dev`. To try the platform on a local demo site that contains deliberate defects:

```bash
npm run demo-site      # serves tests/fixtures/site on http://localhost:4321
```

Then scan `http://localhost:4321` from **New Scan**.

Data is stored in `./data`. The SQLite database is `qa.sqlite` and screenshots go in `screenshots/`. Set `QA_DATA_DIR` to change the location, and `QA_SECRET_KEY` to supply your own key for encrypting stored credentials. If you don't set a key, one is generated in `data/.secret-key`.

## Workflow

1. **New Scan**: enter the URL and choose Quick or Full mode. Under **What to test**, tick the categories to run (SEO, Performance/PageSpeed, Accessibility, Functional, Forms, Responsive, Images, Animation, Google integrations, Cross-browser, Security, Email), or use a preset: *Everything*, *PageSpeed set* (Performance, Accessibility, SEO) or *UI handover*. Crawl and link checks always run. Each project remembers its last selection. A scan that skips categories is labelled **Partial scan** on the scan page and in reports, and its handover status covers only what was tested. You can also set crawl limits, add URLs by hand, choose browsers, set the expected production URL (used for the canonical check) and add authentication (Basic, cookie or login form).
2. **Discovery** runs as a background job. It reads robots.txt and sitemap.xml, crawls links breadth-first (falling back to a real browser on JavaScript-rendered sites), and checks internal and external links for broken links, redirects and redirect chains, duplicate URLs, and pages listed in the sitemap that are missing.
3. **Select pages** (or add more by hand), then **Start testing**. Progress streams live over Server-Sent Events.
4. **Review**: open the Overview, Issues, All tests, Screenshots, Pages and Logs tabs. From an issue you can mark it resolved, assign it to a developer and add comments. You can re-run only the failed tests, compare the scan with an earlier one, and export PDF, Excel or CSV.

| | Quick Scan | Full Scan |
|---|---|---|
| Core checks (SEO, a11y, images, functional, security, integrations) | All selected pages | All selected pages |
| Responsive viewports | 1440 / 768 / 390 | All 10 (1920 → 360) |
| Lighthouse | Homepage, mobile | Up to N pages (Settings), desktop **and** mobile |
| Animation profiling | Homepage | Up to 15 pages, including a 4× CPU-throttled mobile run |
| Cross-browser | Homepage | Up to 5 pages |

## What is tested

| Module | Checks |
|---|---|
| **Crawl** | Broken internal/external links, redirect chains, cross-domain redirects, duplicate URLs, sitemap presence, coverage, missing sitemap pages |
| **Functional** | Page load, logo → home, nav links, dropdowns (hover/click), mobile menu (tap + `aria-expanded`), sticky header, active menu state, external link `rel`, dead CTAs, carousels, tabs, accordions, modals (focus + Esc), search, pagination, breadcrumbs, footer, social and download links, custom 404 with real 404 status |
| **Forms** | Required-field, email and phone validation, error messaging, CAPTCHA detection; submission, API response, duplicate-submit prevention and success message (**only when enabled**) |
| **Responsive** | Horizontal overflow (lists the offending elements), text overlap, image scaling, button positioning and tap targets, nav availability, landmark visibility, alignment, small text, full-page screenshots and **pixel diffs against the previous scan** |
| **Images** | Broken or missing images, alt text, file size budget, WebP/AVIF use, lazy loading, oversized dimensions, aspect-ratio distortion, width/height attributes, duplicate assets (content hash), naming convention (`page-section-description.webp`, with a suggested name) |
| **Animation** | Detects GSAP, ScrollTrigger, Lenis, Lottie, AOS, Locomotive, Swup/Barba, parallax, sticky/pinned sections and video. Measures scroll FPS and jank, layout shift during scroll, scroll freezing, CPU use (long tasks), heap growth (leaks), flicker at rest, hover transitions, Lottie and video health, `prefers-reduced-motion` compliance and throttled mobile performance |
| **Performance** | Lighthouse score; FCP, LCP, CLS, Speed Index, TBT and TTFB against Core Web Vitals targets; JavaScript execution, unused CSS/JS, render-blocking resources, compression, caching, font-display and image opportunities. **INP comes only from CrUX field data** (API key needed). TBT is never used as a stand-in for INP |
| **SEO** | Title, meta description, single H1, heading order, canonical (self-referencing, HTTPS, production domain), noindex, Open Graph and OG image, Twitter card, `lang`, JSON-LD validation, duplicate titles and descriptions, robots.txt, sitemap, favicon, HTTP → HTTPS redirect, www vs non-www |
| **Google** | GTM container ID format and expected match, duplicate containers, runtime initialisation, noscript fallback, expected dataLayer events; GA4 ID, `page_view` hits, duplicate tracking; reCAPTCHA v3 script, token generation (confirms the domain is allowed), secret exposure, and backend validation of valid, invalid and replayed tokens through **your authorised test endpoint** |
| **Accessibility** | Tested at the level chosen for the scan (see below). One result per axe rule, impact-based severity and highlighted screenshots. At WCAG A/AA also keyboard Tab traversal and trap detection and dropdown/dialog ARIA; at AA also visible focus and skip link |
| **Email** | Reads a Mailpit/MailHog test inbox: delivery, user confirmation, admin notification, subject, sender, recipients, merged values, and HTML rendering at 800px and 375px |
| **Cross-browser** | Chromium, Firefox, WebKit and Edge (if installed): console errors, font loading, navigation, and layout compared with Chromium (height, H1 position, nav/form/animation counts), with screenshots |
| **Security** | HTTPS, mixed content, HSTS/CSP/nosniff/Referrer/Permissions-Policy, clickjacking protection, version disclosure, secrets in page source, third-party SRI, console errors, failed requests, exposed files (`.env`, `.git`, …, confirmed by their content, not just the status code) |

Every test case records: ID, category, page, description, expected and actual results, PASS / FAIL / WARNING / NOT TESTED, severity, screenshot evidence, error, recommended fix, viewport, browser and timestamp. When a check cannot run (for example, no CrUX key or form submission turned off), it is reported as **NOT TESTED** with the reason. It is never reported as passed.

## Accessibility levels

Choose a level for each project on **New Scan**. The form remembers each project's last choice, and new projects default to Basic.

| Level | What it checks | Passes when |
|---|---|---|
| **Basic (Lighthouse)** | The 57 axe rules in the PageSpeed Insights / Lighthouse 12.8 accessibility score, with Lighthouse's weights. Lighthouse's "informative" audits (bypass, duplicate-id-aria, form-field-multiple-labels, th-has-data-cells, video-caption) are warnings that don't affect the score, as in PageSpeed | Every page scores 100 |
| **WCAG 2.1 A** | All automated WCAG 2.0/2.1 Level A rules, plus keyboard access and ARIA widget checks | No Level A violations |
| **WCAG 2.1 AA** | Level A and AA rules, plus visible focus and skip link. Best-practice-only rules are warnings | No A/AA violations |

Scans inject the same axe-core build Lighthouse uses, so Basic gives the same score as Lighthouse's desktop accessibility score for the same page. Checked against Lighthouse on the demo site: 91, 100 and 94. The PageSpeed mobile score can differ slightly (for example, `target-size` at phone width). Scans created before levels existed are treated as AA.

## Sharing issues with developers

Open **Projects & Sharing**, or a scan's **Share with developer** button. Enter the developer's name, choose an expiry (7, 30 or 90 days, or never) and create the link. It's copied to your clipboard.

A link opens the issues (FAIL and WARNING results) for **that project only**, for any of its completed scans. With it, a developer can:

- see each issue's details, the recommended fix, screenshot evidence and QA notes;
- set the **bug status**: Open, In progress, Fixed – ready for retest, Needs info or Won't fix;
- add a developer note, such as a commit or PR link.

The developer can't see other projects, run scans, mark issues resolved, change the assignee or QA comment, or open settings and reports. Every share API checks that the result, scan or screenshot belongs to the link's project. Status changes are recorded with the developer's name, and QA sees them, with their history, in the result dialog.

"Fixed" is the developer's claim. It doesn't change the score or the handover status. Confirm it with **Re-run failed**, or mark the issue resolved yourself.

You can revoke a link at any time, and it stops working immediately. Tokens are 256-bit random values, looked up by hash and stored encrypted.

**Set `QA_ADMIN_PASSWORD` before sharing links outside your machine.** Without it, the admin area has no login and anyone who can reach the server can open everything. With it set, every page and API except `/share/…` requires admin sign-in. Put it in `.env.local` (see `.env.example`) and restart.

## Scoring

- Each test adds its severity weight to its category: Critical 10, High 5, Medium 3, Low 1. A PASS earns the full weight, a WARNING earns half and a FAIL earns nothing. NOT TESTED results are excluded, and resolved issues count as passed.
- The Lighthouse score (Performance) and the axe-derived score (Accessibility) are averaged 50/50 with the test-based score.
- **Overall** is the weighted average of the category scores. You can change the weights in Settings.
- **Production ready** requires no open critical issues, open High issues within the configured limit, and an overall score at or above the threshold. The handover status is `READY FOR QA`, `READY WITH WARNINGS` or `NOT READY`.

## Deploying (Docker on Railway or Render)

The app needs one always-running server with real browsers and a persistent disk, so it can't run on Vercel or other serverless hosts. The included `Dockerfile` is based on the official Playwright image (Chromium, Firefox and WebKit) and stores everything in `/data`.

| Variable | Required | Notes |
|---|---|---|
| `QA_ADMIN_PASSWORD` | Yes | The container refuses to start without it, so the admin area is never left open on the internet |
| `QA_SECRET_KEY` | Recommended | Any long random string. Encrypts stored scan credentials and share tokens. If you change it, existing ones stop working |
| `QA_DATA_DIR` | No | Defaults to `/data` in the image |

Run **one instance only**. SQLite and the job queue live inside the container. Give it at least **2 GB RAM**, since Lighthouse and three browser engines are heavy.

**Railway**
1. New Project → Deploy from GitHub repo → pick this repo. `railway.json` makes it build the Dockerfile and use `/api/health` for health checks.
2. On the service, open **Variables** and add `QA_ADMIN_PASSWORD` and `QA_SECRET_KEY`.
3. Right-click the service → **Attach volume**, mount path `/data`.
4. Under **Settings → Networking**, choose **Generate domain** (port 3000).

**Render**
1. New → **Blueprint** → pick this repo. `render.yaml` creates a Docker web service with a 5 GB disk at `/data` and generates `QA_SECRET_KEY`.
2. Enter `QA_ADMIN_PASSWORD` when asked. Disks need a paid instance type; the blueprint uses *Standard* (2 GB).

**Locally**
```bash
docker build -t sitecheck-qa .
docker run -p 3000:3000 -v sitecheck-data:/data -e QA_ADMIN_PASSWORD=change-me -e QA_SECRET_KEY=$(openssl rand -hex 32) sitecheck-qa
```

When you upgrade `playwright` in package.json, change the image tag on the first line of the Dockerfile to the same version.

A hosted scanner can reach anything its server can, so only scan sites you're authorised to test. Form submissions stay blocked unless you turn them on in Settings.

## Safety

- Only scan sites you are authorised to test. The checks are passive: GET requests, a real browser, and well-known file paths. Nothing is destructive or intrusive.
- Form tests **block every non-GET request** unless *Allow real form submissions* is turned on in Settings. Turn it on only for staging with a test mail server.
- The platform never sends email. It only reads a test inbox.
- The platform never handles the reCAPTCHA secret. Backend checks call an endpoint you provide (`POST {token, action} → {success, score}`).
- Optional admin password (`QA_ADMIN_PASSWORD`) protects everything except developer share links, which are limited to one project and to bug status and notes.
- Scan credentials are encrypted with AES-256-GCM. They are never returned by the API and never included in reports. Secret-like values are redacted from results and logs.

## Architecture

```
src/
  app/                   UI pages (dashboard, scan, scans/[id], compare, settings) + API route handlers
  components/            shadcn-style UI primitives, charts, scan views
  lib/
    types.ts url.ts naming.ts scoring.ts      pure, unit-tested logic shared by UI and server
    server/
      db.ts              SQLite persistence (websites, scans, pages, links, results, screenshots, logs, settings)
      jobs.ts            in-process background queue (configurable concurrency)
      secrets.ts         credential encryption + redaction
      engine/
        context.ts       ScanContext: browsers, auth, screenshots, result recording, progress events
        crawler.ts       discovery + link checking
        runner.ts        orchestration, scoring, re-run of failed tests
        modules/*.ts     one module per testing category
      reports/           PDF (Playwright print), Excel (exceljs), CSV
tests/                   Vitest unit tests + demo fixture site
```

Scans run in the Node.js server process. Progress is saved to SQLite and pushed to the browser over SSE. If the server restarts mid-scan, that scan is marked as interrupted and you'll need to run it again.

## Scripts

`npm run dev` · `npm run build` · `npm start` · `npm test` (Vitest) · `npm run typecheck` · `npm run lint` · `npm run demo-site`

## Known limitations

- WebKit is Playwright's WebKit build, not Apple Safari, so iOS-specific behaviour isn't covered. Edge tests need Microsoft Edge installed on the host.
- Flicker, misalignment and text-overlap detection are heuristics. Review the flagged screenshots.
- Automated accessibility testing finds roughly 30–40% of WCAG issues. Follow up with manual screen-reader testing.
- Jobs run in a single process. To scale horizontally, move `jobs.ts` to a shared queue such as BullMQ with Redis.
