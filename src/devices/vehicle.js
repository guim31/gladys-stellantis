// -----------------------------------------------------------------------------
// Device type: STELLANTIS VEHICLE (Peugeot, Citroën, DS, Opel, Vauxhall).
//
// One Gladys device per car, keyed on the VIN (it never changes, unlike the
// account the car is linked to or the API id). The VIN never appears in a
// device name or a log line: only its last four characters.
//
// The status endpoint gives everything in one answer; it is folded into one
// canonical snapshot (km, °C, minutes), from which the states are derived. The
// field paths are those of andreadegiovine/homeassistant-stellantis-vehicles
// (MIT, const.py) and of the Connected Car v4 schema: the API answers either
// `energies` with an `extension.electric.charging` block (current apps) or
// `energy` with a `charging` block (older answers); both are read.
//
// Which features a car gets depends on its motorization (electric, plug-in
// hybrid, combustion) and, for the optional values, on what its answers
// contained: a value seen once keeps its feature (src/store.js).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { t } from '../i18n.js';

export const VEHICLE_DEVICE_TYPE = 'vehicle';

// Feature keys: part of the external_id, frozen once published.
export const VEHICLE_FEATURES = {
  BATTERY_LEVEL: 'battery-level',
  ELECTRIC_RANGE: 'electric-range',
  FUEL_LEVEL: 'fuel-level',
  FUEL_RANGE: 'fuel-range',
  TOTAL_RANGE: 'total-range',
  ODOMETER: 'odometer',
  CHARGING_STATE: 'charging-state',
  PLUGGED: 'plugged',
  CHARGING: 'charging',
  CHARGING_RATE: 'charging-rate',
  CHARGE_TIME_REMAINING: 'charge-time-remaining',
  LOCKED: 'locked',
  DOOR_OPEN: 'door-open',
  PRECONDITIONING: 'preconditioning',
  OUTSIDE_TEMPERATURE: 'outside-temperature',
  POSITION: 'position',
};

// Charge session states, the Gladys `charging-station/charging-state` enum
// (OCPP values, translated by the Gladys front).
export const CHARGING_STATION_STATE = {
  CHARGING: 0,
  EV_CONNECTED: 1,
  PAUSED_BY_VEHICLE: 2,
  PAUSED_BY_CHARGER: 3,
  IDLE: 4,
  DISCHARGING: 5,
};

// `charging.status` of the API (ChargingStatusEnum of the Connected Car v4 schema).
export const CHARGE_STATUS = {
  DISCONNECTED: 'Disconnected',
  IN_PROGRESS: 'InProgress',
  FAILURE: 'Failure',
  STOPPED: 'Stopped',
  FINISHED: 'Finished',
};

export const MOTORIZATIONS = {
  ELECTRIC: 'electric',
  HYBRID: 'hybrid',
  THERMIC: 'thermic',
  UNKNOWN: 'unknown',
};

export function vehicleIds(gladys, vin) {
  return gladys.externalIds(VEHICLE_DEVICE_TYPE, vin);
}

// --- The car ------------------------------------------------------------------

/** "PEUGEOT" → "Peugeot", "3008 HYBRID4" → "3008 Hybrid4"; "e-208", "DS", "C5" stay. */
function tidy(text) {
  return String(text ?? '')
    .trim()
    .replace(/\S+/g, (word) =>
      word.length > 2 && word === word.toUpperCase() && /\p{Lu}/u.test(word)
        ? word.charAt(0) + word.slice(1).toLowerCase()
        : word,
    );
}

/** The motorization of an entry of the vehicle list. */
export function motorizationOf(raw) {
  const declared = String(raw?.motorization ?? '').toLowerCase();
  if (declared === 'electric' || declared === 'hydrogen') return MOTORIZATIONS.ELECTRIC;
  if (declared === 'hybrid') return MOTORIZATIONS.HYBRID;
  if (declared === 'thermic') return MOTORIZATIONS.THERMIC;
  // The schema's `engine` list: [{ class: "Electric" | "Thermic", energy }].
  const classes = new Set(
    (Array.isArray(raw?.engine) ? raw.engine : []).map((e) => String(e?.class ?? '').toLowerCase()),
  );
  if (classes.has('electric') && classes.has('thermic')) return MOTORIZATIONS.HYBRID;
  if (classes.has('electric')) return MOTORIZATIONS.ELECTRIC;
  if (classes.has('thermic')) return MOTORIZATIONS.THERMIC;
  return MOTORIZATIONS.UNKNOWN;
}

