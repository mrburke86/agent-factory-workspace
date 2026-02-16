export const CONTRACTS_VERSION = "0.1.0";

/**
 * Compatibility policy (v1):
 * - Patch: backward compatible
 * - Minor: backward compatible (new optional fields/events)
 * - Major: breaking change (removed/required fields, changed semantics)
 */
export const COMPAT_POLICY = {
  semver: true
} as const;
