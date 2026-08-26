/**
 * TypeScript wrapper around the lets-scroll vanilla scrub engine.
 *
 * The engine itself is intentionally kept as vanilla JS in .agents/skills/lets-scroll/
 * and inlined into this module so we get zero extra HTTP requests and full
 * tree-shaking. It is SSR-safe — mountLetsScroll must only be called inside a
 * useEffect / onMounted / after DOMContentLoaded.
 *
 * API surface exposed to React:
 *   mountLetsScroll(container, config) → unmount()
 *
 * The engine builds its own DOM inside `container`, injects its own namespaced
 * CSS, and handles all scroll / resize / reduced-motion logic internally.
 */

// ─── Config types ────────────────────────────────────────────────────────────

export interface ScrollSectionCta {
  primary?: { label: string; href: string };
  secondary?: { label: string; href: string };
}

export interface ScrollSection {
  /** Unique stable id (used for nav + route dots) */
  id: string;
  /** Short nav label shown in the top nav + route rail */
  label: string;
  /** Still image — shown as poster + reduced-motion fallback */
  still: string;
  /** Optional 9:16 portrait still for mobile */
  stillMobile?: string;
  /** Dive-in video clip URL */
  clip: string;
  /** Optional ~720p portrait clip for mobile */
  clipMobile?: string;
  /** CSS colour used for accents in this section's copy overlay */
  accent?: string;
  /** Optional per-section scroll weight override (default = config.diveScroll) */
  scroll?: number;
  /** 0..1 — slows the mid-scene camera to let copy peak. Keep ≤ 0.6 */
  linger?: number;
  /** Small eyebrow text above the headline */
  eyebrow?: string;
  /** Main headline */
  title?: string;
  /** Body / sub-headline */
  body?: string;
  /** Tag pill chips */
  tags?: string[];
  /** CTA buttons — typically only on the last section */
  cta?: ScrollSectionCta;
}

export interface ScrollBrand {
  name: string;
  href?: string;
}

export interface ScrollConfig {
  sections: ScrollSection[];
  /** Connector clips — length MUST equal sections.length - 1. Use null to skip a connector. */
  connectors: (string | null)[];
  /** Optional 9:16 portrait connector clips (same length as connectors) */
  connectorsMobile?: (string | null)[];
  /** Viewport-heights of scroll per dive clip (default 1.3) */
  diveScroll?: number;
  /** Viewport-heights of scroll per connector clip (default 0.9) */
  connScroll?: number;
  /** Scroll-hint text shown to first-time visitors */
  hint?: string;
  /** Show the top section nav (default true) */
  nav?: boolean;
  /** Show atmospheric gradient + drifting particles (default true) */
  atmosphere?: boolean;
  brand?: ScrollBrand;
  /** Top-right CTA button (separate from section CTAs) */
  cta?: { label: string; href: string };
  /** Crossfade dissolve width in vh (default 0.12) */
  crossfade?: number;
}

// ─── Engine ──────────────────────────────────────────────────────────────────

// Inline the engine source so it ships in the main chunk (no dynamic import
// latency). The engine is ~400 LOC of vanilla JS.
// It is pasted verbatim from .agents/skills/lets-scroll/references/scrub-engine.js
// and wrapped in a module export.

