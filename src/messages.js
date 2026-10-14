// -----------------------------------------------------------------------------
// Texts the runtime sends to Gladys: connection statuses, action results,
// errors. Multi-language objects: the core and the browser pick the user's
// language. Kept short: an action toast is cut at 200 characters.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './stellantis/errors.js';

export const MESSAGES = {
  [ERROR_KINDS.NOT_SIGNED_IN]: {
    en: 'Not signed in: choose the brand and the country, save, click Connect, then paste the code in “Finish the sign-in”.',
    fr: 'Pas connecté : choisissez la marque et le pays, enregistrez, cliquez sur Connecter, puis collez le code dans « Terminer la connexion ».',
    de: 'Nicht angemeldet: Wähle Marke und Land, speichere, klicke auf Verbinden und füge den Code unter „Anmeldung abschließen“ ein.',
    es: 'Sin sesión: elija la marca y el país, guarde, pulse Conectar y pegue el código en «Terminar el inicio de sesión».',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'The Stellantis session has ended: click Connect again, then paste the new code in “Finish the sign-in”.',
    fr: 'La session Stellantis a pris fin : cliquez à nouveau sur Connecter, puis collez le nouveau code dans « Terminer la connexion ».',
    de: 'Die Stellantis-Sitzung ist beendet: Klicke erneut auf Verbinden und füge den neuen Code unter „Anmeldung abschließen“ ein.',
    es: 'La sesión de Stellantis ha terminado: pulse de nuevo Conectar y pegue el nuevo código en «Terminar el inicio de sesión».',
  },
  [ERROR_KINDS.CODE]: {
    en: 'Code refused: it works once, for a few minutes, with the brand and country saved here. Click Connect again and paste the new code.',
    fr: 'Code refusé : il ne sert qu’une fois, quelques minutes, avec la marque et le pays enregistrés ici. Cliquez à nouveau sur Connecter et collez le nouveau code.',
    de: 'Code abgelehnt: Er gilt einmal, wenige Minuten, mit der hier gespeicherten Marke und dem Land. Klicke erneut auf Verbinden und füge den neuen Code ein.',
    es: 'Código rechazado: sirve una vez, unos minutos, con la marca y el país guardados aquí. Pulse de nuevo Conectar y pegue el nuevo código.',
  },
  [ERROR_KINDS.RATE_LIMIT]: {
    en: 'The Stellantis cloud asks to slow down: reads resume in 30 minutes.',
    fr: 'Le cloud Stellantis demande de ralentir : les relevés reprennent dans 30 minutes.',
    de: 'Die Stellantis-Cloud bittet um weniger Anfragen: Die Abfragen laufen in 30 Minuten weiter.',
    es: 'La nube de Stellantis pide ir más despacio: las lecturas se reanudan en 30 minutos.',
  },
  unreachable: {
    en: 'The Stellantis cloud is unreachable for now, retrying.',
    fr: 'Le cloud Stellantis est injoignable pour le moment, nouvel essai en cours.',
    de: 'Die Stellantis-Cloud ist gerade nicht erreichbar, neuer Versuch läuft.',
    es: 'La nube de Stellantis no está disponible por ahora, nuevo intento en curso.',
  },
  appUnavailable: {
    en: 'The app of this brand does not exist in this country: choose another country or brand, then save.',
    fr: 'L’application de cette marque n’existe pas dans ce pays : choisissez un autre pays ou une autre marque, puis enregistrez.',
    de: 'Die App dieser Marke gibt es in diesem Land nicht: Wähle ein anderes Land oder eine andere Marke und speichere.',
    es: 'La aplicación de esta marca no existe en este país: elija otro país u otra marca y guarde.',
  },
  codeFormat: {
    en: 'No code found: paste the address that starts with mymap:// (or mymacsdk://, mymdssdk://, mymopsdk://, mymvxsdk://) or the code after “code=”.',
    fr: 'Aucun code trouvé : collez l’adresse qui commence par mymap:// (ou mymacsdk://, mymdssdk://, mymopsdk://, mymvxsdk://) ou le code après « code= ».',
    de: 'Kein Code gefunden: Füge die Adresse ein, die mit mymap:// (oder mymacsdk://, mymdssdk://, mymopsdk://, mymvxsdk://) beginnt, oder den Code nach „code=“.',
    es: 'No se ha encontrado ningún código: pegue la dirección que empieza por mymap:// (o mymacsdk://, mymdssdk://, mymopsdk://, mymvxsdk://) o el código tras «code=».',
  },
  privacy: {
    en: 'The privacy mode of the car is on: it shares no data for now.',
    fr: 'Le mode confidentialité de la voiture est activé : elle ne partage aucune donnée pour le moment.',
    de: 'Der Privatsphäre-Modus des Autos ist an: Es teilt gerade keine Daten.',
    es: 'El modo de privacidad del coche está activado: no comparte datos por ahora.',
  },
  refreshed: {
    en: 'State read again from the Stellantis cloud (the car itself is not woken).',
    fr: 'État relu depuis le cloud Stellantis (la voiture elle-même n’est pas réveillée).',
    de: 'Zustand erneut aus der Stellantis-Cloud gelesen (das Auto selbst wird nicht geweckt).',
    es: 'Estado leído de nuevo desde la nube de Stellantis (el coche en sí no se despierta).',
  },
  signedOut: {
    en: 'Signed out: the tokens stored by Gladys are deleted.',
    fr: 'Déconnecté : les jetons enregistrés par Gladys sont supprimés.',
    de: 'Abgemeldet: Die von Gladys gespeicherten Token sind gelöscht.',
    es: 'Sesión cerrada: se han borrado los tokens guardados por Gladys.',
  },
  starting: {
    en: 'The integration is starting: try again in a few seconds.',
    fr: 'L’intégration démarre : réessayez dans quelques secondes.',
    de: 'Die Integration startet: Versuche es in ein paar Sekunden erneut.',
    es: 'La integración se está iniciando: vuelva a intentarlo dentro de unos segundos.',
  },
  initFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: 'L’initialisation a échoué, consultez les journaux de l’intégration.',
    de: 'Initialisierung fehlgeschlagen, sieh in den Logs der Integration nach.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },
  unknownVehicle: {
    en: 'Choose a vehicle of this integration.',
    fr: 'Choisissez un véhicule de cette intégration.',
    de: 'Wähle ein Fahrzeug dieser Integration.',
    es: 'Elija un vehículo de esta integración.',
  },
  noVehicle: {
    en: 'Signed in, but the account has no connected vehicle: add it in the brand’s app first.',
    fr: 'Connecté, mais le compte n’a aucun véhicule connecté : ajoutez-le d’abord dans l’application de la marque.',
    de: 'Angemeldet, aber das Konto hat kein vernetztes Fahrzeug: Füge es zuerst in der App der Marke hinzu.',
    es: 'Sesión iniciada, pero la cuenta no tiene ningún vehículo conectado: añádalo primero en la aplicación de la marca.',
  },
};

