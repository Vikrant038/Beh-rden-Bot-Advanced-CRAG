"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  ArrowUp,
  BadgeCheck,
  Bot,
  ChevronDown,
  Eye,
  FileText,
  GraduationCap,
  Landmark,
  Languages,
  Menu,
  Network,
  Receipt,
  ShieldCheck,
  X,
} from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { CountUp } from "@/components/ui/count-up";
import { ScrollWorld } from "@/components/landing/scroll-world";
import { ChangelogModal } from "@/components/ui/changelog-modal";
import { api } from "@/lib/trpc/client";

const NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#corpus", label: "The corpus" },
  { href: "#faq", label: "FAQ" },
];

/**
 * Real, DB-backed trust numbers (public.corpusStats) — no invented claims.
 * The pipeline and language counts are static facts; sources/chunks/German %
 * come from the live corpus. `isLoading` shows a neutral placeholder instead
 * of flashing zeros.
 */
function useCorpusStats() {
  const { data, isLoading, isError } = api.public.corpusStats.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });
  return { stats: data, isLoading, isError };
}

const FEATURES = [
  {
    title: "3-Agent ReAct",
    description:
      "Research, analysis, and writing agents collaborate to build thorough, grounded answers.",
    icon: Bot,
  },
  {
    title: "Bilingual Retrieval",
    description:
      "Every query is expanded into English + German sub-queries, then matched by dense pgvector and Postgres full-text search (GIN-indexed BM25-style scoring) fused via RRF.",
    icon: Languages,
  },
  {
    title: "CRAG Gate",
    description:
      "Confidence-gated retrieval that automatically falls back to live web search when sources score below threshold.",
    icon: ShieldCheck,
  },
  {
    title: "Parent-Child Chunking",
    description:
      "Short snippets are matched and expanded to full parent sections, so answers are grounded in complete legal context.",
    icon: Network,
  },
  {
    title: "PII Masking",
    description:
      "Passport numbers, IBANs, emails, and phones are redacted before any query reaches an LLM.",
    icon: Eye,
  },
  {
    title: "Per-Answer Telemetry",
    description:
      "Stage timings, tokens, and USD cost per LLM call are traced and surfaced for every answer.",
    icon: Receipt,
  },
];

const FAQ_ITEMS = [
  {
    question: "Is this free to use?",
    answer:
      "Yes — the core assistant is free while you plan your German journey. Sign in with Google or GitHub and start asking.",
  },
  {
    question: "What sources do you use?",
    answer:
      "We retrieve answers from official and trusted sources: embassy and consulate pages, university websites, and verified public documentation. Every answer cites its sources.",
  },
  {
    question: "Is my data private?",
    answer:
      "Your conversations are private to your account, and PII like names, emails, and passport numbers is redacted before any query reaches a language model.",
  },
];

const TOPICS = [
  "Student Visa",
  "APS Certificate",
  "Blocked Account",
  "University Admissions",
  "Health Insurance",
  "Language Requirements",
  "uni-assist",
  "Scholarships",
  "Work Permit",
  "City Cost of Living",
  "Semester Contribution",
  "Degree Recognition",
];

const DEMO_POINTS = [
  "Bilingual query expansion (English + German)",
  "Sources with relevance scores on every answer",
];

// Three tappable sample questions — each prefills a chat query on /chat.
const SAMPLE_QUESTIONS = [
  {
    title: "Visa documents",
    query: "What documents do I need for a German student visa?",
    icon: FileText,
  },
  {
    title: "Blocked account",
    query: "How much do I need in a blocked account for 2026?",
    icon: Landmark,
  },
  {
    title: "APS certificate",
    query: "How do I get my APS certificate and how long does it take?",
    icon: BadgeCheck,
  },
];

