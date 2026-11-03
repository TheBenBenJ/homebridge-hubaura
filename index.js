'use strict';

/*
 * homebridge-hubaura
 *
 * The Hubaura Sync Box (Tuya protocol 3.4, model RD200) in the Home app, over the local network
 * only. The vendor does not publish the box's data points (DPs): the ones below were captured
 * from the Tuya app on 2026-10-30.
 *
 * DP 101 (mode) follows the tab selected in the app; its "setting_mode" value only lasts while
 * the app's settings are open. Each family of modes has its own brightness DP.
 *
 * Two accessories:
 * - a colour light (bridged, static platform API): power, brightness, hue and saturation;
 * - a mode selector, published as a HomeKit television (outside the bridge) whose inputs are
 *   the modes and scenes.
 */

const TuyAPI = require('tuyapi');

const PLUGIN_NAME = 'homebridge-hubaura';
const PLATFORM_NAME = 'Hubaura';
const DEFAULT_NAME = 'Ambilight';
const RECONNECT_DELAY_MS = 10000;
const COALESCE_DELAY_MS = 150;
const FAILURES_BEFORE_DISCOVERY = 2;
const DISCOVERY_TIMEOUT_S = 30;

// Data point ids, as strings like the keys of tuyapi's dps object.
const DP_MODE = '101';
const DP_POWER = '102';
const DP_TV_BRIGHTNESS = '104'; // TV sync, music and film modes
const DP_COLOR = '111'; // "rrggbb"
const DP_COLOR_BRIGHTNESS = '112';
const DP_SCENE = '113'; // 1 to 12
const DP_SCENE_BRIGHTNESS = '114';

// Values of DP 101.
const MODE_VIDEO = 'video_mode';
const MODE_MUSIC = 'music_mode';
const MODE_FILM = 'film_mode';
const MODE_COLOR = 'color_mode';
const MODE_SCENE = 'ambi_mode';

// Scene names shown in the Home app, in the order of the Tuya app's grid: values 1 to 12 of DP 113.
const SCENES = ['Lecture', 'Réveil', 'Bonne nuit', 'Ciel', 'Romantique', 'Coloré', 'Rêveur', 'Dynamique', 'Boucle', 'Magnifique', 'Tournesol', 'Arc-en-ciel'];

// Inputs of the mode selector, in Home app order: the input identifier is the index + 1.
// Titles are shown in the Home app; the order is part of the accessory identity, keep it.
const INPUTS = [
  { title: 'Synchro TV', mode: MODE_VIDEO },
  { title: 'Musique', mode: MODE_MUSIC },
  { title: 'Film', mode: MODE_FILM },
  { title: 'Couleur fixe', mode: MODE_COLOR },
  ...SCENES.map((title, i) => ({ title, mode: MODE_SCENE, scene: i + 1 })),
];

/** HomeKit hue (0-360) and saturation (0-100), at full value, to the box's "rrggbb" colour. */
function hsToRgbHex(hue, saturation) {
  const c = saturation / 100;
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = 1 - c;
  const sector = Math.floor(hue / 60) % 6;
  const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][sector];
  return [r, g, b].map((n) => Math.round((n + m) * 255).toString(16).padStart(2, '0')).join('');
}

/** The box's "rrggbb" colour to HomeKit hue and saturation (brightness is a separate DP). */
function rgbHexToHs(hex) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (!delta) return { hue: 0, saturation: 0 };
  const hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { hue: Math.round((hue * 60 + 360) % 360), saturation: Math.round((delta / max) * 100) };
}

class HubauraPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.api = api;
    this.config = config;
    this.dps = {}; // last known DP values
    this.failures = 0; // consecutive connection failures
    this.lastInput = 1; // last selector input that matched the box's mode
    if (!config.id || !config.key) {
      log.error('id and key are required in config.json');
      return;
    }
    api.on('didFinishLaunching', () => this.publishModeSelector());
    this.box = new TuyAPI({ id: config.id, key: config.key, ip: config.ip, version: '3.4', issueGetOnConnect: true });
    this.box.on('connected', () => {
      this.failures = 0;
      this.log.info('Box connected');
    });
    this.box.on('disconnected', () => this.scheduleReconnect());
    this.box.on('error', (error) => this.log.debug(`Box: ${error.message}`));
    const onData = (data) => {
      if (data?.dps) {
        Object.assign(this.dps, data.dps);
        this.refresh();
      }
    };
    this.box.on('data', onData);
    this.box.on('dp-refresh', onData);
    this.connect();
  }

  async connect() {
    try {
      if (this.failures >= FAILURES_BEFORE_DISCOVERY) {
        // The DHCP lease may have changed: forget the IP and look for the box on the network.
        this.box.device.ip = undefined;
        await this.box.find({ timeout: DISCOVERY_TIMEOUT_S });
        this.log.info(`Box found at ${this.box.device.ip}`);
      }
      await this.box.connect();
    } catch (error) {
      if (++this.failures === FAILURES_BEFORE_DISCOVERY) {
        this.log.warn(`Box unreachable: ${error.message}`);
      }
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.box.isConnected()) this.connect();
    }, RECONNECT_DELAY_MS);
  }

  /**
   * Writes DPs to the box. The box only applies the last DP of a message that carries several,
   * so each changed DP goes in its own message, power and mode first. The local state is updated
   * before sending, so that the Home app reflects the change at once.
   */
  async send(data) {
    const { HapStatusError, HAPStatus } = this.api.hap;
    if (!this.box?.isConnected()) throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    const previous = { ...this.dps };
    const sent = new Set();
    Object.assign(this.dps, data);
    this.refresh();
    try {
      for (const dp of [DP_POWER, DP_MODE, ...Object.keys(data)]) {
        if (dp in data && !sent.has(dp) && previous[dp] !== data[dp]) {
          sent.add(dp);
          await this.box.set({ dps: Number(dp), set: data[dp] });
        }
      }
    } catch (error) {
      this.log.warn(`Command not delivered: ${error.message}`);
      throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  /** Brightness DP of the current family of modes. */
  brightnessDp() {
    const mode = this.dps[DP_MODE];
    return mode === MODE_COLOR ? DP_COLOR_BRIGHTNESS : mode === MODE_SCENE ? DP_SCENE_BRIGHTNESS : DP_TV_BRIGHTNESS;
  }

  currentColor() {
    return rgbHexToHs(this.dps[DP_COLOR] || 'ffffff');
  }

  /**
   * The Home app writes brightness, hue and saturation separately. They are grouped for
   * COALESCE_DELAY_MS: a colour change becomes one fixed-colour command with its own brightness,
   * while a brightness change alone applies to the current mode (for example TV sync) without
   * switching to the fixed colour.
   */
  setTarget(key, value) {
    const { HapStatusError, HAPStatus } = this.api.hap;
    if (!this.box?.isConnected()) throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    if (key === 'brightness') this.pendingBrightness = Math.max(1, value);
    else this.pendingColor = { ...(this.pendingColor || this.currentColor()), [key]: value };
    clearTimeout(this.coalesceTimer);
    this.coalesceTimer = setTimeout(() => {
      const color = this.pendingColor;
      const brightness = this.pendingBrightness;
      this.pendingColor = this.pendingBrightness = null;
      const data = color
        ? { [DP_POWER]: true, [DP_MODE]: MODE_COLOR, [DP_COLOR]: hsToRgbHex(color.hue, color.saturation), ...(brightness ? { [DP_COLOR_BRIGHTNESS]: brightness } : {}) }
        : { [this.brightnessDp()]: brightness };
      this.send(data).catch(() => {});
    }, COALESCE_DELAY_MS);
  }

  /** Selector input of the current mode; unknown modes such as "setting_mode" keep the previous input. */
  currentInput() {
    const index = INPUTS.findIndex((input) => input.mode === this.dps[DP_MODE] && (input.scene == null || input.scene === this.dps[DP_SCENE]));
    if (index >= 0) this.lastInput = index + 1;
    return this.lastInput;
  }

  /** Pushes the known state to HomeKit. */
  refresh() {
    if (!this.light) return;
    const { Characteristic } = this.api.hap;
    const { hue, saturation } = this.currentColor();
    this.light.updateCharacteristic(Characteristic.On, !!this.dps[DP_POWER])
      .updateCharacteristic(Characteristic.Brightness, this.dps[this.brightnessDp()] ?? 100);
    // While a grouped change is pending, keep the colour the user is choosing.
    if (!this.pendingColor && !this.pendingBrightness) {
      this.light.updateCharacteristic(Characteristic.Hue, hue).updateCharacteristic(Characteristic.Saturation, saturation);
    }
    this.modeSelector?.updateCharacteristic(Characteristic.Active, this.dps[DP_POWER] ? 1 : 0)
      .updateCharacteristic(Characteristic.ActiveIdentifier, this.currentInput());
  }

  /**
   * The mode selector. A HomeKit television is the only way to get a list of choices in a tile,
   * and the Home app requires a television to be published outside the bridge.
   */
  publishModeSelector() {
    const { Service, Characteristic, Categories, uuid } = this.api.hap;
    // "nom" is the historical config key for the name. The name seeds the accessory UUID, which
    // is the HomeKit identity: changing the formula or the name creates a new accessory.
    const name = `${this.config.nom || DEFAULT_NAME} Modes`;
    const accessory = new this.api.platformAccessory(name, uuid.generate(`${PLUGIN_NAME}:${name}`), Categories.TELEVISION);
    this.modeSelector = accessory.addService(Service.Television, name);
    this.modeSelector.setCharacteristic(Characteristic.ConfiguredName, name)
      .setCharacteristic(Characteristic.SleepDiscoveryMode, Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);
    this.modeSelector.getCharacteristic(Characteristic.Active)
      .onGet(() => (this.dps[DP_POWER] ? 1 : 0))
      .onSet((value) => this.send({ [DP_POWER]: !!value }));
    this.modeSelector.getCharacteristic(Characteristic.ActiveIdentifier)
      .onGet(() => this.currentInput())
      .onSet((value) => {
        const { mode, scene } = INPUTS[value - 1];
        return this.send({ [DP_POWER]: true, [DP_MODE]: mode, ...(scene == null ? {} : { [DP_SCENE]: scene }) });
      });
    INPUTS.forEach(({ title }, i) => {
      // The subtype ("entree" = input) is part of the service identity: keep it.
      const input = accessory.addService(Service.InputSource, title, `entree-${i + 1}`);
      input.setCharacteristic(Characteristic.Identifier, i + 1)
        .setCharacteristic(Characteristic.ConfiguredName, title)
        .setCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED)
        .setCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.OTHER)
        .setCharacteristic(Characteristic.CurrentVisibilityState, Characteristic.CurrentVisibilityState.SHOWN);
      this.modeSelector.addLinkedService(input);
    });
    this.refresh();
    this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
  }

  /**
   * Static platform API: the colour light. Homebridge derives its UUID from the platform alias
   * and the name; the subtype ("lampe" = light) and the serial number are kept for the same reason.
   */
  accessories(callback) {
    const { Service, Characteristic } = this.api.hap;
    if (!this.box) return callback([]);
    const name = this.config.nom || DEFAULT_NAME;
    this.light = new Service.Lightbulb(name, 'lampe');
    this.light.getCharacteristic(Characteristic.On)
      .onGet(() => !!this.dps[DP_POWER])
      .onSet((value) => this.send({ [DP_POWER]: !!value }));
    this.light.getCharacteristic(Characteristic.Brightness)
      .onGet(() => this.dps[this.brightnessDp()] ?? 100)
      .onSet((value) => this.setTarget('brightness', value));
    this.light.getCharacteristic(Characteristic.Hue)
      .onGet(() => this.currentColor().hue)
      .onSet((value) => this.setTarget('hue', value));
    this.light.getCharacteristic(Characteristic.Saturation)
      .onGet(() => this.currentColor().saturation)
      .onSet((value) => this.setTarget('saturation', value));
    const information = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, 'Hubaura')
      .setCharacteristic(Characteristic.Model, 'Sync Box ST-HDMI')
      .setCharacteristic(Characteristic.SerialNumber, `${this.config.id}-lampe`);
    this.refresh();
    callback([{ name, getServices: () => [information, this.light] }]);
  }
}

module.exports = (api) => api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, HubauraPlatform);
