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
 * All sizes are grounded in the Prisma schema:
 *   - Message: content + metadata Json + sources Json + row overhead
 *   - ConversationMemory: 1 row per conversation (summaryText)
 *   - SemanticCacheEntry: queryVector vector(1024) (4 KB) + responseJson
 *     (full answer + sources) + queryText/hash/overhead — bounded by TTL
 *   - DocumentChunk: embedding vector(1024) (4 KB) + text + HNSW index overhead
 *
 * Usage (from web-app/):
 *   pnpm storage:estimate
 *   pnpm storage:estimate --users 5000 --chunks 60000 --cache-ttl-days 14
 *   pnpm storage:estimate --users 100 --chunks 5000 --neon-mb 512
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
  /** Questions asked per user per day — drives cache entry volume (messages are sized separately). */
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

interface LayerResult {
  name: string;
  count: number;
  bytes: number;
}

interface Model {
  params: EstimateParams;
  layers: LayerResult[];
  subtotal: number;
  total: number;
}

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildModel(overrides: Partial<EstimateParams>): Model {
  const params: EstimateParams = { ...DEFAULTS, ...overrides };
  const convCount = params.users * params.conversationsPerUser;
  const msgCount = convCount * params.messagesPerConversation;
  const cacheEntries = Math.ceil(
    params.users *
      params.questionsPerUserPerDay *
      params.distinctQuestionRatio *
      params.cacheTtlDays,
  );

  const layers: LayerResult[] = [
    { name: "Messages", count: msgCount, bytes: msgCount * params.avgMessageBytes },
    { name: "Conversations", count: convCount, bytes: convCount * params.conversationRowBytes },
    { name: "Summaries", count: convCount, bytes: convCount * params.summaryBytes },
    {
      name: "Semantic cache",
      count: cacheEntries,
      bytes: cacheEntries * params.cacheEntryBytes,
    },
    { name: "Chunks (corpus)", count: params.chunks, bytes: params.chunks * params.chunkBytes },
  ];

  const subtotal = layers.reduce((acc, layer) => acc + layer.bytes, 0);
  const total = subtotal * (1 + params.overheadPct / 100);
  return { params, layers, subtotal, total };
}

function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 10_000) return `${(value / 1000).toFixed(0)}K`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return `${Math.round(value)}`;
}

function printLayerTable(model: Model): void {
  const { params } = model;
  const neonBytes = params.neonFreeMb * 1024 * 1024;
  const header = `${model.layers.length} layers`;
  console.log(`\nLayer table — ${header} @ ${formatNumber(params.users)} users`);
  console.log("─".repeat(58));
  console.log(
    "Layer".padEnd(20) + "Count".padStart(10) + "Size".padStart(14) + "% free tier".padStart(13),
  );
  console.log("─".repeat(58));
  for (const layer of model.layers) {
    const pct = ((layer.bytes / neonBytes) * 100).toFixed(1);
    console.log(
      layer.name.padEnd(20) +
        formatNumber(layer.count).padStart(10) +
        mb(layer.bytes).padStart(14) +
        `${pct}%`.padStart(13),
    );
  }
  console.log("─".repeat(58));
  const subtotalPct = ((model.subtotal / neonBytes) * 100).toFixed(1);
  const totalPct = ((model.total / neonBytes) * 100).toFixed(1);
  console.log(
    "Subtotal (raw)".padEnd(20) +
      "".padStart(10) +
      mb(model.subtotal).padStart(14) +
      `${subtotalPct}%`.padStart(13),
  );
  console.log(
    `+ PG overhead ${params.overheadPct}%`.padEnd(30) +
      mb(model.total - model.subtotal).padStart(14),
  );
  console.log(
    "Total".padEnd(20) +
      "".padStart(10) +
      mb(model.total).padStart(14) +
      `${totalPct}%`.padStart(13),
  );
  if (model.total > neonBytes) {
    console.log(`\n⚠ Total exceeds the ${params.neonFreeMb} MB free tier.`);
  } else {
    console.log(`\n✅ Total fits within the ${params.neonFreeMb} MB free tier.`);
  }
}

interface LayerSlope {
  name: string;
  /** Bytes per user (0 for the constant corpus layer). */
  slope: number;
  /** Bytes independent of user count (only the corpus). */
  constant: number;
}

