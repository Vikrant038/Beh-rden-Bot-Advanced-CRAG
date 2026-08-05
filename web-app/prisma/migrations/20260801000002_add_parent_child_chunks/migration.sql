-- CreateTable
CREATE TABLE "document_parent_chunks" (
    "id" SERIAL NOT NULL,
    "documentId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_parent_chunks_pkey" PRIMARY KEY ("id")
);

-- AlterTable (nullable first so pre-existing flat chunks remain valid as standalone children)
ALTER TABLE "document_chunks" ADD COLUMN "parentId" INTEGER;

-- CreateIndex
CREATE INDEX "document_parent_chunks_documentId_idx" ON "document_parent_chunks"("documentId");

-- CreateIndex
CREATE INDEX "document_chunks_parentId_idx" ON "document_chunks"("parentId");

-- AddForeignKey
ALTER TABLE "document_parent_chunks" ADD CONSTRAINT "document_parent_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "document_parent_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
