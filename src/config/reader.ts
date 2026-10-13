import type { ConfigIssue } from '../core/errors.js';
import { checkProjectRelativePath, toPosixPath } from '../core/paths.js';

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Reads typed fields from an untrusted JSON object, collecting issues instead of throwing.
 * Every key read is remembered so unknown keys (usually typos) can be reported.
 */
export class FieldReader {
  private readonly seen = new Set<string>();

  constructor(
    private readonly obj: Record<string, unknown>,
    private readonly at: string,
    private readonly issues: ConfigIssue[],
  ) {}

  location(key: string): string {
    return `${this.at}.${key}`;
  }

  issue(key: string, message: string): void {
    this.issues.push({ path: this.location(key), message });
  }

  has(key: string): boolean {
    return this.obj[key] !== undefined;
  }

  private take(key: string): unknown {
    this.seen.add(key);
    return this.obj[key];
  }

  optionalString(key: string): string | undefined {
    const value = this.take(key);
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || value.trim().length === 0) {
      this.issue(key, `must be a non-empty string (got ${describeType(value)})`);
      return undefined;
    }
    return value;
  }

  requiredString(key: string): string {
    if (this.obj[key] === undefined) {
      this.take(key);
      this.issue(key, 'is required');
      return '';
    }
    return this.optionalString(key) ?? '';
  }

  boolean(key: string, defaultValue: boolean): boolean {
    const value = this.take(key);
    if (value === undefined) return defaultValue;
    if (typeof value !== 'boolean') {
      this.issue(key, `must be true or false (got ${describeType(value)})`);
      return defaultValue;
    }
    return value;
  }

  optionalInteger(key: string, min: number, max: number): number | undefined {
    const value = this.take(key);
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      this.issue(key, `must be an integer between ${min} and ${max}`);
      return undefined;
    }
    return value;
  }

  /** Accepts a single integer or a non-empty array of integers. */
  optionalIntegerList(key: string, min: number, max: number): number[] | undefined {
    const value = this.take(key);
    if (value === undefined) return undefined;
    const list = Array.isArray(value) ? value : [value];
    const valid =
      list.length > 0 &&
      list.every((item) => typeof item === 'number' && Number.isInteger(item) && item >= min && item <= max);
    if (!valid) {
      this.issue(key, `must be an integer or a non-empty array of integers between ${min} and ${max}`);
      return undefined;
    }
    return list as number[];
  }

  oneOf<T extends string>(key: string, allowed: readonly T[], defaultValue: T): T {
    const value = this.take(key);
    if (value === undefined) return defaultValue;
    if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
      this.issue(key, `must be one of: ${allowed.join(', ')}`);
      return defaultValue;
    }
    return value as T;
  }

  stringArray(key: string): string[] {
    const value = this.take(key);
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      this.issue(key, `must be an array of strings (got ${describeType(value)})`);
      return [];
    }
    const result: string[] = [];
    value.forEach((item, index) => {
      if (typeof item !== 'string' || item.length === 0) {
        this.issues.push({ path: `${this.location(key)}[${index}]`, message: 'must be a non-empty string' });
      } else {
        result.push(item);
      }
    });
    return result;
  }

  /** Reads an array of project-relative paths, normalized to forward slashes. */
  pathArray(key: string): string[] {
    const result: string[] = [];
    this.stringArray(key).forEach((item, index) => {
      const problem = checkProjectRelativePath(item);
      if (problem) {
        this.issues.push({ path: `${this.location(key)}[${index}]`, message: `path ${problem}` });
      } else {
        result.push(toPosixPath(item));
      }
    });
    return result;
  }

  optionalPath(key: string): string | undefined {
    const value = this.optionalString(key);
    if (value === undefined) return undefined;
    const problem = checkProjectRelativePath(value);
    if (problem) {
      this.issue(key, `path ${problem}`);
      return undefined;
    }
    return toPosixPath(value);
  }

  requiredPath(key: string): string {
    if (this.obj[key] === undefined) {
      this.take(key);
      this.issue(key, 'is required');
      return '';
    }
    return this.optionalPath(key) ?? '';
  }

  stringRecord(key: string): Record<string, string> {
    const value = this.take(key);
    if (value === undefined) return {};
    if (!isPlainObject(value)) {
      this.issue(key, `must be an object of string values (got ${describeType(value)})`);
      return {};
    }
    const result: Record<string, string> = {};
    for (const [name, entry] of Object.entries(value)) {
      if (typeof entry !== 'string') {
        this.issues.push({ path: `${this.location(key)}.${name}`, message: 'must be a string' });
      } else {
        result[name] = entry;
      }
    }
    return result;
  }

  /** Marks a key as consumed without validating it (e.g. `$schema`). */
  allow(key: string): void {
    this.seen.add(key);
  }

  /** Reports every key that no reader method consumed. */
  rejectUnknownKeys(): void {
    for (const key of Object.keys(this.obj)) {
      if (!this.seen.has(key)) this.issue(key, 'is not a recognized option');
    }
  }
}
