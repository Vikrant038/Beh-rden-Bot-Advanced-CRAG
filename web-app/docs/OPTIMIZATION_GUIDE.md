# Optimization & Best Practices Guide

> **For:** Developers optimizing database queries, async patterns, and performance

---

## 🗄️ Database Optimization

### **Current Schema Review: Grade A-**

Your `prisma/schema.prisma` is well-designed. Here's what's working:

✅ **Proper Indexing**
```prisma
model Conversation {
  @@index([userId, updatedAt(sort: Desc)])  // Query pattern: user's recent chats
  @@index([userId, deletedAt, pinned, updatedAt(sort: Desc)])  // Soft-delete queries
}

model DocumentChunk {
  @@index([documentId])  // Join back to parent document
  @@index([sourceName])  // Search by source
  @@index([parentId])    // Navigate to parent chunk
}

model SemanticCacheEntry {
  @@index([expiresAt])   // Cleanup job: find expired entries
}
```

✅ **Foreign Key Constraints (Cascading)**
```prisma
user User @relation(fields: [userId], references: [id], onDelete: Cascade)
// When user deleted → all conversations/feedback deleted automatically
```

✅ **Role-Based Access (PostgreSQL level)**
```sql
-- behoerden_app role is DML-only (secure)
-- behoerden_migrator role is DDL-only (manage schema)
```

---

### **Areas for Optimization**

#### **1. Message.sources as JSON Blob**

**Current:**
```prisma
model Message {
  sources Json?  // Array of { name, url, score, documentId }
}
```

**Problem:** Can't query citations via SQL
```sql
-- You CANNOT do this:
SELECT COUNT(*), document_id FROM messages
  CROSS JOIN LATERAL jsonb_array_elements(messages.sources) AS src
GROUP BY document_id
-- (expensive; sources unpacked every query)
```

**Solution (PHASE 3):** Normalize to a relation
```prisma
model MessageSource {
  id String @id @default(cuid())
  messageId String
  documentId String?
  name String
  url String
  score Float
  
  message Message @relation(fields: [messageId], references: [id], onDelete: Cascade)
  
  @@index([messageId])
  @@index([documentId])
  @@unique([messageId, documentId])  // Prevent duplicates
}
```

**Trade-off:** Adds 1 join per message read; enables SQL analytics

---

#### **2. Conversation Memory Summary Storage**

**Current:**
```prisma
model ConversationMemory {
  summaryText String @default("")
  updatedAt DateTime @updatedAt
}
```

**Potential Issue:** Unbounded `summaryText` grows as conversation lengthens

**Solution:** Cap summary length + implement windowing
```typescript
// In src/server/rag/memory/summary-buffer.ts
const MAX_SUMMARY_LENGTH = 2000;  // Hard limit

if (summary.length > MAX_SUMMARY_LENGTH) {
  // Keep only recent turns, drop oldest
  summary = summary.slice(-MAX_SUMMARY_LENGTH);
}
```

---

#### **3. Vector Index on DocumentChunk**

**Current:**
```prisma
embedding Unsupported("vector(1024)")
```

**Optimization:** Add HNSW index for faster search
```prisma
// schema.prisma (after Prisma supports vector indexes)
@@index([embedding(ops: "vector_cosine_ops")])  // HNSW algorithm
```

**Status:** Waiting on Prisma support; manually created in migrations

**Workaround:** Create in migration if needed
```sql
CREATE INDEX idx_document_chunk_embedding
  ON document_chunks USING HNSW (embedding vector_cosine_ops);
```

---

### **Query Performance Checklist**

#### **Dense Retrieval (FAISS)**

```typescript
// src/server/rag/retrieval/dense.ts
const rows = await prisma.$queryRaw<SimilarChunkRow[]>`
  SELECT id, "parentId", "documentId", "sourceName", "sourceUrl", text,
         1 - (embedding <=> ${literal}::vector) AS sim
  FROM document_chunks
  WHERE 1 - (embedding <=> ${literal}::vector) >= ${minSimilarity}
  ORDER BY embedding <=> ${literal}::vector
  LIMIT ${topK};
`;
```

✅ **Good:**
- Uses Postgres vector operations (fast, vectorized)
- Filters before ORDER BY (reduces sort cost)
- Limits result set (no unbounded fetch)

🔧 **Could improve:**
- Add `EXPLAIN ANALYZE` output to docs
- Monitor query execution time via Langfuse

