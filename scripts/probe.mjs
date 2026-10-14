#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Probe of the real Stellantis sign-in servers and API, with the integration's
// own code. Nothing sensitive is printed: no client id or secret, no code, no
// token, no VIN, no position.
//
// Without an account (default): for each brand, the sign-in page is followed
// until the login form, then a fake code is sent to the token endpoint, which
// must refuse it cleanly (invalid_grant → "code refused" for the user), and
// the API must refuse a call without token (401).
//
//   node scripts/probe.mjs              # one country per brand (FR, GB for Vauxhall)
//   node scripts/probe.mjs --all        # every country of every brand
//
// With an account: sign in in a browser (the URL is printed), copy the
// mymap://… address, then within two minutes:
//
//   STELLANTIS_BRAND=peugeot STELLANTIS_COUNTRY=FR node scripts/probe.mjs --url
//   STELLANTIS_BRAND=peugeot STELLANTIS_COUNTRY=FR STELLANTIS_CODE='mymap://…' node scripts/probe.mjs
//
// prints the number of cars, their motorization and which values each status
// carries (the field names only), then renews the token once.
// -----------------------------------------------------------------------------

import { appConfig, authorizeUrl, countriesOf, BRAND_KEYS } from '../src/stellantis/apps.js';
import { createHttp } from '../src/stellantis/http.js';
import { createStellantisClient, API_BASE_URL } from '../src/stellantis/client.js';
import { extractCode } from '../src/stellantis/code.js';
import { snapshotOf, vehicleInfo } from '../src/devices/vehicle.js';
import { createMemoryStore } from '../src/store.js';

const step = (label, outcome) => console.log(`${label.padEnd(36)} ${outcome}`);
const describe = (err) =>
  `${err.kind ?? err.name ?? 'error'}${err.status !== undefined ? ` (HTTP ${err.status})` : ''}`;
const http = createHttp({ timeoutMs: 20000 });

/** Follow the sign-in page to the login form; returns a one-line summary. */
async function followSignIn(app) {
  let url = authorizeUrl(app);
  const hosts = [];
  for (let hop = 0; hop < 10; hop += 1) {
    const response = await http.request(url, { headers: { Accept: 'text/html' } });
    hosts.push(`${new URL(url).host} ${response.status}`);
    const location = response.headers?.get?.('location');
    if (response.status >= 300 && response.status < 400 && location) {
      const next = new URL(location, url);
      // Already the app's address: the server signed nobody in, it should not.
      if (!next.protocol.startsWith('http'))
        return { ok: false, line: `${hosts.join(' → ')} → app scheme` };
      url = next.toString();
      continue;
    }
    const form = /<form|<input|login|password/i.test(response.text);
    return {
      ok: response.status === 200 && form,
      line: `${hosts.join(' → ')}${form ? ', login form' : ', no login form'} (${response.text.length} bytes)`,
    };
  }
  return { ok: false, line: `${hosts.join(' → ')} → too many redirects` };
}

async function probeBrand(brand, country) {
  const app = appConfig(brand, country);
  const label = `${app.appName} ${country}`;
  let ok = true;
  try {
    const page = await followSignIn(app);
    ok &&= page.ok;
    step(`${label}: sign-in page`, page.line);
  } catch (err) {
    ok = false;
    step(`${label}: sign-in page`, `failed: ${describe(err)}`);
  }
  const session = createMemoryStore().sessionStore(`${brand}:${country}`);
  const client = createStellantisClient({ http, app, session });
  try {
    await client.exchangeCode('probe-fake-code-0000000000');
    ok = false;
    step(`${label}: fake code`, 'ACCEPTED (unexpected)');
  } catch (err) {
    const clean = err.kind === 'code';
    ok &&= clean;
    step(
      `${label}: fake code`,
      clean ? `refused cleanly: ${describe(err)}` : `refused: ${describe(err)}`,
    );
  }
  return ok;
}

async function probeApiWithoutToken() {
  const response = await http.request(`${API_BASE_URL}/connectedcar/v4/user/vehicles`);
  step('API without token', `HTTP ${response.status}`);
  return response.status === 401 || response.status === 403;
}

async function probeAccount(brand, country, pasted) {
  const app = appConfig(brand, country);
  if (!app) throw new Error(`No ${brand} app in ${country}`);
  const code = extractCode(pasted);
  if (!code) throw new Error('No code found in STELLANTIS_CODE');
  const session = createMemoryStore().sessionStore(`${brand}:${country}`);
  const client = createStellantisClient({ http, app, session });
  await client.exchangeCode(code);
  step(
    'Code exchange',
    `OK, token valid ${Math.round((session.get().expiresAt - Date.now()) / 60000)} min`,
  );
  const list = await client.vehicles();
  step('Vehicles', String(list.length));
  for (const [index, raw] of list.entries()) {
    const info = vehicleInfo(raw, app.brandLabel);
    try {
      const snapshot = snapshotOf(await client.status(info.id));
      const present = Object.entries(snapshot)
        .filter(([key, value]) => value !== undefined && !['latitude', 'longitude'].includes(key))
        .map(([key]) => key);
      step(`  car ${index + 1} (${info.motorization})`, present.join(', ') || 'empty status');
    } catch (err) {
      step(`  car ${index + 1} (${info.motorization})`, `status: ${describe(err)}`);
    }
  }
  await client.refresh();
  step('Token renewal', 'OK (refresh token rotated)');
}

const brand = process.env.STELLANTIS_BRAND ?? 'peugeot';
const country = (process.env.STELLANTIS_COUNTRY ?? 'FR').toUpperCase();
try {
  if (process.argv.includes('--url')) {
    const app = appConfig(brand, country);
    if (!app) throw new Error(`No ${brand} app in ${country}`);
    console.log(authorizeUrl(app));
  } else if (process.env.STELLANTIS_CODE) {
    await probeAccount(brand, country, process.env.STELLANTIS_CODE);
  } else {
    const all = process.argv.includes('--all');
    let ok = await probeApiWithoutToken().catch((err) => {
      step('API without token', `failed: ${describe(err)}`);
      return false;
    });
    for (const key of BRAND_KEYS) {
      const countries = all
        ? countriesOf(key)
        : [countriesOf(key).includes('FR') ? 'FR' : countriesOf(key)[0]];
      for (const c of countries) ok = (await probeBrand(key, c)) && ok;
    }
    console.log(ok ? 'All checks passed.' : 'Some checks failed.');
    process.exit(ok ? 0 : 1);
  }
} catch (err) {
  step('Failed', describe(err));
  process.exit(1);
}
