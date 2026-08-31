import { callLLM } from "@/server/llm/client";
import type { LlmMessage } from "@/server/llm/client";
import { createLogger } from "@/server/lib/logger";

const logger = createLogger("llm-json");

/**
 * Calls the LLM and parses a JSON response, stripping markdown code fences.
 * Returns null on any parse failure (callers fall back gracefully).
 */
export async function callLLMJson<T>(
  prompt: string,
  maxTokens = 300,
  temperature = 0,
): Promise<T | null> {
  const messages: LlmMessage[] = [{ role: "user", content: prompt }];
  try {
    const raw = await callLLM(messages, { maxTokens, temperature });
    return parseJsonLoose(raw) as T;
  } catch (error) {
    logger.warn({ error: String(error) }, "[LLM JSON] call failed");
    return null;
  }
}

export function parseJsonLoose(raw: string): unknown {
  let text = raw.trim();
  if (text.startsWith("```json")) {
    text = text.slice(7);
  } else if (text.startsWith("```")) {
    text = text.slice(3);
  }
  if (text.endsWith("```")) {
    text = text.slice(0, -3);
  }
  const candidate = text.trim();
  try {
    return JSON.parse(candidate);
  } catch {
    // Some models append commentary AFTER the JSON ("{\"language\":\"de\"} Done!").
    // JSON.parse rejects any trailing non-whitespace, which silently broke the
    // query-expansion/analyst/guardrail contracts (each caller fell back to its
    // degraded path on every such response). Recover by extracting the first
    // complete JSON value (string-aware brace/bracket matching) and parsing it.
    // The object is preferred over the array when both exist at index 0.
    const brace = candidate.indexOf("{");
    const start = brace !== -1 ? brace : candidate.indexOf("[");
    if (start === -1) {
      throw new SyntaxError("No JSON value found in LLM response");
    }
    const value = extractJsonValue(candidate.slice(start));
    try {
      return JSON.parse(value);
    } catch {
      // Stage 2: Standard repair (control chars, quotes, commas, bare identifiers)
      try {
        return JSON.parse(repairJson(value));
      } catch {
        // Stage 3: Auto-close truncated JSON and repair
        const closed = autoCloseTruncatedJson(candidate.slice(start));
        try {
          return JSON.parse(closed);
        } catch {
          return JSON.parse(repairJson(closed));
        }
      }
    }
  }
}

/**
 * Best-effort recovery for common LLM JSON glitches, applied ONLY to the
 * extracted JSON value (never raw prose).
 * 1. Escapes raw unescaped newlines/tabs inside string literals (e.g. Markdown tables).
 * 2. Converts single-quoted strings to double-quoted ones.
 * 3. Inserts missing commas between fields/elements.
 * 4. Quotes bare identifiers.
 */
function repairJson(text: string): string {
  const cleaned = text.replace(/,\s*([}\]])/g, "$1");
  return quoteBareIdentifiers(
    insertMissingCommas(convertSingleQuotes(escapeControlCharsInStrings(cleaned))),
  ).replace(/,\s*([}\]])/g, "$1");
}

/**
 * Escapes unescaped ASCII control characters (newline, carriage return, tab)
 * that occur INSIDE string literals. Standard JSON forbids literal newlines
 * inside string literals (RFC 8259), which causes LLMs outputting multiline
 * tables or paragraphs to fail JSON.parse with "Unterminated string in JSON".
 */
export function escapeControlCharsInStrings(text: string): string {
  let out = "";
  let inDouble = false;
  let inSingle = false;
  let escaped = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (inDouble) {
      if (escaped) {
        escaped = false;
        out += ch;
        i += 1;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        out += ch;
        i += 1;
        continue;
      }
      if (ch === '"') {
        inDouble = false;
        out += ch;
        i += 1;
        continue;
      }
      if (ch === "\n") {
        out += "\\n";
        i += 1;
        continue;
      }
      if (ch === "\r") {
        out += "\\r";
        i += 1;
        continue;
      }
      if (ch === "\t") {
        out += "\\t";
        i += 1;
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }
    if (inSingle) {
      if (escaped) {
        escaped = false;
        out += ch;
        i += 1;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        out += ch;
        i += 1;
        continue;
      }
      if (ch === "'") {
        inSingle = false;
        out += ch;
        i += 1;
        continue;
      }
      if (ch === "\n") {
        out += "\\n";
        i += 1;
        continue;
      }
      if (ch === "\r") {
        out += "\\r";
        i += 1;
        continue;
      }
      if (ch === "\t") {
        out += "\\t";
        i += 1;
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      out += ch;
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Automatically closes unclosed string literals and unclosed arrays/objects
 * when an LLM response has been truncated at a token boundary.
 */
export function autoCloseTruncatedJson(text: string): string {
  let inDouble = false;
  let inSingle = false;
  let escaped = false;
  const stack: ("{" | "[")[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inDouble) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inDouble = false;
      }
      continue;
    }
    if (inSingle) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "'") {
        inSingle = false;
      }
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      stack.push(ch);
    } else if (ch === "}") {
      if (stack.length && stack[stack.length - 1] === "{") {
        stack.pop();
      }
    } else if (ch === "]") {
      if (stack.length && stack[stack.length - 1] === "[") {
        stack.pop();
      }
    }
  }

  let result = text;
  if (inDouble) {
    result += '"';
  } else if (inSingle) {
    result += "'";
  }

  // Remove trailing dangling colons or commas before closing
  result = result.replace(/:\s*$/, ': ""');
  result = result.replace(/,\s*$/, "");

  // Pop remaining open brackets from stack and close them
  while (stack.length > 0) {
    const open = stack.pop();
    result = result.replace(/,\s*$/, "");
    if (open === "{") {
      result += "}";
    } else if (open === "[") {
      result += "]";
    }
  }

  return result.replace(/,\s*([}\]])/g, "$1");
}

