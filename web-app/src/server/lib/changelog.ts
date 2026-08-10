/**
 * Keep-a-Changelog parser for the "What's new" modal (1.14).
 *
 * Parses the project's `CHANGELOG.md` (Keep a Changelog format) into a flat
 * list of entries: every `### Group` under a `## [version]` header becomes an
 * entry whose `items` are the `- ` bullets beneath it. `## [Unreleased]`
 * (no date) is handled as a version with an empty date.
 */
export interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  items: string[];
}

export function parseChangelog(markdown: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];

  // Split on version headers; `[0.1.0]: <url>` reference links at the bottom
  // are not `## ` headers, so they never split.
  const versions = markdown.split(/^## /m).slice(1);

  for (const versionBlock of versions) {
    const header = versionBlock.match(/^\[(.+?)\](?: - (.+))?$/m);
    if (!header) {
      continue;
    }
    const version = header[1];
    const date = (header[2] ?? "").trim();

    // Split the block into `### Group` sections (Added / Changed / Fixed / …).
    const groups = versionBlock.split(/^### /m).slice(1);
    for (const group of groups) {
      const lines = group.split("\n");
      const title = (lines[0] ?? "Changes").trim();
      const items = lines
        .slice(1)
        .map((line) => line.trim())
        .filter((line) => /^-\s+/.test(line))
        .map((line) => line.replace(/^-\s+/, ""))
        .filter(Boolean);
      if (items.length > 0) {
        entries.push({ version, date, title, items });
      }
    }
  }

  return entries;
}
