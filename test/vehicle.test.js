// -----------------------------------------------------------------------------
// The vehicle model: the status answers folded into a snapshot, the states
// derived from it, the name of the device.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CHARGING_STATION_STATE,
  MOTORIZATIONS,
  capabilitiesOf,
  chargingStationState,
  durationMinutes,
  motorizationOf,
  snapshotOf,
  vehicleInfo,
  vehicleName,
  vehicleStates,
} from '../src/devices/vehicle.js';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/stellantis/${name}`, import.meta.url), 'utf8'));
const READ_AT = Date.UTC(2026, 9, 13, 8, 5);

test('an electric car charging', () => {
  const s = snapshotOf(fixture('status-electric-charging.json'), { readAt: READ_AT });
  assert.equal(s.batteryLevel, 54);
  assert.equal(s.electricRangeKm, 182);
  assert.equal(s.plugged, true);
  assert.equal(s.charging, true);
  assert.equal(s.chargeStatus, 'InProgress');
  assert.equal(s.chargingRateKmh, 38);
  assert.equal(s.chargeRemainingMin, 95);
  // From when the car sent it, not from when it was read.
  assert.equal(s.chargeEndAt, Date.parse('2026-10-13T08:00:42Z') + 95 * 60 * 1000);
  assert.equal(s.locked, true);
  assert.equal(s.doorOpen, false);
  assert.equal(s.preconditioning, false);
  assert.equal(s.outsideTempC, 12.5);
  assert.equal(s.odometerKm, 12345.6);
  assert.equal(s.latitude, 48.85661);
  assert.equal(s.longitude, 2.35222);
  assert.equal(s.fuelLevel, undefined);
  assert.equal(chargingStationState(s), CHARGING_STATION_STATE.CHARGING);
});

test('a plug-in hybrid: charge finished, boot open, both ranges', () => {
  const s = snapshotOf(fixture('status-hybrid.json'));
  assert.equal(s.batteryLevel, 100);
  assert.equal(s.electricRangeKm, 52);
  assert.equal(s.fuelLevel, 63);
  assert.equal(s.fuelRangeKm, 410);
  assert.equal(s.charging, false);
  assert.equal(s.chargeStatus, 'Finished');
  assert.equal(s.chargeEndAt, undefined);
  assert.equal(s.locked, false);
  assert.equal(s.doorOpen, true);
  assert.equal(chargingStationState(s), CHARGING_STATION_STATE.EV_CONNECTED);
  const states = Object.fromEntries(vehicleStates(s).map((x) => [x.key, x.value ?? x.text]));
  assert.equal(states['total-range'], 462);
  assert.equal(states['charge-time-remaining'], 0);
  assert.equal(states['charging-rate'], 0);
});

test('the older answer shape (energy, preconditionning) is read too', () => {
  const s = snapshotOf(fixture('status-thermic-legacy.json'));
  assert.equal(s.fuelLevel, 42);
  assert.equal(s.fuelRangeKm, 515);
  assert.equal(s.odometerKm, 61107.1);
  assert.equal(s.preconditioning, false);
  assert.equal(s.batteryLevel, undefined);
  assert.equal(s.locked, undefined);
  assert.equal(chargingStationState(s), null);
});

test('the charge states of the Gladys enum', () => {
  const state = (plugged, chargeStatus) =>
    chargingStationState({ plugged, chargeStatus, charging: chargeStatus === 'InProgress' });
  assert.equal(state(true, 'InProgress'), CHARGING_STATION_STATE.CHARGING);
  assert.equal(state(true, 'Finished'), CHARGING_STATION_STATE.EV_CONNECTED);
  assert.equal(state(true, 'Stopped'), CHARGING_STATION_STATE.PAUSED_BY_VEHICLE);
  assert.equal(state(true, 'Failure'), CHARGING_STATION_STATE.PAUSED_BY_CHARGER);
  assert.equal(state(false, 'Disconnected'), CHARGING_STATION_STATE.IDLE);
  assert.equal(state(undefined, 'Disconnected'), CHARGING_STATION_STATE.IDLE);
  assert.equal(state(undefined, undefined), null);
});

test('lock states: any unlocked door wins', () => {
  const locked = (lockedStates) => snapshotOf({ doorsState: { lockedStates } }).locked;
  assert.equal(locked(['Locked']), true);
  assert.equal(locked(['SuperLocked']), true);
  assert.equal(locked(['Unlocked']), false);
  assert.equal(locked(['Locked', 'CargoDoorsUnlocked']), false);
  assert.equal(locked(['DriverDoorUnlocked']), false);
  assert.equal(locked([]), undefined);
  assert.equal(snapshotOf({ doorsState: { lockedState: 'Locked' } }).locked, true);
});

test('ISO durations', () => {
  assert.equal(durationMinutes('PT1H35M'), 95);
  assert.equal(durationMinutes('PT0S'), 0);
  assert.equal(durationMinutes('PT45M30S'), 46);
  assert.equal(durationMinutes('P1DT2H'), 1560);
  for (const bad of ['', 'PT', 'P', '1h30', null, undefined, 'PTxM']) {
    assert.equal(durationMinutes(bad), undefined, String(bad));
  }
});

test('artefacts are not readings', () => {
  // A full battery with no range: a sleeping car's answer (Home Assistant PR #476).
  const asleep = snapshotOf({ energies: [{ type: 'Electric', level: 100, autonomy: 0 }] });
  assert.equal(asleep.batteryLevel, undefined);
  assert.equal(asleep.electricRangeKm, undefined);
  // A mileage of 0 and a position at 0, 0 say nothing.
  const empty = snapshotOf({
    odometer: { mileage: 0 },
    lastPosition: { geometry: { coordinates: [0, 0] } },
  });
  assert.equal(empty.odometerKm, undefined);
  assert.equal(empty.latitude, undefined);
  // Garbage does not throw.
  assert.doesNotThrow(() => snapshotOf(null));
  assert.doesNotThrow(() => snapshotOf({ energies: 'x', doorsState: { opening: 'x' } }));
});

test('motorization, name and features of each car', () => {
  const list = fixture('vehicles.json')._embedded.vehicles;
  const infos = list.map((raw) => vehicleInfo(raw, 'Peugeot'));
  assert.deepEqual(
    infos.map((i) => i.motorization),
    [MOTORIZATIONS.ELECTRIC, MOTORIZATIONS.HYBRID, MOTORIZATIONS.THERMIC],
  );
  assert.deepEqual(infos.map(vehicleName), [
    'Peugeot e-208 (…0208)',
    'Peugeot 3008 Hybrid4 (…3008)',
    'Citroën C5 Aircross (…00C5)',
  ]);
  assert.equal(
    vehicleName(vehicleInfo({ id: '1', vin: 'X0001', brand: 'DS' }, 'DS')),
    'DS (…0001)',
  );
  assert.equal(
    vehicleName(
      vehicleInfo({ id: '1', vin: 'X0001', brand: 'OPEL', label: 'OPEL CORSA-E' }, 'Opel'),
    ),
    'Opel Corsa-e (…0001)',
  );
  assert.equal(motorizationOf({ motorization: 'Hydrogen' }), MOTORIZATIONS.ELECTRIC);
  assert.equal(
    motorizationOf({ engine: [{ class: 'Electric' }, { class: 'Thermic' }] }),
    MOTORIZATIONS.HYBRID,
  );
  assert.equal(motorizationOf({}), MOTORIZATIONS.UNKNOWN);

  // An unknown motorization follows what the car sent.
  const unknown = { motorization: MOTORIZATIONS.UNKNOWN };
  assert.equal(capabilitiesOf(unknown, new Set(['batteryLevel'])).electric, true);
  assert.equal(capabilitiesOf(unknown, new Set(['batteryLevel'])).fuel, false);
  // A combustion car never gets battery features, whatever it sends.
  const thermic = { motorization: MOTORIZATIONS.THERMIC };
  assert.equal(capabilitiesOf(thermic, new Set(['batteryLevel', 'fuelLevel'])).electric, false);
});
