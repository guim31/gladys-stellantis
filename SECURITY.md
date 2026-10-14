# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- the Gladys configuration holds no secret: the app (brand), the country, the language, the refresh
  period and the GPS option. The password of the account is typed on the brand's own sign-in page,
  never in Gladys;
- the sign-in code pasted in the "Finish the sign-in" action is sent once to the brand's sign-in
  server and never stored;
- in the `/data` volume, file `stellantis.json` (mode 0600, written atomically): the access token,
  the refresh token and their expiry, the app they belong to, and per car (keyed by VIN) the optional
  values it reports and its last charge status;
- the public identifiers of the brands' mobile apps (`src/stellantis/apps.json`, already published
  by the Home Assistant integration): they identify the app, not a user;
- network: outbound HTTPS only, to the brand's sign-in server (`idpcvs.peugeot.com`,
  `idpcvs.citroen.com`, `idpcvs.driveds.com`, `idpcvs.opel.com`, `idpcvs.vauxhall.co.uk`) and to
  `api.groupe-psa.com`; nothing listens.

The logs never contain a token, a code, an app secret, a full VIN or a position. A report that one of
them leaks is in scope.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)), the Stellantis cloud
and the cars.
