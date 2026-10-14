# Fixtures of the Stellantis cloud

No real answer of the Stellantis API is published under a license this repository can use: the
fixtures are written by hand, with invented identifiers (VIN, ids, tokens) and public places
(Paris, Lyon) as positions. Their shape follows:

- the field paths read by
  [andreadegiovine/homeassistant-stellantis-vehicles](https://github.com/andreadegiovine/homeassistant-stellantis-vehicles)
  (MIT, `const.py`): `energies[].extension.electric.charging`, `doorsState.lockedStates`,
  `preconditioning.airConditioning`, `environment.air.temp`, `odometer.mileage`;
- the Connected Car v4 schema (enums of `charging.status`, `lockedStates`, `opening`,
  `airConditioning.status`), whose older answers use `energy[]` with a `charging` block and the
  `preconditionning` spelling (`status-thermic-legacy.json`);
- the error bodies handled by the same Home Assistant client (`invalid_grant`, `40400`).

| File                            | Car                                                   |
| ------------------------------- | ----------------------------------------------------- |
| `vehicles.json`                 | an electric e-208, a 3008 plug-in hybrid, a C5 diesel |
| `status-electric-charging.json` | e-208 charging, locked, outside temperature           |
| `status-hybrid.json`            | 3008: charge finished, boot open, unlocked            |
| `status-thermic-legacy.json`    | C5: older answer shape, fuel only                     |
| `status.404.json`               | a car with no status yet                              |
| `token*.json`                   | token endpoint: success and refused grant             |
