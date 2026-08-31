/**
 * Neon free-tier storage estimator for the Behörden-Bot web app.
 *
 * Models the four data layers stored in Postgres — messages, conversations +
 * memory summaries, the global semantic cache, and ingested document chunks —
 * and reports:
 *   1. A per-layer size table for a given user count.
 *   2. The user count at which each layer overtakes the document corpus.
 *   3. The dominant layer at any scale (piecewise over user ranges).
 *   4. The user count at which total storage exceeds the Neon free tier
 *      (512 MB by default, overridable).
 *
 * All sizes are grounded in the Prisma schema (Message content/metadata/sources,
 * ConversationMemory summaryText, SemanticCacheEntry vector(1024) + responseJson,
 * DocumentChunk embedding vector(1024) + text + HNSW index).
 *
 * Every layer is linear in users: bytes(u) = a·u + b, so the table, the
 * crossover analysis, and the dominant-layer ranges all derive from one
 * descriptor list (A/B below) — no duplicated layer math.
 *
 * Usage (from web-app/):
 *   pnpm storage:estimate
 *   pnpm storage:estimate --users 5000 --chunks 60000 --cache-ttl-days 14
 *
 * Every flag is optional; defaults model the app as deployed today.
 */

interface EstimateParams {
  /** Total registered + guest users. */
  users: number;
  /** Average conversations per user. */
  conversationsPerUser: number;
  /** Average messages per conversation (both roles). */
  messagesPerConversation: number;
  /** Weighted avg bytes per message (user + assistant incl. metadata/sources). */
  avgMessageBytes: number;
  /** Bare Conversation row size. */
  conversationRowBytes: number;
  /** ConversationMemory summaryText + row overhead. */
  summaryBytes: number;
  /** Semantic-cache TTL in days. */
  cacheTtlDays: number;
  /** Questions asked per user per day — drives cache entry volume. */
  questionsPerUserPerDay: number;
  /** Fraction of questions that are distinct enough to create new cache entries. */
  distinctQuestionRatio: number;
  /** Bytes per SemanticCacheEntry (4 KB vector + ~4 KB responseJson + overhead). */
  cacheEntryBytes: number;
  /** Total document chunks ingested into the corpus. */
  chunks: number;
  /** Bytes per chunk (4 KB vector + ~1 KB text + ~5 KB HNSW index overhead). */
  chunkBytes: number;
  /** Postgres real-world overhead: WAL, page headers, MVCC bloat. */
  overheadPct: number;
  /** Neon free tier cap in MB. */
  neonFreeMb: number;
}

const DEFAULTS: EstimateParams = {
  users: 1000,
  conversationsPerUser: 5,
  messagesPerConversation: 10,
  avgMessageBytes: 2500,
  conversationRowBytes: 200,
  summaryBytes: 2000,
  cacheTtlDays: 7,
  questionsPerUserPerDay: 7,
  distinctQuestionRatio: 0.2,
  cacheEntryBytes: 8000,
  chunks: 40000,
  chunkBytes: 9000,
  overheadPct: 25,
  neonFreeMb: 512,
};

function parseArgs(argv: string[]): Partial<EstimateParams> {
  const out: Partial<EstimateParams> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const rawValue = eq === -1 ? argv[i + 1] : arg.slice(eq + 1);
    // Reject missing, empty, and flag-like values so `--users --chunks 500`
    // does not silently swallow `--chunks` as a value (or an empty value as 0).
    if (!rawValue || rawValue.startsWith("--") || !/^-?\d+(\.\d+)?$/.test(rawValue)) continue;
    const value = Number(rawValue);
    // Accept both kebab-case flags (--cache-ttl-days) and camelCase (--cacheTtlDays).
    const camelKey = key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    if (Object.prototype.hasOwnProperty.call(DEFAULTS, camelKey) && !Number.isNaN(value)) {
      // Clamp negatives so nonsense inputs cannot produce inverted math or
      // a division-by-zero from `overheadPct <= -100`.
      (out as Record<string, number>)[camelKey] = Math.max(0, value);
    }
  }
  return out;
}

