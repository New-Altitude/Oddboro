/** A short real macOS path for the command sandbox's per-run files. */
export const runTemp = (key: string): string => `/private/tmp/ob-${key.slice(0, 8)}`;