/**
 * What the integration needs of an entry of the vehicle list.
 * @param {object} raw entry of `_embedded.vehicles`
 * @param {string} fallbackBrand brand label of the configured app
 */
export function vehicleInfo(raw, fallbackBrand) {
  return {
    id: String(raw.id),
    vin: String(raw.vin),
    brand: tidy(raw.brand) || fallbackBrand,
    label: tidy(raw.label),
    motorization: motorizationOf(raw),
  };
}

/** "…1234": the only part of the VIN shown anywhere. */
export const shortVin = (vin) => `…${String(vin).slice(-4)}`;

/** "Peugeot e-208", "Opel Corsa-e", "DS" (no label). */
function modelName(info) {
  if (!info.label) return info.brand;
  return info.label.toLowerCase().startsWith(info.brand.toLowerCase())
    ? info.label
    : `${info.brand} ${info.label}`;
}

/** "Peugeot e-208 (…1234)": two cars of the same model stay apart. */
export const vehicleName = (info) => `${modelName(info)} (${shortVin(info.vin)})`;

/** A label for the logs: the model and the end of the VIN. */
export const logLabel = (info) => vehicleName(info);

// --- Reading -------------------------------------------------------------------

const num = (value) => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    return undefined;
  }
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
};
const time = (value) => {
  const ms = Date.parse(String(value ?? ''));
  return Number.isFinite(ms) ? ms : undefined;
};
const bool = (value) => (typeof value === 'boolean' ? value : undefined);
const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

/** Minutes of an ISO 8601 duration ("PT1H30M" → 90), undefined when unreadable. */
export function durationMinutes(value) {
  const match = String(value ?? '').match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/,
  );
  if (!match || value === 'P' || value === 'PT') return undefined;
  const [, d = 0, h = 0, m = 0, s = 0] = match;
  return Number(d) * 1440 + Number(h) * 60 + Number(m) + Math.round(Number(s) / 60);
}

const energyList = (status) => {
  const list = Array.isArray(status.energies) ? status.energies : status.energy;
  return Array.isArray(list) ? list : [];
};
const energyOf = (status, type) =>
  energyList(status).find((e) => String(e?.type ?? '').toLowerCase() === type) ?? null;

// Lock states that leave at least one door open to anyone.
const UNLOCKED_STATES = new Set([
  'unlocked',
  'driverdoorunlocked',
  'cabindoorsunlocked',
  'cargodoorsunlocked',
  'reardoorsunlocked',
]);
const LOCKED_STATES = new Set(['locked', 'superlocked']);

function lockedOf(doors) {
  const raw = doors?.lockedStates ?? doors?.lockedState;
  const states = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((s) => String(s).toLowerCase());
  if (states.length === 0) return undefined;
  if (states.some((s) => UNLOCKED_STATES.has(s))) return false;
  if (states.some((s) => LOCKED_STATES.has(s))) return true;
  return undefined;
}

function doorOpenOf(doors) {
  const openings = Array.isArray(doors?.opening) ? doors.opening : [];
  const known = openings
    .map((o) => String(o?.state ?? '').toLowerCase())
    .filter((s) => s === 'open' || s === 'closed');
  return known.length === 0 ? undefined : known.includes('open');
}

/**
 * The canonical snapshot of a status answer. Every field is set (undefined
 * when absent), so a value the car stopped sending is cleared.
 * @param {object} status the status answer
 * @param {{ readAt: number }} context when it was read (for the charge end)
 */