/** A storage layer as a line in users: bytes(u) = slope·u + constant. */
interface Layer {
  name: string;
  /** Bytes per user. */
  slope: number;
  /** Bytes independent of user count (only the corpus). */
  constant: number;
  /** Bytes per stored row (backing out display counts). */
  unit: number;
}

/** Builds the layer list — the single source for table AND crossover math. */
function buildLayers(p: EstimateParams): Layer[] {
  const perConv = p.conversationsPerUser;
  const cacheEntries = p.questionsPerUserPerDay * p.distinctQuestionRatio * p.cacheTtlDays;
  return [
    {
      name: "Messages",
      slope: perConv * p.messagesPerConversation * p.avgMessageBytes,
      constant: 0,
      unit: p.avgMessageBytes,
    },
    {
      name: "Conversations",
      slope: perConv * p.conversationRowBytes,
      constant: 0,
      unit: p.conversationRowBytes,
    },
    { name: "Summaries", slope: perConv * p.summaryBytes, constant: 0, unit: p.summaryBytes },
    {
      name: "Semantic cache",
      slope: cacheEntries * p.cacheEntryBytes,
      constant: 0,
      unit: p.cacheEntryBytes,
    },
    { name: "Chunks (corpus)", slope: 0, constant: p.chunks * p.chunkBytes, unit: p.chunkBytes },
  ];
}

const sizeAt = (layer: Layer, users: number): number => layer.slope * users + layer.constant;

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 10_000) return `${(value / 1000).toFixed(0)}K`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return `${Math.round(value)}`;
}

/** One formatted table row: "name  count  size  %". */
function tableRow(name: string, count: string, bytes: number, neonBytes: number): string {
  return (
    name.padEnd(20) +
    count.padStart(10) +
    mb(bytes).padStart(14) +
    `${((bytes / neonBytes) * 100).toFixed(1)}%`.padStart(13)
  );
}

function printLayerTable(p: EstimateParams, layers: Layer[]): void {
  const neonBytes = p.neonFreeMb * 1024 * 1024;
  const rows = layers.map((layer) => {
    const bytes = sizeAt(layer, p.users);
    return { name: layer.name, count: formatNumber(bytes / layer.unit), bytes };
  });
  const subtotal = rows.reduce((acc, row) => acc + row.bytes, 0);
  const total = subtotal * (1 + p.overheadPct / 100);

  const rule = "─".repeat(58);
  console.log(`\nLayer table — ${layers.length} layers @ ${formatNumber(p.users)} users`);
  console.log(rule);
  console.log(
    "Layer".padEnd(20) + "Count".padStart(10) + "Size".padStart(14) + "% free tier".padStart(13),
  );
  console.log(rule);
  for (const row of rows) {
    console.log(tableRow(row.name, row.count, row.bytes, neonBytes));
  }
  console.log(rule);
  console.log(tableRow("Subtotal (raw)", "", subtotal, neonBytes));
  console.log(`+ PG overhead ${p.overheadPct}%`.padEnd(30) + mb(total - subtotal).padStart(14));
  console.log(tableRow("Total", "", total, neonBytes));
  if (total > neonBytes) {
    console.log(`\n⚠ Total exceeds the ${p.neonFreeMb} MB free tier.`);
  } else {
    console.log(`\n✅ Total fits within the ${p.neonFreeMb} MB free tier.`);
  }
}

/**
 * Finds the user count at which layer `a` overtakes layer `b`.
 * Returns null when the ordering never flips (parallel lines / zero slope).
 */
function crossoverUsers(a: Layer, b: Layer): number | null {
  const d = a.slope - b.slope;
  if (Math.abs(d) < 1e-9) return null;
  const u = (b.constant - a.constant) / d;
  return u > 0 ? u : null;
}

