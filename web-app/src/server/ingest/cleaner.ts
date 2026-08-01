/**
 * Text cleaner for RAG ingestion (TypeScript port of the Python
 * `src/utils.py:clean_text`). Preserves German characters and meaningful
 * whitespace while removing PDF artifacts and repeated boilerplate lines.
 */
export function cleanText(raw: string): string {
  if (!raw) {
    return "";
  }

  // Step 1: Unicode normalization (NFC — keeps German umlauts composed).
  let text = raw.normalize("NFC");

  // Step 2: Remove common PDF artifacts.
  text = text.replace(/\x00/g, "");
  text = text.replace(/\uf0b7/g, "-");
  text = text.replace(/\uf06c/g, "");

  // Step 3: Remove repeated page headers/footers (lines appearing >3 times).
  const lineCounts = new Map<string, number>();
  for (const line of text.split("\n")) {
    const stripped = line.trim();
    if (stripped.length > 5) {
      lineCounts.set(stripped, (lineCounts.get(stripped) ?? 0) + 1);
    }
  }
  text = text
    .split("\n")
    .filter((line) => (lineCounts.get(line.trim()) ?? 0) <= 3)
    .join("\n");

  // Step 4: Normalize whitespace (max 2 blank lines; collapse multiple spaces).
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/ \n/g, "\n");

  // Step 5: Drop very short lines that are likely noise.
  text = text
    .split("\n")
    .filter((line) => line.trim().length > 2 || line.trim() === "")
    .join("\n");

  return text.trim();
}
