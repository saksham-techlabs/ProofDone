const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ANSI_PATTERN = new RegExp(
  `${ESC}\\[[0-?]*[ -/]*[@-~]|${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`,
  'g',
);

/** Best-effort patterns for well-known credential formats. */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];
const BEARER_PATTERN = /(\bBearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi;
const MIN_LITERAL_SECRET_LENGTH = 8;

export const REDACTED = '[REDACTED]';

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

/**
 * Redacts well-known token formats plus any literal values supplied by the caller
 * (for example, values of `env` entries from the config). Best effort only.
 */
export function redact(text: string, literals: readonly string[] = []): string {
  let result = text;
  for (const literal of literals) {
    if (literal.length >= MIN_LITERAL_SECRET_LENGTH) {
      result = result.split(literal).join(REDACTED);
    }
  }
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, REDACTED);
  }
  return result.replace(BEARER_PATTERN, `$1${REDACTED}`);
}

/** Normalizes line endings, strips ANSI escapes and redacts secrets. */
export function sanitizeOutput(text: string, literals: readonly string[] = []): string {
  return redact(stripAnsi(text).replace(/\r\n?/g, '\n'), literals);
}

/** Returns the last `maxLines` non-empty lines, limited to roughly `maxChars` characters. */
export function tailLines(text: string, maxLines = 20, maxChars = 2000): string[] {
  const lines = text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  const selected: string[] = [];
  let size = 0;
  for (let i = lines.length - 1; i >= 0 && selected.length < maxLines; i--) {
    let line = lines[i] ?? '';
    if (line.length > 500) line = `${line.slice(0, 497)}...`;
    if (size + line.length > maxChars && selected.length > 0) break;
    selected.unshift(line);
    size += line.length + 1;
  }
  return selected;
}

/** Truncates a string to `max` characters, marking truncation. */
export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 3))}...`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/** Caps a list for display, appending a "... and N more" marker. */
export function capList(items: readonly string[], max: number): string[] {
  if (items.length <= max) return [...items];
  return [...items.slice(0, max), `... and ${items.length - max} more`];
}
