/**
 * Tolerant JSON parser. It reads JSON the way models actually write it:
 * wrapped in prose or markdown fences, with trailing commas, comments,
 * single quotes, unquoted keys, Python literals, or cut off mid-stream.
 */

const MISSING: unique symbol = Symbol("missing");
/** A placeholder such as `...` that is dropped without ending its container. */
const SKIP: unique symbol = Symbol("skip");
type Parsed = unknown | typeof MISSING | typeof SKIP;

/**
 * Limits on trying `{` / `[` start positions: how many, and how many characters
 * of parsing in total (as a multiple of the input length). Prose brackets are
 * short, so they barely use the budget.
 */
const MAX_CANDIDATES = 1000;
const PARSE_BUDGET = 4;

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
const ELLIPSES = ["...", "…"];

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
 * The markdown fence to read from: the first one tagged `json`/`jsonc`/`json5`,
 * else the first one containing `{` or `[`. A fence may be unclosed (streaming).
 */
function fenceContent(text: string): string | undefined {
  let fallback: string | undefined;
  for (const [, lang = "", body = ""] of text.matchAll(/```([\w-]*)[^\S\n]*\n?([\s\S]*?)(?:```|$)/g)) {
    if (!/[[{]/.test(body)) continue;
    if (/^json/i.test(lang)) return body;
    fallback ??= body;
  }
  return fallback;
}

interface Located {
  source: string;
  start: number;
  end: number;
  value: Parsed;
}

function nextBracket(source: string, from: number): number {
  const offset = source.slice(from).search(/[[{]/);
  return offset === -1 ? -1 : from + offset;
}

/**
 * Find the most JSON-like value in a model reply. Prose often has brackets of
 * its own (`<thinking>maybe {x}</thinking>`, `[note]`), so each `{` / `[` is
 * tried and scored: quoted strings, numbers and literals count for it, bare
 * words and keys with no value count against it.
 */
function locate(text: string): Located {
  const source = fenceContent(text) ?? text;
  let best: (Located & { score: number }) | undefined;
  let coveredUntil = -1;
  let tried = 0;
  let budget = PARSE_BUDGET * source.length + 1000;
  for (let start = nextBracket(source, 0); start !== -1 && tried < MAX_CANDIDATES && budget > 0; tried++) {
    const parser = new Parser(source, start);
    const value = parser.parseTop();
    const end = parser.index;
    const score = parser.strong - parser.weak;
    budget -= end - start;
    if (
      value !== MISSING &&
      (!best || score > best.score || (score === best.score && end - start > best.end - best.start))
    ) {
      best = { source, start, end, value, score };
    }
    // A clean parse already accounts for the brackets nested inside it.
    if (parser.weak === 0) coveredUntil = Math.max(coveredUntil, end);
    start = nextBracket(source, Math.max(start + 1, coveredUntil));
  }
  if (best) return best;

  // No brackets: a bare scalar like `"hi"` or `true`. Plain prose is not JSON.
  const trimmed = source.trim();
  const parser = new Parser(trimmed, 0);
  let value = parser.parseTop();
  if (typeof value === "string" && !((trimmed[0] ?? "") in QUOTES)) value = MISSING;
  return { source: trimmed, start: 0, end: parser.index, value };
}

/**
 * Return the part of a model reply that holds the JSON: the span of the most
 * JSON-like `{...}` / `[...]`, looking inside a code fence if there is one.
 */
export function extractJsonText(text: string): string {
  const { source, start, end } = locate(text);
  return source.slice(start, end);
}

/** Like `obj[key] = value`, but a `"__proto__"` key stays a plain property, as with JSON.parse. */
function setOwn(obj: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

class Parser {
  /** Tokens that only show up in real JSON. */
  strong = 0;
  /** Tokens that look like prose. */
  weak = 0;
  private i: number;

  constructor(
    private readonly s: string,
    start: number,
  ) {
    this.i = start;
  }

  get index(): number {
    return this.i;
  }

  parseTop(): Parsed {
    this.skipWs();
    const value = this.parseValue();
    return value === SKIP ? MISSING : value;
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
      } else if (c === "#" && /^[\s#]?$/.test(this.peek(1))) {
        // `# comment`, but not a value like `#fff`
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
      if (key === MISSING) {
        this.weak++;
        continue;
      }
      this.skipWs();
      if (this.peek() === ":") this.i++;
      this.skipWs();
      if (this.peek() === "," || this.peek() === "}") {
        if (!ELLIPSES.includes(String(key))) this.weak++; // key with no value
        continue;
      }
      const value = this.parseValue();
      if (value === MISSING) return out;
      if (value === SKIP) continue;
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
      if (value === SKIP) continue;
      out.push(value);
    }
  }

  private parseBareKey(): Parsed {
    const start = this.i;
    while (!this.eof && !/[:,{}[\]\n"'`]/.test(this.peek())) this.i++;
    const key = this.s.slice(start, this.i).trim();
    if (key === "") {
      this.i = Math.max(this.i, start + 1); // skip an unexpected character rather than loop forever
      return MISSING;
    }
    return key;
  }

  private parseString(isKey = false): Parsed {
    const close = QUOTES[this.peek()] ?? '"';
    this.i++;
    this.strong++;
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
      if (c === close && (this.isStringEnd(close) || (isKey && WHITESPACE.has(this.peek(1))))) {
        this.i++;
        return out;
      }
      out += c;
      this.i++;
    }
    return out; // unterminated: keep what arrived
  }

  /** A quote only ends the string if what follows looks like JSON structure. */
  private isStringEnd(close: string): boolean {
    let j = this.i + 1;
    while (j < this.s.length && WHITESPACE.has(this.s[j] ?? "")) j++;
    const next = this.s[j] ?? "";
    if (next === ",") return !this.isQuotedClause(j, close);
    if (next === "" || VALUE_TERMINATORS.has(next)) return true;
    // A newline after the quote usually means a missing comma.
    return /\n/.test(this.s.slice(this.i + 1, j)) || next === "/" || next === "#";
  }

  /**
   * `"He said "hi", then left"`: after the comma at `comma` come plain words
   * and then the real closing quote, followed by structure. Such a comma is
   * part of the string.
   */
  private isQuotedClause(comma: number, close: string): boolean {
    const clause = /^,[^\S\n]*([A-Za-z][^,:{}[\]\n"'`“”‘’]*)(.)/.exec(
      this.s.slice(comma, comma + 200),
    );
    if (clause?.[2] !== close || LITERALS.has((clause[1] ?? "").trim())) return false;
    const after = this.s.slice(comma + clause[0].length).trimStart()[0] ?? "";
    return after === "" || VALUE_TERMINATORS.has(after);
  }

  private parseNumber(): Parsed {
    const match = /^[-+]?(?:\d+\.?\d*|\.\d+)?(?:[eE][-+]?\d*)?/.exec(this.s.slice(this.i, this.i + 400));
    const raw = match?.[0] ?? "";
    if (raw === "" || !/\d/.test(raw)) {
      if (/^[-+]?(?:Infinity|NaN)/.test(this.s.slice(this.i, this.i + 9))) {
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
    this.strong++;
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
    if (LITERALS.has(word)) {
      this.strong++;
      return LITERALS.get(word);
    }
    if (this.eof && [...LITERALS.keys(), ...ELLIPSES].some((lit) => lit.startsWith(word))) {
      return MISSING; // "tr" at the end of a stream is half of "true"
    }
    if (ELLIPSES.includes(word)) return SKIP;
    this.weak++;
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
  const { value } = locate(text);
  if (value === MISSING || value === SKIP) {
    throw new JsonMendError(`No JSON value found in input: ${preview(text)}`);
  }
  return { value, repaired: true };
}

function preview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat === "") return "(empty string)";
  return JSON.stringify(flat.length > 60 ? `${flat.slice(0, 57)}...` : flat);
}
