// -----------------------------------------------------------------------------
// The integration's runtime: the cars of the Stellantis account (MyPeugeot,
// MyCitroën, MyDS, MyOpel, MyVauxhall app), read from the cloud on the
// container's own timer and published to Gladys (only what changed, plus a
// heartbeat).
//
// Reads return the state each car last sent to the cloud: they never wake the
// car. A car sends its state when it is switched off, while it charges and
// now and then while parked. One read is one call per car.
//
// Sign-in: "Connect" (an account_link field) opens the brand's sign-in page;
// the user copies the code the page hands to the mobile app and pastes it in
// the "Finish the sign-in" action (src/stellantis/code.js). The tokens then
// live in /data and renew themselves (src/stellantis/client.js); a refused
// renewal is the only thing that asks the user to sign in again.
//
// Remote commands (preconditioning, charge, locks, wake-up) go through a
// separate MQTT service with a one-time-password enrolment: not implemented,
// see README "Limits". Every feature is read-only.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { readPeriodMs } from './config.js';
import { appConfig, authorizeUrl } from './stellantis/apps.js';
import { createHttp } from './stellantis/http.js';
import { createStellantisClient } from './stellantis/client.js';
import { extractCode } from './stellantis/code.js';
import { ERROR_KINDS } from './stellantis/errors.js';
import { ActionFailure, MESSAGES, UserError, failureText, userTextOf } from './messages.js';
import {
  CHARGE_STATUS,
  OPTIONAL_FIELDS,
  buildVehicleDevice,
  capabilitiesOf,
  logLabel,
  snapshotOf,
  totalRangeKm,
  vehicleIds,
  vehicleInfo,
  vehicleName,
  vehicleStates,
} from './devices/vehicle.js';

const MINUTE = 60 * 1000;
const TICK_MS = MINUTE;
const VEHICLE_LIST_REFRESH_MS = 6 * 60 * MINUTE;
const LIST_RETRY_MS = 15 * MINUTE;
const RATE_LIMIT_BACKOFF_MS = 30 * MINUTE;
// Waits after consecutive cloud failures (network, server): the last one repeats.
const OUTAGE_BACKOFF_MS = [MINUTE, 2 * MINUTE, 5 * MINUTE, 10 * MINUTE, 15 * MINUTE];
// A refresh asked by a scene or the widget within a minute of a read reuses it.
const MANUAL_REFRESH_MIN_GAP_MS = MINUTE;
// A value that does not change is sent again twice a day, so Gladys does not
// show it as stale ("no recent value" past 48 h).
const HEARTBEAT_MS = 12 * 60 * MINUTE;
const WIDGET_NUDGE_MIN_INTERVAL_MS = 10 * 1000;

export const WIDGET_KEYS = { VEHICLE: 'vehicle' };
export const SCENE_TRIGGER_KEYS = { CHARGE_FINISHED: 'charge_finished' };

// States that stop every call until the user acts (configuration, sign-in).
const APP_UNAVAILABLE = 'appUnavailable';
const BLOCKING_KINDS = new Set([ERROR_KINDS.NOT_SIGNED_IN, ERROR_KINDS.AUTH]);

/** The real cloud client of an app. */
export function defaultClientFactory(app, session) {
  return createStellantisClient({ http: createHttp(), app, session });
}

const appKeyOf = (config) => `${config.brand}:${config.country}`;

