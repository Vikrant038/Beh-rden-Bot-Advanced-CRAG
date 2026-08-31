"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import { useReducedMotion } from "framer-motion";
import { type ScrollConfig, getMount } from "./scroll-engine";

// ─── Section definitions ─────────────────────────────────────────────────────
//
// Asset paths match public/scroll/ — drop your rendered files there.
// Placeholder stills are 1×1 grey WebP; placeholder clips are empty files.
// The engine degrades gracefully: if a clip file is empty / fails to fetch,
// that segment shows only the still poster.

// Optional CDN / External storage prefix for deployment (e.g. Cloudinary / Cloudflare R2 / AWS S3 / Vercel Blob)
// Defaults to local Next.js /public directory if not set.
const ASSET_BASE = (
  process.env.SCROLL_ASSETS_URL ||
  process.env.NEXT_PUBLIC_SCROLL_ASSETS_URL ||
  ""
).replace(/\/$/, "");
const assetUrl = (path: string, mobile = false) => {
  if (!ASSET_BASE) return path;
  // Auto-format Cloudinary URLs if root cloud endpoint is provided (e.g. https://res.cloudinary.com/<cloud_name>)
  if (ASSET_BASE.includes("cloudinary.com") && !ASSET_BASE.includes("/upload")) {
    const isVideo = path.endsWith(".mp4") || path.includes("/vid/");
    const type = isVideo ? "video" : "image";
    // For mobile viewports, deliver lighter 720p H.264 streams to prevent mobile GPU decoder stalling
    const transform = mobile
      ? isVideo
        ? "/f_auto,q_auto:eco,w_720,vc_h264"
        : "/f_auto,q_auto:eco,w_720"
      : "/f_auto,q_auto";
    return `${ASSET_BASE}/${type}/upload${transform}${path}`;
  }
  return `${ASSET_BASE}${path}`;
};

const BEHOERDEN_WORLD: ScrollConfig = {
  // brand and nav CTA are intentionally omitted — the page already has a
  // sticky navbar with "Behörden-Bot" branding and "Get started" button.
  // Adding them here would duplicate the link and break CTA href tests.
  hint: "scroll to explore",
  nav: false, // hide the engine's own section nav (page uses scroll route dots only)
  atmosphere: true,
  diveScroll: 1.0,
  connScroll: 0.5,

  sections: [
    {
      id: "dream",
      label: "Start",
      still: assetUrl("/scroll/dream.png"),
      stillMobile: assetUrl("/scroll/dream.png", true),
      clip: assetUrl("/scroll/vid/dream.mp4"),
      clipMobile: assetUrl("/scroll/vid/dream.mp4", true),
      accent: "#7c3aed",
      linger: 0.25,
      eyebrow: "Your German journey starts here",
      title: "Your AI guide to studying in Germany",
      body: "Get instant, verified answers about visas, APS certificates, blocked accounts, and admissions — cited from official German sources.",
      tags: ["Visa Checklist", "Blocked Account 2026", "APS India", "uni-assist"],
      cta: {
        primary: { label: "Start asking →", href: "/login" },
        secondary: { label: "See how it works", href: "#how-it-works" },
      },
    },
    {
      id: "docs",
      label: "Documents",
      still: assetUrl("/scroll/docs.png"),
      stillMobile: assetUrl("/scroll/docs.png", true),
      clip: assetUrl("/scroll/vid/docs.mp4"),
      clipMobile: assetUrl("/scroll/vid/docs.mp4", true),
      accent: "#2563eb",
      linger: 0.25,
      eyebrow: "How It Works · 3-Agent ReAct",
      title: "Never get lost in the paperwork",
      body: "Research, Analyst, and Writer agents collaborate to cross-reference BAMF regulations, consulate guidelines, and university requirements with confidence scoring.",
      tags: [
        "Embassy Guidelines",
        "Blocked Account (€11,904)",
        "Health Insurance (TK/Barmer)",
        "Declaration of Consent",
      ],
    },
    {
      id: "aps",
      label: "APS",
      still: assetUrl("/scroll/aps.png"),
      stillMobile: assetUrl("/scroll/aps.png", true),
      clip: assetUrl("/scroll/vid/aps.mp4"),
      clipMobile: assetUrl("/scroll/vid/aps.mp4", true),
      accent: "#059669",
      linger: 0.25,
      eyebrow: "Verification · APS Certificate",
      title: "Your degree, officially recognised",
      body: "Clear step-by-step guidance on APS timelines, DigiLocker verification, uni-assist VPD conversions, and German GPA equivalence (Bavarian Formula).",
      tags: ["APS Timeline", "DigiLocker Verification", "Bavarian Formula (GPA)", "uni-assist VPD"],
    },
    {
      id: "campus",
      label: "Campus",
      still: assetUrl("/scroll/campus.png"),
      stillMobile: assetUrl("/scroll/campus.png", true),
      clip: assetUrl("/scroll/vid/campus.mp4"),
      clipMobile: assetUrl("/scroll/vid/campus.mp4", true),
      accent: "#d97706",
      linger: 0.3,
      eyebrow: "Arrival & Graduation",
      title: "From first day to graduation",
      body: "Navigate city registration (Anmeldung), 140-day student work permits, semester contributions, and post-study 18-month job-seeker visa extensions.",
      tags: [
        "City Registration (Anmeldung)",
        "Work Permit (140 Days)",
        "Semester Ticket",
        "18-Month Job Seeker",
      ],
    },
  ],

  connectors: [
    assetUrl("/scroll/vid/conn1.mp4"),
    assetUrl("/scroll/vid/conn2.mp4"),
    assetUrl("/scroll/vid/conn3.mp4"),
  ],
  connectorsMobile: [
    assetUrl("/scroll/vid/conn1.mp4", true),
    assetUrl("/scroll/vid/conn2.mp4", true),
    assetUrl("/scroll/vid/conn3.mp4", true),
  ],
};