// Status rows of the widget, 40 characters at most.
export const WIDGET_ISSUES = {
  [ERROR_KINDS.NOT_SIGNED_IN]: {
    en: 'Not signed in (configuration)',
    fr: 'Pas connecté (configuration)',
    de: 'Nicht angemeldet (Konfiguration)',
    es: 'Sin sesión (configuración)',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'Sign in again (configuration)',
    fr: 'Reconnexion requise (configuration)',
    de: 'Neu anmelden (Konfiguration)',
    es: 'Inicie sesión de nuevo',
  },
  appUnavailable: {
    en: 'Brand or country to fix',
    fr: 'Marque ou pays à corriger',
    de: 'Marke oder Land korrigieren',
    es: 'Marca o país por corregir',
  },
  privacy: {
    en: 'Privacy mode on',
    fr: 'Mode confidentialité activé',
    de: 'Privatsphäre-Modus an',
    es: 'Modo de privacidad activado',
  },
};

/** An Error carrying a multi-language text, for widget toasts and scene actions. */
export class UserError extends Error {
  constructor(text, kind) {
    super(text.en);
    this.text = text;
    if (kind) this.kind = kind;
  }
}

/**
 * A failed manifest action. Thrown, so Gladys shows it in red: the core relays
 * the thrown `message` untouched to the browser, which picks the user's
 * language in a `{ en, fr, de, es }` object.
 */
export class ActionFailure extends Error {
  constructor(text) {
    super(text.en);
    this.message = text;
    this.text = text;
  }
}

/** The multi-language text of a cloud failure, `null` when none fits. */
export function userTextOf(err) {
  if (err instanceof UserError || err instanceof ActionFailure) return err.text;
  if (MESSAGES[err?.kind]) return MESSAGES[err.kind];
  if (err?.kind === ERROR_KINDS.NETWORK || err?.kind === ERROR_KINDS.SERVER) {
    return MESSAGES.unreachable;
  }
  return null;
}

/** A text for any failure: the known one, else the cloud's own words. */
export function failureText(err) {
  const known = userTextOf(err);
  if (known) return known;
  const detail = String(err?.message ?? err).slice(0, 120);
  return {
    en: `The Stellantis cloud refused the request: ${detail}`,
    fr: `Le cloud Stellantis a refusé la requête : ${detail}`,
    de: `Die Stellantis-Cloud hat die Anfrage abgelehnt: ${detail}`,
    es: `La nube de Stellantis ha rechazado la solicitud: ${detail}`,
  };
}
