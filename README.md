# llm-json-mend

Repair broken, partial, or markdown-fenced JSON from LLM output, and validate it against Zod or any [Standard Schema](https://standardschema.dev). Zero dependencies, fully typed, ESM and CommonJS.

```bash
npm install llm-json-mend
```

```ts
import { parseJson } from "llm-json-mend";

parseJson(`Sure! Here's the data:
\`\`\`json
{
  name: 'Ada',          // unquoted key, single quotes
  "tags": ["math", "code",],  // trailing comma
  "active": True        // Python literal
\`\`\``);
// → { name: "Ada", tags: ["math", "code"], active: true }
```

## What it fixes

| Problem | Example |
| --- | --- |
| Markdown fences and surrounding prose | `` Here you go: ```json {...} ``` `` |
| Trailing and missing commas | `[1, 2,]`, `{"a": 1 \n "b": 2}` |
| Single, backtick, and smart quotes | `{'a': 'b'}`, `{“a”: “b”}` |
| Unquoted keys and values | `{status: done}` |
| Comments | `//`, `/* */`, `#` |
| Python / JS literals | `True`, `False`, `None`, `undefined`, `NaN`, `Infinity` → `true`, `false`, `null` |
| Loose numbers | `+1`, `.5`, `5.`, `007` |
| Unescaped quotes and newlines inside strings | `"He said "hi" today"` |
| Truncated output | `{"a": [1, 2` → `{ a: [1, 2] }` |

Valid JSON takes the fast path through `JSON.parse`. A `__proto__` key stays a plain property, so model output can't pollute prototypes.

## API

### `parseJson<T>(text): T`

Repairs and parses. Throws `JsonMendError` if no JSON value can be found.

### `safeParseJson<T>(text)`

Returns `{ success: true, data, repaired }` or `{ success: false, error }`. `repaired` is `false` when the input was already valid JSON.

### `repairJson(text, space?): string`

Returns a valid JSON string. `space` is passed to `JSON.stringify`.

### `parsePartial<T>(text): T | undefined`

For streaming. Call it on the text received so far to render structured output while it arrives. It never throws, and returns `undefined` until there is something to show. Incomplete keys and literals are dropped (`{"ok": tr` → `{}`), and incomplete strings are kept (`{"msg": "hel` → `{ msg: "hel" }`).

```ts
let text = "";
for await (const chunk of stream) {
  text += chunk;
  render(parsePartial(text));
}
```

### `parseWithSchema(text, schema)` / `safeParseWithSchema(text, schema)`

Repair, parse, then validate. `schema` can be anything with a Zod-style `safeParse` method, or any synchronous Standard Schema (Zod 3.24+ and 4, Valibot, ArkType, …). Validation failures throw (or return) a `JsonMendError` whose `issues` holds the schema's issues.

```ts
import { z } from "zod";
import { parseWithSchema } from "llm-json-mend";

const User = z.object({ name: z.string(), age: z.number() });
const user = parseWithSchema(modelReply, User); // typed as { name: string; age: number }
```

### `extractJsonText(text): string`

Returns the JSON-looking part of a reply: the first code fence that contains `{` or `[`, otherwise everything from the first `{` or `[`.

### `JsonMendError`

`Error` subclass with an optional `issues` array.

## Limits

- It recovers the first JSON value in the text and ignores anything after it.
- If the prose before the JSON contains `[` or `{`, put the JSON in a code fence, or call `extractJsonText` yourself.
- Repair is a best guess. If the shape matters, validate it with a schema.

## License

MIT
