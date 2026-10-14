// -----------------------------------------------------------------------------
// Feature names, in the language chosen in the configuration.
//
// A `device` integration does not receive the language of the user (a widget
// request does): feature names follow the `language` setting, and Gladys keeps
// a name once the device is created. Widget contents and action messages use
// multi-language objects instead, so the core picks the viewer's language.
// Vocabulary of the Gladys interface (front/src/config/i18n).
// -----------------------------------------------------------------------------

export const NAMES = {
  en: {
    batteryLevel: 'Battery level',
    electricRange: 'Electric range',
    fuelLevel: 'Fuel level',
    fuelRange: 'Fuel range',
    totalRange: 'Total range',
    odometer: 'Mileage',
    chargingState: 'Charging state',
    plugged: 'Plugged in',
    charging: 'Charging',
    chargingRate: 'Charging speed (km of range per hour)',
    chargeTimeRemaining: 'Charging time remaining',
    locked: 'Locked',
    doorOpen: 'Door or boot open',
    preconditioning: 'Preconditioning',
    outsideTemperature: 'Outside temperature',
    position: 'GPS position',
  },
  fr: {
    batteryLevel: 'Niveau de batterie',
    electricRange: 'Autonomie électrique',
    fuelLevel: 'Niveau de carburant',
    fuelRange: 'Autonomie carburant',
    totalRange: 'Autonomie totale',
    odometer: 'Kilométrage',
    chargingState: 'État de la charge',
    plugged: 'Branchée',
    charging: 'En charge',
    chargingRate: 'Vitesse de charge (km d’autonomie/h)',
    chargeTimeRemaining: 'Temps de charge restant',
    locked: 'Verrouillée',
    doorOpen: 'Portière ou coffre ouvert',
    preconditioning: 'Préconditionnement',
    outsideTemperature: 'Température extérieure',
    position: 'Position GPS',
  },
  de: {
    batteryLevel: 'Batteriestand',
    electricRange: 'Elektrische Reichweite',
    fuelLevel: 'Tankfüllstand',
    fuelRange: 'Kraftstoffreichweite',
    totalRange: 'Gesamtreichweite',
    odometer: 'Kilometerstand',
    chargingState: 'Ladezustand',
    plugged: 'Angeschlossen',
    charging: 'Lädt',
    chargingRate: 'Ladegeschwindigkeit (km Reichweite/h)',
    chargeTimeRemaining: 'Verbleibende Ladezeit',
    locked: 'Verriegelt',
    doorOpen: 'Tür oder Kofferraum offen',
    preconditioning: 'Vorklimatisierung',
    outsideTemperature: 'Außentemperatur',
    position: 'GPS-Position',
  },
  es: {
    batteryLevel: 'Nivel de batería',
    electricRange: 'Autonomía eléctrica',
    fuelLevel: 'Nivel de combustible',
    fuelRange: 'Autonomía de combustible',
    totalRange: 'Autonomía total',
    odometer: 'Kilometraje',
    chargingState: 'Estado de la carga',
    plugged: 'Enchufado',
    charging: 'Cargando',
    chargingRate: 'Velocidad de carga (km de autonomía/h)',
    chargeTimeRemaining: 'Tiempo de carga restante',
    locked: 'Bloqueado',
    doorOpen: 'Puerta o maletero abierto',
    preconditioning: 'Preacondicionamiento',
    outsideTemperature: 'Temperatura exterior',
    position: 'Posición GPS',
  },
};

/** Feature name in one language. */
export function t(language, key) {
  const table = NAMES[language] ?? NAMES.en;
  const name = table[key];
  if (!name) throw new Error(`Unknown text key: ${key}`);
  return name;
}
