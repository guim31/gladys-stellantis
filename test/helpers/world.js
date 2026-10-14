// -----------------------------------------------------------------------------
// The integration wired like index.js, against the SDK's fake Gladys and the
// fake Stellantis cloud, with a clock the tests move by hand and no timer: the
// tests call `tick()` where the container's timer would.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { createMemoryStore } from '../../src/store.js';
import { createHttp } from '../../src/stellantis/http.js';
import { createStellantisClient } from '../../src/stellantis/client.js';
import { VALID_CODE, createFakeStellantis } from './fakeStellantis.js';

export const MINUTE = 60 * 1000;
export const SELECTOR = 'stellantis';
// 13/10/2026 10:00 UTC.
export const T0 = Date.UTC(2026, 9, 13, 10, 0, 0);

/** A logger that records every line, by level. */
export function recordingLogger() {
  const lines = { debug: [], info: [], warn: [], error: [] };
  const format = (args) =>
    args
      .map((arg) => (arg instanceof Error ? `${arg.message}\n${arg.stack}` : String(arg)))
      .join(' ');
  const logger = {
    lines,
    debug: (...args) => lines.debug.push(format(args)),
    info: (...args) => lines.info.push(format(args)),
    warn: (...args) => lines.warn.push(format(args)),
    error: (...args) => lines.error.push(format(args)),
    child: () => logger,
    all: () => [...lines.debug, ...lines.info, ...lines.warn, ...lines.error],
    clear() {
      for (const level of Object.keys(lines)) lines[level].length = 0;
    },
  };
  return logger;
}

/**
 * @param {object} [options]
 * @param {object} [options.config] configuration overrides
 * @param {boolean} [options.signIn] finish the sign-in after connecting (default true)
 * @param {object} [options.store] a memory store (to restart with the same /data)
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {object} [options.cloud] an existing fake cloud
 * @param {string[]} [options.cars] keep only these VINs in the account
 */
export async function createWorld({
  config = {},
  signIn = true,
  store = createMemoryStore(),
  devices = [],
  cloud,
  cars,
  logger = recordingLogger(),
  start = T0,
} = {}) {
  let clock = start;
  const now = () => clock;
  const stellantis = cloud ?? createFakeStellantis({ now });
  if (cars) {
    stellantis.vehicles = {
      ...stellantis.vehicles,
      _embedded: {
        vehicles: stellantis.vehicles._embedded.vehicles.filter((v) => cars.includes(v.vin)),
      },
    };
  }
  const gladys = createFakeGladys({
    selector: SELECTOR,
    devices,
    config: { brand: 'peugeot', country: 'FR', ...config },
  });
  const http = createHttp({ fetchImpl: stellantis.fetch });
  const runtime = registerHandlers({
    gladys,
    store,
    logger,
    timeZone: 'Europe/Paris',
    runtimeOptions: {
      now,
      timers: false,
      clientFactory: (app, session) => createStellantisClient({ http, app, session, now }),
    },
  });
  const world = {
    gladys,
    fake: gladys.fake,
    stellantis,
    runtime,
    store,
    logger,
    now,
    advance(ms) {
      clock += ms;
    },
    /** Move the clock and run the container's timer once. */
    async tick(ms = MINUTE) {
      clock += ms;
      await runtime.tick();
    },
    device: (vin) => gladys.fake.discoveredDevices.find((d) => d.external_id.endsWith(`:${vin}`)),
    deviceId: (vin) => `ext:${SELECTOR}:vehicle:${vin}`,
    feature: (vin, key) => `ext:${SELECTOR}:vehicle:${vin}:${key}`,
    /** Sign-in as the user does it: the code pasted in the action. */
    finishSignIn: (
      pasted = `mymap://oauth2redirect/fr?code=${VALID_CODE}&scope=openid%20profile`,
    ) => gladys.fake.action('finish_sign_in', { code: pasted }),
    /** The user adds every discovered car to Gladys. */
    async createAll() {
      for (const device of gladys.fake.discoveredDevices) await gladys.fake.deviceCreated(device);
    },
    async create(vin) {
      await gladys.fake.deviceCreated(world.device(vin));
    },
    async stop() {
      await runtime.stop();
    },
  };
  await gladys.connect();
  if (signIn) {
    const ack = await world.finishSignIn();
    if (!ack.success) throw new Error(`sign-in failed: ${JSON.stringify(ack)}`);
  }
  return world;
}