---

#### **Semantic Cache Lookup**

```typescript
// src/server/db/vector-queries.ts
const literal = toVectorLiteral(queryVector);

return prisma.$queryRaw<CacheSimRow[]>`
  SELECT "responseJson", 1 - ("queryVector" <=> ${literal}::vector) AS sim
  FROM semantic_cache
  WHERE "expiresAt" > ${now}
  ORDER BY "queryVector" <=> ${literal}::vector
  LIMIT 1;
`;
```

✅ **Good:**
- Pre-filters by expiration (only live cache)
- Single result (LIMIT 1)
- No unnecessary columns

🔧 **Could improve:**
- Cache hit rate tracking (add to analytics)
- TTL tuning (currently 7 days; tune based on usage)

---

## ⚡ Async/Await Patterns

### **Current Grade: A (Well-Executed)**

Your async patterns are clean. Here's what's working:

#### **1. Promise Composition (Good)**

```typescript
// src/server/rag/retrieval/hybrid.ts
const [dense, sparse] = await Promise.all([
  hybridRetriever.embedQuery(maskedQuestion),
  bm25.search(maskedQuestion, { topK: SPARSE_TOP_K }),
]);
```

✅ **Good:**
- Parallel execution (both run concurrently)
- Explicit wait (`await`)
- No orphaned promises

---

#### **2. Error Handling in Pipelines**

```typescript
// src/server/rag/pipeline.ts
try {
  answerText = await callLLM(messages, { maxTokens: 600 });
  isGrounded = true;
  pathUsed = gate.pathUsed;
} catch (error) {
  logger.warn({ error: String(error) }, "[CRAG] generation failed");
  answerText = "I do not have sufficient official information...";
  isGrounded = false;
  pathUsed = "LLM_GENERATION_FAILED";
}
```

✅ **Good:**
- Graceful fallback (ungrounded answer, not 500 error)
- Logged error for debugging
- User sees message (not raw exception)

---

#### **3. Streaming Responses (SSE)**

```typescript
// src/app/api/chat/stream/route.ts
const stream = new ReadableStream<Uint8Array>({
  async start(controller) {
    try {
      for await (const event of runChatStream({...})) {
        if (request.signal.aborted) break;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
    } finally {
      controller.close();
    }
  },
});
```

✅ **Good:**
- Respects cancellation (AbortSignal)
- Async iteration (`for await`)
- Proper cleanup (finally block)

---

### **Potential Async Issues (Rare)**

#### **1. Race Condition in Guest Claim**

```typescript
// src/server/trpc/context.ts
if (session?.user?.id && cookieGuestId) {
  try {
    await claimGuestData(cookieGuestId, session.user.id);
    // ⚠️ What if two requests arrive simultaneously?
    // First request moves data; second request fails (no rows to move)
  }
}
```

**Solution:** Use database-level locking
```typescript
// In claimGuestData():
const tx = await prisma.$transaction(async (tx) => {
  // Atomic: all or nothing
  const guestConversations = await tx.conversation.findMany({
    where: { userId: guestId },
  });
  
  await tx.conversation.updateMany({
    where: { userId: guestId },
    data: { userId: accountId },
  });
  
  return guestConversations;
});
```

---

#### **2. Ingest Pipeline Sync Timeout**

```typescript
// src/server/ingest/pipeline.ts
export async function syncAllDocuments() {
  // ⚠️ Runs synchronously inside /api/admin/documents/sync
  // Risk: 60s Vercel timeout if corpus is large (>20 documents)
  
  for (const doc of documents) {
    await ingestUrl(doc.url);  // Sequential, could take 5s each
  }
}
```

**Solution (PHASE 2):** Move to background queue
```typescript
// Create ingest job in DB
await prisma.ingestJob.create({
  data: {
    type: "URL",
    url: document.url,
    status: "QUEUED",
  },
});

// Vercel Cron runs daily to process jobs
// - /api/cron/process-ingest-jobs processes 1 job per invocation
// - If stuck, next cron picks it up
```

---

## 📊 Performance Metrics & Monitoring

### **Key Metrics to Track**

```typescript
// Langfuse automatically captures:
- latencyMs: Total pipeline time
- tokenUsage: LLM token count
- retrieval_latency: Search time
- cache_hit_rate: Semantic cache effectiveness
- isCached: Whether response came from cache
```

### **Set Up Dashboard**

