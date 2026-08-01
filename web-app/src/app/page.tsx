import Link from "next/link";
import Image from "next/image";

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

export default function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div className="gradient-mesh pointer-events-none absolute inset-0" />

      <header className="relative z-10 flex items-center justify-between px-6 py-5">
        <span className="text-lg font-semibold">Behörden-Bot</span>
        <Link
          href="/login"
          className="rounded-lg border border-border px-3 py-1.5 text-sm transition hover:bg-surface-hover"
        >
          Sign in
        </Link>
      </header>

      <main className="relative z-10 mx-auto max-w-5xl px-6 pb-24 pt-16 text-center">
        <div className="mx-auto max-w-2xl overflow-hidden rounded-3xl border border-glass-border bg-glass backdrop-blur">
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
              className="cta-shimmer mt-8 inline-block rounded-xl bg-primary px-8 py-3 text-sm font-semibold text-white"
            >
              Start asking →
            </Link>
          </div>
        </div>

        <div className="mt-16 grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="rounded-2xl border border-border bg-surface/70 p-5 transition hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/10"
            >
              <h3 className="font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm text-muted">{feature.description}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="relative z-10 border-t border-border px-6 py-6 text-center text-xs text-muted">
        Built for Indian students navigating the German education system.
      </footer>
    </div>
  );
}