/** Reads the identifier run starting at `i` (`[A-Za-z0-9_]+`); returns [word, nextIndex]. */
function readWord(text: string, i: number): [string, number] {
  let j = i;
  while (j < text.length && /[A-Za-z0-9_]/.test(text[j]!)) {
    j += 1;
  }
  return [text.slice(i, j), j];
}

/**
 * Copies the double-quoted string starting at `i` (the opening `"`) to `out`,
 * advancing `i` past the closing quote. Shared by the repair passes so each
 * one skips string literals identically (prose like "visa questions, see: FAQ"
 * survives untouched).
 */
function copyString(text: string, i: number, out: string[]): number {
  out.push('"');
  i += 1;
  while (i < text.length) {
    const ch = text[i]!;
    out.push(ch);
    i += 1;
    if (ch === "\\") {
      if (i < text.length) {
        out.push(text[i]!);
        i += 1;
      }
    } else if (ch === '"') {
      break;
    }
  }
  return i;
}

/**
 * Converts single-quoted strings to double-quoted ones (JSON has no single
 * quotes). Inside a single-quoted string, an inner double quote is escaped so
 * the result stays valid. Double-quoted strings and their contents are skipped.
 */
function convertSingleQuotes(text: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"') {
      i = copyString(text, i, out);
      continue;
    }
    if (ch !== "'") {
      out.push(ch);
      i += 1;
      continue;
    }
    // Opening single quote → convert to a double-quoted JSON string.
    out.push('"');
    i += 1;
    while (i < text.length) {
      const c = text[i]!;
      if (c === "\\") {
        const next = text[i + 1];
        if (next === "'") {
          // Escaped single quote: needs NO escape in JSON — drop the
          // backslash, or `\'` becomes an invalid JSON escape.
          out.push("'");
          i += 2;
          continue;
        }
        if (next === '"') {
          // Escaped double quote: keep it escaped for the JSON string.
          out.push('\\"');
          i += 2;
          continue;
        }
        // Other escapes (\\, \n, \t, \u…) are already valid JSON — keep.
        out.push(c);
        i += 1;
        continue;
      }
      if (c === "'") {
        out.push('"');
        i += 1;
        break;
      }
      if (c === '"') {
        // Inner double quote must be escaped for the JSON string.
        out.push('\\"');
        i += 1;
        continue;
      }
      out.push(c);
      i += 1;
    }
  }
  return out.join("");
}

/**
 * Inserts commas missing between consecutive values/fields, e.g.
 * `{"a": 1 "b": 2}` → `{"a": 1, "b": 2}` and `["p" "q"]` → `["p", "q"]`.
 * Tracks whether the previous significant token ended a value; a comma is
 * emitted before the next value/key start unless a separator (`:`, `,`) or a
 * closing bracket already reset that state. String-aware, so separators inside
 * strings are never mistaken for structure.
 */
function insertMissingCommas(text: string): string {
  const out: string[] = [];
  let prevValueEnd = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"') {
      if (prevValueEnd) {
        out.push(",");
      }
      // A string followed by ':' is a KEY, not a value — it does not end a
      // value for comma purposes (the ':' branch resets the state anyway).
      prevValueEnd = true;
      i = copyString(text, i, out);
      continue;
    }
    if (ch === ":" || ch === ",") {
      prevValueEnd = false;
    } else if (ch === "}" || ch === "]") {
      prevValueEnd = true;
    } else if (ch === "{" || ch === "[") {
      if (prevValueEnd) {
        out.push(",");
      }
      prevValueEnd = false;
    } else if (/[0-9-]/.test(ch)) {
      if (prevValueEnd) {
        out.push(",");
      }
      let j = i;
      while (j < text.length && /[0-9.eE+-]/.test(text[j]!)) {
        j += 1;
      }
      out.push(text.slice(i, j));
      i = j;
      prevValueEnd = true;
      continue;
    } else if (/[A-Za-z_]/.test(ch)) {
      if (prevValueEnd) {
        out.push(",");
      }
      const [word, next] = readWord(text, i);
      out.push(word);
      i = next;
      prevValueEnd = true;
      continue;
    }
    out.push(ch);
    i += 1;
  }
  return out.join("");
}

/**
 * Quotes bare identifiers so the repaired text is valid JSON. LLMs sometimes
 * emit `"language": language` (an unquoted word) instead of `"language": "de"`.
 * Outside string literals, every identifier token that is not a JSON literal
 * (`true`/`false`/`null`) is wrapped in quotes — one pass covers bare values,
 * bare keys, and unquoted array elements. Text inside strings is never touched,
 * so prose like `"reasoning": "visa questions, see: FAQ"` survives untouched.
 */
function quoteBareIdentifiers(text: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"') {
      i = copyString(text, i, out);
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const [word, next] = readWord(text, i);
      out.push(word === "true" || word === "false" || word === "null" ? word : `"${word}"`);
      i = next;
      continue;
    }
    out.push(ch);
    i += 1;
  }
  return out.join("");
}

/**
 * Returns the first complete JSON value (object or array) in `text`, honoring
 * string literals so braces/brackets inside strings don't unbalance the scan.
 * Returns `text` unchanged when the value never closes — JSON.parse then
 * surfaces the real error and callers fall back as designed.
 */
function extractJsonValue(text: string): string {
  let depth = 0;
  let inString = false;
  let inSingle = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inString || inSingle) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (inString && ch === '"') {
        inString = false;
      } else if (inSingle && ch === "'") {
        inSingle = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      depth++;
    } else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) {
        return text.slice(0, i + 1);
      }
    }
  }
  return text;
}
