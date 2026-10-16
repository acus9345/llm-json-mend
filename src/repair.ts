/**
 * Tolerant JSON parser. It reads JSON the way models actually write it:
 * wrapped in prose or markdown fences, with trailing commas, comments,
 * single quotes, unquoted keys, Python literals, or cut off mid-stream.
 */

const MISSING: unique symbol = Symbol("missing");
type Parsed = unknown | typeof MISSING;

const WHITESPACE = new Set([" ", "\t", "\n", "\r", " ", "﻿"]);
const VALUE_TERMINATORS = new Set([",", "}", "]", ":"]);
const QUOTES: Record<string, string> = {
  '"': '"',
  "'": "'",
  "`": "`",
  "“": "”",
  "‘": "’",
};
const ESCAPES: Record<string, string> = {
  '"': '"',
  "'": "'",
  "`": "`",
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};
const LITERALS = new Map<string, unknown>([
  ["true", true],
  ["false", false],
  ["null", null],
  ["True", true],
  ["False", false],
  ["None", null],
  ["undefined", null],
  ["NaN", null],
  ["Infinity", null],
]);

/** Thrown when no JSON value can be recovered from the input. */
export class JsonMendError extends Error {
  readonly issues: readonly unknown[] | undefined;

  constructor(message: string, issues?: readonly unknown[]) {
    super(message);
    this.name = "JsonMendError";
    this.issues = issues;
  }
}

/**
 * Pull the JSON part out of a model reply: the first markdown code fence
 * if there is one (closed or not), otherwise everything from the first
 * `{` or `[`. Falls back to the whole text for bare scalars.
 */
