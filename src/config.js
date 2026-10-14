// -----------------------------------------------------------------------------
// Integration configuration: defaults (they MUST match the `default` values of
// the manifest `config_schema`, see test/manifest.test.js) and normalization,
// so the rest of the code never deals with `undefined` or form strings.
// -----------------------------------------------------------------------------

import { BRAND_KEYS, COUNTRY_CODES } from './stellantis/apps.js';

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Minutes between two reads of the cloud. A read never wakes the car: it
// returns the state the car last sent. Stellantis publishes no quota for the
// app's API; the Home Assistant integration reads every minute by default.
// Ten minutes is the shortest offered here, a car sends its state seldom
// more often than that while parked.
export const REFRESH_CHOICES = ['10', '15', '30', '60'];

// The manifest key of the "Connect" button (an `account_link` field: it
// stores no value).
export const ACCOUNT_LINK_KEY = 'stellantis_account';

export const DEFAULT_CONFIG = {
  brand: 'peugeot',
  country: 'FR',
  language: 'fr',
  refresh_minutes: '15',
  gps: false,
};

const choice = (value, choices, fallback) =>
  choices.includes(String(value)) ? String(value) : fallback;

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const config = { ...DEFAULT_CONFIG, ...(raw ?? {}) };
  return {
    brand: choice(config.brand, BRAND_KEYS, DEFAULT_CONFIG.brand),
    country: choice(
      String(config.country ?? '').toUpperCase(),
      COUNTRY_CODES,
      DEFAULT_CONFIG.country,
    ),
    language: choice(config.language, LANGUAGES, DEFAULT_CONFIG.language),
    refresh_minutes: choice(
      config.refresh_minutes,
      REFRESH_CHOICES,
      DEFAULT_CONFIG.refresh_minutes,
    ),
    gps: config.gps === true || config.gps === 'true',
  };
}

/** Period of the reads, in milliseconds. */
export const readPeriodMs = (config) => Number(config.refresh_minutes) * 60 * 1000;
