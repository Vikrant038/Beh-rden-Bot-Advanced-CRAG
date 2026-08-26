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

const BEHOERDEN_WORLD: ScrollConfig = {
  // brand and nav CTA are intentionally omitted — the page already has a
  // sticky navbar with "Behörden-Bot" branding and "Get started" button.
  // Adding them here would duplicate the link and break CTA href tests.
  hint: "scroll to explore",
  nav: false, // hide the engine's own section nav (page uses scroll route dots only)
  atmosphere: true,
  diveScroll: 1.4,
  connScroll: 0.9,

  sections: [
    {
      id: "dream",
      label: "Start",
      still: "/scroll/dream.webp",
      clip: "/scroll/vid/dream.mp4",
      accent: "#7c3aed",
      linger: 0.3,
      eyebrow: "Your German journey starts here",
      title: "Your AI guide to studying in Germany",
      body: "Visas, APS, blocked accounts, university — answered from official sources.",
      cta: {
        primary: { label: "Start asking →", href: "/login" },
        secondary: { label: "See how it works", href: "#how-it-works" },
      },
    },
    {
      id: "docs",
      label: "Documents",
      still: "/scroll/docs.webp",
      clip: "/scroll/vid/docs.mp4",
      accent: "#2563eb",
      linger: 0.3,
      eyebrow: "Documents & Visas",
      title: "Never get lost in the paperwork",
      body: "Official embassy pages, BAMF brochures, and consulate guidance — every answer cites its sources with confidence scores.",
      tags: ["Student Visa", "Blocked Account", "APS Certificate", "Health Insurance"],
    },
    {
      id: "aps",
      label: "APS",
      still: "/scroll/aps.webp",
      clip: "/scroll/vid/aps.mp4",
      accent: "#059669",
      linger: 0.3,
      eyebrow: "APS Certificate",
      title: "Your degree, officially recognised",
      body: "Get clear guidance on the APS process, timelines, document lists, and what happens after — in English or German.",
      tags: ["APS Timeline", "Degree Recognition", "uni-assist", "Scholarships"],
    },
    {
      id: "campus",
      label: "Campus",
      still: "/scroll/campus.webp",
      clip: "/scroll/vid/campus.mp4",
      accent: "#d97706",
      linger: 0.4,
      eyebrow: "Start your semester",
      title: "From first day to graduation",
      body: "Ask about city costs, semester contributions, language requirements — every answer grounded in real sources with confidence scores.",
      tags: ["City Cost of Living", "Semester Contribution", "Language Requirements", "Work Permit"],
      cta: {
        primary: { label: "Get started for free →", href: "/login" },
        secondary: { label: "Browse the knowledge base", href: "/sources" },
      },
    },
  ],

  connectors: [
    "/scroll/vid/conn1.mp4",
    "/scroll/vid/conn2.mp4",
    "/scroll/vid/conn3.mp4",
  ],
};

// ─── Reduced-motion fallback ──────────────────────────────────────────────────
// Shows a static 2×2 grid of scene stills with section copy — no JS engine.

function StaticFallback() {
  const sections = BEHOERDEN_WORLD.sections;
  return (
    <section
      className="relative min-h-[70vh] w-full bg-background"
      aria-label="World overview"
    >
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
export function ScrollWorld({
  startHref,
  browseHref,
}: {
  startHref: string;
  browseHref: string;
}) {
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
