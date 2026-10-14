// -----------------------------------------------------------------------------
// The runtime, wired like index.js against the SDK's fake Gladys and the fake
// Stellantis cloud: sign-in, the container's own refresh timer (no onPoll),
// states only on change plus a heartbeat, the session kept alive, the quiet
// logs, the trigger, the scene action, the widget.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createMemoryStore } from '../src/store.js';
import { MESSAGES } from '../src/messages.js';
import { ERROR_KINDS } from '../src/stellantis/errors.js';
import { MINUTE, T0, createWorld } from './helpers/world.js';
import { VALID_CODE, VINS, createFakeStellantis } from './helpers/fakeStellantis.js';

const HOUR = 60 * MINUTE;
const statesOf = (world, vin, key) =>
  world.fake.states.filter((s) => s.device_feature_external_id === world.feature(vin, key));

test('before the sign-in: a clear status, no call to the cloud, nothing discovered', async () => {
  const world = await createWorld({ signIn: false });
  try {
    assert.deepEqual(world.fake.connectionStatus, {
      connected: false,
      message: MESSAGES[ERROR_KINDS.NOT_SIGNED_IN],
    });
    assert.deepEqual(world.fake.discoveredDevices, []);
    await world.tick(30 * MINUTE);
    assert.equal(world.stellantis.calls.length, 0);
  } finally {
    await world.stop();
  }
});

test('"Connect" opens the sign-in page of the saved brand and country', async () => {
  const world = await createWorld({ signIn: false, config: { brand: 'opel', country: 'DE' } });
  try {
    const ack = await world.fake.oauthAuthorizeUrl('stellantis_account');
    assert.equal(ack.success, true);
    const url = new URL(ack.data.authorize_url);
    assert.equal(url.host, 'idpcvs.opel.com');
    assert.equal(url.searchParams.get('redirect_uri'), 'mymopsdk://oauth2redirect/de');
  } finally {
    await world.stop();
  }
});

test('an app that does not exist in the country is said, not tried', async () => {
  const world = await createWorld({ signIn: false, config: { brand: 'vauxhall', country: 'FR' } });
  try {
    assert.deepEqual(world.fake.connectionStatus, {
      connected: false,
      message: MESSAGES.appUnavailable,
    });
    const ack = await world.fake.oauthAuthorizeUrl('stellantis_account');
    assert.equal(ack.success, false);
    const action = await world.finishSignIn();
    assert.equal(action.success, false);
    assert.equal(world.stellantis.calls.length, 0);
  } finally {
    await world.stop();
  }
});

