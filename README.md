# homebridge-hubaura

Homebridge plugin for the Hubaura Sync Box (Tuya protocol 3.4, model RD200). It brings the box's
colour light, its TV sync, music and film modes and its 12 scenes to the Home app, over the local
network only: no cloud at runtime.

Why: the box is only controlled by its vendor's Tuya-based app, without HomeKit support.

## How it works

```
Home app ──HomeKit──> Homebridge (index.js) ──Tuya 3.4, local TCP (tuyapi)──> Sync Box
```

The plugin keeps a local connection to the box, mirrors its data points (DPs) and exposes two
accessories:

- **`<nom>`**, a colour light (inside the Homebridge bridge): power, brightness, hue and
  saturation. Brightness applies to the current mode: TV sync, music and film share one, the
  fixed colour and the scenes each have their own. Choosing a colour switches the box to the
  fixed colour.
- **`<nom> Modes`**, a HomeKit TV used as a mode selector (published as its own accessory). Its
  inputs are Synchro TV, Musique, Film, Couleur fixe and the 12 scenes; turning it off turns the
  box off.

The vendor does not publish the DPs. These were captured from the Tuya app on 2026-10-30:

| DP | Meaning | Values |
| --- | --- | --- |
| 101 | mode | `video_mode` (TV sync), `music_mode`, `film_mode`, `color_mode` (fixed colour), `ambi_mode` (scenes); `setting_mode` while the app's settings are open |
| 102 | power | `true` / `false` |
| 104 | brightness of TV sync, music and film | number |
| 111 | fixed colour | `rrggbb` |
| 112 | brightness of the fixed colour | number |
| 113 | scene | 1 to 12, in the order of the app's grid |
| 114 | brightness of the scenes | number |

## Requirements

- Homebridge 1.6 or 2.x, Node.js 22 or later.
- The box on the same local network as the Homebridge host, and its Tuya device id and local key.

Tested with one box.

## Installation

The plugin is not published on npm. Install it from a clone, in the Homebridge storage
directory (`/var/lib/homebridge` with the official Linux package):

```sh
git clone https://github.com/TheBenBenJ/homebridge-hubaura.git
cd /var/lib/homebridge && npm install /path/to/homebridge-hubaura
```

Get the device id and local key once, with the wizard of
[tinytuya](https://github.com/jasonacox/tinytuya) or from the Tuya IoT platform. The local key
changes when the box is paired again in the app.

Add the platform to Homebridge's `config.json` and restart Homebridge:

```json
{
  "platform": "Hubaura",
  "nom": "Ambilight",
  "id": "DEVICE_ID",
  "key": "LOCAL_KEY",
  "ip": "192.168.1.x"
}
```

| Key | Required | Default | Meaning |
| --- | --- | --- | --- |
| `nom` | no | `Ambilight` | Name of the light; the selector is `<nom> Modes` ("nom" is French for "name"). It also defines the accessories' identity: changing it makes HomeKit see new accessories. |
| `id` | yes | | Tuya device id. |
| `key` | yes | | Tuya local key. |
| `ip` | no | | IP address of the box. Without it, or when it changes, the plugin looks for the box on the network after two failed connections. |

The light comes with the Homebridge bridge. The mode selector is published as its own accessory:
add it in the Home app with the Homebridge setup code.

## Operations and troubleshooting

- Homebridge logs `Box connected` at each connection, `Box unreachable: <reason>` after two
  failed attempts, `Box found at <address>` after a network search, and
  `Command not delivered: <reason>` when a write fails. Debug logging adds the connection errors
  (`Box: <reason>`).
- The plugin reconnects every 10 s. While the box is disconnected, commands fail at once and the
  Home app reports that the accessory is not responding.
- The network search listens to the box's UDP broadcasts on ports 6666 and 6667. If a firewall on
  the host blocks them, set `ip` and give the box a fixed address (DHCP reservation).
- After pairing the box again in the app, update `key`.
- A mode chosen in the vendor's app shows up in the selector; while the app's settings are open
  (`setting_mode`), the selector keeps the previous mode.

## Security

- The local key is the box's secret: anyone on the local network who has the id and the key can
  control the box. Keep it in `config.json` only, and filter it out of logs or configs you share.
- The local traffic is encrypted with that key (Tuya 3.4). No cloud account is used at runtime.
- The repository holds no device id, key or address.

## Design decisions

- **Local Tuya protocol instead of the cloud.** It works without internet access, answers faster,
  and needs no cloud account at runtime. The price is reading the local key once.
- **One message per DP.** The box only applies the last DP of a message that carries several, so
  each changed DP goes in its own message. Power and mode go first, so that the box is on and in
  the right mode when the colour or the scene arrives. Unchanged DPs are skipped.
- **A TV as mode selector.** A HomeKit TV is the only service that gives a list of choices in a
  tile. The Home app requires a TV to be published outside the bridge, hence a second accessory
  added with the setup code. Inputs are numbered by position, so their order is part of the
  identity.
- **The light uses Homebridge's static platform API.** There is no accessory cache to keep in
  sync: the light's identity derives from the platform alias and its name.
- **Brightness follows the mode family.** Each family has its own brightness DP. The light reads
  and writes the one of the current mode, so dimming during TV sync leaves the fixed colour's
  brightness alone.
- **Writes are grouped for 150 ms.** The Home app sends brightness, hue and saturation as
  separate writes. Grouped, a colour change becomes one fixed-colour command with its brightness,
  while a brightness change alone keeps the current mode.
- **`setting_mode` is ignored.** DP 101 only takes this value while the app's settings are open,
  and no input matches it: the selector keeps the previous mode instead of jumping elsewhere.
- **Network search after two failures.** When the DHCP lease changes, the configured address no
  longer answers; searching only after two failures avoids a search on every short outage.
- **The state is updated before the write**, so the Home app reflects a change at once; the
  box's own reports then overwrite it.
- **French names kept where they are identity.** The `nom` config key, the service subtypes
  (`lampe`, `entree-1`...) and the serial number `<id>-lampe` define the accessories in HomeKit:
  renaming them would make HomeKit see new accessories and lose their rooms, scenes and
  automations. `name` is not accepted as an alias, because Homebridge already uses a platform's
  `name` as its log prefix and an existing configuration may contain one. Input and scene names
  are French on purpose: they are what the user reads in the Home app.

## License

MIT, see [LICENSE](LICENSE).