/* eslint-disable */
function _engineFactory() {
  function mountLetsScroll(container: HTMLElement, config: ScrollConfig): () => void {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
    const smallMQ = window.matchMedia("(max-width: 860px)");
    const isMobile = () => coarse || smallMQ.matches;
    const SECTIONS = config.sections || [];
    const CONNECTORS = config.connectors || [];
    const CONNECTORS_M = config.connectorsMobile || [];
    const DIVE_W = config.diveScroll || 1.3;
    const CONN_W = config.connScroll || 0.9;
    const CROSSFADE = config.crossfade != null ? config.crossfade : 0.12;
    const N = SECTIONS.length;
    if (!N) return () => {};

    injectCSS();
    container.classList.add("sw-root");

    // Build interleaved segment chain: dive0, conn0, dive1, … diveN-1
    interface Segment {
      kind: "dive" | "conn";
      si: number;
      clip: string | null;
      clipM?: string | null;
      still: string;
      stillM?: string;
      accent?: string;
      w: number;
      linger?: number;
      el?: HTMLElement;
      img?: HTMLImageElement;
      video?: HTMLVideoElement | null;
      hasClip?: boolean;
      loading?: boolean;
      ready?: boolean;
      cur?: number;
      target?: number;
      visible?: boolean;
    }
    const SEGMENTS: Segment[] = [];
    SECTIONS.forEach((s, i) => {
      const dive: Segment = {
        kind: "dive", si: i,
        clip: s.clip, clipM: s.clipMobile,
        still: s.still, stillM: s.stillMobile,
        accent: s.accent,
        w: s.scroll || DIVE_W,
        linger: s.linger || 0,
      };
      SEGMENTS.push(dive);
      (s as any)._seg = dive;
      if (i < N - 1 && CONNECTORS[i]) {
        SEGMENTS.push({
          kind: "conn", si: i,
          clip: CONNECTORS[i] ?? null, clipM: CONNECTORS_M[i] ?? null,
          still: SECTIONS[i + 1].still, stillM: SECTIONS[i + 1].stillMobile,
          accent: SECTIONS[i + 1].accent,
          w: CONN_W,
        });
      }
    });
    const NSEG = SEGMENTS.length;

    // ── DOM helpers ──────────────────────────────────────────────────────────
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string): HTMLElementTagNameMap[K] => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      return e;
    };
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const pad = (n: number) => String(n).padStart(2, "0");
    const ctaBtns = (cta: ScrollSectionCta) => {
      let html = "";
      if (cta.primary) html += `<a class="sw-cta sw-cta--primary" href="${esc(cta.primary.href)}">${esc(cta.primary.label)}</a>`;
      if (cta.secondary) html += `<a class="sw-cta sw-cta--secondary" href="${esc(cta.secondary.href)}">${esc(cta.secondary.label)}</a>`;
      return html;
    };

    // ── Build DOM ─────────────────────────────────────────────────────────────
    const sky = el("div", "sw-sky");
    if (config.atmosphere !== false) {
      sky.appendChild(el("div", "sw-sky__grad"));
      sky.appendChild(el("div", "sw-sky__glow"));
    }
    const particles = el("div", "sw-particles");
    sky.appendChild(particles);

    const scrollbar = el("div", "sw-scrollbar");
    const scrollbarFill = el("span");
    scrollbar.appendChild(scrollbarFill);

    const topbar = el("div", "sw-topbar");
    if (config.brand) {
      const brand = el("a", "sw-brand");
      brand.href = config.brand.href || "#";
      brand.appendChild(el("span", "sw-brand__mark"));
      const nm = el("span", "sw-brand__name");
      nm.textContent = config.brand.name || "";
      brand.appendChild(nm);
      topbar.appendChild(brand);
    }
    const nav = el("nav", "sw-nav");
    if (config.nav !== false) topbar.appendChild(nav);
    if (config.cta?.label) {
      const c = el("a", "sw-topcta");
      c.href = config.cta.href || "#";
      c.textContent = config.cta.label;
      topbar.appendChild(c);
    }

    const stage = el("div", "sw-stage");
    const copylayer = el("div", "sw-copylayer");
    const route = el("div", "sw-route");
    const hint = el("div", "sw-hint");
    const hintText = el("span");
    hintText.textContent = config.hint || "scroll";
    hint.appendChild(hintText);
    hint.appendChild(el("i"));
    const track = el("div", "sw-track");

    [sky, scrollbar, topbar, stage, copylayer, route, hint, track].forEach((n) => container.appendChild(n));

    // Segment scenes
    SEGMENTS.forEach((s) => {
      const scene = el("div", "sw-scene");
      scene.style.setProperty("--sw-accent", s.accent || "");
      const img = el("img", "sw-scene__still");
      img.alt = "";
      img.decoding = "async";
      img.loading = "lazy";
      const poster = isMobile() && s.stillM ? s.stillM : s.still;
      if (poster) img.src = poster;
      scene.appendChild(img);
      stage.appendChild(scene);
      s.el = scene; s.img = img; s.video = null; s.hasClip = false;
      s.loading = false; s.ready = false; s.cur = 0; s.target = 0; s.visible = false;
    });

    // Per-section copy / route / nav
    const copies: HTMLElement[] = [];
    const dots: HTMLElement[] = [];
    SECTIONS.forEach((s, i) => {
      const c = el("article", "sw-copy");
      c.style.setProperty("--sw-accent", s.accent || "");
      c.innerHTML =
        `<span class="sw-copy__num">${pad(i + 1)} / ${pad(N)}</span>` +
        (s.eyebrow ? `<span class="sw-copy__eyebrow">${esc(s.eyebrow)}</span>` : "") +
        (s.title ? `<h2 class="sw-copy__title">${esc(s.title)}</h2>` : "") +
        (s.body ? `<p class="sw-copy__body">${esc(s.body)}</p>` : "") +
        (s.tags?.length ? `<ul class="sw-copy__tags">${s.tags.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : "") +
        (s.cta ? `<div class="sw-copy__cta">${ctaBtns(s.cta)}</div>` : "");
      copylayer.appendChild(c);
      copies.push(c);

      const dot = el("button", "sw-route__dot");
      dot.style.setProperty("--sw-accent", s.accent || "");
      dot.innerHTML = `<span class="sw-route__label">${esc(s.label || "")}</span><i></i>`;
      dot.addEventListener("click", () => jumpTo(i));
      route.appendChild(dot);
      dots.push(dot);

      if (config.nav !== false) {
        const b = el("button", "sw-nav__item");
        b.textContent = s.label || "";
        b.addEventListener("click", () => jumpTo(i));
        nav.appendChild(b);
      }
    });

    // ── Math ──────────────────────────────────────────────────────────────────
    const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
    const smooth = (x: number) => { x = clamp(x); return x * x * (3 - 2 * x); };
    const lingerEase = (x: number, L: number) => {
      x = clamp(x);
      if (L <= 0) return x;
      const mid = 0.5, hw = 0.5 * (1 - L);
      if (x < mid - hw) return x / (2 * (mid - hw)) * (mid - hw);
      if (x > mid + hw) return mid + (x - mid - hw) / (2 * (1 - mid - hw)) * (1 - mid);
      return mid;
    };

    // ── Segment geometry ──────────────────────────────────────────────────────
    let VH = window.innerHeight;
    let totalScroll = 0;
    const segStarts: number[] = [];
    const segLens: number[] = [];

    const calcGeom = () => {
      VH = window.innerHeight;
      totalScroll = 0;
      SEGMENTS.forEach((s, i) => {
        segStarts[i] = totalScroll;
        const len = s.w * VH;
        segLens[i] = len;
        totalScroll += len;
      });
      track.style.height = `${totalScroll + VH}px`;
    };
    calcGeom();

    // ── Lazy video loading ────────────────────────────────────────────────────
    const loadClip = (s: Segment) => {
      if (s.loading || s.ready || !s.clip) return;
      s.loading = true;
      const url = isMobile() && s.clipM ? s.clipM : s.clip;
      fetch(url)
        .then((r) => r.blob())
        .then((b) => {
          const v = document.createElement("video");
          v.src = URL.createObjectURL(b);
          v.muted = true;
          v.preload = "auto";
          v.playsInline = true;
          v.setAttribute("playsinline", "");
          v.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.3s";
          // Prime on mobile (required for iOS seek)
          if (isMobile()) {
            v.play().then(() => v.pause()).catch(() => {});
          }
          s.el!.appendChild(v);
          s.video = v;
          s.hasClip = true;
          s.ready = true;
          s.loading = false;
        })
        .catch(() => { s.loading = false; });
    };

    // ── Scroll driver ─────────────────────────────────────────────────────────
    let raf: number | null = null;
    let lastScrollY = -1;
    let activeSi = 0;
    let pendingSeek = false;

    const drive = () => {
      raf = null;
      const scrollY = window.scrollY;
      if (scrollY === lastScrollY) { raf = requestAnimationFrame(drive); return; }
      lastScrollY = scrollY;

      const progress = scrollY / totalScroll;
      scrollbarFill.style.width = `${clamp(progress) * 100}%`;

      // Find active segment
      let activeSeg = NSEG - 1;
      for (let i = 0; i < NSEG; i++) {
        if (scrollY < segStarts[i] + segLens[i]) { activeSeg = i; break; }
      }

      SEGMENTS.forEach((s, i) => {
        const localT = clamp((scrollY - segStarts[i]) / segLens[i]);
        const t = lingerEase(localT, s.linger || 0);

        const isActive = i === activeSeg;
        const nearBy = Math.abs(i - activeSeg) <= 1;

        // Lazy-load nearby clips
        if (nearBy && s.clip && !s.ready) loadClip(s);

        // Show/hide scene
        s.visible = isActive || (nearBy && (
          (i < activeSeg && localT > 1 - CROSSFADE) ||
          (i > activeSeg && localT < CROSSFADE)
        ));

        if (s.el) {
          s.el.style.display = s.visible || i === activeSeg ? "block" : "none";
          s.el.style.zIndex = isActive ? "2" : "1";
        }

        // Scrub video
        if (s.ready && s.hasClip && s.video) {
          s.target = t;
          if (!pendingSeek) {
            pendingSeek = true;
            requestAnimationFrame(() => {
              pendingSeek = false;
              SEGMENTS.forEach((seg) => {
                if (!seg.video || !seg.hasClip) return;
                const dur = seg.video.duration;
                if (!isFinite(dur) || dur === 0) return;
                const targetTime = clamp(seg.target ?? 0) * dur;
                if (!seg.video.seeking && Math.abs(seg.video.currentTime - targetTime) > 0.016) {
                  seg.video.currentTime = targetTime;
                }
                // Fade video over still
                seg.video.style.opacity = seg.visible ? "1" : "0";
              });
            });
          }
        }

        // Active section index for copy/nav/dots
        if (s.kind === "dive" && isActive) {
          if (activeSi !== s.si) {
            activeSi = s.si;
            copies.forEach((c, j) => c.classList.toggle("sw-copy--active", j === activeSi));
            dots.forEach((d, j) => d.classList.toggle("sw-route__dot--active", j === activeSi));
            nav.querySelectorAll(".sw-nav__item").forEach((b, j) => b.classList.toggle("sw-nav__item--active", j === activeSi));
          }
        }
      });

      raf = requestAnimationFrame(drive);
    };

    // Initial active
    copies[0]?.classList.add("sw-copy--active");
    dots[0]?.classList.add("sw-route__dot--active");
    nav.querySelector(".sw-nav__item")?.classList.add("sw-nav__item--active");
    hint.classList.add("sw-hint--visible");
    window.addEventListener("scroll", () => {
      if (window.scrollY > VH * 0.5) hint.classList.remove("sw-hint--visible");
    }, { passive: true });

    raf = requestAnimationFrame(drive);

    // Resize
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      // Ignore iOS URL-bar-only resizes (< 60px change)
      if (isMobile() && Math.abs(window.innerHeight - VH) < 60) return;
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(calcGeom, 120);
    };
    window.addEventListener("resize", onResize, { passive: true });

    // Navigate to section
    const jumpTo = (si: number) => {
      let targetScroll = 0;
      for (let i = 0; i < NSEG; i++) {
        if (SEGMENTS[i].kind === "dive" && SEGMENTS[i].si === si) {
          targetScroll = segStarts[i] + segLens[i] * 0.1;
          break;
        }
      }
      window.scrollTo({ top: targetScroll, behavior: reduce ? "auto" : "smooth" });
    };

    // Particles (decorative, desktop only)
    if (config.atmosphere !== false && !isMobile()) {
      for (let p = 0; p < 18; p++) {
        const dot = el("div", "sw-particle");
        dot.style.cssText = `left:${Math.random() * 100}%;top:${Math.random() * 100}%;animation-delay:${(Math.random() * 8).toFixed(2)}s;animation-duration:${(6 + Math.random() * 6).toFixed(2)}s`;
        particles.appendChild(dot);
      }
    }

    // ── Reduced-motion: skip video entirely ──────────────────────────────────
    if (reduce) {
      if (raf) cancelAnimationFrame(raf);
      SEGMENTS.forEach((s, i) => {
        if (s.el) s.el.style.display = "block";
        if (s.img) s.img.style.opacity = "1";
      });
      copies.forEach((c, i) => c.classList.toggle("sw-copy--active", i === 0));
      track.style.height = "100vh";
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      container.classList.remove("sw-root");
      container.innerHTML = "";
    };
  }

  // ── CSS injection (namespaced under .sw-root) ─────────────────────────────
  function injectCSS() {
    if (document.getElementById("sw-style")) return;
    const style = document.createElement("style");
    style.id = "sw-style";
    style.textContent = `
.sw-root{position:relative;height:100vh;overflow:hidden;background:var(--sw-bg,#0a0a0a);color:var(--sw-ink,#f0f0f0);font-family:var(--sw-font-body,system-ui,sans-serif)}
.sw-track{position:absolute;top:0;left:0;width:1px;pointer-events:none;z-index:0}
.sw-sky{position:absolute;inset:0;z-index:0;overflow:hidden}
.sw-sky__grad{position:absolute;inset:0;background:radial-gradient(ellipse 80% 60% at 50% 30%,var(--sw-accent,#7c3aed22),transparent 70%)}
.sw-sky__glow{position:absolute;bottom:-20%;left:10%;right:10%;height:50%;background:radial-gradient(ellipse 100% 100%,var(--sw-accent,#7c3aed15),transparent 70%);filter:blur(40px)}
.sw-particle{position:absolute;width:2px;height:2px;background:var(--sw-accent,#a78bfa);border-radius:50%;opacity:0;animation:sw-drift linear infinite}
@keyframes sw-drift{0%{opacity:0;transform:translateY(0)}20%{opacity:.6}80%{opacity:.3}100%{opacity:0;transform:translateY(-60px)}}
.sw-stage{position:sticky;top:0;width:100%;height:100vh;z-index:1;overflow:hidden}
.sw-scene{position:absolute;inset:0;display:none}
.sw-scene__still{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.sw-scrollbar{position:fixed;top:0;left:0;right:0;height:2px;background:rgba(255,255,255,.08);z-index:100}
.sw-scrollbar>span{display:block;height:100%;background:var(--sw-accent,#7c3aed);transition:width .1s linear}
.sw-topbar{position:fixed;top:0;left:0;right:0;z-index:90;display:flex;align-items:center;gap:1rem;padding:.75rem 1.25rem;padding-top:.625rem;background:linear-gradient(to bottom,rgba(0,0,0,.5),transparent);pointer-events:none}
.sw-topbar>*{pointer-events:auto}
.sw-brand{display:flex;align-items:center;gap:.5rem;text-decoration:none;color:inherit;font-weight:600;font-size:.9rem}
.sw-brand__mark{display:inline-block;width:1.75rem;height:1.75rem;border-radius:.5rem;background:var(--sw-accent,#7c3aed)}
.sw-nav{display:flex;gap:.25rem;margin-left:auto}
.sw-nav__item{background:none;border:none;color:rgba(255,255,255,.6);font-size:.8rem;padding:.375rem .75rem;border-radius:.5rem;cursor:pointer;transition:background .15s,color .15s}
.sw-nav__item:hover,.sw-nav__item--active{background:rgba(255,255,255,.1);color:#fff}
.sw-topcta{padding:.5rem 1rem;border-radius:.75rem;background:var(--sw-accent,#7c3aed);color:#fff;font-size:.8rem;font-weight:600;text-decoration:none;transition:filter .15s}
.sw-topcta:hover{filter:brightness(1.1)}
.sw-copylayer{position:absolute;inset:0;z-index:20;pointer-events:none;display:flex;align-items:flex-end;padding:clamp(1.5rem,4vw,3rem)}
.sw-copy{position:absolute;bottom:clamp(1.5rem,4vw,3rem);left:clamp(1.5rem,4vw,3rem);right:clamp(1.5rem,4vw,3rem);max-width:42rem;pointer-events:auto;opacity:0;transform:translateY(1rem);transition:opacity .4s,transform .4s;display:none}
.sw-copy--active{opacity:1;transform:translateY(0);display:block}
.sw-copy__num{display:block;font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.45);margin-bottom:.5rem;font-family:var(--sw-font-display,system-ui,monospace)}
.sw-copy__eyebrow{display:block;font-size:.8rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--sw-accent,#a78bfa);margin-bottom:.4rem}
.sw-copy__title{margin:0 0 .6rem;font-size:clamp(1.6rem,4vw,2.8rem);font-weight:700;line-height:1.1;font-family:var(--sw-font-display,system-ui,sans-serif)}
.sw-copy__body{margin:0 0 1rem;font-size:clamp(.85rem,1.5vw,1.05rem);color:rgba(255,255,255,.7);line-height:1.6;max-width:36rem}
.sw-copy__tags{list-style:none;padding:0;margin:0 0 1.25rem;display:flex;flex-wrap:wrap;gap:.5rem}
.sw-copy__tags li{padding:.3rem .75rem;border-radius:999px;border:1px solid rgba(255,255,255,.18);font-size:.75rem;color:rgba(255,255,255,.7);backdrop-filter:blur(6px);background:rgba(255,255,255,.06)}
.sw-copy__cta{display:flex;flex-wrap:wrap;gap:.75rem}
.sw-cta{display:inline-block;padding:.65rem 1.5rem;border-radius:.875rem;font-size:.9rem;font-weight:600;text-decoration:none;transition:filter .15s,transform .1s}
.sw-cta--primary{background:var(--sw-accent,#7c3aed);color:#fff;box-shadow:0 4px 24px -4px var(--sw-accent,#7c3aed)}
.sw-cta--secondary{border:1px solid rgba(255,255,255,.25);color:#fff;backdrop-filter:blur(8px)}
.sw-cta:hover{filter:brightness(1.1)}
.sw-cta:active{transform:scale(.98)}
.sw-route{position:fixed;right:1.25rem;top:50%;transform:translateY(-50%);z-index:80;display:flex;flex-direction:column;gap:.5rem}
.sw-route__dot{background:none;border:none;width:2rem;height:2rem;cursor:pointer;display:flex;align-items:center;justify-content:flex-end;gap:.4rem;padding:0;color:rgba(255,255,255,.5);position:relative}
.sw-route__dot i{width:.55rem;height:.55rem;border-radius:50%;border:1.5px solid rgba(255,255,255,.4);transition:all .2s}
.sw-route__dot--active i{background:var(--sw-accent,#a78bfa);border-color:var(--sw-accent,#a78bfa);box-shadow:0 0 8px var(--sw-accent,#a78bfa)}
.sw-route__label{font-size:.7rem;opacity:0;transform:translateX(.25rem);transition:opacity .15s,transform .15s;white-space:nowrap}
.sw-route__dot:hover .sw-route__label{opacity:1;transform:translateX(0)}
.sw-hint{position:absolute;bottom:2rem;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:.35rem;font-size:.75rem;color:rgba(255,255,255,.5);opacity:0;transition:opacity .4s;pointer-events:none}
.sw-hint--visible{opacity:1}
.sw-hint i{width:1.25rem;height:1.25rem;border:1.5px solid rgba(255,255,255,.3);border-radius:50%;display:flex;align-items:center;justify-content:center}
.sw-hint i::after{content:'';width:4px;height:4px;background:rgba(255,255,255,.6);border-radius:50%;animation:sw-bounce 1.2s ease-in-out infinite}
@keyframes sw-bounce{0%,100%{transform:translateY(-3px)}50%{transform:translateY(3px)}}
@media(max-width:640px){.sw-route{display:none}.sw-copy__title{font-size:clamp(1.3rem,5vw,2rem)}}
@media(prefers-reduced-motion:reduce){.sw-copy{transition:none!important}.sw-particle{display:none}.sw-hint{display:none}}`;
    document.head.appendChild(style);
  }

  return mountLetsScroll;
}

export type MountFn = (container: HTMLElement, config: ScrollConfig) => () => void;

let _mount: MountFn | null = null;

/**
 * Returns the mountLetsScroll function. Safe to call multiple times.
 * Must only be called client-side (inside useEffect / after hydration).
 */
export function getMount(): MountFn {
  if (!_mount) _mount = _engineFactory();
  return _mount;
}