```bash
# In Vercel environment variables, set:
LANGFUSE_PUBLIC_KEY=pk_...
LANGFUSE_SECRET_KEY=sk_...
LANGFUSE_HOST=https://cloud.langfuse.com

# Then visit: https://cloud.langfuse.com/dashboard
# Filter by mode: STANDARD vs AGENTIC
# Identify slow queries (outliers >5s)
```

---

## 🔍 Query Optimization Checklist

### **For Every Database Query**

- [ ] **Index exists** — `@@index([field])` in schema?
- [ ] **Filters first** — WHERE before ORDER BY?
- [ ] **Limits result** — LIMIT N to avoid unbounded fetches?
- [ ] **Parameterized** — Using `Prisma.sql` or ORM generated SQL?
- [ ] **No N+1** — One query vs many? (use `select()` to avoid extra fields)
- [ ] **Tested** — EXPLAIN ANALYZE shows reasonable plan?

---

### **Before Adding Raw SQL**

1. **Can Prisma ORM do it?** Use ORM first
   ```typescript
   // ✅ Prefer ORM
   await prisma.message.findMany({
     where: { conversationId, role: "ASSISTANT" },
     select: { content: true, createdAt: true },
     orderBy: { createdAt: "desc" },
     take: 10,
   });
   ```

2. **If ORM doesn't support it**, use `Prisma.sql`
   ```typescript
   // ✅ Use tagged template (safe from injection)
   const rows = await prisma.$queryRaw<Row[]>`
     SELECT * FROM messages WHERE role = ${"ASSISTANT"}
   `;
   ```

3. **Never interpolate strings**
   ```typescript
   // ❌ NEVER
   const query = `SELECT * FROM messages WHERE id = ${id}`;
   await prisma.$executeRaw(query);
   ```

---

## 🚀 Performance Targets

### **Baseline (Current)**

| Operation | Latency | Target | Notes |
|-----------|---------|--------|-------|
| **Semantic cache hit** | ~20ms | <50ms | Fast path |
| **Dense retrieval (FAISS)** | ~100ms | <200ms | Vector search |
| **Sparse retrieval (BM25)** | ~50ms | <100ms | Full-text search |
| **Reranking (cross-encoder)** | ~200ms | <300ms | Model inference |
| **LLM generation** | ~2s | <5s | Groq inference |
| **E2E chat response** | ~3-5s | <10s | Including all stages |

### **Optimization Priorities**

1. **Cache hit rate** (quickest win)
   - Current: ~30-40%
   - Target: >60%
   - How: Increase TTL, tune similarity threshold

2. **Vector index** (medium effort)
   - Add HNSW index on embeddings
   - Reduces dense search from 100ms to 30ms

3. **Query batching** (low effort)
   - Batch multiple concurrent requests
   - Reduce connection overhead

4. **Connection pooling** (Neon only)
   - Use `pooler.` URL instead of direct connection
   - Reduces latency by ~50ms

---

## 🛡️ Concurrency & Safety

### **Conversation Ownership (Prevents Data Leaks)**

```typescript
// src/server/lib/conversation-policy.ts
export async function ensureConversationOwnership(
  conversationId: string,
  userId: string,
  prisma: PrismaClient,
): Promise<boolean> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { userId: true },
  });
  
  return conversation?.userId === userId;
}
```

✅ **Called on every mutation** to prevent users accessing others' data

---

### **Soft Deletes (Preserve Data & Undo)**

```prisma
model Conversation {
  deletedAt DateTime?  // Soft delete marker
}
```

**Benefit:** User can undo delete; you keep audit trail

**Implementation:**
```typescript
// Delete: Set flag
await prisma.conversation.update({
  where: { id },
  data: { deletedAt: new Date() },
});

// Restore: Clear flag
await prisma.conversation.update({
  where: { id },
  data: { deletedAt: null },
});

// Queries exclude soft-deleted by default
await prisma.conversation.findMany({
  where: { userId, deletedAt: null },
});
```

---

## 📋 Refactoring Checklist

**When refactoring a module, ensure:**

- [ ] All tests pass (`pnpm test`)
- [ ] No new console.log() (use logger.info())
- [ ] Async/await properly chained (no fire-and-forget)
- [ ] Error messages are user-friendly
- [ ] Database queries have explain plans
- [ ] New endpoints documented in schema
- [ ] tRPC types generated (`pnpm db:generate`)

---

**Last Updated:** 2026-08-09
