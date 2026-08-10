# Developer Quick Reference

> **TL;DR:** Start here. Everything else is in ARCHITECTURE.md and OPTIMIZATION_GUIDE.md

---

## 🗺️ Find What You Need (Decision Tree)

```
I need to...

├─ UNDERSTAND THE CODE
│  └─ Read: ARCHITECTURE.md (folder structure + data flow)
│
├─ MODIFY A ROUTE
│  ├─ Is it: /api/chat/stream?
│  │  └─ File: src/app/api/chat/stream/route.ts
│  │  └─ Logic is in: src/server/rag/chat-pipeline.ts
│  │
│  ├─ Is it: /api/admin/*?
│  │  └─ File: src/app/api/admin/...
│  │  └─ Logic is in: src/server/routers/admin.ts
│  │
│  └─ Is it: tRPC (conversations, chat)?
│     └─ Files: src/server/routers/*.ts
│
├─ ADD A RAG FEATURE
│  ├─ New retrieval method?
│     └─ Create: src/server/rag/retrieval/[method].ts
│  │
│  ├─ New agent?
│     └─ Create: src/server/rag/agents/[name].ts
│  │
│  └─ New LLM provider?
│     └─ Modify: src/server/llm/client.ts
│
├─ FIX A BUG IN THE UI
│  ├─ Chat display?
│     └─ Component: src/components/chat/chat-bubble.tsx
│  │
│  ├─ Message input?
│     └─ Component: src/components/chat/chat-input.tsx
│  │
│  └─ State management?
│     └─ Hook: src/hooks/use-chat.ts
│
├─ OPTIMIZE PERFORMANCE
│  └─ Read: OPTIMIZATION_GUIDE.md
│
├─ ADD A DATABASE TABLE
│  ├─ Edit: prisma/schema.prisma
│  ├─ Run: pnpm db:migrate dev
│  ├─ Commit: prisma/migrations/[timestamp]_*.sql
│  └─ Docs: OPTIMIZATION_GUIDE.md (Database section)
│
├─ WRITE A TEST
│  ├─ Unit test?
│     └─ File: tests/unit/[name].test.ts
│  │
│  ├─ Integration (real DB)?
│     └─ File: tests/integration/[name].test.ts
│  │
│  └─ E2E (browser)?
│     └─ File: tests/e2e/[name].spec.ts
│
└─ DEPLOY
   └─ Push to: main or web-app branch
   └─ GitHub Actions runs: .github/workflows/ci-web-app.yml
   └─ Auto-deploys to Vercel on success
```

---

## 🎯 Common Tasks (Copy-Paste Ready)

### **1. Run Local Dev Server**

```bash
# Terminal 1: Start Postgres
docker compose up -d postgres

# Terminal 2: Run dev server
pnpm dev

# Terminal 3: Watch tests
pnpm test:watch

# Open http://localhost:3000
```

---

### **2. Add a New tRPC Endpoint**

**File:** `src/server/routers/conversation.ts`

```typescript
export const conversationRouter = router({
  create: protectedProcedure
    .input(z.object({ title: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db.conversation.create({
        data: { userId: ctx.user.id, title: input.title },
      });
      return result;
    }),

  // ADD YOUR ENDPOINT HERE:
  getLatest: protectedProcedure
    .query(async ({ ctx }) => {
      return await ctx.db.conversation.findFirst({
        where: { userId: ctx.user.id, deletedAt: null },
        orderBy: { updatedAt: 'desc' },
      });
    }),
});
```

**Then call it from frontend:**

```typescript
// src/components/chat/chat-input.tsx
const { data } = trpc.conversation.getLatest.useQuery();
```

---

### **3. Add a New Raw SQL Query**

**Always in:** `src/server/db/vector-queries.ts`

```typescript
// ❌ DON'T put raw SQL in routers or API routes

// ✅ DO centralize in vector-queries.ts:
async function findChunksByDocument(
  prisma: PrismaClient,
  documentId: string,
): Promise<Chunk[]> {
  const rows = await prisma.$queryRaw<ChunkRow[]>`
    SELECT id, text, embedding FROM document_chunks
    WHERE "documentId" = ${documentId}
    ORDER BY "createdAt"
  `;
  return rows.map(rowToChunk);
}

export const vectorQueries = {
  findChunksByDocument,  // Export here
  // ... other functions
} as const;
```

---

### **4. Write a Unit Test**

**File:** `tests/unit/guardrail.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { isQueryOutOfDomain } from '@/server/rag/guardrail';

describe('guardrail', () => {
  it('rejects off-domain terms from negative cache', async () => {
    const result = await isQueryOutOfDomain('How do I trade crypto?');
    expect(result).toBe(true);  // REJECT
  });

  it('accepts domain queries', async () => {
    const result = await isQueryOutOfDomain(
      'What are the requirements for a German student visa?'
    );
    expect(result).toBe(false);  // ACCEPT
  });
});
```

**Run:**
```bash
pnpm test guardrail.test.ts
```

---

### **5. Update the Prisma Schema**

**Step 1:** Edit `prisma/schema.prisma`

```prisma
model NewTable {
  id String @id @default(cuid())
  name String
  createdAt DateTime @default(now())
  
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId String
  
  @@index([userId])
  @@map("new_table")
}
```

**Step 2:** Create migration

```bash
pnpm db:migrate dev --name add_new_table
```

**Step 3:** Commit migration

```bash
git add prisma/migrations/
git commit -m "feat: add new_table schema"
```

---

### **6. Deploy to Production**

