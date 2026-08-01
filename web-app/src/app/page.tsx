import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";

const FEATURES = [
  {
    title: "3-Agent ReAct",
    description:
      "Research, analysis, and writing agents collaborate to build thorough, grounded answers.",
  },
  {
    title: "Hybrid Retrieval",
    description: "Dense pgvector search fused with BM25 keyword search via reciprocal rank fusion.",
  },
  {
    title: "CRAG Gate",
    description:
      "Confidence-gated retrieval that automatically falls back to live web search on weak sources.",
  },
  {
    title: "Semantic Cache",
    description: "Exact and vector-similarity caching returns repeat answers in milliseconds.",
  },
  {
    title: "PII Masking",
    description:
      "Names, emails, and passport numbers are redacted before any query reaches an LLM.",
  },
  {
    title: "Observability",
    description:
      "Full tracing of latency, tokens, fallbacks, and cache behaviour for every answer.",
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

export default function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div className="gradient-mesh pointer-events-none absolute inset-0" />

      <header className="relative z-10 flex items-center justify-between px-6 py-5">
        <span className="text-lg font-semibold">Behörden-Bot</span>
        <Link
          href="/login"
          className="rounded-lg border border-glass-border bg-glass px-3 py-1.5 text-sm shadow-glass backdrop-blur transition hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-primary"
        >
          Sign in
        </Link>
      </header>

      <main className="relative z-10 mx-auto max-w-5xl px-6 pb-24 pt-16 text-center">
        <GlassCard className="mx-auto max-w-2xl overflow-hidden">
          <div className="relative aspect-video w-full overflow-hidden">
            <Image
              src="/Images/hero-banner.jpg"
              alt="German universities, student visas, and blocked accounts guide"
              fill
              priority
              sizes="(max-width: 768px) 100vw, 42rem"
              className="object-cover"
            />
          </div>
          <div className="px-10 pb-10 pt-8">
            <h1 className="text-4xl font-bold leading-tight sm:text-5xl">
              Your AI Guide to German Immigration
            </h1>
            <p className="mt-4 text-base text-muted">
              Student visas, APS certification, blocked accounts, and university applications —
              answered with official sources in seconds.
            </p>
            <Link
              href="/login"
              className="cta-shimmer mt-8 inline-block rounded-xl bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground shadow-glass transition hover:bg-primary-hover active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-primary"
            >
              Start asking →
            </Link>
          </div>
        </GlassCard>

        <div className="mt-16 grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <GlassCard
              key={feature.title}
              className="p-5 transition hover:-translate-y-0.5 hover:shadow-glass"
            >
              <h3 className="font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm text-muted">{feature.description}</p>
            </GlassCard>
          ))}
        </div>

        <div className="mt-24">
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
                  className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary transition hover:text-primary-hover focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {section.cta}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </GlassCard>
            ))}
          </div>
        </div>
      </main>

      <footer className="relative z-10 border-t border-border px-6 py-6 text-center text-xs text-muted">
        Built for Indian students navigating the German education system.
      </footer>
    </div>
  );
}
