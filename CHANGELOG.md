# Changelog

## [0.3.1] - 2026-11-25

### Fixed
- Fix variable-length backtick/tilde fences, prose/empty-fence misdetection, inline comments after bare words/keys, mismatched closing brackets in objects, and newline/comment boundaries after quoted clauses.

## 0.2.2

- No library changes. First release published from GitHub Actions with npm trusted publishing, so it carries a provenance attestation that links it to the exact commit and workflow that built it.

## [0.3.1] - 2026-11-25

### Fixed
- Fix variable-length backtick/tilde fences, prose/empty-fence misdetection, inline comments after bare words/keys, mismatched closing brackets in objects, and newline/comment boundaries after quoted clauses.

## 0.2.1

- Tagged on GitHub but never published to npm: the first trusted-publishing attempt was rejected. 0.2.2 is the same code.

## [0.3.1] - 2026-11-25

### Fixed
- Fix variable-length backtick/tilde fences, prose/empty-fence misdetection, inline comments after bare words/keys, mismatched closing brackets in objects, and newline/comment boundaries after quoted clauses.

## 0.2.0

- Finds the JSON even when the prose before it has its own brackets or braces (`<thinking>maybe {x}</thinking>`, `[note]`, checklists).
- When there are several code fences, prefers the one tagged `json`/`jsonc`/`json5`.
- Handles more sloppy output: unescaped quotes followed by a comma (`"He said "hi", then left"`), `...` / `?圳 placeholders, unquoted keys with spaces, and `#fff`-style values. `#` comments still work.
- New `parseWithSchemaAsync` and `safeParseWithSchemaAsync` for schemas with async refinements or transforms.
- `parsePartial<T>` now returns `DeepPartial<T> | undefined`, matching what a half-streamed value can actually look like.
- The "No JSON value found" error now quotes the start of the input.
- `extractJsonText` returns just the JSON span, not everything after it.

## [0.3.1] - 2026-11-25

### Fixed
- Fix variable-length backtick/tilde fences, prose/empty-fence misdetection, inline comments after bare words/keys, mismatched closing brackets in objects, and newline/comment boundaries after quoted clauses.

## 0.1.0

- First release.