```bash
# Ensure you're on main or web-app branch
git push origin main

# GitHub Actions will:
# 1. Run tests, lint, type-check
# 2. Run Gitleaks (secrets scan)
# 3. Run Semgrep (SAST)
# 4. Build Docker image
# 5. Deploy to Vercel

# Check status: https://github.com/Vikrant038/Beh-rden-Bot.../actions
```

---

## 📋 Code Style Rules

### **Naming Conventions**

```typescript
// ✅ Functions: camelCase, descriptive verbs
async function findSimilarChunks() { }
export function maskPii() { }

// ✅ Classes: PascalCase
export class CircuitBreaker { }
export class SemanticCache { }

// ✅ Constants: SCREAMING_SNAKE_CASE (but schema uses PascalCase, see exception)
const MAX_QUERY_LENGTH = 5000;
const DEFAULT_TIMEOUT_MS = 30000;

// ✅ Types: PascalCase
interface ChatMessage { }
type Chunk = { ... };
```

### **Imports**

```typescript
// ✅ Group imports: standard lib, packages, local
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';

import { prisma } from '@/server/db';
import type { Chunk } from '@/server/rag/types';

// ✅ Use path aliases (@/server, @/lib, not ../../../)
```

### **Error Handling**

```typescript
// ✅ Custom error types
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

// ✅ tRPC maps errors to HTTP status codes
if (error instanceof NotFoundError) {
  throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
}
```

### **Async/Await**

```typescript
// ✅ Wait for promises
const result = await fetchData();

// ✅ Parallel execution
const [a, b] = await Promise.all([fetchA(), fetchB()]);

// ❌ Don't fire-and-forget (orphaned promise)
fetchData();  // Missing await!

// ❌ Don't catch without rethrowing
try { ... } catch (e) { }  // Silent failure!
```

---

## 🔍 Debugging Tips

### **Enable Debug Logging**

```bash
# Start dev server with debug output
DEBUG=* pnpm dev

# Or specific module
DEBUG=chat:* pnpm dev
```

### **View Database**

```bash
# Open interactive terminal
pnpm db:seed  # Insert test data

# Query from shell
psql postgresql://behoerden_app:behoerden_password@localhost:5432/behoerden_bot

# Example query
SELECT id, content, role FROM messages LIMIT 5;
```

### **Monitor Langfuse Traces**

1. Set env vars:
   ```bash
   LANGFUSE_PUBLIC_KEY=pk_...
   LANGFUSE_SECRET_KEY=sk_...
   ```

2. Make a request in the UI

3. Visit `https://cloud.langfuse.com/dashboard`

4. Filter by conversation ID

---

## ✅ Pre-Commit Checklist

Before `git commit`:

- [ ] **Tests pass:** `pnpm test`
- [ ] **Types check:** `pnpm typecheck`
- [ ] **Lints:** `pnpm lint`
- [ ] **Formats:** `pnpm format`
- [ ] **No secrets in diff:** `git diff` (scan for keys)
- [ ] **Commit message is clear:** `feat(rag): add new retrieval method`

---

## 📚 File Anatomy

### **Typical Router File**

```typescript
// src/server/routers/conversation.ts

import { router, protectedProcedure } from '@/server/trpc/t';
import { prisma } from '@/server/db';
import { z } from 'zod';

// 1. Input schema
const createSchema = z.object({
  title: z.string().optional(),
});

// 2. Router definition
export const conversationRouter = router({
  create: protectedProcedure
    .input(createSchema)
    .mutation(async ({ ctx, input }) => {
      // Business logic here
      const result = await prisma.conversation.create({
        data: { userId: ctx.user.id, ...input },
      });
      return result;
    }),
});
```

### **Typical Service File**

```typescript
// src/server/rag/retrieval/dense.ts

import type { PrismaClient } from '@prisma/client';
import { vectorQueries } from '@/server/db/vector-queries';
import type { Chunk } from '@/server/rag/types';

export interface DenseRetrieverOptions {
  topK?: number;
  minSimilarity?: number;
}

export async function densSearch(
  prisma: PrismaClient,
  queryVector: number[],
  options: DenseRetrieverOptions = {},
): Promise<Chunk[]> {
  // 1. Validate inputs
  if (!Array.isArray(queryVector) || queryVector.length === 0) {
    throw new Error('Invalid query vector');
  }

  // 2. Call database
  const chunks = await vectorQueries.findSimilarChunks(prisma, queryVector, {
    topK: options.topK ?? 15,
    minSimilarity: options.minSimilarity ?? 0.2,
  });

  // 3. Return results
  return chunks;
}
```

---

## 🚀 Performance Profiling

### **Slow Request? Follow These Steps**

1. **Check Langfuse trace**
   ```
   https://cloud.langfuse.com → filter by conversation ID
   ```

2. **Identify slow stage** (retrieval? LLM? cache?)

3. **Profile locally**
   ```bash
   # Run with verbose timing
   VERBOSE_TIMING=1 pnpm dev
   ```

4. **Check database**
   ```bash
   pnpm exec prisma studio
   # Opens interactive DB browser at http://localhost:5555
   ```

---

## 📖 Related Docs

| Document | Purpose |
|----------|---------|
| `ARCHITECTURE.md` | Full system design + data flow |
| `OPTIMIZATION_GUIDE.md` | Database & async best practices |
| `README.md` | Quick start + deployment |
| `.env.example` | Environment variables reference |
| `prisma/schema.prisma` | Database schema (source of truth) |
| `docs/security/SECURITY_EXCEPTIONS.md` | Known limitations |

---

**Last Updated:** 2026-08-09  
**For questions:** Check ARCHITECTURE.md first
