// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACTION_KEYS } from '../src/app.js';
import { SCENE_TRIGGER_KEYS as TRIGGERS } from '../src/runtime.js';
import { createSceneActions } from '../src/scenes.js';
import { createWidgets } from '../src/widgets.js';
import { ACCOUNT_LINK_KEY, DEFAULT_CONFIG, REFRESH_CHOICES } from '../src/config.js';
import { BRAND_KEYS, COUNTRY_CODES } from '../src/stellantis/apps.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const SCENE_ACTIONS = createSceneActions({});
const WIDGETS = createWidgets({});
const SCENE_TRIGGER_KEYS = Object.values(TRIGGERS);

const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const field = (key) => manifest.config_schema.find((f) => f.key === key);

// Minimum version of the manifest `gladys_version` range, e.g. [5, 1, 0].
function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) return version[i] > required[i];
  }
  return true;
}

test('every manifest action has a registered handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), Object.values(ACTION_KEYS).sort());
});

test('actions declare no secret field and no default (the core ignores both)', () => {
  // GladysAssistant/Gladys#3154 and #3155: a secret field of an action cannot
  // be filled, and an action applies no default.
  for (const action of manifest.actions) {
    for (const f of action.fields ?? []) {
      assert.notEqual(f.type, 'secret', `${action.key}.${f.key}`);
      assert.equal(f.default, undefined, `${action.key}.${f.key}`);
    }
  }
});

test('the brand and country selects offer exactly what the client knows', () => {
  assert.deepEqual(
    field('brand').options.map((o) => o.value),
    BRAND_KEYS,
  );
  assert.deepEqual(
    field('country')
      .options.map((o) => o.value)
      .sort(),
    COUNTRY_CODES,
  );
  assert.deepEqual(
    field('refresh_minutes').options.map((o) => o.value),
    REFRESH_CHOICES,
  );
});

test('the Connect button is an account_link field, which stores no value', () => {
  const link = field(ACCOUNT_LINK_KEY);
  assert.equal(link.type, 'account_link');
  assert.ok(!(ACCOUNT_LINK_KEY in DEFAULT_CONFIG));
  // Saved before Connect: the brand and the country come first.
  const keys = keysOf(manifest.config_schema);
  assert.ok(keys.indexOf('brand') < keys.indexOf(ACCOUNT_LINK_KEY));
  assert.ok(keys.indexOf('country') < keys.indexOf(ACCOUNT_LINK_KEY));
});

test('number fields have integer bounds and defaults (the form has no step)', () => {
  for (const f of allFields.filter((x) => x.type === 'number')) {
    for (const key of ['min', 'max', 'default']) {
      if (f[key] !== undefined) assert.ok(Number.isInteger(f[key]), `${f.key}.${key}`);
    }
  }
});

test('the manifest describes this integration: name, cloud transport, images', () => {
  assert.equal(manifest.name, 'Peugeot / Citroën / DS / Opel');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-stellantis:/);
  assert.match(manifest.cover_image, /guim31\/gladys-stellantis\/main\/cover\.png$/);
});

test('declaring catalog categories requires Gladys >= 4.86.0', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.ok(isAtLeast(minGladysVersion(), [4, 86, 0]));
});

test('declaring scene triggers, scene actions or widgets requires Gladys >= 5.1.0', () => {
  const declared = ['scene_triggers', 'scene_actions', 'widgets'].filter(
    (f) => manifest[f] !== undefined,
  );
  assert.ok(declared.length > 0, 'the integration declares capability fields');
  assert.ok(isAtLeast(minGladysVersion(), [5, 1, 0]));
});

test('every scene_actions key has an onSceneAction handler, and vice versa', () => {
  const declared = keysOf(manifest.scene_actions);
  for (const key of declared) {
    assert.equal(typeof SCENE_ACTIONS[key], 'function', `scene action "${key}" has no handler`);
  }
  for (const key of Object.keys(SCENE_ACTIONS)) {
    assert.ok(declared.includes(key), `handler "${key}" is not declared in scene_actions`);
  }
});

test('every widgets key has an onWidgetGet handler, and vice versa', () => {
  const declared = keysOf(manifest.widgets);
  for (const key of declared) {
    assert.equal(typeof WIDGETS[key]?.get, 'function', `widget "${key}" has no content handler`);
  }
  for (const key of Object.keys(WIDGETS)) {
    assert.ok(declared.includes(key), `widget "${key}" is not declared in widgets`);
  }
});

test('every scene trigger the code fires is declared in scene_triggers, and vice versa', () => {
  const declared = keysOf(manifest.scene_triggers);
  for (const key of SCENE_TRIGGER_KEYS) assert.ok(declared.includes(key), key);
  for (const key of declared) assert.ok(SCENE_TRIGGER_KEYS.includes(key), key);
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const f of manifest.config_schema) {
    if (f.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[f.key], f.default, `DEFAULT_CONFIG.${f.key}`);
    }
  }
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    assert.ok(field(key), `DEFAULT_CONFIG.${key} is not a manifest field`);
  }
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0, 'the configuration opens with a section block');
  for (const section of sections) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const link of section.links ?? []) assert.match(link.url, /^https:\/\//);
  }
});

test('dynamic selects declare a source and no static options', () => {
  const dynamicSelects = allFields.filter((f) => f.source !== undefined);
  assert.ok(dynamicSelects.length > 0);
  for (const f of dynamicSelects) {
    assert.equal(f.source, 'devices');
    assert.equal(f.options, undefined);
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});

test('field placeholders are multi-language objects', () => {
  const withPlaceholder = allFields.filter((f) => f.placeholder !== undefined);
  assert.ok(withPlaceholder.length > 0);
  for (const f of withPlaceholder) {
    assert.equal(typeof f.placeholder, 'object', `field "${f.key}": placeholder`);
    assert.ok(f.placeholder.en);
  }
});

test('the manifest says the integration is not affiliated with Stellantis', () => {
  const intro = field('intro').description;
  assert.match(intro.en, /Not affiliated with Stellantis/);
  assert.match(intro.en, /Developed without a car: feedback welcome/);
});
