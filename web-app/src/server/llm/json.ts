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
    // The object is preferred over the array: every contract requests an object,
    // and prose like "see [1]" must not be mistaken for the JSON value.
    const brace = candidate.indexOf("{");
    const start = brace !== -1 ? brace : candidate.indexOf("[");
    if (start === -1) {
      throw new SyntaxError("No JSON value found in LLM response");
    }
    const value = extractJsonValue(candidate.slice(start));
    try {
      return JSON.parse(value);
    } catch {
      // Other LLM glitches inside the value also break JSON.parse: bare
      // identifiers ("\"language\": language" — a real Groq glitch), single-
      // quoted strings ('de'), and missing commas between fields. Without
      // recovery the whole response was discarded and the expansion silently
      // fell back to the original query. Repair and retry — a real ISO code
      // ("de") then recovers perfectly, and even a stray word degrades to the
      // sanitizer's "en" fallback while keeping the English queries.
      return JSON.parse(repairJson(value));
    }
  }
}

/**
 * Best-effort recovery for common LLM JSON glitches, applied ONLY to the
 * extracted JSON value (never raw prose). Three string-aware passes, in order:
 * single-quoted strings → double-quoted, missing commas between fields/
 * elements inserted, then bare identifiers quoted. Each pass skips text inside
 * string literals, so prose like "visa questions, see: FAQ" survives untouched.
 */
function repairJson(text: string): string {
  return quoteBareIdentifiers(insertMissingCommas(convertSingleQuotes(text)));
}

/**
 * Converts single-quoted strings to double-quoted ones (JSON has no single
 * quotes). Inside a single-quoted string, an inner double quote is escaped so
 * the result stays valid. Double-quoted strings and their contents are skipped.
 */
function convertSingleQuotes(text: string): string {
  let out = "";
  let inDouble = false;
  let escaped = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (inDouble) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inDouble = false;
      }
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
      out += '"';
      i += 1;
      while (i < text.length) {
        const c = text[i]!;
        if (c === "\\") {
          const next = text[i + 1];
          if (next === "'") {
            // Escaped single quote: needs NO escape in JSON — drop the
            // backslash, or `\'` becomes an invalid JSON escape.
            out += "'";
            i += 2;
            continue;
          }
          if (next === '"') {
            // Escaped double quote: keep it escaped for the JSON string.
            out += '\\"';
            i += 2;
            continue;
          }
          // Other escapes (\\, \n, \t, \u…) are already valid JSON — keep.
          out += c;
          i += 1;
          continue;
        }
        if (c === "'") {
          out += '"';
          i += 1;
          break;
        }
        if (c === '"') {
          // Inner double quote must be escaped for the JSON string.
          out += '\\"';
          i += 1;
          continue;
        }
        out += c;
        i += 1;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
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
  let out = "";
  let inString = false;
  let escaped = false;
  let prevValueEnd = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      i += 1;
      continue;
    }
    if (ch === '"') {
      if (prevValueEnd) {
        out += ",";
      }
      inString = true;
      out += ch;
      i += 1;
      // A string followed by ':' is a KEY, not a value — it does not end a
      // value for comma purposes (the ':' branch resets the state anyway).
      prevValueEnd = true;
      continue;
    }
    if (ch === ":") {
      out += ch;
      i += 1;
      prevValueEnd = false;
      continue;
    }
    if (ch === ",") {
      out += ch;
      i += 1;
      prevValueEnd = false;
      continue;
    }
    if (ch === "{" || ch === "[") {
      if (prevValueEnd) {
        out += ",";
      }
      out += ch;
      i += 1;
      prevValueEnd = false;
      continue;
    }
    if (ch === "}" || ch === "]") {
      out += ch;
      i += 1;
      prevValueEnd = true;
      continue;
    }
    if (/[0-9-]/.test(ch)) {
      if (prevValueEnd) {
        out += ",";
      }
      let j = i;
      while (j < text.length && /[0-9.eE+-]/.test(text[j]!)) {
        j += 1;
      }
      out += text.slice(i, j);
      i = j;
      prevValueEnd = true;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      if (prevValueEnd) {
        out += ",";
      }
      let j = i;
      while (j < text.length && /[A-Za-z0-9_]/.test(text[j]!)) {
        j += 1;
      }
      out += text.slice(i, j);
      i = j;
      prevValueEnd = true;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
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
  let out = "";
  let inString = false;
  let escaped = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < text.length && /[A-Za-z0-9_]/.test(text[j]!)) {
        j += 1;
      }
      const word = text.slice(i, j);
      if (word === "true" || word === "false" || word === "null") {
        out += word;
      } else {
        out += `"${word}"`;
      }
      i = j;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
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
