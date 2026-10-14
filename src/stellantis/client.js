// -----------------------------------------------------------------------------
// Client of the Stellantis "Connected Car" API v4 (api.groupe-psa.com), signed
// in as the brand's mobile app.
//
// Sign-in (OAuth2 authorization code, as the app does it): the user signs in
// on the brand's page (src/stellantis/apps.js authorizeUrl), copies the code
// (src/stellantis/code.js), and the client trades it for an access token
// (about an hour) and a refresh token. The access token is renewed before it
// expires; the refresh token changes at each renewal and is saved at once
// (session.set), a restart must not lose it.
//
// Reads return the state the car last sent to the Stellantis cloud: they never
// wake the car. Endpoints, headers and query parameters are those of
// andreadegiovine/homeassistant-stellantis-vehicles (const.py, stellantis.py).
// -----------------------------------------------------------------------------

import { ERROR_KINDS, StellantisError, checkApiResponse, checkTokenResponse } from './errors.js';

export const API_BASE_URL = 'https://api.groupe-psa.com';
const VEHICLES_PATH = '/connectedcar/v4/user/vehicles';
// Renew the access token this long before it expires.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
// When the server gives no lifetime: the app's tokens last about an hour.
const DEFAULT_LIFETIME_S = 3600;

/**
 * @param {object} options
 * @param {object} options.http src/stellantis/http.js
 * @param {object} options.app appConfig() of src/stellantis/apps.js
 * @param {{ get: () => object, set: (partial: object) => void }} options.session
 *   where the tokens live ({ accessToken, refreshToken, expiresAt })
 * @param {() => number} [options.now]
 */
export function createStellantisClient({ http, app, session, now = Date.now }) {
  let refreshing = null;

  const basic = Buffer.from(`${app.clientId}:${app.clientSecret}`).toString('base64');
  const tokenUrl = `${app.oauthUrl}/am/oauth2/access_token`;

  /** A token call; the parameters go in the query string, as the app sends them. */
  async function tokenRequest(query, grant) {
    const response = await http.request(tokenUrl, {
      method: 'POST',
      query,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basic}`,
      },
    });
    const body = checkTokenResponse(response.json(), response.status, grant);
    const lifetime = Number(body.expires_in);
    const tokens = {
      accessToken: body.access_token,
      // Kept when an answer carries none: the current one stays valid.
      refreshToken: body.refresh_token || session.get().refreshToken || null,
      expiresAt:
        now() + (Number.isFinite(lifetime) && lifetime > 0 ? lifetime : DEFAULT_LIFETIME_S) * 1000,
      refreshedAt: now(),
    };
    session.set(tokens);
    return tokens;
  }

  /** Trade the pasted code for the first tokens. */
  async function exchangeCode(code) {
    const tokens = await tokenRequest(
      { redirect_uri: app.redirectUri, grant_type: 'authorization_code', code },
      'code',
    );
    session.set({ signedInAt: now() });
    return tokens;
  }

  /** Renew the access token (one renewal at a time). */
  function refresh() {
    if (!refreshing) {
      const { refreshToken } = session.get();
      if (!refreshToken) {
        return Promise.reject(new StellantisError(ERROR_KINDS.NOT_SIGNED_IN, 'Not signed in'));
      }
      refreshing = tokenRequest(
        { grant_type: 'refresh_token', refresh_token: refreshToken },
        'refresh',
      ).finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  /** A valid access token, renewed first when it is about to expire. */
  async function accessToken() {
    const { accessToken: token, refreshToken, expiresAt } = session.get();
    if (!token && !refreshToken) {
      throw new StellantisError(ERROR_KINDS.NOT_SIGNED_IN, 'Not signed in');
    }
    if (!token || !Number.isFinite(expiresAt) || now() >= expiresAt - REFRESH_MARGIN_MS) {
      return (await refresh()).accessToken;
    }
    return token;
  }

  /** GET an API path; a refused access token is renewed once. */
  async function get(path, what, query = {}) {
    let retried = false;
    for (;;) {
      const token = await accessToken();
      const response = await http.request(`${API_BASE_URL}${path}`, {
        query: { client_id: app.clientId, locale: app.locale, ...query },
        headers: { Authorization: `Bearer ${token}`, 'x-introspect-realm': app.realm },
      });
      try {
        return checkApiResponse(response.json(), response.status, what);
      } catch (err) {
        if (err.kind !== ERROR_KINDS.TOKEN_REJECTED || retried) throw err;
        retried = true;
        await refresh();
      }
    }
  }

  return {
    app,
    exchangeCode,
    refresh,
    accessToken,

    get signedIn() {
      const { accessToken: token, refreshToken } = session.get();
      return Boolean(token || refreshToken);
    },

    /** The cars of the account (`_embedded.vehicles`). */
    async vehicles() {
      const body = await get(VEHICLES_PATH, 'Vehicle list');
      const list = body?._embedded?.vehicles;
      return Array.isArray(list) ? list : [];
    },

    /** The last state a car sent to the cloud. Never wakes the car. */
    status(vehicleId) {
      return get(`${VEHICLES_PATH}/${encodeURIComponent(vehicleId)}/status`, 'Vehicle status');
    },
  };
}
