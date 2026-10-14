// -----------------------------------------------------------------------------
// Configuration normalization and the /data file.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, normalizeConfig, readPeriodMs } from '../src/config.js';
import { createStore } from '../src/store.js';

test('the defaults fill what the form left out, unknown values fall back', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
  const config = normalizeConfig({
    brand: 'nope',
    country: 'gb',
    language: 'it',
    refresh_minutes: 30,
    gps: 'true',
  });
  assert.equal(config.brand, 'peugeot');
  assert.equal(config.country, 'GB');
  assert.equal(config.language, 'fr');
  assert.equal(config.refresh_minutes, '30');
  assert.equal(config.gps, true);
  assert.equal(normalizeConfig({ refresh_minutes: '1' }).refresh_minutes, '15');
  assert.equal(readPeriodMs(normalizeConfig({ refresh_minutes: '10' })), 10 * 60 * 1000);
});

test('the session is written to /data with mode 0600, and read back', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stellantis-'));
  try {
    const store = createStore({ dir });
    await store.load();
    const session = store.sessionStore('peugeot:FR');
    session.set({ accessToken: 'a', refreshToken: 'r', expiresAt: 1 });
    await store.flush();
    const file = join(dir, 'stellantis.json');
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).session.refreshToken, 'r');

    const again = createStore({ dir });
    await again.load();
    assert.equal(again.sessionStore('peugeot:FR').get().refreshToken, 'r');
    // Another app: the tokens of the first one are dropped.
    assert.equal(again.sessionStore('opel:DE').get().refreshToken, undefined);
    await again.clearSession();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an unreadable file is ignored, not fatal', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stellantis-'));
  try {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'stellantis.json'), '{not json');
    const warnings = [];
    const store = createStore({ dir, logger: { warn: (line) => warnings.push(line) } });
    const data = await store.load();
    assert.deepEqual(data.session, {});
    assert.equal(warnings.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
