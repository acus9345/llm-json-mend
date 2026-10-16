# Changelog

## 0.2.0

- Finds the JSON even when the prose before it has its own brackets or braces (`<thinking>maybe {x}</thinking>`, `[note]`, checklists).
- When there are several code fences, prefers the one tagged `json`/`jsonc`/`json5`.
- Handles more sloppy output: unescaped quotes followed by a comma (`"He said "hi", then left"`), `...` / `…` placeholders, unquoted keys with spaces, and `#fff`-style values. `#` comments still work.
- New `parseWithSchemaAsync` and `safeParseWithSchemaAsync` for schemas with async refinements or transforms.
- `parsePartial<T>` now returns `DeepPartial<T> | undefined`, matching what a half-streamed value can actually look like.
- The "No JSON value found" error now quotes the start of the input.
- `extractJsonText` returns just the JSON span, not everything after it.

## 0.1.0

- First release.