export function snapshotOf(status = {}, { readAt = Date.now() } = {}) {
  const s = status ?? {};
  const electric = energyOf(s, 'electric');
  const fuel = energyOf(s, 'fuel');
  const charging = electric?.extension?.electric?.charging ?? electric?.charging ?? null;

  let batteryLevel = num(electric?.level);
  let electricRangeKm = num(electric?.autonomy);
  // A sleeping car sometimes answers a full battery with no range: an
  // artefact, not a reading (Home Assistant integration, PR #476).
  if (batteryLevel !== undefined && batteryLevel > 90 && electricRangeKm === 0) {
    batteryLevel = undefined;
    electricRangeKm = undefined;
  }
  const fuelLevel = num(fuel?.level);
  const fuelRangeKm = num(fuel?.autonomy);
  const chargeStatus = text(charging?.status);
  const plugged = bool(charging?.plugged);
  const energyUpdatedAt = time(electric?.updatedAt ?? electric?.createdAt);
  const remaining = durationMinutes(charging?.remainingTime);
  const isCharging = chargeStatus ? chargeStatus === CHARGE_STATUS.IN_PROGRESS : undefined;
  const odometer = num(s.odometer?.mileage);
  const air = s.environment?.air;
  const precond = (s.preconditioning ?? s.preconditionning)?.airConditioning;
  const precondStatus = text(precond?.status)?.toLowerCase();
  const coordinates = s.lastPosition?.geometry?.coordinates;
  const longitude = Array.isArray(coordinates) ? num(coordinates[0]) : undefined;
  const latitude = Array.isArray(coordinates) ? num(coordinates[1]) : undefined;
  const validPosition =
    latitude !== undefined &&
    longitude !== undefined &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180 &&
    !(latitude === 0 && longitude === 0);

  return {
    updatedAt: time(s.updatedAt) ?? energyUpdatedAt,
    batteryLevel,
    electricRangeKm,
    fuelLevel,
    fuelRangeKm,
    // A mileage of 0 is a car that did not say (Home Assistant keeps the last one).
    odometerKm: odometer !== undefined && odometer > 0 ? odometer : undefined,
    chargeStatus,
    plugged,
    charging: isCharging,
    chargingRateKmh: num(charging?.chargingRate),
    chargingMode: text(charging?.chargingMode),
    chargeRemainingMin: remaining,
    chargeEndAt:
      isCharging && remaining !== undefined && remaining > 0
        ? (energyUpdatedAt ?? readAt) + remaining * 60 * 1000
        : undefined,
    locked: lockedOf(s.doorsState),
    doorOpen: doorOpenOf(s.doorsState),
    preconditioning:
      precondStatus === 'enabled'
        ? true
        : ['disabled', 'finished', 'failure'].includes(precondStatus)
          ? false
          : undefined,
    outsideTempC: num(air?.temp),
    latitude: validPosition ? latitude : undefined,
    longitude: validPosition ? longitude : undefined,
    privacy: text(s.privacy?.state),
  };
}

// Snapshot fields whose presence decides an optional feature.
export const OPTIONAL_FIELDS = [
  'batteryLevel',
  'fuelLevel',
  'fuelRangeKm',
  'odometerKm',
  'chargingRateKmh',
  'chargeRemainingMin',
  'locked',
  'doorOpen',
  'preconditioning',
  'outsideTempC',
];

/** Charge session state of the snapshot (null when unknown). */
export function chargingStationState(snapshot) {
  if (snapshot.charging === true) return CHARGING_STATION_STATE.CHARGING;
  if (snapshot.plugged === false || snapshot.chargeStatus === CHARGE_STATUS.DISCONNECTED) {
    return CHARGING_STATION_STATE.IDLE;
  }
  if (snapshot.plugged === true) {
    // Waiting for a delayed charge, or stopped: the car holds it.
    if (snapshot.chargeStatus === CHARGE_STATUS.STOPPED) {
      return CHARGING_STATION_STATE.PAUSED_BY_VEHICLE;
    }
    if (snapshot.chargeStatus === CHARGE_STATUS.FAILURE) {
      return CHARGING_STATION_STATE.PAUSED_BY_CHARGER;
    }
    // Finished, or plugged without more detail.
    return CHARGING_STATION_STATE.EV_CONNECTED;
  }
  return null;
}

/** The total range: both energies of a hybrid, else the one the car has. */
export function totalRangeKm(snapshot) {
  const { electricRangeKm: e, fuelRangeKm: f } = snapshot;
  if (Number.isFinite(e) && Number.isFinite(f)) return e + f;
  return Number.isFinite(e) ? e : f;
}

// --- Publishing ----------------------------------------------------------------

/**
 * What a car has: decides its features.
 * @param {object} info vehicleInfo()
 * @param {Set<string>} seen optional snapshot fields seen once
 */
