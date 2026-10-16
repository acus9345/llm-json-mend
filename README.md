# llm-json-mend

[![npm](https://img.shields.io/npm/v/llm-json-mend)](https://www.npmjs.com/package/llm-json-mend)
[![CI](https://github.com/acus9345/llm-json-mend/actions/workflows/ci.yml/badge.svg)](https://github.com/acus9345/llm-json-mend/actions/workflows/ci.yml)
[![bundle size](https://img.shields.io/bundlephobia/minzip/llm-json-mend)](https://bundlephobia.com/package/llm-json-mend)

Get JSON out of LLM replies, even when the model wraps it in prose, puts it in a code fence, writes it sloppily, or gets cut off mid-stream. Validate it against Zod or any [Standard Schema](https://standardschema.dev) in the same call.

Zero dependencies · TypeScript types · ESM and CommonJS · Node 18+, browsers, edge runtimes

```bash
npm install llm-json-mend
```

## Quick start

```ts
import { parseJson } from "llm-json-mend";

const reply = `Sure! Here's the user:

\`\`\`json
{
  name: 'Ada',             // unquoted key, single quotes, comment
  "tags": ["math", "code",],
  "active": True,
}
\`\`\``;

parseJson(reply);
// { name: "Ada", tags: ["math", "code"], active: true }
```

## Which function do I need?

| You want to… | Use |
| --- | --- |
| Get a typed, validated object | `parseWithSchema(text, schema)` |
| Get the value without validation | `parseJson(text)` |
| Show structured output while it streams in | `parsePartial(text)` |
| Store or forward clean JSON text | `repairJson(text)` |
| Handle failure without `try/catch` | the `safe…` versions, which return `{ success, data \| error }` |

### Validate with a schema

```ts
import { z } from "zod";
import { parseWithSchema } from "llm-json-mend";

const User = z.object({ name: z.string(), age: z.number() });

const user = parseWithSchema(reply, User); // typed { name: string; age: number }
```

This works with Zod 3.24+ and 4, Valibot, ArkType, and anything else that implements Standard Schema or has a Zod-style `safeParse`. If the schema has async refinements or transforms, use `parseWithSchemaAsync` / `safeParseWithSchemaAsync`.

When validation fails, you get a `JsonMendError` with a readable message (`Schema validation failed: age: Invalid input: expected number, received string`), and `error.issues` holds the schema's own issues. That makes it easy to send the error back to the model and ask it to try again:

```ts
const result = safeParseWithSchema(reply, User);
if (!result.success) {
  // ask the model again, including result.error.message in the prompt
}
```

### Stream structured output

Call `parsePartial` on everything received so far. It returns `undefined` until there's something to show, and it never throws.

```ts
import { parsePartial } from "llm-json-mend";

let text = "";
for await (const chunk of textStream) {
  text += chunk;
  const partial = parsePartial<{ title: string; steps: string[] }>(text);
  render(partial); // { title?: string; steps?: string[] } | undefined
}
```

The return type is a deep partial of `T`, because every field can be missing mid-stream. An incomplete string shows what has arrived so far (`{"title": "Hel` → `{ title: "Hel" }`). An incomplete key or literal is left out until it finishes (`{"done": tr` → `{}`).

## What it fixes

| Problem | Example |
| --- | --- |
| Prose around the JSON, including prose with its own brackets | `<thinking>maybe {x}</thinking> {"a": 1}` |
| Markdown fences, preferring ```` ```json ```` over other fences | ```` ```bash … ``` ```json {…} ``` ```` |
| Trailing and missing commas | `[1, 2,]`, `{"a": 1 ⏎ "b": 2}` |
| Single, backtick, and smart quotes | `{'a': 'b'}`, `{“a”: “b”}` |
| Unquoted keys and values | `{first name: Ada, status: done}` |
| Comments | `//`, `/* */`, `# ` |
| Python and JS literals | `True`, `False`, `None`, `undefined`, `NaN`, `Infinity` |
| Loose numbers | `+1`, `.5`, `5.`, `007` |
| Unescaped quotes and newlines inside strings | `"He said "hi", then left"` |
| `...` placeholders | `[1, 2, ...]` → `[1, 2]` |
| Truncated output | `{"a": [1, 2` → `{ a: [1, 2] }` |

Valid JSON takes the `JSON.parse` fast path (a 1.5 MB document parses in a few milliseconds). A broken document of the same size repairs in about 50 ms. A `__proto__` key stays a plain property, so model output can't pollute prototypes.

## API

| Function | Returns | On failure |
| --- | --- | --- |
| `parseJson<T>(text)` | `T` | throws `JsonMendError` |
| `safeParseJson<T>(text)` | `{ success: true, data, repaired } \| { success: false, error }` | — |
| `parsePartial<T>(text)` | `DeepPartial<T> \| undefined` | returns `undefined` |
| `repairJson(text, space?)` | `string` of valid JSON | throws `JsonMendError` |
| `parseWithSchema(text, schema)` | the schema's output type | throws `JsonMendError` |
| `safeParseWithSchema(text, schema)` | result object | — |
| `parseWithSchemaAsync` / `safeParseWithSchemaAsync` | `Promise` of the above | — |
| `extractJsonText(text)` | the substring of `text` holding the JSON | — |

`repaired` is `false` when the input was already valid JSON. You can log it to see how often a model needs fixing.

`JsonMendError` extends `Error`. When there's no JSON at all, its message quotes the start of the input (`No JSON value found in input: "I'm sorry, I can't…"`). `issues` is set when schema validation fails.

## Limits

- It returns one value: the most JSON-like `{…}` or `[…]` in the text. For several separate objects (NDJSON), split the lines first.
- Repair is a best guess. When the shape matters, validate it with a schema.
- Numbers keep JavaScript precision, the same as `JSON.parse`.

## License

MIT
