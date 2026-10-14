# Peugeot / Citroën / DS / Opel for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for the connected cars of the
Stellantis group sold under the **Peugeot, Citroën, DS, Opel and Vauxhall** brands: electric,
plug-in hybrid and combustion. It signs in to the account of the brand's app (MyPeugeot,
MyCitroën, MyDS, MyOpel, MyVauxhall), like the app, and reads the state each car last sent to the
Stellantis "Connected Car" cloud.

> **Not affiliated with Stellantis or its brands.** Developed without the hardware (no car, no
> account): feedback welcome. Fiat, Jeep, Alfa Romeo and the other brands of the group use another
> cloud and are not covered.

User documentation: [English](docs/en.md) · [Français](docs/fr.md) · [Deutsch](docs/de.md) ·
[Español](docs/es.md).

## What it does

- One Gladys device per car, named after its model and the last four characters of its VIN (the
  full VIN never appears in a name or a log line).
- Battery level, electric range, charging state (charging, plugged in, finished, waiting, failure,
  unplugged), plugged in, charging, charging speed (km of range per hour) and time remaining for
  electric cars and plug-in hybrids; fuel level and fuel range for combustion cars and plug-in
  hybrids; total range for plug-in hybrids; mileage, locks, door or boot open, preconditioning,
  outside temperature when the car sends them.
- GPS position, **off by default** (an explicit option).
- The cloud is read on the container's own timer, every 10 to 60 minutes (15 by default). A read
  never wakes the car: it returns its last message. Only the changes are published, and every
  value at least twice a day.
- Scene trigger **Charge finished**, scene action **Read a Stellantis car now**, dashboard widget
  **My car (Stellantis)**.
- English, French, German and Spanish.

## Requirements

- Gladys Assistant 5.1 or later.
- A car with connected services, visible in the brand's app, and that app's e-mail and password.
- A computer with a desktop browser for the sign-in (once).

## Installation

In Gladys: **Integrations → Install from GitHub**, enter
`https://github.com/guim31/gladys-stellantis`, then open the integration's **Configuration** tab:

1. choose the app and the country of the account, save;
2. click **Connect**, open the developer tools of the new tab, sign in, copy the `mymap://…` address
   shown in the console;
3. paste it in the **Finish the sign-in** action;
4. add the cars from the **Discovery** tab.

The [documentation](docs/en.md#sign-in) shows where the address appears in Chrome, Edge, Firefox
and Safari.

## How it works

Stellantis gives no API access to private persons. Like the Home Assistant integration it follows,
this one uses the OAuth2 sign-in of each brand's mobile app: the brand's page ends on an address
only the app opens (`mymap://oauth2redirect/<country>?code=…`); the user copies the code, the
integration trades it for an access token (about an hour) and a refresh token, saved in `/data`
and renewed before each expiry, so the user signs in once. Gladys 5.2 publishes no port for an
integration: there is no local callback server, the **Connect** button is an `account_link` field
paired with an action that receives the pasted code (the pattern of
[gladys-amazon-echo](https://github.com/guim31/gladys-amazon-echo)).

Reads go to `GET /connectedcar/v4/user/vehicles` and `…/vehicles/{id}/status` on
`api.groupe-psa.com`: one call per car per read, plus a token renewal about once an hour.

## Limits

- **No remote command.** Preconditioning, charge start/stop, charge limit, lock/unlock and the
  wake-up go through a separate MQTT service (`mwa.mpsa.com`) whose access requires a one-time
  password enrolment (SMS code + the app's PIN, the "Inwebo" OTP of `otp.mpsa.com`). The only open
  implementations of that enrolment are GPL-3.0 (psa_car_controller, also vendored by the Home
  Assistant integration); this Apache-2.0 integration does not copy them, and an enrolment cannot be
  tested without an account (failed attempts lock the PIN or exhaust the account's devices). Every
  feature is read-only; the widget has no preconditioning button.
- No forced refresh: the values are as recent as the car's last message.
- The charging speed is in km/h of range: the cloud gives no power in kW.
- The sign-in uses the public identifiers of the brands' apps (from the Home Assistant
  integration): a change of the apps can break it until an update.
- Developed and tested without a car or an account, against hand-written answers in the shape the
  Home Assistant integration reads.

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .   # store checks (from a clone)
```

The tests run against the fake Gladys of the SDK and a fake Stellantis cloud
([`test/helpers/fakeStellantis.js`](test/helpers/fakeStellantis.js)) answering with
[the fixtures](test/fixtures/stellantis/README.md). `scripts/probe.mjs` checks the real sign-in
servers and API with the integration's own code, without printing anything sensitive:

```bash
node scripts/probe.mjs            # each brand's sign-in page, a fake code refused cleanly
node scripts/probe.mjs --all      # every country of every brand
STELLANTIS_BRAND=peugeot STELLANTIS_COUNTRY=FR node scripts/probe.mjs --url   # sign-in URL
STELLANTIS_BRAND=peugeot STELLANTIS_COUNTRY=FR STELLANTIS_CODE='mymap://…' node scripts/probe.mjs
```

Project rules for contributors and coding assistants: [`CLAUDE.md`](CLAUDE.md). Versions are set by
the Release workflow (**Actions → Release**), never by hand.

## Credits

- [andreadegiovine/homeassistant-stellantis-vehicles](https://github.com/andreadegiovine/homeassistant-stellantis-vehicles)
  (MIT): the OAuth2 flow of each app, the per-country app identifiers (`src/stellantis/apps.json`
  is derived from its `configs.json`), the endpoints, headers and field meanings.
- [flobz/psa_car_controller](https://github.com/flobz/psa_car_controller) (GPL-3.0): read to
  understand the API and the remote commands; no code copied.
- Built on the [Gladys integration SDK](https://github.com/GladysAssistant/integration-sdk-js) and
  its template.

## License

[Apache-2.0](LICENSE).
