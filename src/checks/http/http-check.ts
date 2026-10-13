import { formatDuration, redact, truncate } from '../../core/output.js';
import type { HttpCheckConfig, HttpMethod } from '../../types/index.js';
import type { CheckDefinition, CheckOutcome } from '../definition.js';

export const DEFAULT_HTTP_TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 1024 * 1024;
const BODY_SNIPPET_CHARS = 300;
const METHODS: readonly HttpMethod[] = ['GET', 'HEAD'];

async function readBody(response: Response): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) return { text: '', truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (size >= MAX_BODY_BYTES) {
      truncated = true;
      await reader.cancel();
      break;
    }
  }
  return { text: new TextDecoder().decode(Buffer.concat(chunks)), truncated };
}

/** Explains a fetch failure using the underlying system error code when available. */
function describeFetchError(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause instanceof Error) {
      const code = (cause as NodeJS.ErrnoException).code;
      if (code === 'ECONNREFUSED') return 'connection refused (is the server running?)';
      if (code === 'ENOTFOUND') return 'host not found';
      return code ? `${code}: ${cause.message}` : cause.message;
    }
    return error.message;
  }
  return String(error);
}

function statusAccepted(status: number, expected: number[] | undefined): boolean {
  return expected ? expected.includes(status) : status >= 200 && status <= 299;
}

export const httpCheck: CheckDefinition<HttpCheckConfig> = {
  type: 'http',
  description: 'Requests a URL (GET/HEAD only) and checks the status code and optional body text.',

  parse(reader, base) {
    const url = reader.requiredString('url');
    if (url) {
      let parsed: URL | undefined;
      try {
        parsed = new URL(url);
      } catch {
        reader.issue('url', 'must be a valid absolute URL');
      }
      if (parsed && parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        reader.issue('url', 'must use http or https');
      }
    }

    const config: HttpCheckConfig = {
      ...base,
      type: 'http',
      url,
      method: reader.oneOf('method', METHODS, 'GET'),
    };
    const expectStatus = reader.optionalIntegerList('expectStatus', 100, 599);
    if (expectStatus) config.expectStatus = expectStatus;
    const bodyContains = reader.optionalString('bodyContains');
    if (bodyContains !== undefined) {
      config.bodyContains = bodyContains;
      if (config.method === 'HEAD') reader.issue('bodyContains', 'cannot be used with method HEAD');
    }
    return config;
  },

  describe(config) {
    const status = config.expectStatus ? `status ${config.expectStatus.join('/')}` : 'a 2xx status';
    const body = config.bodyContains ? ` and body containing ${JSON.stringify(config.bodyContains)}` : '';
    return `${config.method} ${config.url} returns ${status}${body}`;
  },

  async run(config, _context): Promise<CheckOutcome> {
    const timeoutMs = config.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
    const evidence: Record<string, unknown> = { url: config.url, method: config.method, timeoutMs };
    const started = performance.now();

    let response: Response;
    let body: { text: string; truncated: boolean } = { text: '', truncated: false };
    try {
      response = await fetch(config.url, {
        method: config.method,
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': 'proofdone' },
      });
      body = config.method === 'HEAD' ? body : await readBody(response);
    } catch (error) {
      evidence.durationMs = Math.round(performance.now() - started);
      const name = error instanceof Error ? error.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        evidence.timedOut = true;
        return { status: 'FAIL', summary: `no response within ${formatDuration(timeoutMs)}`, evidence };
      }
      const reason = describeFetchError(error);
      evidence.error = reason;
      return { status: 'FAIL', summary: `request failed: ${reason}`, evidence };
    }

    const durationMs = performance.now() - started;
    const snippet = truncate(redact(body.text.trim()), BODY_SNIPPET_CHARS);
    Object.assign(evidence, {
      status: response.status,
      finalUrl: response.url,
      durationMs: Math.round(durationMs),
      expectedStatus: config.expectStatus ?? '2xx',
      bodySnippet: snippet,
      bodyTruncated: body.truncated,
    });

    const problems: string[] = [];
    if (!statusAccepted(response.status, config.expectStatus)) {
      const expected = config.expectStatus ? config.expectStatus.join(' or ') : '2xx';
      problems.push(`status ${response.status} (expected ${expected})`);
    }
    if (config.bodyContains !== undefined) {
      const found = body.text.includes(config.bodyContains);
      evidence.bodyContainsFound = found;
      if (!found) problems.push(`response body does not contain ${JSON.stringify(config.bodyContains)}`);
    }

    if (problems.length > 0) {
      return {
        status: 'FAIL',
        summary: problems.join('; '),
        details: snippet ? [`Response body (start): ${snippet}`] : [],
        evidence,
      };
    }
    return { status: 'PASS', summary: `${response.status} in ${formatDuration(durationMs)}`, evidence };
  },
};
