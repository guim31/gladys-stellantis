# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-14

### Added

- Peugeot, Citroën, DS, Opel and Vauxhall cars of a MyPeugeot, MyCitroën, MyDS, MyOpel or
  MyVauxhall account in Gladys, one device per car (electric, plug-in hybrid or combustion): battery
  level, electric range, charging state, plugged in, charging, charging speed and time remaining,
  fuel level and range, total range, mileage, locks, door or boot open, preconditioning, outside
  temperature, depending on what each car sends.
- GPS position of the cars, off by default.
- Sign-in with the brand's own page: "Connect", then the code pasted in "Finish the sign-in"; the
  session then renews itself. "Test the connection" and "Sign out" actions.
- The cloud is read every 10 to 60 minutes (15 by default), never waking the car.
- Scene trigger "Charge finished" and scene action "Read a Stellantis car now".
- Dashboard widget "My car (Stellantis)".
- Documentation in English, French, German and Spanish, with a browser-by-browser guide to the
  sign-in code.

[Unreleased]: https://github.com/guim31/gladys-stellantis/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-stellantis/releases/tag/v1.0.1