export function capabilitiesOf(info, seen = new Set()) {
  const m = info.motorization;
  const known = m !== MOTORIZATIONS.UNKNOWN;
  const electric = known
    ? m === MOTORIZATIONS.ELECTRIC || m === MOTORIZATIONS.HYBRID
    : seen.has('batteryLevel');
  const fuel = known
    ? m === MOTORIZATIONS.THERMIC || m === MOTORIZATIONS.HYBRID
    : seen.has('fuelLevel') || seen.has('fuelRangeKm');
  return {
    electric,
    fuel,
    fuelLevel: fuel && seen.has('fuelLevel'),
    fuelRange: fuel && seen.has('fuelRangeKm'),
    totalRange: electric && fuel,
    odometer: seen.has('odometerKm'),
    chargingRate: electric && seen.has('chargingRateKmh'),
    chargeTimeRemaining: electric && seen.has('chargeRemainingMin'),
    locked: seen.has('locked'),
    doorOpen: seen.has('doorOpen'),
    preconditioning: seen.has('preconditioning'),
    outsideTemperature: seen.has('outsideTempC'),
  };
}

/**
 * The discovery payload of one car.
 * @param {object} gladys SDK instance
 * @param {object} info vehicleInfo()
 * @param {object} caps capabilitiesOf()
 * @param {{ language: string, gps: boolean }} options
 */
export function buildVehicleDevice(gladys, info, caps, { language, gps }) {
  const ids = vehicleIds(gladys, info.vin);
  // No command yet (see README, "Limits"): every feature is read-only.
  const feature = (key, name, category, type, extra) => ({
    name: t(language, name),
    external_id: ids.feature(key),
    category,
    type,
    read_only: true,
    has_feedback: false,
    keep_history: true,
    min: 0,
    max: 1,
    ...extra,
  });
  const F = VEHICLE_FEATURES;
  const features = [];

  if (caps.electric) {
    features.push(
      feature(
        F.BATTERY_LEVEL,
        'batteryLevel',
        CATEGORIES.ELECTRICAL_VEHICLE_BATTERY,
        TYPES.ELECTRICAL_VEHICLE_BATTERY.BATTERY_LEVEL,
        { unit: UNITS.PERCENT, max: 100 },
      ),
      feature(
        F.ELECTRIC_RANGE,
        'electricRange',
        CATEGORIES.ELECTRICAL_VEHICLE_BATTERY,
        TYPES.ELECTRICAL_VEHICLE_BATTERY.BATTERY_RANGE_ESTIMATE,
        { unit: UNITS.KM, max: 1000 },
      ),
      feature(
        F.CHARGING_STATE,
        'chargingState',
        CATEGORIES.CHARGING_STATION,
        TYPES.CHARGING_STATION.CHARGING_STATE,
        { max: 5 },
      ),
      feature(
        F.PLUGGED,
        'plugged',
        CATEGORIES.ELECTRICAL_VEHICLE_CHARGE,
        TYPES.ELECTRICAL_VEHICLE_CHARGE.PLUGGED,
      ),
      feature(
        F.CHARGING,
        'charging',
        CATEGORIES.ELECTRICAL_VEHICLE_CHARGE,
        TYPES.ELECTRICAL_VEHICLE_CHARGE.CHARGE_ON,
      ),
    );
    if (caps.chargingRate) {
      // Kilometres of range gained per hour, what the app shows: the API
      // gives no power in kW.
      features.push(
        feature(F.CHARGING_RATE, 'chargingRate', CATEGORIES.SPEED_SENSOR, TYPES.SENSOR.DECIMAL, {
          unit: UNITS.KILOMETER_PER_HOUR,
          max: 1000,
        }),
      );
    }
    if (caps.chargeTimeRemaining) {
      features.push(
        feature(
          F.CHARGE_TIME_REMAINING,
          'chargeTimeRemaining',
          CATEGORIES.DURATION,
          TYPES.DURATION.INTEGER,
          { unit: UNITS.MINUTES, max: 3000 },
        ),
      );
    }
  }
  if (caps.fuelLevel) {
    features.push(
      feature(
        F.FUEL_LEVEL,
        'fuelLevel',
        CATEGORIES.LEVEL_SENSOR,
        TYPES.LEVEL_SENSOR.LIQUID_LEVEL_PERCENT,
        { unit: UNITS.PERCENT, max: 100 },
      ),
    );
  }
  if (caps.fuelRange) {
    features.push(
      feature(F.FUEL_RANGE, 'fuelRange', CATEGORIES.DISTANCE_SENSOR, TYPES.SENSOR.DECIMAL, {
        unit: UNITS.KM,
        max: 2000,
      }),
    );
  }
  if (caps.totalRange) {
    features.push(
      feature(F.TOTAL_RANGE, 'totalRange', CATEGORIES.DISTANCE_SENSOR, TYPES.SENSOR.DECIMAL, {
        unit: UNITS.KM,
        max: 3000,
      }),
    );
  }
  if (caps.odometer) {
    features.push(
      feature(
        F.ODOMETER,
        'odometer',
        CATEGORIES.ELECTRICAL_VEHICLE_STATE,
        TYPES.ELECTRICAL_VEHICLE_STATE.ODOMETER,
        { unit: UNITS.KM, max: 2000000 },
      ),
    );
  }
  if (caps.locked) {
    // 1 = locked (the lock icon of the Gladys front).
    features.push(feature(F.LOCKED, 'locked', CATEGORIES.LOCK, TYPES.LOCK.BINARY));
  }
  if (caps.doorOpen) {
    features.push(
      feature(
        F.DOOR_OPEN,
        'doorOpen',
        CATEGORIES.ELECTRICAL_VEHICLE_STATE,
        TYPES.ELECTRICAL_VEHICLE_STATE.DOOR_OPENED,
      ),
    );
  }
  if (caps.preconditioning) {
    features.push(
      feature(
        F.PRECONDITIONING,
        'preconditioning',
        CATEGORIES.ELECTRICAL_VEHICLE_CLIMATE,
        TYPES.ELECTRICAL_VEHICLE_CLIMATE.CLIMATE_ON,
      ),
    );
  }
  if (caps.outsideTemperature) {
    features.push(
      feature(
        F.OUTSIDE_TEMPERATURE,
        'outsideTemperature',
        CATEGORIES.TEMPERATURE_SENSOR,
        TYPES.SENSOR.DECIMAL,
        { unit: UNITS.CELSIUS, min: -50, max: 60 },
      ),
    );
  }
  if (gps) {
    features.push(
      feature(F.POSITION, 'position', CATEGORIES.TEXT, TYPES.TEXT.TEXT, {
        keep_history: false,
        max: 0,
      }),
    );
  }
  return {
    name: vehicleName(info),
    external_id: ids.device,
    // The runtime keeps its own pace (src/runtime.js): the core never polls it.
    should_poll: false,
    model: modelName(info),
    features,
  };
}

