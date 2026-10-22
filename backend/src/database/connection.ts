/**
 * Helpers for describing the MongoDB connection without leaking credentials.
 */

export const DEFAULT_DB_NAME = 'bizwoke_nova';

const URI_PATTERN = /^mongodb(?:\+srv)?:\/\/(?:[^@/]+@)?([^/?]+)(?:\/([^?]*))?/;

/** Removes any `user:password@` segment from a string (URIs, error messages). */
export function redactCredentials(value: string): string {
  return value.replace(/(mongodb(?:\+srv)?:\/\/)[^@/\s]+@/gi, '$1***:***@');
}

/** Host list only (e.g. "cluster0.abcd.mongodb.net"), safe to log. */
export function describeHosts(uri: string): string {
  return URI_PATTERN.exec(uri)?.[1] ?? 'unknown-host';
}

/**
 * Database name precedence: MONGODB_DB_NAME → path in the URI → "bizwoke_nova".
 */
export function resolveDbName(uri: string, explicit?: string): string {
  if (explicit) return explicit;
  const fromUri = URI_PATTERN.exec(uri)?.[2];
  return fromUri ? decodeURIComponent(fromUri) : DEFAULT_DB_NAME;
}
