// -----------------------------------------------------------------------------
// A fake Stellantis cloud behind a `fetch` implementation: the token endpoint
// of the brand's sign-in server and the Connected Car v4 API, served from the
// fixtures of test/fixtures/stellantis. Every request is recorded; failures
// are injected per endpoint.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/stellantis/${name}`, import.meta.url), 'utf8'));

export const VALID_CODE = 'Abc123-valid_code.0001';
export const VINS = {
  ELECTRIC: 'VR3TESTVIN0000208',
  HYBRID: 'VR3TESTVIN0003008',
  THERMIC: 'VF7TESTVIN00000C5',
};

export function createFakeStellantis({ now = Date.now } = {}) {
  const vehicles = fixture('vehicles.json');
  const idOf = (vin) => vehicles._embedded.vehicles.find((v) => v.vin === vin).id;
  const cloud = {
    vehicles,
    statuses: {
      [idOf(VINS.ELECTRIC)]: fixture('status-electric-charging.json'),
      [idOf(VINS.HYBRID)]: fixture('status-hybrid.json'),
      [idOf(VINS.THERMIC)]: fixture('status-thermic-legacy.json'),
    },
    calls: [],
    issued: 0,
    lifetimeS: 3599,
    // endpoint ('token' | 'vehicles' | 'status') → [{ status, body }] answered first
    failures: { token: [], vehicles: [], status: [] },
    // refresh tokens the server still accepts
    validRefresh: new Set(),
    // access token → expiry (ms)
    validAccess: new Map(),
    idOf,
    status: (vin) => cloud.statuses[idOf(vin)],
    fail(endpoint, status, body = {}, times = 1) {
      for (let i = 0; i < times; i += 1) cloud.failures[endpoint].push({ status, body });
    },
    /** Every call to an endpoint. */
    callsTo: (endpoint) => cloud.calls.filter((call) => call.endpoint === endpoint),
    fetch,
  };

  const json = (status, body) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  function issue() {
    cloud.issued += 1;
    const tokens = {
      ...fixture('token.json'),
      access_token: `access-${cloud.issued}`,
      refresh_token: `refresh-${cloud.issued}`,
      expires_in: cloud.lifetimeS,
    };
    cloud.validRefresh.clear();
    cloud.validRefresh.add(tokens.refresh_token);
    cloud.validAccess.set(tokens.access_token, now() + cloud.lifetimeS * 1000);
    return tokens;
  }

  async function fetch(url, options = {}) {
    const target = new URL(url);
    const query = Object.fromEntries(target.searchParams);
    const headers = options.headers ?? {};
    let endpoint = 'other';
    if (target.pathname.endsWith('/am/oauth2/access_token')) endpoint = 'token';
    else if (/\/connectedcar\/v4\/user\/vehicles\/[^/]+\/status$/.test(target.pathname)) {
      endpoint = 'status';
    } else if (target.pathname.endsWith('/connectedcar/v4/user/vehicles')) endpoint = 'vehicles';
    cloud.calls.push({
      endpoint,
      host: target.host,
      path: target.pathname,
      query,
      headers,
      at: now(),
    });

    const injected = cloud.failures[endpoint]?.shift();
    if (injected) {
      if (injected.status === 'network') throw new TypeError('fetch failed');
      return json(injected.status, injected.body);
    }

    if (endpoint === 'token') {
      if (!headers.Authorization?.startsWith('Basic '))
        return json(401, { error: 'invalid_client' });
      if (query.grant_type === 'authorization_code') {
        if (query.code !== VALID_CODE || !query.redirect_uri?.includes('://oauth2redirect/')) {
          return json(400, fixture('token.invalid_grant.json'));
        }
        return json(200, issue());
      }
      if (query.grant_type === 'refresh_token') {
        if (!cloud.validRefresh.has(query.refresh_token)) {
          return json(400, fixture('token.invalid_grant.json'));
        }
        return json(200, issue());
      }
      return json(400, { error: 'unsupported_grant_type' });
    }

    // API calls.
    const token = String(headers.Authorization ?? '').replace(/^Bearer /, '');
    if (
      !(cloud.validAccess.get(token) > now()) ||
      !headers['x-introspect-realm'] ||
      !query.client_id
    ) {
      return json(401, { httpMessage: 'Unauthorized', moreInformation: 'Invalid token' });
    }
    if (endpoint === 'vehicles') return json(200, cloud.vehicles);
    if (endpoint === 'status') {
      const id = decodeURIComponent(target.pathname.split('/').at(-2));
      const status = cloud.statuses[id];
      return status ? json(200, status) : json(404, fixture('status.404.json'));
    }
    return json(404, {});
  }

  return cloud;
}
