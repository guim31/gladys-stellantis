// -----------------------------------------------------------------------------
// The mobile apps of the Stellantis brands (MyPeugeot, MyCitroën, MyDS, MyOpel,
// MyVauxhall) and the OAuth2 settings of each one, per country.
//
// Stellantis gives no API credentials to private persons: like the Home
// Assistant integration andreadegiovine/homeassistant-stellantis-vehicles
// (MIT), this integration signs in as the brand's mobile app. apps.json is
// derived from that project's configs.json (the public identifiers shipped in
// the apps, extracted by its configs_updater). One brand, one sign-in server
// and one "realm"; the client id and secret depend on the country.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const APPS = JSON.parse(readFileSync(new URL('./apps.json', import.meta.url), 'utf8'));

/** Brand keys of the configuration, in the order of the manifest select. */
export const BRAND_KEYS = Object.keys(APPS);

/** Every country where at least one of the apps exists (ISO 3166 codes). */
export const COUNTRY_CODES = [
  ...new Set(BRAND_KEYS.flatMap((brand) => Object.keys(APPS[brand].countries))),
].sort();

/** Display name of a brand ("Citroën"). */
export const brandLabel = (brand) => APPS[brand]?.brand ?? brand;

/** Name of the brand's mobile app ("MyCitroen"). */
export const appName = (brand) => APPS[brand]?.app ?? brand;

/** The countries an app exists in. */
export const countriesOf = (brand) => Object.keys(APPS[brand]?.countries ?? {});

/**
 * The OAuth2 settings of one app in one country, `null` when the app does
 * not exist there (Vauxhall outside the United Kingdom, Opel inside it...).
 * @param {string} brand e.g. "peugeot"
 * @param {string} country e.g. "FR"
 */
export function appConfig(brand, country) {
  const app = APPS[brand];
  const entry = app?.countries?.[country];
  if (!entry) return null;
  const client = app.clients[entry.client];
  return {
    brand,
    brandLabel: app.brand,
    appName: app.app,
    country,
    oauthUrl: app.oauth_url,
    realm: app.realm,
    locale: entry.locale,
    clientId: client.client_id,
    clientSecret: client.client_secret,
    // Where the app expects the sign-in page to send the code: a scheme only
    // the app opens. A browser cannot follow it, which is why the user copies
    // the code (src/stellantis/code.js).
    redirectUri: `${app.scheme}://oauth2redirect/${country.toLowerCase()}`,
  };
}

/** The sign-in page of the brand, where the user enters the app's e-mail and password. */
export function authorizeUrl(app) {
  const query = new URLSearchParams({
    client_id: app.clientId,
    response_type: 'code',
    redirect_uri: app.redirectUri,
    scope: 'openid profile email',
    locale: app.locale,
  });
  // As the app sends them: %20 between the scopes, the redirect address as is.
  const search = query.toString().replace(/\+/g, '%20').replace(/%3A/gi, ':').replace(/%2F/gi, '/');
  return `${app.oauthUrl}/am/oauth2/authorize?${search}`;
}
