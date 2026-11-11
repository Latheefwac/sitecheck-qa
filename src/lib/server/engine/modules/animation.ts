/* eslint-disable @typescript-eslint/no-explicit-any -- probes untyped third-party globals (gsap, grecaptcha, dataLayer) inside page.evaluate */
import "server-only";
import type { Page } from "playwright";
import type { PageRecord } from "../../../types";
import type { ScanContext } from "../context";
import { sleep } from "../util";

interface Libs {
  gsap: string | null;
  scrollTrigger: number | null;
  lenis: boolean;
  lottie: number;
  videos: number;
  autoplayVideosMuted: boolean;
  parallax: number;
  sticky: number;
  cssAnimations: number;
  transitionsOnHover: number;
  locomotive: boolean;
  aos: number;
  swup: boolean;
  barba: boolean;
}

async function detect(page: Page): Promise<Libs> {
  return page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    const st = w.ScrollTrigger ?? w.gsap?.ScrollTrigger;
    const els = [...document.querySelectorAll<HTMLElement>("body *")].slice(0, 3000);
    return {
      gsap: w.gsap?.version ?? (w.TweenMax ? "TweenMax (legacy)" : null),
      scrollTrigger: st?.getAll ? st.getAll().length : null,
      lenis: !!(w.lenis || w.Lenis || document.documentElement.classList.contains("lenis")),
      lottie: document.querySelectorAll("lottie-player, dotlottie-player, [data-lottie], .lottie").length + (w.lottie || w.bodymovin ? 1 : 0),
      videos: document.querySelectorAll("video").length,
      autoplayVideosMuted: [...document.querySelectorAll("video[autoplay]")].every((v) => (v as HTMLVideoElement).muted),
      parallax: document.querySelectorAll("[data-parallax], .parallax, [data-speed], [data-scroll-speed], .rellax, .jarallax").length,
      sticky: els.filter((e) => getComputedStyle(e).position === "sticky").length + document.querySelectorAll(".pin-spacer").length,
      cssAnimations: document.getAnimations ? document.getAnimations().length : 0,
      transitionsOnHover: els.filter((e) => /^(A|BUTTON)$/.test(e.tagName) && parseFloat(getComputedStyle(e).transitionDuration) > 0).length,
      locomotive: !!document.querySelector("[data-scroll-container]"),
      aos: document.querySelectorAll("[data-aos]").length,
      swup: !!w.swup,
      barba: !!w.barba || !!document.querySelector("[data-barba]"),
    };
  });
}

/** Scrolls the page while sampling rAF frame times, layout shifts, long tasks and heap. */
async function scrollProfile(page: Page) {
  return page.evaluate(async () => {
    const frames: number[] = [];
    let shifts = 0;
    let shiftCount = 0;
    let longTasks = 0;
    let longTaskMs = 0;
    const po1 = new PerformanceObserver((l) => l.getEntries().forEach((e: any) => { if (!e.hadRecentInput) { shifts += e.value; shiftCount++; } }));
    try { po1.observe({ type: "layout-shift", buffered: false }); } catch {}
    const po2 = new PerformanceObserver((l) => l.getEntries().forEach((e) => { longTasks++; longTaskMs += e.duration; }));
    try { po2.observe({ type: "longtask", buffered: false }); } catch {}
    const mem0 = (performance as any).memory?.usedJSHeapSize ?? null;
    let last = performance.now();
    let running = true;
    const loop = (t: number) => { frames.push(t - last); last = t; if (running) requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    const max = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) - innerHeight;
    const steps = Math.min(40, Math.max(8, Math.round(max / (innerHeight * 0.5))));
    let frozen = 0;
    const t0 = performance.now();
    for (let i = 1; i <= steps; i++) {
      const target = (max * i) / steps;
      const before = scrollY;
      window.scrollTo({ top: target, behavior: "instant" as ScrollBehavior });
      // smooth-scroll libraries hijack wheel/scroll; also dispatch a wheel event
      window.dispatchEvent(new WheelEvent("wheel", { deltaY: innerHeight * 0.5 }));
      await new Promise((r) => setTimeout(r, 140));
      if (Math.abs(scrollY - before) < 2 && target - before > 20) frozen++;
    }
    const duration = performance.now() - t0;
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    await new Promise((r) => setTimeout(r, 300));
    running = false;
    po1.disconnect();
    po2.disconnect();
    const mem1 = (performance as any).memory?.usedJSHeapSize ?? null;
    const valid = frames.slice(2);
    const avg = valid.reduce((a, b) => a + b, 0) / Math.max(1, valid.length);
    const sorted = [...valid].sort((a, b) => a - b);
    return {
      fps: avg ? Math.round(1000 / avg) : 0,
      p95FrameMs: Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
      jank: valid.filter((f) => f > 50).length,
      frames: valid.length,
      cls: Math.round(shifts * 1000) / 1000,
      shiftCount,
      longTasks,
      longTaskMs: Math.round(longTaskMs),
      cpuBusyPct: Math.round((longTaskMs / duration) * 100),
      heapGrowthKb: mem0 !== null && mem1 !== null ? Math.round((mem1 - mem0) / 1024) : null,
      frozen,
      steps,
      scrollable: max > 50,
    };
  });
}

