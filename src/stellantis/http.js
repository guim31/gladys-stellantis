// -----------------------------------------------------------------------------
// A small HTTP layer over the global fetch: timeouts, query strings, form
// bodies, network failures as StellantisError.
//
// Error messages name the host only, never the URL: the token calls carry the
// code or the refresh token in their query string.
// -----------------------------------------------------------------------------

import { ERROR_KINDS, StellantisError } from './errors.js';

const DEFAULT_TIMEOUT_MS = 30000;

/**
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 */
export function createHttp({ fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  /**
   * One request.
   * @param {string} url
   * @param {object} [options]
   * @param {string} [options.method] default GET
   * @param {Record<string, string>} [options.headers]
   * @param {Record<string, string|number>} [options.query]
   * @returns {Promise<{ status: number, text: string, json: () => any }>}
   */
  async function request(url, options = {}) {
    const target = new URL(url);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== null) target.searchParams.set(key, String(value));
    }
    let response;
    try {
      response = await fetchImpl(target.toString(), {
        method: options.method ?? 'GET',
        headers: { Accept: 'application/json', ...(options.headers ?? {}) },
        body: options.body,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const reason = err?.cause?.code ?? err?.name ?? 'error';
      throw new StellantisError(ERROR_KINDS.NETWORK, `${target.host} unreachable (${reason})`);
    }
    let text;
    try {
      text = await response.text();
    } catch (err) {
      throw new StellantisError(
        ERROR_KINDS.NETWORK,
        `${target.host}: answer interrupted (${err?.name ?? 'error'})`,
      );
    }
    return {
      status: response.status,
      headers: response.headers,
      text,
      /** The parsed body, `null` when it is not JSON. */
      json() {
        if (!text) return null;
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      },
    };
  }

  return { request };
}
