// -----------------------------------------------------------------------------
// The Stellantis client: the apps table, the sign-in page, the code pasted by
// the user, the token exchange and renewal, the API calls and their errors.
// Against the fake cloud of test/helpers/fakeStellantis.js: no network.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BRAND_KEYS,
  COUNTRY_CODES,
  appConfig,
  authorizeUrl,
  countriesOf,
} from '../src/stellantis/apps.js';
import { extractCode } from '../src/stellantis/code.js';
import { createHttp } from '../src/stellantis/http.js';
import { createStellantisClient } from '../src/stellantis/client.js';
import { ERROR_KINDS } from '../src/stellantis/errors.js';
import { createMemoryStore } from '../src/store.js';
import { VALID_CODE, VINS, createFakeStellantis } from './helpers/fakeStellantis.js';

const MINUTE = 60 * 1000;

function setup({ brand = 'peugeot', country = 'FR' } = {}) {
  let clock = Date.UTC(2026, 9, 13, 10);
  const now = () => clock;
  const cloud = createFakeStellantis({ now });
  const store = createMemoryStore();
  const session = store.sessionStore(`${brand}:${country}`);
  const client = createStellantisClient({
    http: createHttp({ fetchImpl: cloud.fetch }),
    app: appConfig(brand, country),
    session,
    now,
  });
  return {
    cloud,
    store,
    session,
    client,
    advance: (ms) => {
      clock += ms;
    },
  };
}

test('the five apps and their countries', () => {
  assert.deepEqual(BRAND_KEYS, ['peugeot', 'citroen', 'ds', 'opel', 'vauxhall']);
  assert.ok(COUNTRY_CODES.includes('FR') && COUNTRY_CODES.includes('GB'));
  assert.deepEqual(countriesOf('vauxhall'), ['GB']);
  assert.equal(appConfig('opel', 'GB'), null);
  assert.equal(appConfig('nope', 'FR'), null);
  for (const brand of BRAND_KEYS) {
    for (const country of countriesOf(brand)) {
      const app = appConfig(brand, country);
      assert.match(app.oauthUrl, /^https:\/\/idpcvs\./, `${brand} ${country}`);
      assert.match(app.clientId, /^[0-9a-f-]{36}$/, `${brand} ${country}`);
      assert.ok(app.clientSecret.length > 20);
      assert.match(app.realm, /^clientsB2C/);
      assert.match(app.locale, /^[a-z]{2}-[A-Z]{2}$/);
      assert.match(app.redirectUri, /^mym[a-z]+:\/\/oauth2redirect\/[a-z]{2}$/);
    }
  }
});

test('the sign-in page is the one the app opens', () => {
  const url = new URL(authorizeUrl(appConfig('citroen', 'FR')));
  assert.equal(url.origin, 'https://idpcvs.citroen.com');
  assert.equal(url.pathname, '/am/oauth2/authorize');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('redirect_uri'), 'mymacsdk://oauth2redirect/fr');
  assert.equal(url.searchParams.get('scope'), 'openid profile email');
  assert.equal(url.searchParams.get('locale'), 'fr-FR');
  assert.ok(url.searchParams.get('client_id'));
  // The client secret never goes to the browser.
  assert.ok(
    !authorizeUrl(appConfig('citroen', 'FR')).includes(appConfig('citroen', 'FR').clientSecret),
  );
  assert.match(authorizeUrl(appConfig('peugeot', 'FR')), /scope=openid%20profile%20email/);
});

test('the code is found in whatever the user pasted', () => {
  const code = 'aBc-123_x.Y~z';
  for (const pasted of [
    code,
    `  ${code}\n`,
    `"${code}"`,
    `mymap://oauth2redirect/fr?code=${code}&scope=openid%20profile%20email`,
    `Failed to launch 'mymap://oauth2redirect/fr?code=${code}&scope=openid' because the scheme does not have a registered handler.`,
    `Prevented navigation to “mymacsdk://oauth2redirect/fr?code=${code}”`,
    `mymdssdk://oauth2redirect/de?scope=openid&code=${code}`,
    `location: mymopsdk://oauth2redirect/fr?code=${encodeURIComponent(code)}&iss=x`,
  ]) {
    assert.equal(extractCode(pasted), code, pasted);
  }
  for (const pasted of [
    '',
    '   ',
    'abc',
    'Failed to launch the page',
    'mymap://oauth2redirect/fr',
    undefined,
  ]) {
    assert.equal(extractCode(pasted), null, String(pasted));
  }
});

test('the code is traded for tokens, saved at once', async () => {
  const { cloud, session, client } = setup();
  assert.equal(client.signedIn, false);
  await client.exchangeCode(VALID_CODE);
  assert.equal(client.signedIn, true);
  assert.equal(session.get().accessToken, 'access-1');
  assert.equal(session.get().refreshToken, 'refresh-1');
  const [call] = cloud.callsTo('token');
  assert.equal(call.host, 'idpcvs.peugeot.com');
  assert.equal(call.query.grant_type, 'authorization_code');
  assert.equal(call.query.redirect_uri, 'mymap://oauth2redirect/fr');
  const basic = Buffer.from(call.headers.Authorization.replace('Basic ', ''), 'base64').toString();
  assert.equal(basic.split(':')[0], appConfig('peugeot', 'FR').clientId);
});