// ─── Reduced-motion fallback ──────────────────────────────────────────────────
// Shows a static 2×2 grid of scene stills with section copy — no JS engine.

function StaticFallback() {
  const sections = BEHOERDEN_WORLD.sections;
  return (
    <section className="relative min-h-[70vh] w-full bg-background" aria-label="World overview">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-16 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        {sections.map((s) => (
          <div key={s.id} className="flex flex-col gap-3">
            <div className="relative aspect-[3/2] w-full overflow-hidden rounded-2xl border border-glass-border">
              <Image
                src={s.still}
                alt={s.title ?? s.label}
                fill
                className="object-cover"
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
              />
            </div>
            {s.eyebrow && (
              <p className="text-xs font-semibold uppercase tracking-wider text-accent">
                {s.eyebrow}
              </p>
            )}
            {s.title && <h3 className="text-sm font-semibold">{s.title}</h3>}
            {s.body && <p className="text-xs text-muted">{s.body}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * ScrollWorld — the full-viewport scroll-cinematic hero for the landing page.
 *
 * Mounts the `mountLetsScroll` engine inside a sticky container driven by a
 * tall `<div>` scroll track. The engine handles all video scrubbing, copy
 * transitions, nav, and route dots internally.
 *
 * Renders a static image grid fallback under `prefers-reduced-motion`.
 */
export function ScrollWorld({ startHref, browseHref }: { startHref: string; browseHref: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  // Patch CTAs with real session-aware hrefs before mounting
  const config: ScrollConfig = {
    ...BEHOERDEN_WORLD,
    // No top-level cta — the page navbar already has "Get started".
    // Section-level CTAs (in each section's cta field) are still rendered
    // by the engine's copy layer overlay.
    sections: BEHOERDEN_WORLD.sections.map((s, i) => {
      if (!s.cta) return s;
      // First section CTA always goes to startHref
      if (i === 0) {
        return {
          ...s,
          cta: {
            primary: { label: "Start asking →", href: startHref },
            secondary: { label: "See how it works", href: "#how-it-works" },
          },
        };
      }
      // Last section CTA: primary → startHref, secondary → browseHref
      if (i === BEHOERDEN_WORLD.sections.length - 1) {
        return {
          ...s,
          cta: {
            primary: { label: "Get started for free →", href: startHref },
            secondary: { label: "Browse the knowledge base", href: browseHref },
          },
        };
      }
      return s;
    }),
  };

  useEffect(() => {
    if (reduceMotion) return;
    const container = containerRef.current;
    if (!container) return;
    const mount = getMount();
    const unmount = mount(container, config);
    return unmount;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion, startHref, browseHref]);

  if (reduceMotion) {
    return <StaticFallback />;
  }

  return (
    <div
      ref={containerRef}
      className="w-full"
      aria-label="Scroll through the world — Behörden-Bot journey"
    />
  );
}
