import { DocumentManager } from "@/components/admin/document-manager";

export default function AdminDocumentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Documents</h1>
        <p className="mt-1 text-sm text-muted">
          Ingest URLs, re-sync the knowledge base, and delete documents.
        </p>
      </div>
      <DocumentManager />
    </div>
  );
}
