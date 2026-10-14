// -----------------------------------------------------------------------------
// Dashboard widget `vehicle` (SDK v0.14+, Gladys 5.1+): one car — two tiles
// (battery and range, or fuel and range), a status list (charge, doors,
// preconditioning, last update) and the "Refresh" button.
//
// The tiles are bound to the device features once the car is added to Gladys
// (they then move with every published state); before that they show the last
// known value. The status rows are computed here: the runtime nudges the
// widget when they change (src/runtime.js), the TTL is a safety net.
// No command button: the remote commands are not supported (README, "Limits").
// Budget of the core: 8 components, 2 texts at most (none used here).
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { CHARGE_STATUS, VEHICLE_FEATURES as F, totalRangeKm } from './devices/vehicle.js';
import { MESSAGES, WIDGET_ISSUES, UserError } from './messages.js';
import { WIDGET_KEYS } from './runtime.js';

export const TEXT = {
  pickDevice: {
    en: 'Choose a vehicle in the widget settings.',
    fr: 'Choisissez un véhicule dans les réglages du widget.',
    de: 'Wähle in den Widget-Einstellungen ein Fahrzeug.',
    es: 'Elija un vehículo en los ajustes del widget.',
  },
  notVehicle: {
    en: 'This device is not a vehicle of this integration.',
    fr: 'Cet appareil n’est pas un véhicule de cette intégration.',
    de: 'Dieses Gerät ist kein Fahrzeug dieser Integration.',
    es: 'Este dispositivo no es un vehículo de esta integración.',
  },
  battery: { en: 'Battery', fr: 'Batterie', de: 'Batterie', es: 'Batería' },
  fuel: { en: 'Fuel', fr: 'Carburant', de: 'Kraftstoff', es: 'Combustible' },
  range: { en: 'Range', fr: 'Autonomie', de: 'Reichweite', es: 'Autonomía' },
  charge: { en: 'Charge', fr: 'Charge', de: 'Laden', es: 'Carga' },
  charging: { en: 'Charging', fr: 'En charge', de: 'Lädt', es: 'Cargando' },
  finished: {
    en: 'Complete, plugged in',
    fr: 'Terminée, branchée',
    de: 'Fertig, angeschlossen',
    es: 'Terminada, enchufado',
  },
  waiting: {
    en: 'Plugged in, waiting',
    fr: 'Branchée, en attente',
    de: 'Angeschlossen, wartet',
    es: 'Enchufado, en espera',
  },
  failed: {
    en: 'Plugged in, charge failed',
    fr: 'Branchée, charge en échec',
    de: 'Angeschlossen, Laden fehlgeschlagen',
    es: 'Enchufado, carga fallida',
  },
  plugged: { en: 'Plugged in', fr: 'Branchée', de: 'Angeschlossen', es: 'Enchufado' },
  unplugged: { en: 'Unplugged', fr: 'Débranchée', de: 'Nicht angeschlossen', es: 'Desenchufado' },
  doors: { en: 'Doors', fr: 'Portes', de: 'Türen', es: 'Puertas' },
  locked: { en: 'Locked', fr: 'Verrouillées', de: 'Verriegelt', es: 'Bloqueadas' },
  unlocked: { en: 'Unlocked', fr: 'Déverrouillées', de: 'Entriegelt', es: 'Desbloqueadas' },
  open: {
    en: 'Door or boot open',
    fr: 'Portière ou coffre ouvert',
    de: 'Tür oder Kofferraum offen',
    es: 'Puerta o maletero abierto',
  },
  preconditioning: {
    en: 'Preconditioning',
    fr: 'Préconditionnement',
    de: 'Vorklimatisierung',
    es: 'Preacondicionamiento',
  },
  on: { en: 'On', fr: 'En marche', de: 'Ein', es: 'Encendido' },
  off: { en: 'Off', fr: 'Arrêté', de: 'Aus', es: 'Apagado' },
  account: { en: 'Account', fr: 'Compte', de: 'Konto', es: 'Cuenta' },
  lastUpdate: {
    en: 'Last update',
    fr: 'Dernier relevé',
    de: 'Letzte Meldung',
    es: 'Última actualización',
  },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  map: { en: 'Map', fr: 'Carte', de: 'Karte', es: 'Mapa' },
};

const LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

function message(text) {
  return { ttl_seconds: 300, components: [{ type: 'text', variant: 'body', text }] };
}

function format(ms, timeZone, options) {
  return Object.fromEntries(
    Object.entries(LOCALES).map(([lang, locale]) => [
      lang,
      new Intl.DateTimeFormat(locale, { ...options, ...(timeZone ? { timeZone } : {}) }).format(
        new Date(ms),
      ),
    ]),
  );
}