const round = (value, decimals = 0) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};
const binary = (value) => (value === true ? 1 : value === false ? 0 : null);

/** "48.85661, 2.35222" (about one metre). */
export const positionText = (snapshot) =>
  Number.isFinite(snapshot.latitude) && Number.isFinite(snapshot.longitude)
    ? `${snapshot.latitude.toFixed(5)}, ${snapshot.longitude.toFixed(5)}`
    : null;

/**
 * States of one car, from its snapshot.
 * @returns {Array<{ key: string, value?: number, text?: string }>} only the known values
 */
export function vehicleStates(snapshot) {
  const F = VEHICLE_FEATURES;
  // A rate or a remaining time once the charge is over means nothing.
  const whileCharging = (value) => (snapshot.charging === false ? 0 : value);
  const values = [
    [F.BATTERY_LEVEL, round(snapshot.batteryLevel)],
    [F.ELECTRIC_RANGE, round(snapshot.electricRangeKm)],
    [F.FUEL_LEVEL, round(snapshot.fuelLevel)],
    [F.FUEL_RANGE, round(snapshot.fuelRangeKm)],
    [F.TOTAL_RANGE, round(totalRangeKm(snapshot))],
    [F.ODOMETER, round(snapshot.odometerKm)],
    [F.CHARGING_STATE, chargingStationState(snapshot)],
    [F.PLUGGED, binary(snapshot.plugged)],
    [F.CHARGING, binary(snapshot.charging)],
    [F.CHARGING_RATE, whileCharging(round(snapshot.chargingRateKmh))],
    [F.CHARGE_TIME_REMAINING, whileCharging(round(snapshot.chargeRemainingMin))],
    [F.LOCKED, binary(snapshot.locked)],
    [F.DOOR_OPEN, binary(snapshot.doorOpen)],
    [F.PRECONDITIONING, binary(snapshot.preconditioning)],
    [F.OUTSIDE_TEMPERATURE, round(snapshot.outsideTempC, 1)],
  ];
  const states = values
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => ({ key, value }));
  const position = positionText(snapshot);
  if (position) states.push({ key: F.POSITION, text: position });
  return states;
}
