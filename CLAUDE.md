# homebridge-hubaura

Homebridge plugin: the Hubaura Sync Box (Tuya protocol 3.4) in the Home app, over the local network only: a colour light and a mode selector published as a television. Overview and setup: [`README.md`](README.md). Agent quick map: [`AGENTS.md`](AGENTS.md).

## Engineering Standards (Mandatory)

1. **Small and readable**: one `index.js` with named constants at the top (data point ids, mode values, delays), focused methods, the only dependency is `tuyapi`. Keep the Homebridge entry point `module.exports = (api) => api.registerPlatform(...)`; the helpers attached to it are test hooks, never a public API.
2. **100% English technical code**: identifiers, comments, tests, docs and commit messages in English. The scene and mode titles shown in the Home app (`Synchro TV`, `Lecture`, `Réveil`…), the `nom` config key and the subtypes are part of the HomeKit identity and stay as they are.
3. **Offline tests required**: every rule or bug fix comes with a test in `test/plugin.test.js` (recording fake of `tuyapi`, fake Homebridge `api`, mock timers; no network, no box, no key).
4. **Required checks before every commit**:
   ```sh
   npx --yes @biomejs/biome@2.6.8 check .
   node --test
   ```
   Check that a new test fails when the rule it pins is broken (change the code, watch it fail, restore it).

## Readability Standards (Mandatory, same in every repository)

Full text: `docs/engineering-standards.md` of the `home-server` repository (French → English vocabulary: `docs/decisions.md` of the `dashboard` repository).

1. **Limits**: functions ≤ 60 lines (100 with a comment that says why); lines ≤ 120 characters (100 in the Dashboard's JavaScript); early returns instead of nested `if`; no dead or commented-out code; no history in comments (git and the changelog keep it).
2. **Named structures**: `@dataclass(slots=True)` or `{ key, label }` objects, never `d[0]` or a hand-built nested dict; more than 3 parameters → an options object or keyword-only signature; named constants with their unit for every threshold, delay and size.
3. **Types and docs**: annotated signatures (Python), JSDoc `@typedef` for data shapes (JavaScript); a docstring or JSDoc that says WHY on every module and shared function.
4. **Errors and output**: precise exceptions, never swallowed in silence, `raise … from error`; `logging` instead of `print` outside interactive tools.
5. **Contracts**: a key, path or protocol word read by another program (often French) is never renamed on one side only; produce it from English attributes and read it through English locals.
6. **A readability pass changes no behaviour**: characterization test first, output compared before and after, `grep -rn` every rename across the repository (tools, tests, units, installers), entry points keep their name and command line, no bug fixed in passing (it goes in the report), one commit per module on `refactor/<language>-readability-<module>`, never pushed to `main` without the owner's validation. A new test must fail when the rule it pins is broken.

## Behaviour you must not break

- The box only applies the last data point of a message: each changed data point goes in its own message, power and mode first (pinned by a test).
- Brightness, hue and saturation are grouped for 150 ms into one command; brightness never goes below 1.
- Accessory names, subtypes, input order and serial numbers seed the HomeKit identity: changing them creates new accessories and breaks the owner's scenes and automations.

## Operational rules

- **Never push directly to `main`** without the owner's explicit validation: a green push to `main` fast-forwards `production`, which the home server deploys.
- No device id, local key or address in the repository (they live in the Homebridge `config.json`).