function printCrossoverAnalysis(p: EstimateParams, layers: Layer[]): void {
  const corpus = layers[layers.length - 1];

  console.log("\nCrossover analysis — user count at which each layer overtakes the corpus:");
  for (const layer of layers) {
    if (layer.slope <= 0) continue;
    const u = crossoverUsers(layer, corpus);
    let label: string;
    if (corpus.constant === 0) {
      label = "immediately (no corpus ingested)";
    } else if (u === null) {
      label = "never (smaller than corpus forever)";
    } else {
      label = `~${formatNumber(u)} users`;
    }
    console.log(`  ${layer.name.padEnd(17)} overtakes corpus at ${label}`);
  }

  // Dominant layer over user ranges (piecewise), merging adjacent ranges that
  // share the same dominant layer.
  const breakpoints = new Set<number>([0]);
  for (let i = 0; i < layers.length; i++) {
    for (let j = i + 1; j < layers.length; j++) {
      const u = crossoverUsers(layers[i], layers[j]);
      if (u !== null) breakpoints.add(u);
    }
  }
  const sorted = [...breakpoints].sort((a, b) => a - b);
  const maxUsers = 100_000_000;
  const merged: { from: number; to: number; name: string }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const from = sorted[i];
    const to = i + 1 < sorted.length ? Math.min(sorted[i + 1], maxUsers) : maxUsers;
    if (to <= from) continue;
    const mid = (from + to) / 2;
    const dominant = layers.reduce((best, layer) =>
      sizeAt(layer, mid) > sizeAt(best, mid) ? layer : best,
    );
    const last = merged[merged.length - 1];
    if (last && last.name === dominant.name && last.to === from) {
      last.to = to;
    } else {
      merged.push({ from, to, name: dominant.name });
    }
  }
  console.log("\nDominant layer by scale:");
  for (const range of merged) {
    console.log(
      range.from === 0
        ? `  0 → ${formatNumber(range.to)} users: ${range.name}`
        : `  > ${formatNumber(range.from)} users: ${range.name}`,
    );
  }

  // Neon crossing: total = neon → users.
  const neonBytes = p.neonFreeMb * 1024 * 1024;
  const targetRaw = neonBytes / (1 + p.overheadPct / 100);
  const sumSlopes = layers.reduce((acc, layer) => acc + layer.slope, 0);
  console.log("\nFree-tier capacity:");
  if (sumSlopes <= 0) {
    console.log("  No user-dependent layers configured; capacity is constant.");
  } else {
    const u = (targetRaw - corpus.constant) / sumSlopes;
    if (u <= 0) {
      console.log(
        `  ⚠ Corpus alone (${mb(corpus.constant)}) already exceeds the ${p.neonFreeMb} MB tier.`,
      );
    } else {
      console.log(
        `  Total storage exceeds ${p.neonFreeMb} MB free tier at ~${formatNumber(u)} users`,
      );
      console.log("  (holding corpus, cache TTL, and per-user volumes constant).");
    }
  }
}

function main(): void {
  const params: EstimateParams = { ...DEFAULTS, ...parseArgs(process.argv.slice(2)) };
  const layers = buildLayers(params);
  console.log("Behörden-Bot — Neon free-tier storage estimator");
  console.log("─".repeat(58));
  console.log(
    `Model: ${formatNumber(params.users)} users · ${params.conversationsPerUser} convs/user · ` +
      `${params.messagesPerConversation} msgs/conv`,
  );
  console.log(
    `       ${formatNumber(params.chunks)} chunks ingested · cache TTL ${params.cacheTtlDays}d · ` +
      `${Math.round(params.distinctQuestionRatio * 100)}% distinct questions`,
  );
  printLayerTable(params, layers);
  printCrossoverAnalysis(params, layers);
  console.log("");
}

main();
