import { JsonMendError, extractJsonText, mend, type MendResult } from "./repair.js";

export { JsonMendError, extractJsonText };
export type { MendResult };

/** Anything with a Zod-style `safeParse` method. */
export interface SafeParseSchema<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false; error: unknown };
}

/** The subset of the Standard Schema v1 spec (https://standardschema.dev) used here. */
export interface StandardSchemaV1<T = unknown> {
  readonly "~standard": {
    readonly version: 1;
    readonly validate: (
      value: unknown,
    ) => StandardResult<T> | Promise<StandardResult<T>>;
  };
}

type StandardResult<T> =
  | { readonly value: T; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<{ readonly message: string }> };

/** Zod 3/4, Valibot, ArkType, or anything else with `safeParse` or `~standard`. */
export type Schema<T> = SafeParseSchema<T> | StandardSchemaV1<T>;

export type SafeResult<T> =
  | { success: true; data: T; repaired: boolean }
  | { success: false; error: JsonMendError };

/**
 * Parse JSON from model output, repairing it if needed.
 *
 * @throws {JsonMendError} if no JSON value can be recovered.
 */
export function parseJson<T = unknown>(text: string): T {
  return mend(text).value as T;
}

/** Like {@link parseJson}, but returns a result object instead of throwing. */
export function safeParseJson<T = unknown>(text: string): SafeResult<T> {
  try {
    const { value, repaired } = mend(text);
    return { success: true, data: value as T, repaired };
  } catch (error) {
    return { success: false, error: toMendError(error) };
  }
}

/**
 * Return the input as a valid JSON string.
 *
 * @throws {JsonMendError} if no JSON value can be recovered.
 */
export function repairJson(text: string, space?: number | string): string {
  return JSON.stringify(mend(text).value, null, space);
}

/**
 * Parse a JSON stream that is still arriving. Returns `undefined` until
 * there is something to show; never throws on incomplete input.
 *
 * Incomplete keys and literals (`{"ok": tr`) are dropped, and incomplete strings are kept.
 */
export function parsePartial<T = unknown>(text: string): T | undefined {
  const result = safeParseJson<T>(text);
  return result.success ? result.data : undefined;
}

/**
 * Parse and repair model output, then validate it against a schema.
 *
 * @throws {JsonMendError} if no JSON can be recovered or validation fails;
 *   `error.issues` holds the schema's issues.
 */
export function parseWithSchema<T>(text: string, schema: Schema<T>): T {
  const result = safeParseWithSchema(text, schema);
  if (!result.success) throw result.error;
  return result.data;
}

/** Like {@link parseWithSchema}, but returns a result object instead of throwing. */
export function safeParseWithSchema<T>(text: string, schema: Schema<T>): SafeResult<T> {
  const parsed = safeParseJson(text);
  if (!parsed.success) return parsed;

  if ("~standard" in schema) {
    const result = schema["~standard"].validate(parsed.data);
    if (result instanceof Promise) {
      throw new TypeError("Async schemas are not supported; validate the parsed value yourself");
    }
    if (result.issues) {
      return { success: false, error: validationError(result.issues) };
    }
    return { success: true, data: result.value, repaired: parsed.repaired };
  }

  const result = schema.safeParse(parsed.data);
  if (!result.success) {
    const issues = (result.error as { issues?: readonly unknown[] } | undefined)?.issues;
    return { success: false, error: validationError(issues ?? [result.error]) };
  }
  return { success: true, data: result.data, repaired: parsed.repaired };
}

function validationError(issues: readonly unknown[]): JsonMendError {
  const summary = issues
    .slice(0, 3)
    .map((issue) => {
      const { message, path } = (issue ?? {}) as { message?: unknown; path?: unknown };
      const where = Array.isArray(path) && path.length > 0 ? `${path.map(pathKey).join(".")}: ` : "";
      return `${where}${typeof message === "string" ? message : String(issue)}`;
    })
    .join("; ");
  return new JsonMendError(`Schema validation failed: ${summary}`, issues);
}

function pathKey(segment: unknown): string {
  return typeof segment === "object" && segment !== null && "key" in segment
    ? String(segment.key)
    : String(segment);
}

function toMendError(error: unknown): JsonMendError {
  return error instanceof JsonMendError ? error : new JsonMendError(String(error));
}
