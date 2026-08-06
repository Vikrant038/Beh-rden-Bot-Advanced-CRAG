import { BackButton } from "@/components/ui/back-button";
import { SourceBrowser } from "@/components/sources/source-browser";

export default function SourcesPage() {
  return (
    <div id="main" className="mx-auto max-w-5xl px-4 py-8">
      <BackButton href="/chat" label="Back to chat" />
      <h1 className="text-xl font-semibold sm:text-2xl">Knowledge base</h1>
      <p className="mt-1 text-sm text-muted">
        Browse indexed documents and their chunks used for retrieval.
      </p>
      <div className="mt-6">
        <SourceBrowser />
      </div>
    </div>
  );
}