function StatCell({
  value,
  suffix,
  label,
  decimals,
}: {
  value: number;
  suffix: string;
  label: string;
  decimals?: number;
}) {
  return (
    <div className="flex flex-col items-center gap-1 px-3 py-3 text-center sm:border-l sm:border-glass-border sm:first:border-l-0">
      <p className="text-xl font-bold tabular-nums text-foreground sm:text-2xl">
        <CountUp value={value} suffix={suffix} decimals={decimals} />
      </p>
      <p className="text-[11px] text-muted sm:text-xs">{label}</p>
    </div>
  );
}

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const { stats, isLoading, isError } = useCorpusStats();
  const pathname = usePathname();
  const { status: sessionStatus } = useSession();
  const { data: guestStatus } = api.public.guestStatus.useQuery(undefined, {
    staleTime: 60_000,
  });

  // Session-aware CTAs: a signed-in user — or a returning guest whose valid
  // device cookie is still live — pressing "Get started" / "Start asking" goes
  // straight to chat instead of bouncing through the login page. New visitors
  // (or session still loading) get the login page as before.
  const isReturningGuest = sessionStatus === "unauthenticated" && Boolean(guestStatus?.hasGuest);
  const startHref = sessionStatus === "authenticated" || isReturningGuest ? "/chat" : "/login";
  const browseHref = sessionStatus === "authenticated" ? "/sources" : "/login";

  useEffect(() => {
    const onScroll = () => {
      setShowBackToTop(window.scrollY > 600);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // #31 — close the mobile menu on Escape and on route change.
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  };

  const reveal = reduceMotion
    ? {}
    : {
        initial: { opacity: 0, y: 16 },
        whileInView: { opacity: 1, y: 0 },
        viewport: { once: true },
      };

  return (
    <div id="main" className="relative min-h-screen overflow-hidden bg-background">
      <div className="gradient-mesh pointer-events-none absolute inset-0 opacity-60" />

      {/* ─── Sticky glass navbar ─── */}
      <header className="sticky top-0 z-30 border-b border-glass-border bg-background/70 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2 sm:px-6 md:py-3">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="brand-gradient grid h-9 w-9 place-items-center rounded-xl text-white shadow-[0_4px_16px_-4px_var(--color-primary)]">
              <GraduationCap className="h-5 w-5" />
            </span>
            <span className="text-lg">Behörden-Bot</span>
          </Link>

          <div className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-surface-hover hover:text-foreground"
              >
                {item.label}
              </a>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle compact />
            {/* #33 — the primary CTA stays visible on mobile (compact "Start"
                label); the accessible name stays "Get started" so tests and
                screen readers see one consistent action. */}
            <Link
              href={startHref}
              aria-label="Get started"
              className="brand-gradient inline-block rounded-xl px-3 py-2 text-xs font-medium text-white shadow-[0_4px_16px_-4px_var(--color-primary)] transition hover:brightness-110 sm:px-4 sm:text-sm"
            >
              <span className="sm:hidden">Start</span>
              <span className="hidden sm:inline">Get started</span>
            </Link>
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              className="grid h-10 w-10 place-items-center rounded-lg text-muted transition hover:bg-surface-hover hover:text-foreground md:hidden"
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </nav>

        {menuOpen && (
          <div className="border-t border-glass-border bg-background/95 px-6 py-3 md:hidden">
            <div className="flex flex-col gap-1">
              {NAV_LINKS.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-lg px-3 py-2.5 text-sm text-muted transition hover:bg-surface-hover hover:text-foreground"
                >
                  {item.label}
                </a>
              ))}
              <Link
                href={startHref}
                onClick={() => setMenuOpen(false)}
                className="brand-gradient mt-2 rounded-xl px-4 py-2.5 text-center text-sm font-medium text-white transition hover:brightness-110"
              >
                Get started
              </Link>
            </div>
          </div>
        )}
      </header>

      {/* ─── Full-viewport scroll-cinematic hero ─── */}
      {/* ScrollWorld spans 100vw — rendered outside max-w-6xl.
          The engine builds its own sticky track, copy layer, nav, and route dots. */}
      <ScrollWorld startHref={startHref} browseHref={browseHref} />

      <main className="relative z-10 mx-auto max-w-6xl px-4 pb-16 pt-12 text-center sm:px-6 sm:pb-24 sm:pt-14">
        {/* Below-the-fold content starts here.
            The hero has been replaced by the scroll-cinematic world above. */}

        {/* ─── What you can ask (sample chips → prefill chat) ─── */}
        <motion.section
          {...reveal}
          transition={{ duration: 0.5 }}
          className="mt-20"
          aria-label="Sample questions"
        >
          <h2 className="type-title">What can I ask?</h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-muted">
            Tap a question to try it — it opens straight in the chat.
          </p>
          <div className="mx-auto mt-8 grid max-w-3xl gap-3 sm:grid-cols-3">
            {SAMPLE_QUESTIONS.map((sample) => {
              const Icon = sample.icon;
              return (
                <Link
                  key={sample.title}
                  href={`/chat?q=${encodeURIComponent(sample.query)}`}
                  className="group flex min-h-11 flex-col items-start gap-2 rounded-xl border border-glass-border bg-glass px-4 py-4 text-left shadow-glass backdrop-blur transition hover:-translate-y-0.5 hover:border-primary/50 hover:bg-surface"
                >
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary shadow-[0_0_14px_-4px_var(--color-primary)]">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="text-sm font-medium">{sample.title}</span>
                  <span className="line-clamp-2 text-xs text-muted">{sample.query}</span>
                  <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent">
                    Ask this
                    <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              );
            })}
          </div>
        </motion.section>

        {/* ─── How it works ─── */}
        <motion.section
          {...reveal}
          transition={{ duration: 0.5, delay: 0.05 }}
          id="how-it-works"
          className="content-visibility-auto mt-24 scroll-mt-20 md:scroll-mt-24"
        >
          <h2 className="type-title">How it works</h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-muted">
            A three-agent pipeline turns your question into a cited, verified answer.
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {[
              {
                step: "1",
                title: "Ask a question",
                body: "Type it in plain English — no forms, no jargon.",
              },
              {
                step: "2",
                title: "AI researches official sources",
                body: "Hybrid retrieval + a research agent pull from verified documents.",
              },
              {
                step: "3",
                title: "Get a cited, verified answer",
                body: "Every answer links the sources it was grounded on.",
              },
            ].map((step) => (
              <GlassCard key={step.step} className="flex items-start gap-4 p-6 text-left sm:block">
                <span className="brand-gradient grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold text-white shadow-[0_4px_14px_-4px_var(--color-primary)]">
                  {step.step}
                </span>
                <div className="min-w-0">
                  <h3 className="mt-0 font-semibold sm:mt-3">{step.title}</h3>
                  <p className="mt-2 text-sm text-muted">{step.body}</p>
                </div>
              </GlassCard>
            ))}
          </div>
        </motion.section>

        {/* ─── Trust / stats strip (real DB numbers) ─── */}
        <motion.section
          {...reveal}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="mx-auto mt-20 max-w-3xl"
          aria-label="Live corpus statistics"
        >
          {isLoading ? (
            <GlassCard className="flex flex-col gap-4 p-5 sm:flex-row sm:gap-0">
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className="flex-1 px-4 text-center">
                  <div className="mx-auto h-7 w-16 animate-pulse rounded-md bg-surface-hover" />
                  <div className="mx-auto mt-2 h-3 w-20 animate-pulse rounded bg-surface-hover" />
                </div>
              ))}
            </GlassCard>
          ) : isError || !stats ? (
            <GlassCard className="p-5 text-center text-sm text-muted">
              Live corpus stats temporarily unavailable.
            </GlassCard>
          ) : (
            <GlassCard className="grid grid-cols-2 gap-y-4 p-3 sm:grid-cols-4 sm:gap-y-0 sm:p-2">
              <StatCell value={stats?.sources ?? 0} suffix="+" label="official sources" />
              <StatCell value={stats?.chunks ?? 0} suffix="+" label="indexed chunks" />
              <StatCell
                value={stats?.germanChunkPercent ?? 0}
                suffix="%"
                label="German-language chunks"
                decimals={1}
              />
              <StatCell value={3} suffix="" label="agent pipeline" />
            </GlassCard>
          )}
        </motion.section>

        {/* ─── Live chat demo ─── */}
        <motion.section
          {...reveal}
          transition={{ duration: 0.5 }}
          className="content-visibility-auto mt-24 text-left"
          id="demo"
        >
          <GlassCard className="overflow-hidden p-6 sm:p-10">
            {/* Framed image above the section heading */}
            <div className="relative mb-8 overflow-hidden rounded-2xl border border-glass-border shadow-glass">
              <div className="relative aspect-[8/5] w-full overflow-hidden sm:aspect-[21/9]">
                <Image
                  src="/Images/hero-image.jpeg"
                  alt="Historic German town square at dusk — the journey this guide helps you plan"
                  fill
                  sizes="(max-width: 1024px) 100vw, 60rem"
                  className="object-cover"
                />
                <div
                  className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/40 via-transparent to-transparent"
                  aria-hidden="true"
                />
              </div>
            </div>
            <div className="grid items-center gap-8 lg:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-accent">
                  See it in action
                </p>
                <h2 className="type-title mt-2">Ask a question. Get a cited answer.</h2>
                <p className="mt-3 max-w-md text-sm text-muted">
                  Every answer is grounded in official sources with confidence scores — and the
                  three-agent pipeline tells you exactly what it&apos;s doing as it works.
                </p>
              </div>
              <ul className="space-y-3">
                {[
                  `Hybrid retrieval across ${stats ? `${stats.sources}+` : "115+"} official sources`,
                  ...DEMO_POINTS,
                ].map((point, index) => (
                  <li
                    key={point}
                    className="flex items-center gap-3 rounded-xl border border-glass-border bg-glass px-4 py-3 text-sm text-foreground backdrop-blur"
                  >
                    <span className="brand-gradient grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[11px] font-bold text-white">
                      {index + 1}
                    </span>
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          </GlassCard>
        </motion.section>

        {/* ─── Features — collapsible "Why it's trustworthy" accordion ─── */}
        <motion.section
          {...reveal}
          transition={{ duration: 0.5 }}
          id="features"
          className="content-visibility-auto mx-auto mt-24 max-w-3xl scroll-mt-20 text-left md:scroll-mt-24"
        >
          <h2 className="type-title text-center">Why it&apos;s trustworthy</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-sm text-muted">
            Every feature exists to earn your trust before you make a life-changing decision.
          </p>
          <div className="mt-10 space-y-3">
            {FEATURES.map((feature) => {
              const Icon = feature.icon;
              return (
                <details
                  key={feature.title}
                  className="group rounded-xl border border-glass-border bg-glass shadow-glass backdrop-blur transition open:border-primary/40"
                >
                  <summary className="flex min-h-11 cursor-pointer list-none items-center gap-4 px-5 py-3.5 transition hover:bg-surface-hover sm:py-4">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary shadow-[0_0_18px_-6px_var(--color-primary)]">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1 font-medium">{feature.title}</span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="px-5 pb-5 text-sm leading-relaxed text-muted">
                    {feature.description}
                  </p>
                </details>
              );
            })}
          </div>
        </motion.section>

        {/* ─── Corpus + topics — collapsed behind "Explore the knowledge base" ─── */}
        <motion.section
          {...reveal}
          transition={{ duration: 0.5 }}
          id="corpus"
          className="content-visibility-auto mt-24 scroll-mt-20 md:scroll-mt-24"
        >
          {/* Keep the corpus content in the DOM (SEO) but visually collapsed until
              the visitor opts in — progressive disclosure per the landing plan. */}
          <details className="group mx-auto max-w-3xl rounded-2xl border border-glass-border bg-glass shadow-glass backdrop-blur">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 px-6 py-4 text-left transition hover:bg-surface-hover">
              <span>
                <span className="block font-semibold">Explore the knowledge base</span>
                <span className="mt-0.5 block text-xs text-muted">
                  Official documents, laws, and exam handbooks behind every answer
                </span>
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-180" />
            </summary>
            <div className="border-t border-glass-border px-6 py-6">
              <h3 className="text-left font-semibold">Built on a real legal corpus</h3>
              <p className="mt-2 text-left text-sm text-muted">
                Federal laws, BAMF brochures, and Goethe/telc/TestDaF exam handbooks — the largest
                documents in the knowledge base right now:
              </p>
              <div className="mt-6 grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-3">
                {(stats?.topSources ?? []).map((source, index) => (
                  <GlassCard key={source.title} className="p-5">
                    <div className="flex items-start gap-3">
                      <span className="brand-gradient grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-bold text-white">
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <h4
                          className="line-clamp-2 text-sm font-medium sm:truncate"
                          title={source.title}
                        >
                          {source.title}
                        </h4>
                        <p className="mt-1 text-xs text-muted">
                          {source.chunkCount.toLocaleString()} indexed chunks
                        </p>
                      </div>
                    </div>
                  </GlassCard>
                ))}
              </div>
              {!isLoading && (stats?.sources ?? 0) > 0 && (
                <p className="mt-6 text-xs text-muted">
                  {stats?.sources} sources · {stats?.parentChunks?.toLocaleString()} parent sections
                  · {stats?.chunks?.toLocaleString()} chunks · indexed as 1024-dim bge-m3 vectors.
                </p>
              )}

              <div className="mt-8 border-t border-glass-border pt-6">
                <h3 className="text-left font-semibold">What can I ask about?</h3>
                <p className="mt-2 text-left text-sm text-muted">
                  From your first APS appointment to your first semester — the knowledge base covers
                  the whole journey.
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {TOPICS.map((topic) => (
                    <a
                      key={topic}
                      href={startHref}
                      className="grid min-h-11 place-items-center rounded-full border border-glass-border bg-glass px-3.5 py-1.5 text-xs text-muted shadow-glass backdrop-blur transition hover:border-primary/60 hover:text-foreground"
                    >
                      {topic}
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </details>
        </motion.section>

        {/* ─── FAQ ─── */}
        <motion.section
          {...reveal}
          transition={{ duration: 0.5 }}
          id="faq"
          className="content-visibility-auto mx-auto mt-24 max-w-2xl scroll-mt-20 text-left md:scroll-mt-24"
        >
          <h2 className="type-title text-center">Frequently asked questions</h2>
          <div className="mt-8 space-y-3">
            {FAQ_ITEMS.map((item, index) => {
              const open = openFaq === index;
              return (
                <GlassCard key={item.question} className="overflow-hidden p-0">
                  <button
                    type="button"
                    onClick={() => setOpenFaq(open ? null : index)}
                    aria-expanded={open}
                    className="flex min-h-11 w-full items-center justify-between gap-4 px-5 py-3.5 text-left font-medium transition hover:bg-surface-hover sm:py-4"
                  >
                    {item.question}
                    <ArrowRight
                      className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`}
                    />
                  </button>
                  {open && <p className="px-5 pb-4 text-sm text-muted">{item.answer}</p>}
                </GlassCard>
              );
            })}
          </div>
        </motion.section>

        {/* ─── Final CTA ─── */}
        <motion.section
          {...reveal}
          transition={{ duration: 0.5 }}
          className="content-visibility-auto mt-24"
        >
          <GlassCard className="relative overflow-hidden px-5 py-10 sm:px-8 sm:py-14">
            <div className="aurora" aria-hidden="true">
              <div className="aurora-orb aurora-orb-c left-[-10%] top-[-60%] h-64 w-64 bg-primary/30" />
              <div className="aurora-orb aurora-orb-b right-[-10%] bottom-[-70%] h-64 w-64 bg-accent/25" />
            </div>
            <h2 className="type-title relative">Ready to start your German journey?</h2>
            <p className="relative mx-auto mt-3 max-w-xl text-sm text-muted">
              Get grounded, sourced answers about visas, APS, blocked accounts, and admissions — in
              seconds, for free.
            </p>
            <div className="relative mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href={startHref}
                className="cta-shimmer brand-gradient inline-block w-full rounded-xl px-8 py-3 text-sm font-semibold text-white shadow-[0_8px_28px_-8px_var(--color-primary)] transition hover:brightness-110 active:scale-[0.98] sm:w-auto"
              >
                Start asking →
              </Link>
              <Link
                href={browseHref}
                className="inline-block w-full rounded-xl border border-glass-border bg-glass px-8 py-3 text-sm font-medium shadow-glass backdrop-blur transition hover:bg-surface-hover sm:w-auto"
              >
                Browse the knowledge base
              </Link>
            </div>
          </GlassCard>
        </motion.section>
      </main>

      <footer className="relative z-10 border-t border-glass-border bg-background/60 px-6 py-8 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 text-center sm:flex-row sm:text-left">
          <div>
            <p className="font-semibold">Behörden-Bot</p>
            <p className="mt-1 text-xs text-muted">
              Built for Indian students navigating the German education system.
            </p>
          </div>
          <div className="flex items-center gap-6 text-xs text-muted">
            <Link href="/chat" className="transition hover:text-foreground">
              Chat
            </Link>
            <Link href="/history" className="transition hover:text-foreground">
              History
            </Link>
            <Link href="/sources" className="transition hover:text-foreground">
              Knowledge base
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setChangelogOpen(true)}
              className="text-[10px] text-muted underline-offset-2 transition hover:text-foreground hover:underline"
            >
              What&apos;s new · v1.1.0
            </button>
            <p className="text-[10px] text-muted">© {new Date().getFullYear()} Behörden-Bot</p>
          </div>
        </div>
      </footer>

      {showBackToTop && (
        <button
          type="button"
          onClick={scrollToTop}
          aria-label="Back to top"
          className="fixed bottom-20 right-4 z-40 grid h-11 w-11 place-items-center rounded-full border border-glass-border bg-glass text-foreground shadow-glass backdrop-blur transition hover:bg-surface-hover sm:bottom-6 sm:right-6"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      )}

      <ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />
    </div>
  );
}
