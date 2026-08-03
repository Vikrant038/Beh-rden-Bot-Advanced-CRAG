"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  Bot,
  Database,
  Eye,
  GraduationCap,
  Menu,
  ShieldCheck,
  X,
  Zap,
} from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { CountUp } from "@/components/ui/count-up";

const NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#resources", label: "Resources" },
  { href: "#faq", label: "FAQ" },
];

const STATS_LIST = [
  { value: 2000, suffix: "+", label: "questions answered" },
  { value: 50, suffix: "+", label: "official sources" },
  { value: 3, suffix: "", label: "agent pipeline" },
  { value: 99.9, suffix: "%", label: "uptime", decimals: 1 },
];

const FEATURES = [
  {
    title: "3-Agent ReAct",
    description:
      "Research, analysis, and writing agents collaborate to build thorough, grounded answers.",
    icon: Bot,
  },
  {
    title: "Hybrid Retrieval",
    description: "Dense pgvector search fused with BM25 keyword search via reciprocal rank fusion.",
    icon: Database,
  },
  {
    title: "CRAG Gate",
    description:
      "Confidence-gated retrieval that automatically falls back to live web search on weak sources.",
    icon: ShieldCheck,
  },
  {
    title: "Semantic Cache",
    description: "Exact and vector-similarity caching returns repeat answers in milliseconds.",
    icon: Zap,
  },
  {
    title: "PII Masking",
    description:
      "Names, emails, and passport numbers are redacted before any query reaches an LLM.",
    icon: Eye,
  },
  {
    title: "Observability",
    description:
      "Full tracing of latency, tokens, fallbacks, and cache behaviour for every answer.",
    icon: BarChart3,
  },
];

const CONTENT_SECTIONS = [
  {
    eyebrow: "Guides",
    title: "End-to-end process walkthroughs",
    body: "Step-by-step walkthroughs that connect every milestone — from APS verification and uni-assist application through visa submission and blocked-account setup — so nothing falls through the cracks.",
    cta: "Read the guides",
  },
  {
    eyebrow: "Universities",
    title: "University & program spotlights",
    body: "Curated dossiers on leading German institutions: admission seasons, language requirements, tuition-fee status, and the documents each program actually expects.",
    cta: "Explore spotlights",
  },
  {
    eyebrow: "Finances",
    title: "Financial planning for your move",
    body: "Blocked-account thresholds, semester contributions, health-insurance costs, and realistic monthly budgets for major German cities — with the numbers kept current.",
    cta: "See the numbers",
  },
  {
    eyebrow: "Timelines",
    title: "Checklists and timelines",
    body: "Calendar-aware checklists that sequence every deadline: application windows, visa appointments, and enrollment cutoffs mapped to your intended intake.",
    cta: "Get the checklist",
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
  const reduceMotion = useReducedMotion();

  const reveal = reduceMotion
    ? {}
    : { initial: { opacity: 0, y: 16 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true } };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
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

        {/* ─── Trust / stats bar ─── */}
        <motion.section
          {...reveal}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="mx-auto mt-16 grid max-w-4xl grid-cols-2 gap-4 lg:grid-cols-4"
          aria-label="Trust statistics"
        >
          {STATS_LIST.map((stat) => (
            <StatCard
              key={stat.label}
              value={stat.value}
              suffix={stat.suffix}
              label={stat.label}
              decimals={stat.decimals}
            />
          ))}
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

        {/* ─── Resources ─── */}
        <motion.section
          {...reveal}
          transition={{ duration: 0.5 }}
          id="resources"
          className="mt-24 scroll-mt-24"
        >
          <h2 className="text-2xl font-semibold sm:text-3xl">Guides, resources & timelines</h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-muted">
            In-depth editorial content for every stage of the journey — from your first APS
            appointment to your first semester.
          </p>

          <div className="mt-10 grid gap-4 text-left sm:grid-cols-2">
            {CONTENT_SECTIONS.map((section) => (
              <GlassCard
                key={section.eyebrow}
                className="flex flex-col p-6 transition hover:-translate-y-0.5 hover:shadow-glass"
              >
                <p className="text-xs font-semibold uppercase tracking-wider text-accent">
                  {section.eyebrow}
                </p>
                <h3 className="mt-2 font-semibold">{section.title}</h3>
                <p className="mt-2 flex-1 text-sm text-muted">{section.body}</p>
                <Link
                  href="/login"
                  className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary transition hover:text-primary-hover"
                >
                  {section.cta}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </GlassCard>
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
              Get grounded, sourced answers about visas, APS, blocked accounts, and admissions —
              in seconds, for free.
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
          <p className="text-[10px] text-muted">© {new Date().getFullYear()} Behörden-Bot</p>
        </div>
      </footer>
    </div>
  );
}
