import { vi } from "vitest";

type MockFn = ReturnType<typeof vi.fn>;

/**
 * Structural type for a fully-mocked PrismaClient. Prisma model delegates are
 * generic function namespaces that `vi.mocked(prisma)` cannot unwrap, so tests
 * cast the mocked `@/server/db` export to this shape instead.
 */
export interface MockPrisma {
  conversation: {
    findUnique: MockFn;
    findFirst: MockFn;
    create: MockFn;
    update: MockFn;
    updateMany: MockFn;
    delete: MockFn;
    deleteMany: MockFn;
    count: MockFn;
    findMany: MockFn;
    aggregate: MockFn;
  };
  message: {
    findUnique: MockFn;
    findFirst: MockFn;
    create: MockFn;
    update: MockFn;
    delete: MockFn;
    deleteMany: MockFn;
    count: MockFn;
    findMany: MockFn;
  };
  document: {
    findMany: MockFn;
    findUnique: MockFn;
    count: MockFn;
    groupBy: MockFn;
  };
  documentChunk: {
    findMany: MockFn;
    count: MockFn;
  };
  user: {
    count: MockFn;
    findMany: MockFn;
    create: MockFn;
    upsert: MockFn;
    delete: MockFn;
  };
  messageFeedback: {
    updateMany: MockFn;
    deleteMany: MockFn;
  };
  semanticCacheEntry: {
    deleteMany: MockFn;
    findUnique: MockFn;
    findMany: MockFn;
  };
  conversationMemory: {
    findUnique: MockFn;
    upsert: MockFn;
  };
  pipelineRun: {
    create: MockFn;
    findMany: MockFn;
    findUnique: MockFn;
  };
  $queryRaw: MockFn;
}