export async function animationPage(ctx: ScanContext, p: PageRecord) {
  const base = { category: "animation" as const, pageUrl: p.url };
  // ---------- desktop ----------
  const { ctx: bctx, page } = await ctx.openPage(p.url, { context: { viewport: { width: 1440, height: 900 } } });
  let libs: Libs;
  try {
    libs = await detect(page);
    const found = [
      libs.gsap && `GSAP ${libs.gsap}`, libs.scrollTrigger !== null && `ScrollTrigger (${libs.scrollTrigger} triggers)`, libs.lenis && "Lenis smooth scroll",
      libs.lottie && `Lottie (${libs.lottie})`, libs.videos && `${libs.videos} video(s)`, libs.parallax && `parallax (${libs.parallax})`, libs.sticky && `sticky/pinned (${libs.sticky})`,
      libs.aos && `AOS (${libs.aos})`, libs.locomotive && "Locomotive Scroll", (libs.swup || libs.barba) && "page transitions (Swup/Barba)", libs.cssAnimations && `${libs.cssAnimations} running CSS/Web animations`,
    ].filter(Boolean) as string[];
    ctx.add({ ...base, checkKey: "ani.inventory", title: "Animation libraries & effects detected", description: "GSAP, ScrollTrigger, Lenis, Lottie, parallax, sticky/pinned sections, video and page transitions", expected: "Inventory recorded", actual: found.length ? found.join("\n") : "No animation libraries detected", status: "PASS", severity: "Low", meta: { ...libs } });

    if (libs.gsap) {
      const gs = await page.evaluate(() => {
        const g = (window as any).gsap;
        const tweens = g?.globalTimeline?.getChildren?.(true, true, false) ?? [];
        const stuck = tweens.filter((t: any) => t.duration() > 0 && t.isActive?.() && t.progress() === 0).length;
        const st = (window as any).ScrollTrigger ?? g?.ScrollTrigger;
        const triggers = st?.getAll?.() ?? [];
        const missing = triggers.filter((t: any) => !t.trigger || !document.contains(t.trigger)).length;
        return { tweens: tweens.length, stuck, triggers: triggers.length, missing };
      });
      ctx.check({ ...base, checkKey: "ani.gsap", title: "GSAP / ScrollTrigger health", description: "Tweens progress and every ScrollTrigger has a live trigger element", expected: "0 stalled tweens, 0 orphaned triggers", actual: `${gs.tweens} tween(s), ${gs.stuck} stalled; ${gs.triggers} ScrollTrigger(s), ${gs.missing} orphaned`, severity: "Medium", recommendation: gs.missing || gs.stuck ? "Kill ScrollTriggers on route change (ctx.revert()), call ScrollTrigger.refresh() after layout changes." : null }, gs.missing + gs.stuck === 0);
    }

    const prof = await scrollProfile(page);
    if (!prof.scrollable) {
      ctx.notTested({ ...base, checkKey: "ani.scroll", title: "Scroll animation performance", description: "Page is not scrollable", reason: "Page shorter than the viewport", severity: "Low" });
    } else {
      ctx.check({ ...base, checkKey: "ani.fps", title: "Frame rate during scroll (desktop)", description: "Average FPS and jank while scrolling the full page", expected: "≥ 50 fps, ≤ 3 frames over 50ms", actual: `${prof.fps} fps avg, p95 frame ${prof.p95FrameMs} ms, ${prof.jank} janky frame(s) of ${prof.frames}`, severity: "Medium", recommendation: prof.fps < 50 || prof.jank > 3 ? "Animate only transform/opacity, add will-change sparingly, avoid layout reads in scroll handlers, throttle via rAF." : null, meta: prof }, prof.fps >= 50 && prof.jank <= 3 ? true : prof.fps >= 30 ? "warn" : false);
      ctx.check({ ...base, checkKey: "ani.layout-shift", title: "Unexpected layout shifts during scroll", description: "Layout-shift entries recorded while scrolling (reveal animations should not move layout)", expected: "Scroll CLS ≤ 0.1", actual: `CLS ${prof.cls} from ${prof.shiftCount} shift(s)`, severity: "Medium", recommendation: prof.cls > 0.1 ? "Animate transform instead of top/height/margin; reserve space for revealed content." : null }, prof.cls <= 0.1 ? true : prof.cls <= 0.25 ? "warn" : false);
      ctx.check({ ...base, checkKey: "ani.scroll-freeze", title: "Scroll freezing", description: "Each programmatic scroll step moves the page", expected: "0 frozen steps", actual: `${prof.frozen} of ${prof.steps} step(s) did not move${libs.lenis ? " (Lenis detected — it may virtualise scroll)" : ""}`, severity: "High", recommendation: prof.frozen ? "Check for overflow:hidden on html/body left by a preloader/modal, or a pinned section that never releases." : null }, prof.frozen === 0 ? true : libs.lenis || libs.locomotive ? "warn" : false);
      ctx.check({ ...base, checkKey: "ani.cpu", title: "CPU usage during animations", description: "Share of scroll time spent in long tasks (>50ms)", expected: "≤ 20% busy", actual: `${prof.cpuBusyPct}% (${prof.longTasks} long task(s), ${prof.longTaskMs} ms)`, severity: "Medium", recommendation: prof.cpuBusyPct > 20 ? "Profile scroll handlers; batch DOM reads/writes; prefer CSS/ScrollTimeline for simple effects." : null }, prof.cpuBusyPct <= 20 ? true : prof.cpuBusyPct <= 40 ? "warn" : false);
      if (prof.heapGrowthKb !== null) ctx.check({ ...base, checkKey: "ani.memory", title: "Memory growth (possible leak)", description: "JS heap growth after a full scroll cycle", expected: "≤ 5 MB growth", actual: `${prof.heapGrowthKb} KB`, severity: "Medium", recommendation: prof.heapGrowthKb > 5120 ? "Look for listeners/tweens created on every scroll or intersection callback without cleanup." : null }, prof.heapGrowthKb <= 5120 ? true : prof.heapGrowthKb <= 20480 ? "warn" : false);
    }

    // flicker / instability at rest: two screenshots 600ms apart at the same scroll position
    await sleep(800);
    const a = await page.screenshot({ type: "png" });
    await sleep(600);
    const b = await page.screenshot({ type: "png" });
    const runningAnims = await page.evaluate(() => (document.getAnimations ? document.getAnimations().filter((x) => x.playState === "running").length : 0));
    const changed = !a.equals(b);
    ctx.check({ ...base, checkKey: "ani.stability", title: "Visual stability at rest (flicker)", description: "The viewport stops changing once animations settle", expected: "Identical frames 600ms apart (or intentional looping animation)", actual: changed ? `Viewport still changing; ${runningAnims} running animation(s)` : "Stable", severity: "Low", screenshot: changed ? await ctx.shot(page, "ani-unstable") : null, recommendation: changed ? "Confirm continuous motion is intentional (carousel/video); otherwise look for repeating opacity toggles." : null }, changed ? "warn" : true);

    // hover animations
    const hover = await page.evaluate(() => {
      const el = [...document.querySelectorAll<HTMLElement>("a.btn, .btn, button, nav a")].find((e) => e.getBoundingClientRect().width > 0 && parseFloat(getComputedStyle(e).transitionDuration) > 0);
      if (!el) return null;
      el.setAttribute("data-qa-hover", "1");
      return { duration: getComputedStyle(el).transitionDuration, prop: getComputedStyle(el).transitionProperty };
    });
    if (hover) {
      const loc = page.locator("[data-qa-hover]").first();
      const before = await loc.evaluate((e) => getComputedStyle(e).cssText || JSON.stringify([getComputedStyle(e).backgroundColor, getComputedStyle(e).color, getComputedStyle(e).transform]));
      await loc.hover({ timeout: 3000 }).catch(() => {});
      await sleep(Math.min(1500, parseFloat(hover.duration) * 1000 + 100));
      const after = await loc.evaluate((e) => getComputedStyle(e).cssText || JSON.stringify([getComputedStyle(e).backgroundColor, getComputedStyle(e).color, getComputedStyle(e).transform]));
      const slow = parseFloat(hover.duration) > 0.6;
      ctx.check({ ...base, checkKey: "ani.hover", title: "Hover animations", description: "Interactive elements respond to hover with a short transition", expected: "Visible state change, duration ≤ 600ms", actual: `transition ${hover.prop} ${hover.duration}; state ${before !== after ? "changed" : "did not change"} on hover`, severity: "Low", recommendation: slow ? "Keep hover transitions between 150–300ms." : before === after ? "Add a :hover style so users get feedback." : null }, before !== after && !slow ? true : "warn");
    }

    if (libs.lottie) {
      const lot = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("lottie-player, dotlottie-player")].map((l) => ({ hasSvg: !!(l.shadowRoot?.querySelector("svg, canvas") ?? l.querySelector("svg, canvas")) })));
      const broken = lot.filter((l) => !l.hasSvg).length;
      ctx.check({ ...base, checkKey: "ani.lottie", title: "Lottie animations render", description: "Each Lottie player has rendered an SVG/canvas", expected: "All players rendered", actual: `${lot.length - broken}/${lot.length} rendered`, severity: "Medium", recommendation: broken ? "Check the animation JSON URL and CORS; preload the player script." : null }, broken === 0);
    }
    if (libs.videos) {
      const vids = await page.evaluate(() => [...document.querySelectorAll("video")].map((v) => ({ src: v.currentSrc, err: v.error?.code ?? null, ready: v.readyState, autoplay: v.autoplay, muted: v.muted, playsinline: v.playsInline, poster: !!v.poster })));
      const issues = vids.flatMap((v) => [v.err ? `Error ${v.err}: ${v.src}` : "", v.autoplay && !v.muted ? `Autoplay without muted: ${v.src}` : "", v.autoplay && !v.playsinline ? `Autoplay without playsinline (iOS fullscreen): ${v.src}` : "", !v.poster ? `No poster: ${v.src}` : ""]).filter(Boolean);
      ctx.check({ ...base, checkKey: "ani.video", title: "Video animations", description: "Background/hero videos load, autoplay muted inline with a poster", expected: "No errors; autoplay ⇒ muted + playsinline; poster set", actual: issues.length ? issues.join("\n") : `${vids.length} video(s) OK`, severity: vids.some((v) => v.err) ? "High" : "Low", recommendation: issues.length ? 'Use <video autoplay muted loop playsinline poster="…">.' : null }, vids.some((v) => v.err) ? false : issues.length ? "warn" : true);
    }
  } finally {
    await bctx.close();
  }

  // ---------- reduced motion ----------
  const rm = await ctx.openPage(p.url, { context: { viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" } });
  try {
    const data = await rm.page.evaluate(async () => {
      window.scrollTo(0, innerHeight);
      await new Promise((r) => setTimeout(r, 400));
      const running = document.getAnimations ? document.getAnimations().filter((a) => a.playState === "running" && ((a.effect?.getTiming().duration as number) ?? 0) > 200).length : 0;
      const css = [...document.styleSheets].some((s) => { try { return [...s.cssRules].some((r) => r.cssText.includes("prefers-reduced-motion")); } catch { return false; } });
      const gsapMM = !!(window as any).gsap?.matchMedia;
      return { running, css, gsapMM };
    });
    const respects = data.css || data.running === 0;
    ctx.check({ ...base, checkKey: "ani.reduced-motion", title: "Reduced-motion compatibility", description: "With prefers-reduced-motion: reduce, non-essential motion is disabled", expected: "prefers-reduced-motion handled; no long animations running", actual: `CSS media query present: ${data.css ? "yes" : "no"}; long animations still running: ${data.running}${libs!.gsap ? `; gsap.matchMedia available: ${data.gsapMM ? "yes" : "no"}` : ""}`, severity: "Medium", recommendation: respects ? null : "Wrap motion in @media (prefers-reduced-motion: no-preference) and use gsap.matchMedia() for GSAP timelines (WCAG 2.3.3)." }, respects ? (data.running > 2 ? "warn" : true) : false);
  } finally {
    await rm.ctx.close();
  }

  // ---------- mobile with CPU throttling ----------
  if (ctx.full) {
    const m = await ctx.openPage(p.url, { context: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } });
    try {
      const cdp = await m.ctx.newCDPSession(m.page).catch(() => null);
      await cdp?.send("Emulation.setCPUThrottlingRate", { rate: 4 }).catch(() => {});
      const prof = await scrollProfile(m.page);
      if (prof.scrollable)
        ctx.check({ ...base, viewport: "mobile-390", checkKey: "ani.mobile", title: "Mobile animation performance (4× CPU throttle)", description: "Scroll FPS, jank and freezes on a throttled mobile profile", expected: "≥ 40 fps, no frozen steps", actual: `${prof.fps} fps, ${prof.jank} janky frames, ${prof.frozen} frozen step(s), CLS ${prof.cls}`, severity: "Medium", recommendation: prof.fps < 40 || prof.frozen ? "Disable heavy parallax/pinning on mobile via gsap.matchMedia or CSS media queries." : null, meta: prof }, prof.frozen ? false : prof.fps >= 40 ? true : "warn");
    } finally {
      await m.ctx.close();
    }
  }
}