test('a refused code is a CODE error, and its message carries no code', async () => {
  const { client } = setup();
  await assert.rejects(client.exchangeCode('wrong-code-1234'), (err) => {
    assert.equal(err.kind, ERROR_KINDS.CODE);
    assert.ok(!err.message.includes('wrong-code-1234'));
    return true;
  });
  assert.equal(client.signedIn, false);
});

test('the API is called with the token, the realm and the app id', async () => {
  const { cloud, client } = setup();
  await client.exchangeCode(VALID_CODE);
  const vehicles = await client.vehicles();
  assert.equal(vehicles.length, 3);
  const [call] = cloud.callsTo('vehicles');
  assert.equal(call.host, 'api.groupe-psa.com');
  assert.equal(call.headers['x-introspect-realm'], 'clientsB2CPeugeot');
  assert.equal(call.headers.Authorization, 'Bearer access-1');
  assert.equal(call.query.locale, 'fr-FR');
  const status = await client.status(cloud.idOf(VINS.ELECTRIC));
  assert.equal(status.energies[0].level, 54);
});

test('the access token is renewed before it expires, and the new refresh token kept', async () => {
  const { cloud, session, client, advance } = setup();
  await client.exchangeCode(VALID_CODE);
  advance(50 * MINUTE);
  await client.vehicles();
  assert.equal(cloud.callsTo('token').length, 1, 'no renewal while the token is fresh');
  advance(6 * MINUTE);
  await client.vehicles();
  assert.equal(cloud.callsTo('token').length, 2);
  assert.equal(cloud.callsTo('token')[1].query.refresh_token, 'refresh-1');
  assert.equal(session.get().refreshToken, 'refresh-2');
  assert.equal(session.get().accessToken, 'access-2');
});

test('two calls at once renew the token once', async () => {
  const { cloud, client, advance } = setup();
  await client.exchangeCode(VALID_CODE);
  advance(2 * 60 * MINUTE);
  await Promise.all([client.vehicles(), client.status(cloud.idOf(VINS.ELECTRIC))]);
  assert.equal(cloud.callsTo('token').length, 2);
});

test('a token refused by the API is renewed once, then the call retried', async () => {
  const { cloud, client } = setup();
  await client.exchangeCode(VALID_CODE);
  cloud.fail('vehicles', 401, { httpMessage: 'Unauthorized', moreInformation: 'expired' });
  assert.equal((await client.vehicles()).length, 3);
  assert.equal(cloud.callsTo('token').length, 2);
  cloud.fail('vehicles', 401, {}, 2);
  await assert.rejects(client.vehicles(), { kind: ERROR_KINDS.TOKEN_REJECTED });
});

test('a refused refresh token ends the session (AUTH)', async () => {
  const { cloud, client, advance } = setup();
  await client.exchangeCode(VALID_CODE);
  cloud.validRefresh.clear();
  advance(2 * 60 * MINUTE);
  await assert.rejects(client.vehicles(), (err) => {
    assert.equal(err.kind, ERROR_KINDS.AUTH);
    assert.ok(!err.message.includes('refresh-1'));
    return true;
  });
});

test('a network failure of the renewal keeps the refresh token', async () => {
  const { cloud, session, client, advance } = setup();
  await client.exchangeCode(VALID_CODE);
  advance(2 * 60 * MINUTE);
  cloud.fail('token', 'network');
  await assert.rejects(client.vehicles(), { kind: ERROR_KINDS.NETWORK });
  assert.equal(session.get().refreshToken, 'refresh-1');
  assert.equal((await client.vehicles()).length, 3);
});

test('API errors are sorted by what the runtime does about them', async () => {
  const { cloud, client } = setup();
  await client.exchangeCode(VALID_CODE);
  const id = cloud.idOf(VINS.ELECTRIC);
  for (const [status, kind] of [
    [404, ERROR_KINDS.NOT_FOUND],
    [403, ERROR_KINDS.ACCESS_DENIED],
    [429, ERROR_KINDS.RATE_LIMIT],
    [500, ERROR_KINDS.SERVER],
    [400, ERROR_KINDS.API],
  ]) {
    cloud.fail('status', status, { message: 'Nope', code: status * 100 });
    await assert.rejects(client.status(id), { kind }, String(status));
  }
  cloud.fail('status', 'network');
  await assert.rejects(client.status(id), (err) => {
    assert.equal(err.kind, ERROR_KINDS.NETWORK);
    assert.equal(err.message, 'api.groupe-psa.com unreachable (TypeError)');
    return true;
  });
});

test('not signed in: no call at all', async () => {
  const { cloud, client } = setup();
  await assert.rejects(client.vehicles(), { kind: ERROR_KINDS.NOT_SIGNED_IN });
  assert.equal(cloud.calls.length, 0);
});