test('the sign-in: pasted address → tokens in /data → cars in Discovery', async () => {
  const world = await createWorld({ signIn: false });
  try {
    const bad = await world.finishSignIn('nothing useful here');
    assert.equal(bad.success, false);
    assert.deepEqual(bad.error, MESSAGES.codeFormat);
    const refused = await world.finishSignIn('mymap://oauth2redirect/fr?code=expired-code-000');
    assert.equal(refused.success, false);
    assert.deepEqual(refused.error, MESSAGES[ERROR_KINDS.CODE]);

    const ack = await world.finishSignIn();
    assert.equal(ack.success, true);
    assert.match(ack.data.message.fr, /^Connecté : 3 véhicule\(s\) \(Peugeot e-208 \(…0208\)/);
    assert.equal(world.store.data.session.refreshToken, 'refresh-1');
    assert.equal(world.store.data.session.app, 'peugeot:FR');
    assert.equal(world.fake.discoveredDevices.length, 3);
    assert.deepEqual(world.fake.connectionStatus, { connected: true });
  } finally {
    await world.stop();
  }
});

test('a restart reuses the stored session: no new sign-in', async () => {
  const store = createMemoryStore();
  const first = await createWorld({ store });
  await first.stop();
  const cloud = first.stellantis;
  const second = await createWorld({ store, cloud, signIn: false });
  try {
    assert.deepEqual(second.fake.connectionStatus, { connected: true });
    assert.equal(second.fake.discoveredDevices.length, 3);
  } finally {
    await second.stop();
  }
});

test('another brand or country drops the session of the previous one', async () => {
  const world = await createWorld();
  try {
    await world.fake.configUpdated({ brand: 'citroen', country: 'FR' });
    assert.equal(world.store.data.session.refreshToken, undefined);
    assert.deepEqual(world.fake.connectionStatus, {
      connected: false,
      message: MESSAGES[ERROR_KINDS.NOT_SIGNED_IN],
    });
  } finally {
    await world.stop();
  }
});

test('the states refresh on the container timer, without onPoll', async () => {
  const world = await createWorld();
  try {
    await world.createAll();
    const reads = () => world.stellantis.callsTo('status').length;
    const before = reads();
    // Nothing is due before the period (15 minutes by default).
    await world.tick(10 * MINUTE);
    assert.equal(reads(), before);
    world.stellantis.status(VINS.ELECTRIC).energies[0].level = 61;
    await world.tick(5 * MINUTE);
    assert.equal(reads(), before + 3, 'one read per car');
    assert.equal(world.fake.lastState(world.feature(VINS.ELECTRIC, 'battery-level')), 61);
    // No device asks the core to poll it.
    assert.ok(world.fake.discoveredDevices.every((d) => d.should_poll === false));
    assert.equal(world.fake.requests.filter((r) => r.path.includes('poll')).length, 0);
  } finally {
    await world.stop();
  }
});

test('the configured period is followed', async () => {
  const world = await createWorld({ config: { refresh_minutes: '60' } });
  try {
    const reads = () => world.stellantis.callsTo('status').length;
    const before = reads();
    for (let i = 0; i < 59; i += 1) await world.tick(MINUTE);
    assert.equal(reads(), before);
    await world.tick(MINUTE);
    assert.equal(reads(), before + 3);
  } finally {
    await world.stop();
  }
});

test('only the changes are published, plus a heartbeat every 12 hours', async (t) => {
  // The SDK dates its heartbeat with Date.now: it follows the test clock.
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const world = await createWorld();
  const tick = async (ms) => {
    t.mock.timers.tick(ms);
    await world.tick(ms);
  };
  try {
    await world.createAll();
    const count = () => statesOf(world, VINS.HYBRID, 'odometer').length;
    assert.equal(count(), 1);
    for (let i = 0; i < 4; i += 1) await tick(15 * MINUTE);
    assert.equal(count(), 1, 'an unchanged value is not sent again');
    for (let i = 0; i < 48; i += 1) await tick(15 * MINUTE);
    assert.ok(count() >= 2, 'the heartbeat sends it again within 12 hours');
    assert.ok(count() <= 3);
  } finally {
    await world.stop();
  }
});

test('a device added later gets every state at once, and the widget is nudged', async () => {
  const world = await createWorld();
  try {
    assert.equal(world.fake.states.length, 0, 'nothing is sent before the device exists');
    await world.create(VINS.ELECTRIC);
    assert.equal(world.fake.lastState(world.feature(VINS.ELECTRIC, 'battery-level')), 54);
    assert.ok(world.fake.widgetRefreshes.includes('vehicle'));
    // The onPoll fallback publishes, never calls the cloud.
    const calls = world.stellantis.calls.length;
    const ack = await world.fake.poll(world.device(VINS.ELECTRIC));
    assert.equal(ack.success, true);
    assert.equal(world.stellantis.calls.length, calls);
  } finally {
    await world.stop();
  }
});

test('the session renews itself for days, without the user', async () => {
  const world = await createWorld();
  try {
    for (let i = 0; i < 4 * 24 * 7; i += 1) await world.tick(15 * MINUTE);
    assert.equal(world.runtime.blocked, null);
    assert.deepEqual(world.fake.connectionStatus, { connected: true });
    const renewals = world.stellantis.callsTo('token').length - 1;
    // About one renewal an hour, never a burst.
    assert.ok(renewals >= 7 * 24 - 2 && renewals <= 7 * 24 + 2, `${renewals} renewals`);
    assert.equal(world.store.data.session.refreshToken, `refresh-${renewals + 1}`);
  } finally {
    await world.stop();
  }
});

test('a refused renewal asks to sign in again, and stops the calls', async () => {
  const world = await createWorld();
  try {
    await world.createAll();
    world.stellantis.validRefresh.clear();
    await world.tick(2 * HOUR);
    assert.equal(world.runtime.blocked, ERROR_KINDS.AUTH);
    assert.deepEqual(world.fake.connectionStatus, {
      connected: false,
      message: MESSAGES[ERROR_KINDS.AUTH],
    });
    const calls = world.stellantis.calls.length;
    await world.tick(2 * HOUR);
    assert.equal(world.stellantis.calls.length, calls);
    // The widget says it.
    const ack = await world.fake.widgetGet('vehicle', {
      settings: { device: world.deviceId(VINS.ELECTRIC) },
    });
    const rows = ack.data.content.components.find((c) => c.type === 'status').items;
    assert.ok(rows.some((row) => row.color === 'danger'));
    // Signing in again resumes everything.
    const again = await world.finishSignIn();
    assert.equal(again.success, true);
    assert.equal(world.runtime.blocked, null);
    assert.deepEqual(world.fake.connectionStatus, { connected: true });
  } finally {
    await world.stop();
  }
});

test('an outage: one line when it starts, one when it ends, backed-off retries', async () => {
  const world = await createWorld();
  try {
    world.logger.clear();
    world.stellantis.fail('status', 'network', {}, 50);
    const before = world.stellantis.callsTo('status').length;
    for (let i = 0; i < 60; i += 1) await world.tick(MINUTE);
    const attempts = world.stellantis.callsTo('status').length - before;
    assert.ok(attempts < 15, `${attempts} attempts in an hour`);
    assert.equal(world.logger.lines.warn.length, 1, world.logger.lines.warn.join('\n'));
    assert.match(world.logger.lines.warn[0], /unreachable/);
    assert.deepEqual(world.fake.connectionStatus, {
      connected: false,
      message: MESSAGES.unreachable,
    });
    world.stellantis.failures.status.length = 0;
    for (let i = 0; i < 20; i += 1) await world.tick(MINUTE);
    assert.ok(world.logger.lines.info.some((line) => /answers again/.test(line)));
    assert.deepEqual(world.fake.connectionStatus, { connected: true });
    assert.equal(world.logger.lines.warn.length, 1);
  } finally {
    await world.stop();
  }
});

test('a normal cycle writes nothing at info level, and no secret ever reaches the logs', async () => {
  const world = await createWorld({ config: { gps: true } });
  try {
    await world.createAll();
    world.logger.clear();
    for (let i = 0; i < 4 * 6; i += 1) await world.tick(15 * MINUTE);
    assert.deepEqual(world.logger.lines.info, []);
    assert.deepEqual(world.logger.lines.warn, []);
    assert.ok(world.logger.lines.debug.length > 0, 'the cycle is visible with LOG_LEVEL=debug');

    // Everything logged since the start: no token, code, client secret, full
    // VIN or position.
    await world.fake.action('test_connection');
    await world.fake.action('sign_out');
    const text = world.logger.all().join('\n');
    const secrets = [
      VALID_CODE,
      world.store.data.session.accessToken,
      'access-1',
      'refresh-1',
      'refresh-2',
      ...Object.values(VINS),
      '48.85661',
      world.stellantis.callsTo('token')[0].headers.Authorization.slice(6),
    ].filter(Boolean);
    for (const secret of secrets) assert.ok(!text.includes(secret), `"${secret}" is in the logs`);
  } finally {
    await world.stop();
  }
});

test('"charge finished" fires once, at the end of a charge in progress', async () => {
  const world = await createWorld();
  try {
    await world.createAll();
    const status = world.stellantis.status(VINS.ELECTRIC);
    const charging = status.energies[0].extension.electric.charging;
    await world.tick(15 * MINUTE);
    assert.equal(world.fake.sceneEvents.length, 0);
    charging.status = 'Finished';
    charging.remainingTime = 'PT0S';
    status.energies[0].level = 100;
    status.energies[0].autonomy = 340;
    await world.tick(15 * MINUTE);
    assert.deepEqual(world.fake.sceneEvents, [
      {
        key: 'charge_finished',
        data: { device: world.deviceId(VINS.ELECTRIC), battery_level: 100, range_km: 340 },
      },
    ]);
    await world.tick(15 * MINUTE);
    assert.equal(world.fake.sceneEvents.length, 1);
    // The hybrid was already finished at the first read: nothing.
    assert.ok(world.fake.sceneEvents.every((e) => e.data.device.endsWith(VINS.ELECTRIC)));
    // A charge stopped is no finished charge.
    charging.status = 'InProgress';
    await world.tick(15 * MINUTE);
    charging.status = 'Stopped';
    await world.tick(15 * MINUTE);
    assert.equal(world.fake.sceneEvents.length, 1);
  } finally {
    await world.stop();
  }
});

test('the charge in progress survives a restart for the trigger', async () => {
  const store = createMemoryStore();
  const first = await createWorld({ store });
  await first.stop();
  const cloud = first.stellantis;
  cloud.status(VINS.ELECTRIC).energies[0].extension.electric.charging.status = 'Finished';
  const second = await createWorld({ store, cloud, signIn: false });
  try {
    assert.equal(second.fake.sceneEvents.length, 1);
  } finally {
    await second.stop();
  }
});

test('the scene action reads the car now and gives its values', async () => {
  const world = await createWorld();
  try {
    world.stellantis.status(VINS.HYBRID).energies[1].level = 80;
    world.advance(2 * MINUTE);
    const ack = await world.fake.sceneAction('refresh_vehicle', {
      device: world.deviceId(VINS.HYBRID),
    });
    assert.equal(ack.success, true);
    assert.deepEqual(ack.data.outputs, {
      battery_level: 80,
      fuel_level: 63,
      range_km: 462,
      plugged: true,
      charging: false,
      locked: false,
    });
    const unknown = await world.fake.sceneAction('refresh_vehicle', { device: 'ext:other:1' });
    assert.equal(unknown.success, false);
  } finally {
    await world.stop();
  }
});

test('the widget: valid content for every car, the refresh button', async () => {
  const world = await createWorld({ config: { gps: true } });
  try {
    for (const vin of Object.values(VINS)) {
      for (const created of [false, true]) {
        if (created) await world.create(vin);
        const ack = await world.fake.widgetGet('vehicle', {
          settings: { device: world.deviceId(vin) },
          language: 'de',
        });
        const content = ack.data.content;
        assert.doesNotThrow(() => validateWidgetContent(content), vin);
        assert.ok(content.components.length <= 8);
        // Tiles bound only to features the device has.
        const device = world.device(vin);
        for (const c of content.components.filter((x) => x.device_feature)) {
          assert.ok(
            device.features.some((f) => f.external_id === c.device_feature),
            c.device_feature,
          );
        }
        assert.ok(content.components.some((c) => c.action?.key === 'refresh'));
      }
    }
    world.advance(2 * MINUTE);
    const ack = await world.fake.widgetAction(
      'vehicle',
      'refresh',
      {},
      {
        settings: { device: world.deviceId(VINS.ELECTRIC) },
      },
    );
    assert.equal(ack.success, true);
    const none = await world.fake.widgetGet('vehicle', { settings: {} });
    assert.equal(none.data.content.components[0].type, 'text');
  } finally {
    await world.stop();
  }
});

test('the GPS position goes away when the user turns it off', async () => {
  const world = await createWorld({ config: { gps: true } });
  try {
    await world.createAll();
    assert.ok(statesOf(world, VINS.ELECTRIC, 'position').length === 1);
    await world.fake.configUpdated({ brand: 'peugeot', country: 'FR', gps: false });
    assert.ok(
      !world.fake.discoveredDevices.some((d) =>
        d.features.some((f) => f.external_id.endsWith(':position')),
      ),
    );
    assert.equal(world.runtime._vehicles.get(VINS.ELECTRIC).snapshot.latitude, undefined);
    // The session was kept: same app.
    assert.deepEqual(world.fake.connectionStatus, { connected: true });
  } finally {
    await world.stop();
  }
});

test('sign-out deletes the tokens and stops the reads', async () => {
  const world = await createWorld();
  try {
    const ack = await world.fake.action('sign_out');
    assert.equal(ack.success, true);
    assert.equal(world.store.data.session.refreshToken, undefined);
    const calls = world.stellantis.calls.length;
    await world.tick(HOUR);
    assert.equal(world.stellantis.calls.length, calls);
    const test = await world.fake.action('test_connection');
    assert.equal(test.success, false);
  } finally {
    await world.stop();
  }
});

test('a car with no status yet is still discovered, and read later', async () => {
  const cloud = createFakeStellantis();
  const status = cloud.status(VINS.THERMIC);
  delete cloud.statuses[cloud.idOf(VINS.THERMIC)];
  const world = await createWorld({ cloud });
  try {
    // Nothing known of it yet: no empty device in Discovery.
    assert.equal(world.device(VINS.THERMIC), undefined);
    assert.deepEqual(world.fake.connectionStatus, { connected: true });
    assert.deepEqual(world.logger.lines.warn, []);
    cloud.statuses[cloud.idOf(VINS.THERMIC)] = status;
    await world.tick(15 * MINUTE);
    assert.ok(
      world.device(VINS.THERMIC).features.some((f) => f.external_id.endsWith(':fuel-level')),
    );
  } finally {
    await world.stop();
  }
});

test('the cloud asking to slow down pauses the reads for 30 minutes', async () => {
  const world = await createWorld();
  try {
    world.stellantis.fail('status', 429);
    await world.tick(15 * MINUTE);
    const calls = world.stellantis.callsTo('status').length;
    for (let i = 0; i < 29; i += 1) await world.tick(MINUTE);
    assert.equal(world.stellantis.callsTo('status').length, calls);
    await world.tick(MINUTE);
    assert.ok(world.stellantis.callsTo('status').length > calls);
  } finally {
    await world.stop();
  }
});

test('every feature is read-only: a command is refused', async () => {
  const world = await createWorld();
  try {
    await world.createAll();
    const device = world.device(VINS.ELECTRIC);
    assert.ok(device.features.every((f) => f.read_only === true));
    const ack = await world.fake.setValue(device, device.features[0], 1);
    assert.equal(ack.success, false);
  } finally {
    await world.stop();
  }
});
