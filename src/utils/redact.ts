/**
 * Deep-walk a value, replacing string entries whose parent object key is in
 * `keys` with `placeholder`. Returns a structural copy; primitives pass through.
 *
 * Used by tracer-output sanitizers to keep sensitive payload values
 * (file blobs, signed URLs, etc.) out of debug logs without losing the
 * surrounding structure.
 */
export function redactKeys<T>(value: T, keys: Set<string>, placeholder = "[redacted]"): T {
  return walk(value, null, keys, placeholder) as T;
}

function walk(value: unknown, key: string | null, keys: Set<string>, placeholder: string): unknown {
  if (value == null || typeof value !== "object") {
    if (typeof value === "string" && key && keys.has(key)) {
      return placeholder;
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => walk(item, key, keys, placeholder));
  }

  const result: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    result[entryKey] = walk(entryValue, entryKey, keys, placeholder);
  }
  return result;
}

/**
 * Object keys that carry resolved file payload values across provider request
 * bodies (base64 blobs, signed URLs, data URLs, etc.).
 */
const FILE_VALUE_KEYS = new Set([
  "data",
  "file_data",
  "file_url",
  "image_url",
  "url",
  "uri",
  "fileUri",
]);

/**
 * Sanitize a provider request body for tracer debug output: strips file
 * payload values (base64 blobs, URLs) while preserving structure.
 */
export function redactResolvedFileValues<T>(value: T): T {
  return redactKeys(value, FILE_VALUE_KEYS, "[redacted-file-value]");
}
