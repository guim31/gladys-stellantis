// -----------------------------------------------------------------------------
// Errors of the Stellantis sign-in server and API, sorted by what the runtime
// does about them (see src/runtime.js). Messages never carry a token, a code,
// a URL with a query string or a VIN: they reach the logs.
//
// The API answers its errors in three shapes (andreadegiovine/
// homeassistant-stellantis-vehicles, stellantis.py make_http_request):
// `{ httpMessage, moreInformation }`, `{ error, error_description }` (OAuth2)
// and `{ message, code }`.
// -----------------------------------------------------------------------------

export const ERROR_KINDS = {
  // No session yet: the user has not finished the sign-in.
  NOT_SIGNED_IN: 'not-signed-in',
  // The refresh token was refused (invalid_grant): the user signs in again.
  // Retrying would only fail the same way.
  AUTH: 'auth',
  // The pasted code was refused: wrong, already used or expired.
  CODE: 'code',
  // The access token was refused (401): refresh it, try once more.
  TOKEN_REJECTED: 'token-rejected',
  // 429: pause the reads.
  RATE_LIMIT: 'rate-limit',
  // 403: the subscription or the car does not give this data.
  ACCESS_DENIED: 'access-denied',
  // 404: no status for this car (yet), or it left the account.
  NOT_FOUND: 'not-found',
  NETWORK: 'network',
  SERVER: 'server',
  API: 'api',
};

export class StellantisError extends Error {
  constructor(kind, message, { status, code } = {}) {
    super(message);
    this.name = 'StellantisError';
    this.kind = kind;
    if (status !== undefined) this.status = status;
    if (code !== undefined) this.code = code;
  }
}

/** A short description of an error body, without anything it might echo back. */
function describe(body) {
  if (!body || typeof body !== 'object') return '';
  const parts = [
    body.error,
    body.error_description,
    body.httpMessage,
    body.moreInformation,
    body.message,
    body.code,
  ]
    .filter((part) => part !== undefined && part !== null && part !== '')
    .map((part) => String(part).replace(/\s+/g, ' ').slice(0, 120));
  return parts.length > 0 ? `: ${parts.join(' - ')}` : '';
}

/**
 * Throw the error of a sign-in server answer (token endpoint), if any.
 * @param {object | null} body parsed JSON
 * @param {number} status HTTP status
 * @param {'code' | 'refresh'} grant what was asked
 */
export function checkTokenResponse(body, status, grant) {
  if (status >= 200 && status < 300 && body?.access_token) return body;
  const what = grant === 'code' ? 'Code exchange' : 'Token refresh';
  if (body?.error === 'invalid_grant' || body?.error === 'invalid_request') {
    // A refused code is the user's to fix; a refused refresh token means the
    // session is over.
    throw new StellantisError(
      grant === 'code' ? ERROR_KINDS.CODE : ERROR_KINDS.AUTH,
      `${what} refused (HTTP ${status})${describe(body)}`,
      { status, code: body.error },
    );
  }
  if (status === 401 && grant === 'refresh') {
    throw new StellantisError(ERROR_KINDS.AUTH, `${what} refused (HTTP 401)${describe(body)}`, {
      status,
    });
  }
  if (status === 429) {
    throw new StellantisError(ERROR_KINDS.RATE_LIMIT, `${what}: HTTP 429`, { status });
  }
  if (status >= 500) {
    throw new StellantisError(ERROR_KINDS.SERVER, `${what}: HTTP ${status}${describe(body)}`, {
      status,
    });
  }
  throw new StellantisError(
    status >= 400 && grant === 'code' ? ERROR_KINDS.CODE : ERROR_KINDS.API,
    `${what}: unexpected answer (HTTP ${status})${describe(body)}`,
    { status },
  );
}

/**
 * Throw the error of an API answer, if any.
 * @param {object | null} body parsed JSON
 * @param {number} status HTTP status
 * @param {string} what e.g. "Vehicle list"
 */
export function checkApiResponse(body, status, what) {
  if (status >= 200 && status < 300) {
    if (!body || typeof body !== 'object') {
      throw new StellantisError(ERROR_KINDS.API, `${what}: empty answer (HTTP ${status})`, {
        status,
      });
    }
    return body;
  }
  const detail = describe(body);
  const code = body?.code !== undefined ? String(body.code) : undefined;
  if (status === 401) {
    throw new StellantisError(ERROR_KINDS.TOKEN_REJECTED, `${what}: HTTP 401${detail}`, {
      status,
      code,
    });
  }
  if (status === 403) {
    throw new StellantisError(ERROR_KINDS.ACCESS_DENIED, `${what}: HTTP 403${detail}`, {
      status,
      code,
    });
  }
  if (status === 404) {
    throw new StellantisError(ERROR_KINDS.NOT_FOUND, `${what}: HTTP 404${detail}`, {
      status,
      code,
    });
  }
  if (status === 429) {
    throw new StellantisError(ERROR_KINDS.RATE_LIMIT, `${what}: HTTP 429${detail}`, {
      status,
      code,
    });
  }
  if (status >= 500) {
    throw new StellantisError(ERROR_KINDS.SERVER, `${what}: HTTP ${status}${detail}`, {
      status,
      code,
    });
  }
  throw new StellantisError(ERROR_KINDS.API, `${what}: HTTP ${status}${detail}`, { status, code });
}
