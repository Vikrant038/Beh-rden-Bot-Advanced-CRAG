/**
 * Recursive character text splitter (TypeScript port of langchain's
 * `RecursiveCharacterTextSplitter` used by the Python reference `src/ingest.py`).
 *
 * Defaults: chunk_size=600, chunk_overlap=150, separators ["\n\n", "\n", ". ", "! ", "? ", " ", ""].
 * Chunks shorter than `minChunkChars` (100) are dropped as noisy snippets.
 */
export interface ChunkerOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  separators?: string[];
  minChunkChars?: number;
}

const DEFAULT_SEPARATORS = ["\n\n", "\n", ". ", "! ", "? ", " ", ""];

export class RecursiveChunker {
  private readonly chunkSize: number;
  private readonly chunkOverlap: number;
  private readonly separators: string[];
  private readonly minChunkChars: number;

  constructor(options: ChunkerOptions = {}) {
    this.chunkSize = options.chunkSize ?? 600;
    this.chunkOverlap = options.chunkOverlap ?? 150;
    this.separators = options.separators ?? DEFAULT_SEPARATORS;
    this.minChunkChars = options.minChunkChars ?? 100;
  }

  splitText(text: string): string[] {
    if (!text) {
      return [];
    }
    return this.recursiveSplit(text);
  }

  private recursiveSplit(text: string): string[] {
    const separator = this.findSeparator(text);
    const splits = separator === "" ? Array.from(text) : text.split(separator);
    const finalSplits: string[] = [];
    let goodSplits: string[] = [];

    for (const piece of splits) {
      if (piece.length < this.chunkSize) {
        goodSplits.push(piece);
        continue;
      }

      if (goodSplits.length > 0) {
        finalSplits.push(...this.mergeSplits(goodSplits, separator));
        goodSplits = [];
      }

      if (separator === "") {
        finalSplits.push(...this.recursiveSplit(piece));
      } else {
        finalSplits.push(...this.recursiveSplit(piece));
      }
    }

    if (goodSplits.length > 0) {
      finalSplits.push(...this.mergeSplits(goodSplits, separator));
    }

    return finalSplits.filter((chunk) => chunk.trim().length >= this.minChunkChars);
  }

  private findSeparator(text: string): string {
    for (const separator of this.separators) {
      if (separator === "") {
        return "";
      }
      if (text.includes(separator)) {
        return separator;
      }
    }
    return "";
  }

  private mergeSplits(splits: string[], separator: string): string[] {
    const docs: string[] = [];
    let currentDoc: string[] = [];
    let total = 0;
    const separatorLength = separator.length;

    for (const piece of splits) {
      const pieceLength = piece.length;
      const separatorContribution = currentDoc.length > 0 ? separatorLength : 0;
      if (total + pieceLength + separatorContribution > this.chunkSize) {
        if (currentDoc.length > 0) {
          const doc = this.joinDocs(currentDoc, separator);
          if (doc !== null) {
            docs.push(doc);
          }
          while (total > this.chunkOverlap) {
            const firstLen = currentDoc[0]?.length ?? 0;
            const nextSep = currentDoc.length > 1 ? separatorLength : 0;
            total -= firstLen + nextSep;
            currentDoc = currentDoc.slice(1);
          }
        }
      }
      currentDoc.push(piece);
      total += pieceLength + (currentDoc.length > 0 ? separatorLength : 0);
    }

    const doc = this.joinDocs(currentDoc, separator);
    if (doc !== null) {
      docs.push(doc);
    }
    return docs;
  }

  private joinDocs(docs: string[], separator: string): string | null {
    const text = docs.join(separator).trim();
    return text === "" ? null : text;
  }
}

export function chunkText(text: string, options: ChunkerOptions = {}): string[] {
  return new RecursiveChunker(options).splitText(text);
}