export function createRuntime({
  gladys,
  store,
  logger = createLogger({ name: 'stellantis' }),
  clientFactory = defaultClientFactory,
  now = Date.now,
  timers = true,
}) {
  let config = null;
  let app = null;
  let client = null;
  let ticker = null;
  let blocked = null; // ERROR_KINDS.NOT_SIGNED_IN | ERROR_KINDS.AUTH | APP_UNAVAILABLE
  let lastListAt = 0;
  let lastListAttemptAt = 0;
  let pauseUntil = 0;
  let outages = 0;
  let publishedDevicesJson = null;
  let stopped = false;
  const vehicles = new Map(); // vin → vehicle (see addVehicle)
  const nudges = new Map(); // widget key → { at, timer }
  // Failures already logged: a failure that repeats is logged once at warn
  // level, then at debug level until it recovers.
  const failing = new Set();
  let statusSent = null; // last connection status Gladys accepted (serialized)
  let statusWanted = null; // last connection status asked for: [connected, message]

  // --- Helpers ---------------------------------------------------------------

  const createdDevice = (externalId) =>
    (gladys.devices ?? []).find((device) => device.external_id === externalId);

  function findVehicle(deviceExternalId) {
    for (const vehicle of vehicles.values()) {
      if (vehicleIds(gladys, vehicle.info.vin).device === deviceExternalId) return vehicle;
    }
    return null;
  }

  function requireVehicle(deviceExternalId) {
    const vehicle = findVehicle(deviceExternalId);
    if (!vehicle) throw new UserError(MESSAGES.unknownVehicle);
    return vehicle;
  }

  function requireClient() {
    if (!config) throw new UserError(MESSAGES.starting);
    if (blocked) throw new UserError(MESSAGES[blocked], blocked);
  }

  const seenOf = (vehicle) => new Set(store.vehicle(vehicle.info.vin).seen ?? []);
  const capabilities = (vehicle) => capabilitiesOf(vehicle.info, seenOf(vehicle));
  const vehicleDevice = (vehicle) =>
    buildVehicleDevice(gladys, vehicle.info, capabilities(vehicle), {
      language: config.language,
      gps: config.gps,
    });

  // Send the status only when it changes. Reset when Gladys reconnects.
  async function setStatus(connected, message) {
    statusWanted = [connected, message];
    const key = JSON.stringify([connected, message ?? null]);
    if (key === statusSent) return;
    try {
      await gladys.setConnectionStatus(connected, message);
      statusSent = key;
      logRecovery('status', 'Connection status reported again');
    } catch (err) {
      logFailure('status', `Could not report the connection status: ${err.message}`);
    }
  }

  /** Log a failure once (warn), then at debug level while it repeats. */
  function logFailure(key, line) {
    if (failing.has(key)) {
      logger.debug(line);
      return;
    }
    failing.add(key);
    logger.warn(`${line} (logged once until it recovers)`);
  }

  /** One info line when a logged failure is over. */
  function logRecovery(key, line) {
    if (failing.delete(key)) logger.info(line);
  }

  function nudgeWidget(key) {
    const entry = nudges.get(key) ?? { at: 0, timer: null };
    nudges.set(key, entry);
    if (entry.timer) return;
    const delay = entry.at + WIDGET_NUDGE_MIN_INTERVAL_MS - now();
    const fire = () => {
      entry.timer = null;
      entry.at = now();
      try {
        gladys.requestWidgetRefresh(key);
      } catch (err) {
        logger.debug(`Widget nudge skipped: ${err.message}`);
      }
    };
    if (delay <= 0 || !timers) fire();
    else {
      // Trailing nudge: the last change inside the core's 10 s window still lands.
      entry.timer = setTimeout(fire, delay);
      entry.timer.unref?.();
    }
  }

  // --- Publishing ------------------------------------------------------------

  async function publishDevices({ force = false } = {}) {
    const devices = config
      ? [...vehicles.values()]
          .filter((vehicle) => vehicle.readOnce)
          .map(vehicleDevice)
          .filter((device) => device.features.length > 0)
      : [];
    const json = JSON.stringify(devices);
    if (!force && json === publishedDevicesJson) return;
    await gladys.publishDiscoveredDevices(devices);
    publishedDevicesJson = json;
  }

  /**
   * Publish the states that changed (the SDK remembers what Gladys accepted).
   * A device the user has not created yet gets nothing: Gladys would drop it,
   * and onDeviceCreated sends everything once it exists.
   */
  async function publishVehicle(vehicle, { force = false } = {}) {
    const built = vehicleDevice(vehicle);
    const created = createdDevice(built.external_id);
    if (Array.isArray(gladys.devices) && !created) return;
    if (force) gladys.forgetPublishedStates(built.external_id);
    const present = new Set((created ?? built).features.map((f) => f.external_id));
    const states = vehicleStates(vehicle.snapshot)
      .map(({ key, value, text }) => ({
        device_feature_external_id: `${built.external_id}:${key}`,
        ...(text !== undefined ? { text } : { state: value }),
      }))
      .filter((state) => present.has(state.device_feature_external_id));
    try {
      await gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
      logRecovery('publish', 'Publishing states to Gladys works again');
    } catch (err) {
      // Not remembered by the SDK: the next read sends it again.
      logFailure('publish', `Publishing states failed: ${err.message}`);
    }
  }

  async function publishAll(options) {
    for (const vehicle of vehicles.values()) await publishVehicle(vehicle, options);
  }

  // What the widget shows outside of its device-bound tiles.
  const widgetSignature = (vehicle) => JSON.stringify([vehicle.snapshot, blocked]);

  // --- Snapshots -------------------------------------------------------------

  /**
   * Fire "charge finished": the car reports a finished charge after a charge
   * in progress. A charge stopped, failed or unplugged is no finished charge.
   */
  async function detectChargeFinished(vehicle) {
    const memory = store.vehicle(vehicle.info.vin);
    const before = memory.chargeStatus;
    const after = vehicle.snapshot.chargeStatus;
    if (!after || after === before) return;
    memory.chargeStatus = after;
    store.touch();
    if (before !== CHARGE_STATUS.IN_PROGRESS || after !== CHARGE_STATUS.FINISHED) return;
    const snapshot = vehicle.snapshot;
    const data = { device: vehicleIds(gladys, vehicle.info.vin).device };
    if (Number.isFinite(snapshot.batteryLevel))
      data.battery_level = Math.round(snapshot.batteryLevel);
    if (Number.isFinite(snapshot.electricRangeKm)) {
      data.range_km = Math.round(snapshot.electricRangeKm);
    }
    try {
      await gladys.publishSceneEvent(SCENE_TRIGGER_KEYS.CHARGE_FINISHED, data);
      logger.debug(`${logLabel(vehicle.info)}: charge finished`);
    } catch (err) {
      logger.warn(`Scene event ${SCENE_TRIGGER_KEYS.CHARGE_FINISHED} refused: ${err.message}`);
    }
  }

  async function applySnapshot(vehicle, changes) {
    const before = widgetSignature(vehicle);
    vehicle.snapshot = { ...vehicle.snapshot, ...changes };
    if (!config.gps) {
      delete vehicle.snapshot.latitude;
      delete vehicle.snapshot.longitude;
    }
    await detectChargeFinished(vehicle);
    await publishVehicle(vehicle);
    if (widgetSignature(vehicle) !== before) nudgeWidget(WIDGET_KEYS.VEHICLE);
  }

  // --- Errors ----------------------------------------------------------------

  /** Stop the reads until the user signs in (again). */
  async function block(kind, context, err) {
    if (blocked !== kind) {
      logger.warn(
        `${context}: ${err?.message ?? kind}; no new attempt until the sign-in is done again`,
      );
    }
    blocked = kind;
    await setStatus(false, MESSAGES[kind]);
    nudgeWidget(WIDGET_KEYS.VEHICLE);
  }

  /**
   * Handle a cloud error of a periodic call (`failureKey`: its repeated
   * failures are logged once) or of a user action (no key: logged each time).
   */
  async function handleError(err, context, failureKey = null) {
    if (BLOCKING_KINDS.has(err.kind)) {
      await block(err.kind, context, err);
      return;
    }
    if (err.kind === ERROR_KINDS.RATE_LIMIT) {
      pauseUntil = now() + RATE_LIMIT_BACKOFF_MS;
      logFailure(
        'rate-limit',
        `${context}: the cloud asks to slow down, reads pause for 30 minutes`,
      );
      await setStatus(false, MESSAGES[ERROR_KINDS.RATE_LIMIT]);
      return;
    }
    const line = `${context}: ${err.message}`;
    if (failureKey) logFailure(failureKey, line);
    else logger.warn(line);
    if (err.kind === ERROR_KINDS.NETWORK || err.kind === ERROR_KINDS.SERVER) {
      outages += 1;
      pauseUntil = now() + OUTAGE_BACKOFF_MS[Math.min(outages, OUTAGE_BACKOFF_MS.length) - 1];
      await setStatus(false, MESSAGES.unreachable);
    }
  }

  /** A periodic call worked: end of its logged failure, if any. */
  function cloudAnswered(failureKey, label) {
    outages = 0;
    logRecovery('cloud', 'The Stellantis cloud answers again');
    logRecovery('rate-limit', 'The Stellantis cloud accepts the reads again');
    logRecovery(failureKey, `${label}: works again`);
  }

  // --- Reads -----------------------------------------------------------------

  /** Read a car's status. @throws the cloud error */
  async function readVehicle(vehicle) {
    vehicle.lastReadAt = now();
    const memory = store.vehicle(vehicle.info.vin);
    const seenBefore = JSON.stringify(memory.seen ?? []);
    let changes = {};
    try {
      changes = snapshotOf(await client.status(vehicle.info.id), { readAt: now() });
    } catch (err) {
      // No status yet (a car just added to the account): nothing to read, not an outage.
      if (err.kind !== ERROR_KINDS.NOT_FOUND) throw err;
      logger.debug(`${logLabel(vehicle.info)}: no status in the cloud yet`);
    }
    if (changes.privacy === 'Full' && vehicle.snapshot.privacy !== 'Full') {
      logger.info(`${logLabel(vehicle.info)}: privacy mode on, the car shares no data`);
    } else if (
      vehicle.snapshot.privacy === 'Full' &&
      changes.privacy &&
      changes.privacy !== 'Full'
    ) {
      logger.info(`${logLabel(vehicle.info)}: privacy mode off`);
    }
    const seen = new Set(memory.seen ?? []);
    for (const field of OPTIONAL_FIELDS) if (changes[field] !== undefined) seen.add(field);
    memory.seen = [...seen].sort();
    const seenChanged = JSON.stringify(memory.seen) !== seenBefore;
    if (seenChanged) store.touch();
    const first = !vehicle.readOnce;
    vehicle.readOnce = true;
    if (first || seenChanged) {
      await publishDevices().catch((err) =>
        logger.warn(`Publishing the devices failed: ${err.message}`),
      );
    }
    // A missing field keeps its last value: a car in privacy mode or asleep
    // answers part of its state only.
    const known = Object.fromEntries(
      Object.entries(changes).filter(([, value]) => value !== undefined),
    );
    await applySnapshot(vehicle, known);
    logger.debug(`${logLabel(vehicle.info)}: read`);
  }

  async function safeRead(vehicle) {
    const label = `Reading ${logLabel(vehicle.info)}`;
    const failureKey = `read:${vehicle.info.vin}`;
    try {
      await readVehicle(vehicle);
    } catch (err) {
      // An outage is one failure, whatever the number of cars: one line.
      const outage = err.kind === ERROR_KINDS.NETWORK || err.kind === ERROR_KINDS.SERVER;
      await handleError(err, outage ? 'Reading the cars' : label, outage ? 'cloud' : failureKey);
      return false;
    }
    cloudAnswered(failureKey, label);
    await setStatus(true);
    return true;
  }

  function addVehicle(info) {
    const vehicle = {
      info,
      snapshot: {},
      readOnce: false,
      lastReadAt: 0,
    };
    vehicles.set(info.vin, vehicle);
    return vehicle;
  }

  /** The account's cars; new ones appear in the Discovery screen. */
  async function discover() {
    lastListAttemptAt = now();
    let found;
    try {
      found = (await client.vehicles())
        .filter((raw) => raw?.vin && raw?.id)
        .map((raw) => vehicleInfo(raw, app.brandLabel));
      lastListAt = now();
    } catch (err) {
      await handleError(err, 'Listing the vehicles', 'list');
      return false;
    }
    cloudAnswered('list', 'Listing the vehicles');
    const seen = new Set();
    for (const info of found) {
      if (seen.has(info.vin)) continue;
      seen.add(info.vin);
      const existing = vehicles.get(info.vin);
      if (existing) {
        existing.info = info;
        continue;
      }
      const vehicle = addVehicle(info);
      logger.info(`Vehicle found: ${logLabel(info)} (${info.motorization})`);
      await safeRead(vehicle);
      if (blocked) return false;
    }
    for (const vin of vehicles.keys()) if (!seen.has(vin)) vehicles.delete(vin);
    await publishDevices();
    if (!failing.has('cloud')) await setStatus(true);
    return true;
  }

  /** Keep the session alive when no read renewed it (cloud reads paused). */
  async function keepSessionAlive() {
    try {
      await client.accessToken();
    } catch (err) {
      await handleError(err, 'Renewing the session', 'session');
      return;
    }
    logRecovery('session', 'Renewing the session works again');
  }

  async function tick() {
    if (!client || blocked || stopped) return;
    const t = now();
    if (t < pauseUntil) return;
    const listDue = vehicles.size === 0 || t - lastListAt >= VEHICLE_LIST_REFRESH_MS;
    // An account without a car (or an outage) is listed again every LIST_RETRY_MS.
    if (listDue && t - lastListAttemptAt >= LIST_RETRY_MS) {
      await discover();
      if (blocked || now() < pauseUntil) return;
    }
    const period = readPeriodMs(config);
    for (const vehicle of vehicles.values()) {
      if (blocked || stopped || now() < pauseUntil) return;
      if (t - vehicle.lastReadAt >= period) await safeRead(vehicle);
    }
    if (!blocked && !stopped && now() >= pauseUntil) await keepSessionAlive();
  }

  function startTicker() {
    stopTicker();
    if (!timers) return;
    ticker = setInterval(() => tick().catch((err) => logger.error('Refresh failed', err)), TICK_MS);
    ticker.unref?.();
  }

  function stopTicker() {
    clearInterval(ticker);
    ticker = null;
  }

  // --- Lifecycle -------------------------------------------------------------

  async function stop() {
    stopped = true;
    stopTicker();
    for (const entry of nudges.values()) clearTimeout(entry.timer);
    nudges.clear();
    client = null;
    await store.flush();
  }

  async function start(newConfig) {
    config = newConfig;
    stopped = false;
    blocked = null;
    failing.clear();
    statusSent = null;
    pauseUntil = 0;
    outages = 0;
    lastListAt = 0;
    lastListAttemptAt = 0;
    app = appConfig(config.brand, config.country);
    if (!app) {
      client = null;
      blocked = APP_UNAVAILABLE;
      logger.warn(`No ${config.brand} app in ${config.country}: choose another country`);
      await publishDevices({ force: true });
      await setStatus(false, MESSAGES.appUnavailable);
      return;
    }
    client = clientFactory(app, store.sessionStore(appKeyOf(config)));
    startTicker();
    if (!client.signedIn) {
      blocked = ERROR_KINDS.NOT_SIGNED_IN;
      logger.info(`${app.appName} (${app.country}): waiting for the sign-in`);
      await publishDevices({ force: true });
      await setStatus(false, MESSAGES[ERROR_KINDS.NOT_SIGNED_IN]);
      return;
    }
    if (await discover())
      logger.info(`${app.appName} (${app.country}): ${vehicles.size} vehicle(s)`);
  }

  async function restart(newConfig) {
    await stop();
    vehicles.clear();
    publishedDevicesJson = null;
    gladys.forgetPublishedStates();
    await start(newConfig);
    nudgeWidget(WIDGET_KEYS.VEHICLE);
  }

  function requireConfig() {
    if (!config) throw new ActionFailure(MESSAGES.starting);
    if (!app) throw new ActionFailure(MESSAGES.appUnavailable);
  }

  const vehicleList = () => [...vehicles.values()].map((v) => vehicleName(v.info)).join(', ');

  return {
    start,
    stop,
    tick,

    /** New configuration: another app signs in again, the rest rebuilds the devices. */
    async reconfigure(newConfig) {
      if (!config || appKeyOf(newConfig) !== appKeyOf(config)) {
        await restart(newConfig);
        return;
      }
      config = newConfig;
      await publishDevices();
      for (const vehicle of vehicles.values()) {
        if (!config.gps) {
          // The position is not kept once the user turned it off.
          delete vehicle.snapshot.latitude;
          delete vehicle.snapshot.longitude;
        }
      }
      await publishAll();
      nudgeWidget(WIDGET_KEYS.VEHICLE);
    },

    /** A status set from outside the runtime (failed start). */
    reportStatus(connected, message) {
      return setStatus(connected, message);
    },

    /** (Re)connected to Gladys: devices and every state again. */
    async resync() {
      statusSent = null;
      if (statusWanted) await setStatus(...statusWanted);
      await publishDevices({ force: true });
      await publishAll({ force: true });
      nudgeWidget(WIDGET_KEYS.VEHICLE);
    },

    async scan() {
      if (client && !blocked) await discover();
      else await publishDevices({ force: true });
    },

    /** Gladys created (or updated) a device: its states were dropped until now. */
    async deviceCreated(device) {
      const vehicle = findVehicle(device.external_id);
      if (vehicle) await publishVehicle(vehicle, { force: true });
      nudgeWidget(WIDGET_KEYS.VEHICLE);
    },

    /**
     * The core's poll: a fallback only, no device asks for it (the timer reads
     * the cloud). Never calls the cloud; publishes what changed.
     */
    async poll(device) {
      const vehicle = findVehicle(device.external_id);
      if (vehicle) await publishVehicle(vehicle);
    },

    /** Every feature is read-only: Gladys sends no command. */
    async setValue(device, feature) {
      throw new Error(`${feature?.external_id ?? 'This feature'} is read-only`);
    },

    /** The "Connect" button: the sign-in page of the saved brand and country. */
    signInUrl() {
      if (!config) throw new Error(MESSAGES.starting.en);
      if (!app)
        throw new Error(MESSAGES.appUnavailable[config.language] ?? MESSAGES.appUnavailable.en);
      logger.info(`Sign-in page opened (${app.appName}, ${app.country})`);
      return authorizeUrl(app);
    },

    /** Second step of the sign-in (manifest action): trade the pasted code for tokens. */
    async finishSignIn(pasted) {
      requireConfig();
      const code = extractCode(pasted);
      if (!code) throw new ActionFailure(MESSAGES.codeFormat);
      if (!client) client = clientFactory(app, store.sessionStore(appKeyOf(config)));
      try {
        await client.exchangeCode(code);
      } catch (err) {
        logger.warn(`Sign-in: ${err.message}`);
        throw new ActionFailure(failureText(err));
      }
      logger.info(`Signed in (${app.appName}, ${app.country})`);
      blocked = null;
      failing.clear();
      pauseUntil = 0;
      outages = 0;
      const listed = await discover();
      startTicker();
      if (blocked) throw new ActionFailure(MESSAGES[blocked]);
      if (!listed) throw new ActionFailure(MESSAGES.unreachable);
      if (vehicles.size === 0) return MESSAGES.noVehicle;
      const list = vehicleList();
      return {
        en: `Connected: ${vehicles.size} vehicle(s) (${list}). Add them in the Discovery tab.`,
        fr: `Connecté : ${vehicles.size} véhicule(s) (${list}). Ajoutez-les depuis l’onglet Découverte.`,
        de: `Verbunden: ${vehicles.size} Fahrzeug(e) (${list}). Füge sie im Tab Entdecken hinzu.`,
        es: `Conectado: ${vehicles.size} vehículo(s) (${list}). Añádalos en la pestaña Descubrimiento.`,
      };
    },

    /** Connection test (manifest action): lists the cars, wakes none. */
    async testConnection() {
      requireConfig();
      if (!client || !client.signedIn) {
        throw new ActionFailure(MESSAGES[ERROR_KINDS.NOT_SIGNED_IN]);
      }
      let names;
      try {
        names = (await client.vehicles())
          .filter((raw) => raw?.vin && raw?.id)
          .map((raw) => vehicleName(vehicleInfo(raw, app.brandLabel)));
      } catch (err) {
        logger.warn(`Connection test: ${err.message}`);
        if (BLOCKING_KINDS.has(err.kind)) await block(err.kind, 'Connection test', err);
        throw new ActionFailure(failureText(err));
      }
      if (names.length === 0) return MESSAGES.noVehicle;
      const list = names.join(', ');
      return {
        en: `Connected: ${names.length} vehicle(s) (${list}).`,
        fr: `Connecté : ${names.length} véhicule(s) (${list}).`,
        de: `Verbunden: ${names.length} Fahrzeug(e) (${list}).`,
        es: `Conectado: ${names.length} vehículo(s) (${list}).`,
      };
    },

    /** Sign-out (manifest action): forget the tokens. */
    async signOut() {
      requireConfig();
      await store.clearSession();
      blocked = ERROR_KINDS.NOT_SIGNED_IN;
      logger.info('Signed out: tokens deleted');
      await setStatus(false, MESSAGES[ERROR_KINDS.NOT_SIGNED_IN]);
      nudgeWidget(WIDGET_KEYS.VEHICLE);
      return MESSAGES.signedOut;
    },

    /** Read a car again now (scene action, widget button). Never wakes the car. */
    async refresh(deviceExternalId) {
      const vehicle = requireVehicle(deviceExternalId);
      requireClient();
      if (now() - vehicle.lastReadAt >= MANUAL_REFRESH_MIN_GAP_MS) {
        try {
          await readVehicle(vehicle);
        } catch (err) {
          await handleError(err, `Reading ${logLabel(vehicle.info)}`);
          throw userTextOf(err) ? new UserError(userTextOf(err), err.kind) : err;
        }
      }
      return { ...vehicle.snapshot, totalRangeKm: totalRangeKm(vehicle.snapshot) };
    },

    // Read access for the widget.
    vehicleView(deviceExternalId) {
      const vehicle = findVehicle(deviceExternalId);
      if (!vehicle || !config) return null;
      const device = vehicleDevice(vehicle);
      return {
        device,
        created: createdDevice(device.external_id) ?? null,
        info: vehicle.info,
        caps: capabilities(vehicle),
        snapshot: vehicle.snapshot,
        gps: config.gps,
        issue: blocked ?? (vehicle.snapshot.privacy === 'Full' ? 'privacy' : null),
      };
    },
    get blocked() {
      return blocked;
    },
    // Exposed for the tests.
    _vehicles: vehicles,
  };
}