export function extractJsonText(text: string): string {
  const fence = /```[\w-]*[^\S\n]*\n?([\s\S]*?)(?:```|$)/.exec(text);
  if (fence?.[1] !== undefined && /[[{]/.test(fence[1])) {
    text = fence[1];
  }
  const start = text.search(/[[{]/);
  return start === -1 ? text.trim() : text.slice(start);
}

/** Like `obj[key] = value`, but a `"__proto__"` key stays a plain property, as with JSON.parse. */
function setOwn(obj: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

class Parser {
  private i = 0;

  constructor(private readonly s: string) {}

  parseTop(): Parsed {
    this.skipWs();
    return this.parseValue();
  }

  private get eof(): boolean {
    return this.i >= this.s.length;
  }

  private peek(offset = 0): string {
    return this.s[this.i + offset] ?? "";
  }

  private skipWs(): void {
    while (!this.eof) {
      const c = this.peek();
      if (WHITESPACE.has(c)) {
        this.i++;
      } else if (c === "/" && this.peek(1) === "/") {
        const end = this.s.indexOf("\n", this.i);
        this.i = end === -1 ? this.s.length : end + 1;
      } else if (c === "/" && this.peek(1) === "*") {
        const end = this.s.indexOf("*/", this.i + 2);
        this.i = end === -1 ? this.s.length : end + 2;
      } else if (c === "#") {
        const end = this.s.indexOf("\n", this.i);
        this.i = end === -1 ? this.s.length : end + 1;
      } else {
        return;
      }
    }
  }

  private parseValue(): Parsed {
    const c = this.peek();
    if (c === "") return MISSING;
    if (c === "{") return this.parseObject();
    if (c === "[") return this.parseArray();
    if (c in QUOTES) return this.parseString();
    if (/[-+.\d]/.test(c)) return this.parseNumber();
    return this.parseWord();
  }

  private parseObject(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    this.i++; // {
    for (;;) {
      this.skipWs();
      const c = this.peek();
      if (c === "" || c === "]") return out;
      if (c === "}") {
        this.i++;
        return out;
      }
      if (c === ",") {
        this.i++;
        continue;
      }

      const key = c in QUOTES ? this.parseString(true) : this.parseBareKey();
      if (key === MISSING) continue;
      this.skipWs();
      if (this.peek() === ":") this.i++;
      this.skipWs();
      if (this.peek() === "," || this.peek() === "}") continue; // key with no value
      const value = this.parseValue();
      if (value === MISSING) return out;
      setOwn(out, String(key), value);
    }
  }

  private parseArray(): unknown[] {
    const out: unknown[] = [];
    this.i++; // [
    for (;;) {
      this.skipWs();
      const c = this.peek();
      if (c === "" || c === "}") return out;
      if (c === "]") {
        this.i++;
        return out;
      }
      if (c === ",") {
        this.i++;
        continue;
      }
      const value = this.parseValue();
      if (value === MISSING) return out;
      out.push(value);
    }
  }

  private parseBareKey(): Parsed {
    const start = this.i;
    while (!this.eof && !/[\s:,{}[\]]/.test(this.peek())) this.i++;
    if (this.i === start) {
      this.i++; // skip an unexpected character rather than loop forever
      return MISSING;
    }
    return this.s.slice(start, this.i);
  }

  private parseString(isKey = false): Parsed {
    const close = QUOTES[this.peek()] ?? '"';
    this.i++;
    let out = "";
    while (!this.eof) {
      const c = this.peek();
      if (c === "\\") {
        const next = this.peek(1);
        if (next === "") break;
        if (next === "u") {
          const hex = this.s.slice(this.i + 2, this.i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            if (this.i + 6 > this.s.length) break; // truncated escape
            out += "u";
            this.i += 2;
            continue;
          }
          out += String.fromCharCode(parseInt(hex, 16));
          this.i += 6;
          continue;
        }
        out += ESCAPES[next] ?? next;
        this.i += 2;
        continue;
      }
      if (c === close && (this.isStringEnd() || (isKey && WHITESPACE.has(this.peek(1))))) {
        this.i++;
        return out;
      }
      out += c;
      this.i++;
    }
    return out; // unterminated: keep what arrived
  }

  /** A quote only ends the string if what follows looks like JSON structure. */
  private isStringEnd(): boolean {
    let j = this.i + 1;
    while (j < this.s.length && WHITESPACE.has(this.s[j] ?? "")) j++;
    const next = this.s[j] ?? "";
    if (next === "" || VALUE_TERMINATORS.has(next)) return true;
    // A newline after the quote usually means a missing comma.
    return /\n/.test(this.s.slice(this.i + 1, j)) || next === "/" || next === "#";
  }

  private parseNumber(): Parsed {
    const match = /^[-+]?(?:\d+\.?\d*|\.\d+)?(?:[eE][-+]?\d*)?/.exec(this.s.slice(this.i));
    const raw = match?.[0] ?? "";
    if (raw === "" || !/\d/.test(raw)) {
      if (/^[-+]?(?:Infinity|NaN)/.test(this.s.slice(this.i))) {
        this.i += raw.length;
        return this.parseWord();
      }
      if (this.i + raw.length >= this.s.length) {
        this.i = this.s.length;
        return MISSING; // a lone "-" at the end of a stream
      }
      return this.parseWord();
    }
    this.i += raw.length;
    const value = Number(raw.replace(/[eE][-+]?$/, ""));
    return Number.isFinite(value) ? value : null;
  }

  private parseWord(): Parsed {
    const start = this.i;
    while (!this.eof && !/[,:{}[\]\n]/.test(this.peek())) this.i++;
    const word = this.s.slice(start, this.i).trim();
    if (word === "") {
      this.i = Math.max(this.i, start + 1);
      return MISSING;
    }
    if (LITERALS.has(word)) return LITERALS.get(word);
    if (this.eof && [...LITERALS.keys()].some((lit) => lit.startsWith(word))) {
      return MISSING; // "tr" at the end of a stream is half of "true"
    }
    return word;
  }
}

export interface MendResult {
  /** The recovered value. */
  value: unknown;
  /** `false` if the input was already valid JSON. */
  repaired: boolean;
}

/** Recover a value from model output. Throws {@link JsonMendError} if there is none. */
export function mend(text: string): MendResult {
  if (typeof text !== "string") {
    throw new JsonMendError(`Expected a string, got ${typeof text}`);
  }
  try {
    return { value: JSON.parse(text), repaired: false };
  } catch {
    // fall through to the tolerant parser
  }
  const extracted = extractJsonText(text);
  const value = new Parser(extracted).parseTop();
  // Bare prose with no brackets or quotes is not JSON, even though the parser could read it as a word.
  if (value === MISSING || (typeof value === "string" && !((extracted[0] ?? "") in QUOTES))) {
    throw new JsonMendError("No JSON value found in input");
  }
  return { value, repaired: true };
}
