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

## Behaviour you must not break

- The box only applies the last data point of a message: each changed data point goes in its own message, power and mode first (pinned by a test).
- Brightness, hue and saturation are grouped for 150 ms into one command; brightness never goes below 1.
- Accessory names, subtypes, input order and serial numbers seed the HomeKit identity: changing them creates new accessories and breaks the owner's scenes and automations.

## Operational rules

- **Never push directly to `main`** without the owner's explicit validation: a green push to `main` fast-forwards `production`, which the home server deploys.
- No device id, local key or address in the repository (they live in the Homebridge `config.json`).
