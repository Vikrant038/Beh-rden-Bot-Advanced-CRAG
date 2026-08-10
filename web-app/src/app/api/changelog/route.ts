import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseChangelog } from "@/server/lib/changelog";

export const dynamic = "force-dynamic";

/**
 * Serves the parsed `CHANGELOG.md` so the "What's new" modal always reflects
 * the real release history (1.14) instead of a hardcoded snapshot. The file
 * lives at the Next.js app root (`process.cwd()`), which holds on Vercel and
 * in the repo checkout alike.
 */
export async function GET() {
  try {
    const markdown = await readFile(join(process.cwd(), "CHANGELOG.md"), "utf-8");
    return Response.json({ entries: parseChangelog(markdown) });
  } catch {
    // A missing/unreadable changelog must not break the landing page — the
    // modal falls back to its built-in entries.
    return Response.json({ entries: [] });
  }
}