/** "13/10 14:05": when the car last sent its state, in every language. */
export function formatUpdated(ms, timeZone) {
  if (!Number.isFinite(ms)) return '—';
  return format(ms, timeZone, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function chargeRow(snapshot, timeZone) {
  const row = (value, icon, color) => ({ label: TEXT.charge, icon, value, color });
  if (snapshot.charging === true) {
    const rate =
      Number.isFinite(snapshot.chargingRateKmh) && snapshot.chargingRateKmh > 0
        ? `, ${Math.round(snapshot.chargingRateKmh)} km/h`
        : '';
    const end = Number.isFinite(snapshot.chargeEndAt)
      ? format(snapshot.chargeEndAt, timeZone, { hour: '2-digit', minute: '2-digit' })
      : null;
    return row(
      {
        en: `Charging${rate}${end ? `, ends ~${end.en}` : ''}`,
        fr: `En charge${rate}${end ? `, fin vers ${end.fr}` : ''}`,
        de: `Lädt${rate}${end ? `, fertig ~${end.de}` : ''}`,
        es: `Cargando${rate}${end ? `, fin ~${end.es}` : ''}`,
      },
      'zap',
      WIDGET_COLORS.SUCCESS,
    );
  }
  if (snapshot.plugged === true) {
    if (snapshot.chargeStatus === CHARGE_STATUS.FINISHED) {
      return row(TEXT.finished, 'battery', WIDGET_COLORS.SUCCESS);
    }
    if (snapshot.chargeStatus === CHARGE_STATUS.STOPPED) {
      return row(TEXT.waiting, 'clock', WIDGET_COLORS.INFO);
    }
    if (snapshot.chargeStatus === CHARGE_STATUS.FAILURE) {
      return row(TEXT.failed, 'alert-triangle', WIDGET_COLORS.WARNING);
    }
    return row(TEXT.plugged, 'battery', WIDGET_COLORS.INFO);
  }
  if (snapshot.plugged === false) return row(TEXT.unplugged, 'battery', WIDGET_COLORS.NEUTRAL);
  return row('—', 'battery', WIDGET_COLORS.NEUTRAL);
}

/** The content of the widget for one car (see vehicleView in src/runtime.js). */
export function vehicleContent(view, { timeZone } = {}) {
  const { device, created, caps, snapshot, issue, gps } = view;
  const ref = (key) => `${device.external_id}:${key}`;
  const createdIds = new Set((created?.features ?? []).map((f) => f.external_id));
  // A tile bound to a feature Gladys does not have shows nothing: inline value then.
  const tile = (key, label, icon, value, unit) =>
    createdIds.has(ref(key))
      ? { type: 'value', label, icon, device_feature: ref(key) }
      : {
          type: 'value',
          label,
          icon,
          value: Number.isFinite(value) ? Math.round(value) : '—',
          ...(Number.isFinite(value) ? { unit } : {}),
        };

  const components = [];
  if (caps.electric) {
    components.push(tile(F.BATTERY_LEVEL, TEXT.battery, 'battery', snapshot.batteryLevel, '%'));
  } else {
    components.push(tile(F.FUEL_LEVEL, TEXT.fuel, 'droplet', snapshot.fuelLevel, '%'));
  }
  // The range the driver cares about: everything the car can drive.
  const rangeKey = caps.totalRange
    ? F.TOTAL_RANGE
    : caps.electric
      ? F.ELECTRIC_RANGE
      : F.FUEL_RANGE;
  components.push(tile(rangeKey, TEXT.range, 'navigation', totalRangeKm(snapshot), 'km'));

  const items = [];
  if (caps.electric) items.push(chargeRow(snapshot, timeZone));
  if (caps.locked || caps.doorOpen) {
    items.push({
      label: TEXT.doors,
      icon: snapshot.locked === false ? 'unlock' : 'lock',
      value:
        snapshot.doorOpen === true
          ? TEXT.open
          : snapshot.locked === true
            ? TEXT.locked
            : snapshot.locked === false
              ? TEXT.unlocked
              : '—',
      color:
        snapshot.doorOpen === true || snapshot.locked === false
          ? WIDGET_COLORS.WARNING
          : WIDGET_COLORS.SUCCESS,
    });
  }
  if (caps.preconditioning) {
    items.push({
      label: TEXT.preconditioning,
      icon: 'wind',
      value: snapshot.preconditioning === true ? TEXT.on : TEXT.off,
      color: snapshot.preconditioning === true ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    });
  }
  if (WIDGET_ISSUES[issue]) {
    items.push({
      label: TEXT.account,
      icon: 'alert-octagon',
      value: WIDGET_ISSUES[issue],
      color: issue === 'privacy' ? WIDGET_COLORS.WARNING : WIDGET_COLORS.DANGER,
    });
  }
  items.push({
    label: TEXT.lastUpdate,
    icon: 'clock',
    value: formatUpdated(snapshot.updatedAt, timeZone),
    color: WIDGET_COLORS.NEUTRAL,
  });
  components.push({ type: 'status', items });

  components.push({
    type: 'button',
    label: TEXT.refresh,
    icon: 'refresh-cw',
    action: { key: 'refresh' },
  });
  if (gps && Number.isFinite(snapshot.latitude) && Number.isFinite(snapshot.longitude)) {
    const lat = snapshot.latitude.toFixed(5);
    const lon = snapshot.longitude.toFixed(5);
    components.push({
      type: 'button',
      label: TEXT.map,
      icon: 'map-pin',
      link: { url: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}` },
    });
  }
  return { ttl_seconds: 300, components };
}

/**
 * Widgets, keyed like the manifest. `runtime` is src/runtime.js.
 * A widget action resolves its toast (multi-language), and throws on failure:
 * the core then shows "Action failed — <message>" in red, the message being
 * one plain string. A widget action does not carry the viewer's language, a
 * widget read does: the last one read is used.
 */
export function createWidgets(runtime, { timeZone = process.env.TZ } = {}) {
  let language = 'fr';
  const fail = (text) => new Error(text[language] ?? text.en);
  return {
    [WIDGET_KEYS.VEHICLE]: {
      async get({ settings, language: viewer } = {}) {
        if (typeof viewer === 'string' && viewer) language = viewer.slice(0, 2);
        if (!settings?.device) return message(TEXT.pickDevice);
        const view = runtime.vehicleView(settings.device);
        if (!view) return message(TEXT.notVehicle);
        return vehicleContent(view, { timeZone });
      },
      async action({ actionKey, settings }) {
        if (actionKey !== 'refresh') throw new Error(`Unknown action: ${actionKey}`);
        try {
          await runtime.refresh(settings?.device);
          return MESSAGES.refreshed;
        } catch (err) {
          if (err instanceof UserError) throw fail(err.text);
          throw err;
        }
      },
    },
  };
}
