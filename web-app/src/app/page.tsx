"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  ArrowUp,
  Bot,
  Eye,
  GraduationCap,
  Languages,
  Menu,
  Network,
  Receipt,
  ShieldCheck,
  X,
  Zap,
} from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { CountUp } from "@/components/ui/count-up";
import { ChatMockup } from "@/components/landing/chat-mockup";
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

function StatCard({
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
    <GlassCard className="p-5 text-center">
      <p className="text-2xl font-bold text-foreground sm:text-3xl">
        <CountUp value={value} suffix={suffix} decimals={decimals} />
      </p>
      <p className="mt-1 text-xs text-muted sm:text-sm">{label}</p>
    </GlassCard>
  );
}

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const { stats, isLoading, isError } = useCorpusStats();

  useEffect(() => {
    const onScroll = () => {
      setShowBackToTop(window.scrollY > 600);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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
      <div className="gradient-mesh pointer-events-none absolute inset-0" />

      {/* ─── Sticky glass navbar ─── */}
      <header className="sticky top-0 z-30 border-b border-glass-border bg-background/70 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">
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
            <Link
              href="/login"
              className="hidden rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary-hover md:inline-block"
            >
              Get started
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
                href="/login"
                onClick={() => setMenuOpen(false)}
                className="mt-2 rounded-xl bg-primary px-4 py-2.5 text-center text-sm font-medium text-primary-foreground transition hover:bg-primary-hover"
              >
                Get started
              </Link>
            </div>
          </div>
        )}
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-6 pb-24 pt-14 text-center">
        {/* ─── Hero ─── */}
        <motion.div {...reveal} transition={{ duration: 0.5 }}>
          <GlassCard className="mx-auto max-w-3xl overflow-hidden">
            <div className="relative aspect-video w-full overflow-hidden">
              <Image
                src="/Images/hero-banner.jpg"
                alt="German universities, student visas, and blocked accounts guide"
                fill
                priority
                sizes="(max-width: 768px) 100vw, 48rem"
                className="object-cover"
              />
            </div>
            <div className="px-6 pb-10 pt-8 sm:px-10">
              <h1 className="text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
                Your AI Guide to{" "}
                <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                  German Immigration
                </span>
              </h1>
              <p className="mx-auto mt-4 max-w-xl text-base text-muted sm:text-lg">
                Student visas, APS certification, blocked accounts, and university applications —
                answered with official sources in seconds.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link
                  href="/login"
                  className="cta-shimmer inline-block w-full rounded-xl bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground shadow-glass transition hover:bg-primary-hover active:scale-[0.98] sm:w-auto"
                >
                  Start asking →
                </Link>
                <a
                  href="#how-it-works"
                  className="inline-block w-full rounded-xl border border-glass-border bg-glass px-8 py-3 text-sm font-medium shadow-glass backdrop-blur transition hover:bg-surface-hover sm:w-auto"
                >
                  See how it works
                </a>
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* ─── Trust / stats bar (real DB numbers) ─── */}
        <motion.section
          {...reveal}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="mx-auto mt-16 grid max-w-4xl grid-cols-2 gap-4 lg:grid-cols-4"
          aria-label="Live corpus statistics"
        >
          {isLoading ? (
            <>
              {[0, 1, 2, 3].map((index) => (
                <GlassCard key={index} className="p-5 text-center">
                  <div className="mx-auto h-8 w-16 animate-pulse rounded-md bg-surface-hover" />
                  <div className="mx-auto mt-3 h-3 w-20 animate-pulse rounded bg-surface-hover" />
                </GlassCard>
              ))}
            </>
          ) : isError || !stats ? (
            <GlassCard className="col-span-full p-5 text-center text-sm text-muted">
              Live corpus stats temporarily unavailable.
            </GlassCard>
          ) : (
            <>
              <StatCard value={stats?.sources ?? 0} suffix="+" label="official sources" />
              <StatCard value={stats?.chunks ?? 0} suffix="+" label="indexed chunks" />
              <StatCard
                value={stats?.germanChunkPercent ?? 0}
                suffix="%"
                label="German-language chunks"
                decimals={1}
              />
              <StatCard value={3} suffix="" label="agent pipeline" />
            </>
          )}
        </motion.section>

        {/* ─── Live chat demo ─── */}
        <motion.section
          {...reveal}
          transition={{ duration: 0.5 }}
          className="mt-24 grid items-center gap-10 text-left lg:grid-cols-2"
          id="demo"
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-accent">
              See it in action
            </p>
            <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">
              Ask a question. Get a cited answer.
            </h2>
            <p className="mt-3 max-w-md text-sm text-muted">
              Every answer is grounded in official sources with confidence scores — and the
              three-agent pipeline tells you exactly what it&apos;s doing as it works.
            </p>
            <ul className="mt-6 space-y-2 text-sm text-muted">
              {[
                `Hybrid retrieval across ${stats ? `${stats.sources}+` : "115+"} official sources`,
                "Bilingual query expansion (English + German)",
                "Sources with relevance scores on every answer",
              ].map((point) => (
                <li key={point} className="flex items-center gap-2">
                  <Zap className="h-3.5 w-3.5 shrink-0 text-accent" />
                  {point}
                </li>
              ))}
            </ul>
          </div>
          <ChatMockup />
        </motion.section>

        {/* ─── How it works ─── */}
        <motion.section
          {...reveal}
          transition={{ duration: 0.5, delay: 0.05 }}
          id="how-it-works"
          className="mt-24 scroll-mt-24"
        >
          <h2 className="text-2xl font-semibold sm:text-3xl">How it works</h2>
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
              <GlassCard key={step.step} className="p-6 text-left">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-primary/15 text-sm font-bold text-primary">
                  {step.step}
                </span>
                <h3 className="mt-3 font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm text-muted">{step.body}</p>
              </GlassCard>
            ))}
          </div>
        </motion.section>

        {/* ─── Features ─── */}
        <motion.section
          {...reveal}
          transition={{ duration: 0.5 }}
          id="features"
          className="mt-24 scroll-mt-24"
        >
          <h2 className="text-2xl font-semibold sm:text-3xl">Built for accuracy and privacy</h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-muted">
            Every feature exists to earn your trust before you make a life-changing decision.
          </p>
          <div className="mt-10 grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => {
              const Icon = feature.icon;
              return (
                <motion.div key={feature.title} {...reveal} transition={{ duration: 0.4 }}>
                  <GlassCard className="h-full p-5 transition hover:-translate-y-0.5 hover:shadow-glass">
                    <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </span>
                    <h3 className="mt-3 font-semibold">{feature.title}</h3>
                    <p className="mt-2 text-sm text-muted">{feature.description}</p>
                  </GlassCard>
                </motion.div>
              );
            })}
          </div>
        </motion.section>

        {/* ─── The corpus (real sources, no invented claims) ─── */}
        <motion.section
          {...reveal}
          transition={{ duration: 0.5 }}
          id="corpus"
          className="mt-24 scroll-mt-24"
        >
          <h2 className="text-2xl font-semibold sm:text-3xl">Built on a real legal corpus</h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-muted">
            Every answer is grounded in indexed official documents — federal laws, BAMF brochures,
            and Goethe/telc/TestDaF exam handbooks. These are the largest documents in the knowledge
            base right now:
          </p>
          <div className="mt-10 grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-3">
            {(stats?.topSources ?? []).map((source, index) => (
              <GlassCard key={source.title} className="p-5">
                <div className="flex items-start gap-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-medium" title={source.title}>
                      {source.title}
                    </h3>
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
              {stats?.sources} sources · {stats?.parentChunks?.toLocaleString()} parent sections ·
              {stats?.chunks?.toLocaleString()} chunks · indexed as 1024-dim bge-m3 vectors.
            </p>
          )}
        </motion.section>

        {/* ─── Supported topics ─── */}
        <motion.section {...reveal} transition={{ duration: 0.5 }} className="mt-24">
          <h2 className="text-2xl font-semibold sm:text-3xl">What can I ask about?</h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-muted">
            From your first APS appointment to your first semester — the knowledge base covers the
            whole journey.
          </p>
          <div className="mx-auto mt-8 flex max-w-3xl flex-wrap justify-center gap-2">
            {TOPICS.map((topic) => (
              <a
                key={topic}
                href="/login"
                className="rounded-full border border-glass-border bg-glass px-3.5 py-1.5 text-xs text-muted shadow-glass backdrop-blur transition hover:border-primary hover:text-foreground"
              >
                {topic}
              </a>
            ))}
          </div>
        </motion.section>

        {/* ─── FAQ ─── */}
        <motion.section
          {...reveal}
          transition={{ duration: 0.5 }}
          id="faq"
          className="mx-auto mt-24 max-w-2xl scroll-mt-24 text-left"
        >
          <h2 className="text-center text-2xl font-semibold sm:text-3xl">
            Frequently asked questions
          </h2>
          <div className="mt-8 space-y-3">
            {FAQ_ITEMS.map((item, index) => {
              const open = openFaq === index;
              return (
                <GlassCard key={item.question} className="overflow-hidden p-0">
                  <button
                    type="button"
                    onClick={() => setOpenFaq(open ? null : index)}
                    aria-expanded={open}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left font-medium transition hover:bg-surface-hover"
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
        <motion.section {...reveal} transition={{ duration: 0.5 }} className="mt-24">
          <GlassCard className="relative overflow-hidden px-8 py-14">
            <h2 className="text-2xl font-semibold sm:text-3xl">
              Ready to start your German journey?
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-muted">
              Get grounded, sourced answers about visas, APS, blocked accounts, and admissions — in
              seconds, for free.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/login"
                className="cta-shimmer inline-block w-full rounded-xl bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground shadow-glass transition hover:bg-primary-hover active:scale-[0.98] sm:w-auto"
              >
                Start asking →
              </Link>
              <Link
                href="/login"
                className="inline-block w-full rounded-xl border border-glass-border bg-glass px-8 py-3 text-sm font-medium shadow-glass backdrop-blur transition hover:bg-surface-hover sm:w-auto"
              >
                Browse the knowledge base
              </Link>
            </div>
          </GlassCard>
        </motion.section>
      </main>

      <footer className="relative z-10 border-t border-glass-border bg-background/60 px-6 py-8 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left">
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
          className="fixed bottom-6 right-6 z-40 grid h-11 w-11 place-items-center rounded-full border border-glass-border bg-glass text-foreground shadow-glass backdrop-blur transition hover:bg-surface-hover"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      )}

      <ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />
    </div>
  );
}
