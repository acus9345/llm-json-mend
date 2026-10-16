import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import {
  JsonMendError,
  extractJsonText,
  parseJson,
  parsePartial,
  parseWithSchema,
  parseWithSchemaAsync,
  repairJson,
  safeParseJson,
  safeParseWithSchema,
  safeParseWithSchemaAsync,
  type StandardSchemaV1,
} from "../src/index.js";

describe("parseJson", () => {
  it("returns valid JSON unchanged", () => {
    expect(parseJson('{"a":[1,2,{"b":null}]}')).toEqual({ a: [1, 2, { b: null }] });
    expect(safeParseJson("[1]")).toEqual({ success: true, data: [1], repaired: false });
  });

  it.each([
    ["trailing commas", '{"a": 1, "b": [1, 2,],}', { a: 1, b: [1, 2] }],
    ["single quotes", "{'a': 'it\\'s'}", { a: "it's" }],
    ["unquoted keys", "{name: \"x\", age_2: 3}", { name: "x", age_2: 3 }],
    ["missing commas between lines", '{\n  "a": 1\n  "b": "x"\n  "c": true\n}', { a: 1, b: "x", c: true }],
    ["missing commas in arrays", "[1 2 3]", [1, 2, 3]],
    ["line and block comments", '{\n // note\n "a": 1, /* why */ "b": 2 # py\n}', { a: 1, b: 2 }],
    ["Python literals", "{'ok': True, 'no': False, 'none': None}", { ok: true, no: false, none: null }],
    ["NaN, Infinity, undefined", "[NaN, -Infinity, Infinity, undefined]", [null, null, null, null]],
    ["loose numbers", "[+1, .5, 5., 1e3, -2E-2, 007]", [1, 0.5, 5, 1000, -0.02, 7]],
    ["smart quotes", "{“a”: “b”}", { a: "b" }],
    ["unquoted string values", "{status: done, n: 1}", { status: "done", n: 1 }],
    ["unescaped inner quotes", '{"q": "He said "hi" today"}', { q: 'He said "hi" today' }],
    ["literal newlines in strings", '{"a": "line1\nline2"}', { a: "line1\nline2" }],
    ["escapes in single quotes", "{'a': 'tab\\tnl\\n\\u00e9\\/\\\"\\''}", { a: "tab\tnl\né/\"'" }],
    ["missing colon", '{"a" 1}', { a: 1 }],
    ["mismatched closer", '{"a": [1, 2}', { a: [1, 2] }],
    ["empty containers", "{ , }", {}],
  ])("fixes %s", (_name, input, expected) => {
    expect(parseJson(input)).toEqual(expected);
    expect(safeParseJson(input)).toMatchObject({ success: true, repaired: true });
  });

  it("strips markdown fences and prose", () => {
    const reply = 'Sure! Here is the data:\n\n```json\n{"items": [1, 2],}\n```\n\nLet me know!';
    expect(parseJson(reply)).toEqual({ items: [1, 2] });
  });

  it("finds JSON after prose without fences and ignores trailing text", () => {
    expect(parseJson('The result is {"ok": true}. Hope that helps.')).toEqual({ ok: true });
  });

  it("handles a fence that never closes", () => {
    expect(parseJson('```json\n{"a": [1, 2')).toEqual({ a: [1, 2] });
  });

  it("keeps __proto__ as a plain key", () => {
    const value = parseJson<Record<string, unknown>>("{__proto__: {polluted: 1}, a: 1}");
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.keys(value)).toEqual(["__proto__", "a"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("does not treat Object.prototype names as literals", () => {
    expect(parseJson("{a: toString}")).toEqual({ a: "toString" });
  });

  it("throws JsonMendError when there is no JSON", () => {
    expect(() => parseJson("")).toThrow(JsonMendError);
    expect(() => parseJson("I could not find any data, sorry.")).toThrow(JsonMendError);
    const result = safeParseJson("   ");
    expect(result.success).toBe(false);
  });

  it("parses bare scalars", () => {
    expect(parseJson("'hi'")).toBe("hi");
    expect(parseJson("True")).toBe(true);
  });
});

describe("truncated / streaming input", () => {
  it.each([
    ['{"a": 1, "b": [1, 2', { a: 1, b: [1, 2] }],
    ['{"msg": "hel', { msg: "hel" }],
    ['{"a": 1, "b', { a: 1 }],
    ['{"a": 1, "b":', { a: 1 }],
    ['{"a": 1, "ok": tr', { a: 1 }],
    ['{"a": -', {}],
    ['{"a": 1.5e', { a: 1.5 }],
    ['{"s": "caf\\u00', { s: "caf" }],
    ['{"s": "end\\', { s: "end" }],
    ['[{"a": 1}, {"b"', [{ a: 1 }, {}]],
  ])("recovers %j", (input, expected) => {
    expect(parsePartial(input)).toEqual(expected);
  });

  it("returns undefined before anything parseable arrives", () => {
    expect(parsePartial("")).toBeUndefined();
    expect(parsePartial("Here is")).toBeUndefined();
  });

  it("produces a growing value for every prefix of a stream", () => {
    const full = '```json\n{"title": "Report", "tags": ["a", "b"], "score": 9.5, "done": false}\n```';
    let last: unknown;
    for (let i = 1; i <= full.length; i++) {
      const value = parsePartial(full.slice(0, i));
      if (value !== undefined) last = value;
    }
    expect(last).toEqual({ title: "Report", tags: ["a", "b"], score: 9.5, done: false });
  });
});

describe("repairJson", () => {
  it("returns valid JSON text", () => {
    const out = repairJson("{a: 1, b: 'x',}");
    expect(out).toBe('{"a":1,"b":"x"}');
    expect(JSON.parse(out)).toEqual({ a: 1, b: "x" });
  });

  it("supports indentation", () => {
    expect(repairJson("[1,]", 2)).toBe("[\n  1\n]");
  });
});

describe("extractJsonText", () => {
  it("prefers a fenced block", () => {
    expect(extractJsonText("x {no} ```json\n[1]\n``` y")).toBe("[1]");
  });

  it("returns the span of the most JSON-like value", () => {
    expect(extractJsonText('See [1] below: {"a": 1} thanks')).toBe('{"a": 1}');
  });
});

describe("real model replies", () => {
  it.each([
    ["brackets in prose before the JSON", 'Sure [as requested], here it is: {"a": 1}', { a: 1 }],
    ["braces in prose before the JSON", 'I used {placeholders}. Result:\n{"name": "x"}', { name: "x" }],
    ["thinking tags with braces", "<thinking>maybe {x}?</thinking>\n{\"a\": 1}", { a: 1 }],
    ["<json> tags", '<json>\n{"a": 1}\n</json>', { a: 1 }],
    ["a non-JSON fence first", "```bash\nnpm i\n```\nOutput:\n```json\n{\"ok\": true}\n```", { ok: true }],
    ["a code fence with braces first", "```js\nconst x = {a}\n```\n```json\n{\"ok\": true}\n```", { ok: true }],
    ["an untagged fence", "```\n{'ok': True}\n```", { ok: true }],
    ["inner quote then comma", '{"q": "He said "hi", then left"}', { q: 'He said "hi", then left' }],
    ["bare values after a quoted one", '["x", y, "z"]', ["x", "y", "z"]],
    ["CRLF newlines", '{\r\n  "a": 1,\r\n}', { a: 1 }],
    ["URLs inside strings", '{"u": "https://x.com/a", "b": 1,}', { u: "https://x.com/a", b: 1 }],
    ["# in unquoted values", "{color: #fff, n: 1}", { color: "#fff", n: 1 }],
    ["... placeholders", '{"items": [1, 2, ...], ...}', { items: [1, 2] }],
    ["… placeholders", '["a", …]', ["a"]],
    ["a JS assignment", "const data = {a: 1, b: 'two'};", { a: 1, b: "two" }],
    ["unquoted keys with spaces", "{first name: 'Ada'}", { "first name": "Ada" }],
    ["a numbered list before the JSON", '1. step one\n2. step two\n\n{"done": true}', { done: true }],
    ["an apostrophe in a single-quoted value", "{'msg': 'it's fine'}", { msg: "it's fine" }],
    ["a double-encoded JSON string", '"{\\"a\\": 1}"', '{"a": 1}'],
  ])("handles %s", (_name, input, expected) => {
    expect(parseJson(input)).toEqual(expected);
  });

  it("gets past many brackets in prose", () => {
    const reply = "Checklist: " + "[x] done {step}. ".repeat(50) + '\n{"items": [1, 2],}';
    expect(parseJson(reply)).toEqual({ items: [1, 2] });
  });

  it("says what it was given when there is no JSON", () => {
    expect(() => parseJson("I'm sorry, I can't help with that request today.")).toThrow(
      /No JSON value found in input: "I'm sorry, I can't help/,
    );
    expect(() => parseJson("")).toThrow("(empty string)");
  });
});

describe("schemas", () => {
  const User = z.object({ name: z.string(), age: z.number() });

  it("validates with Zod", () => {
    const user = parseWithSchema("```json\n{name: 'Ada', age: 36,}\n```", User);
    expect(user).toEqual({ name: "Ada", age: 36 });
  });

  it("reports schema issues with paths", () => {
    const result = safeParseWithSchema('{"name": "Ada", "age": "old"}', User);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(JsonMendError);
      expect(result.error.message).toMatch(/^Schema validation failed: age: /);
      expect(result.error.issues?.length).toBe(1);
    }
    expect(() => parseWithSchema("{}", User)).toThrow(JsonMendError);
  });

  it("passes parse errors through", () => {
    const result = safeParseWithSchema("nothing here", User);
    expect(result.success).toBe(false);
  });

  it("works with any Standard Schema", () => {
    const Even: StandardSchemaV1<number> = {
      "~standard": {
        version: 1,
        validate: (v) =>
          typeof v === "number" && v % 2 === 0
            ? { value: v }
            : { issues: [{ message: "must be even" }] },
      },
    };
    expect(parseWithSchema("[4]".slice(1, 2), Even)).toBe(4);
    expect(() => parseWithSchema("3", Even)).toThrow("must be even");
  });

  it("works with a bare safeParse schema", () => {
    const schema = {
      safeParse: (data: unknown) =>
        Array.isArray(data)
          ? { success: true as const, data: data as unknown[] }
          : { success: false as const, error: new Error("not an array") },
    };
    expect(parseWithSchema("[1,", schema)).toEqual([1]);
    expect(() => parseWithSchema("{}", schema)).toThrow("not an array");
  });

  it("rejects async Standard Schemas", () => {
    const Async: StandardSchemaV1<number> = {
      "~standard": { version: 1, validate: async (v) => ({ value: v as number }) },
    };
    expect(() => parseWithSchema("1", Async)).toThrow(/parseWithSchemaAsync/);
  });

  it("validates async schemas with the async variants", async () => {
    const Name = z.object({ name: z.string().refine(async (n) => n.length > 1, "too short") });
    await expect(parseWithSchemaAsync("{name: 'Ada'}", Name)).resolves.toEqual({ name: "Ada" });
    await expect(parseWithSchemaAsync("{name: 'A'}", Name)).rejects.toThrow("name: too short");
    const result = await safeParseWithSchemaAsync("nothing", Name);
    expect(result.success).toBe(false);
  });

  it("types partial values as deep partials", () => {
    const value = parsePartial<{ user: { name: string }; tags: string[] }>('{"user": {');
    expectTypeOf(value).toEqualTypeOf<
      { user?: { name?: string }; tags?: string[] } | undefined
    >();
    expect(value).toEqual({ user: {} });
  });
});

describe("robustness", () => {
  it("never hangs or throws anything but JsonMendError on random input", () => {
    const alphabet = '{}[]:,"\'`\\/*#-+.0123456789eE truefalsnul\n\tabc“”';
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let n = 0; n < 5000; n++) {
      let s = "";
      const len = Math.floor(rand() * 40);
      for (let i = 0; i < len; i++) s += alphabet[Math.floor(rand() * alphabet.length)];
      const result = safeParseJson(s);
      if (result.success) {
        expect(() => JSON.stringify(result.data)).not.toThrow();
      } else {
        expect(result.error).toBeInstanceOf(JsonMendError);
      }
    }
  });
});
