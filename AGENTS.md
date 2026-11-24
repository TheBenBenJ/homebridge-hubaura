# AGENTS.md — homebridge-hubaura

Quick reference for coding agents working in this repository. Rules: [`CLAUDE.md`](CLAUDE.md); setup and behaviour: [`README.md`](README.md).

## Layout

| Path | Role |
|---|---|
| `index.js` | The whole plugin: `HubauraPlatform` (connection and reconnection, writes, grouped colour changes, mode selector, light) and colour helpers. |
| `config.schema.json` | Settings shown in the Homebridge UI. |
| `test/plugin.test.js` | Offline tests (`node --test`): fake `tuyapi`, fake Homebridge API, mock timers. |
| `biome.json` | Lint and format rules (Biome 2.6.8, run through `npx`). |
| `.github/workflows/ci.yml` | Checks, then promotion of `main` to `production`. |

## Verification Commands

```sh
npx --yes @biomejs/biome@2.6.8 check .
node --test
```

## Deployment

A green push to `main` moves `production`, which the home server's deployer pulls and applies. Agents never push to `main` without the owner's validation.