function buildSlopes(model: Model): LayerSlope[] {
  const p = model.params;
  return [
    {
      name: "Messages",
      slope: p.conversationsPerUser * p.messagesPerConversation * p.avgMessageBytes,
      constant: 0,
    },
    { name: "Conversations", slope: p.conversationsPerUser * p.conversationRowBytes, constant: 0 },
    { name: "Summaries", slope: p.conversationsPerUser * p.summaryBytes, constant: 0 },
    {
      name: "Semantic cache",
      slope:
        p.questionsPerUserPerDay * p.distinctQuestionRatio * p.cacheTtlDays * p.cacheEntryBytes,
      constant: 0,
    },
    { name: "Chunks (corpus)", slope: 0, constant: p.chunks * p.chunkBytes },
  ];
}

/**
 * Finds the user count at which layer `a` overtakes layer `b`.
 * Returns null when the ordering never flips (parallel lines / zero slope).
 */
function crossoverUsers(a: LayerSlope, b: LayerSlope): number | null {
  const d = a.slope - b.slope;
  if (Math.abs(d) < 1e-9) return null;
  const u = (b.constant - a.constant) / d;
  return u > 0 ? u : null;
}

function sizeAt(slope: LayerSlope, users: number): number {
  return slope.slope * users + slope.constant;
}

function printCrossoverAnalysis(model: Model): void {
  const { params } = model;
  const slopes = buildSlopes(model);
  const corpus = slopes.find((s) => s.name === "Chunks (corpus)");
  if (!corpus) return;

  console.log("\nCrossover analysis — user count at which each layer overtakes the corpus:");
  for (const s of slopes) {
    if (s.slope <= 0) continue;
    const u = crossoverUsers(s, corpus);
    let label: string;
    if (corpus.constant === 0) {
      label = "immediately (no corpus ingested)";
    } else if (u === null) {
      label = "never (smaller than corpus forever)";
    } else {
      label = `~${formatNumber(u)} users`;
    }
    console.log(`  ${s.name.padEnd(17)} overtakes corpus at ${label}`);
  }

  // Dominant layer over user ranges (piecewise), merging adjacent ranges that
  // share the same dominant layer.
  const breakpoints = new Set<number>([0]);
  for (let i = 0; i < slopes.length; i++) {
    for (let j = i + 1; j < slopes.length; j++) {
      const u = crossoverUsers(slopes[i], slopes[j]);
      if (u !== null) breakpoints.add(u);
    }
  }
  const sorted = [...breakpoints].sort((a, b) => a - b);
  const maxUsers = 100_000_000;
  const rawRanges: { from: number; to: number; name: string }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const from = sorted[i];
    const to = i + 1 < sorted.length ? Math.min(sorted[i + 1], maxUsers) : maxUsers;
    if (to <= from) continue;
    const mid = (from + to) / 2;
    let dominant = slopes[0];
    for (const s of slopes) {
      if (sizeAt(s, mid) > sizeAt(dominant, mid)) dominant = s;
    }
    rawRanges.push({ from, to, name: dominant.name });
    if (to >= maxUsers) break;
  }
  const merged: typeof rawRanges = [];
  for (const range of rawRanges) {
    const last = merged[merged.length - 1];
    if (last && last.name === range.name && last.to === range.from) {
      last.to = range.to;
    } else {
      merged.push({ ...range });
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
  const neonBytes = params.neonFreeMb * 1024 * 1024;
  const targetRaw = neonBytes / (1 + params.overheadPct / 100);
  const sumSlopes = slopes.filter((s) => s.slope > 0).reduce((acc, s) => acc + s.slope, 0);
  console.log("\nFree-tier capacity:");
  if (sumSlopes <= 0) {
    console.log("  No user-dependent layers configured; capacity is constant.");
  } else {
    const u = (targetRaw - corpus.constant) / sumSlopes;
    if (u <= 0) {
      console.log(
        `  ⚠ Corpus alone (${mb(corpus.constant)}) already exceeds the ${params.neonFreeMb} MB tier.`,
      );
    } else {
      console.log(
        `  Total storage exceeds ${params.neonFreeMb} MB free tier at ~${formatNumber(u)} users`,
      );
      console.log("  (holding corpus, cache TTL, and per-user volumes constant).");
    }
  }
}

function printModelLine(model: Model): void {
  const { params } = model;
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
}

function main(): void {
  const overrides = parseArgs(process.argv.slice(2));
  const model = buildModel(overrides);
  printModelLine(model);
  printLayerTable(model);
  printCrossoverAnalysis(model);
  console.log("");
}

main();
