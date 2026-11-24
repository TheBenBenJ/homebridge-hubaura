'use strict';

// Offline tests: no Homebridge, no box, no network. `tuyapi` is replaced by a recording fake, a fake `api` captures the
// platform class, and node's mock timers stand in for the clock. Run: npm test (node --test).

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const { afterEach, describe, mock, test } = require('node:test');

class FakeTuya extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.device = { ip: options.ip };
    this.connected = true;
    this.sets = [];
  }
  isConnected() {
    return this.connected;
  }
  async connect() {}
  async find() {}
  async set(message) {
    if (this.fail) throw new Error('box refused');
    this.sets.push(message);
  }
}

const realLoad = Module._load;
Module._load = (request, ...rest) => (request === 'tuyapi' ? FakeTuya : realLoad(request, ...rest));
const plugin = require('../index.js');
Module._load = realLoad;

class FakeHapStatusError extends Error {
  constructor(status) {
    super(`HAP status ${status}`);
    this.status = status;
  }
}

function makePlatform(config = { id: 'box1', key: 'secret', ip: '10.0.0.5' }) {
  let registered;
  const handlers = {};
  const api = {
    hap: { HapStatusError: FakeHapStatusError, HAPStatus: { SERVICE_COMMUNICATION_FAILURE: -70402 } },
    on: (event, handler) => {
      handlers[event] = handler;
    },
    registerPlatform: (name, alias, platformClass) => {
      registered = { name, alias, platformClass };
    },
  };
  plugin(api);
  const messages = { error: [], warn: [] };
  const log = {
    info: () => {},
    debug: () => {},
    warn: (m) => messages.warn.push(m),
    error: (m) => messages.error.push(m),
  };
  const platform = new registered.platformClass(log, config, api);
  return { platform, registered, handlers, messages };
}

afterEach(() => mock.timers.reset());

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('colour conversion', () => {
  test('primary colours at full saturation', () => {
    assert.equal(plugin.hsToRgbHex(0, 100), 'ff0000');
    assert.equal(plugin.hsToRgbHex(60, 100), 'ffff00');
    assert.equal(plugin.hsToRgbHex(120, 100), '00ff00');
    assert.equal(plugin.hsToRgbHex(240, 100), '0000ff');
    assert.equal(plugin.hsToRgbHex(300, 100), 'ff00ff');
  });

  test('no saturation is white, half saturation is a lighter colour', () => {
    assert.equal(plugin.hsToRgbHex(200, 0), 'ffffff');
    assert.equal(plugin.hsToRgbHex(0, 50), 'ff8080');
  });

  test('the box colour goes back to hue and saturation', () => {
    assert.deepEqual(plugin.rgbHexToHs('ff0000'), { hue: 0, saturation: 100 });
    assert.deepEqual(plugin.rgbHexToHs('00ff00'), { hue: 120, saturation: 100 });
    assert.deepEqual(plugin.rgbHexToHs('0000ff'), { hue: 240, saturation: 100 });
    assert.deepEqual(plugin.rgbHexToHs('ffffff'), { hue: 0, saturation: 0 });
  });

  test('a round trip stays within rounding error', () => {
    for (const hue of [0, 30, 75, 120, 195, 240, 285, 330]) {
      for (const saturation of [20, 60, 100]) {
        const back = plugin.rgbHexToHs(plugin.hsToRgbHex(hue, saturation));
        assert.ok(Math.abs(back.hue - hue) <= 2, `hue ${hue} -> ${back.hue}`);
        assert.ok(Math.abs(back.saturation - saturation) <= 2, `saturation ${saturation} -> ${back.saturation}`);
      }
    }
  });
});

describe('mode selector table', () => {
  test('four modes then the twelve scenes, in the order that is part of the accessory identity', () => {
    assert.equal(plugin.INPUTS.length, 16);
    assert.deepEqual(
      plugin.INPUTS.slice(0, 4).map((input) => input.title),
      ['Synchro TV', 'Musique', 'Film', 'Couleur fixe'],
    );
    assert.deepEqual(
      plugin.INPUTS.slice(4).map((input) => input.scene),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    );
    assert.equal(new Set(plugin.INPUTS.map((input) => input.title)).size, 16);
  });
});

describe('platform', () => {
  test('registers under the plugin name and the platform alias that seed the HomeKit identity', () => {
    const { registered } = makePlatform();
    assert.equal(registered.name, 'homebridge-hubaura');
    assert.equal(registered.alias, 'Hubaura');
  });

  test('without id and key it logs an error and stays inert', () => {
    const { platform, handlers, messages } = makePlatform({});
    assert.equal(platform.box, undefined);
    assert.deepEqual(handlers, {});
    assert.match(messages.error.join(), /id and key are required/);
  });

  test('the box connects with the local key, protocol 3.4', () => {
    const { platform } = makePlatform();
    assert.equal(platform.box.options.id, 'box1');
    assert.equal(platform.box.options.version, '3.4');
  });

  test('data from the box updates the known data points', () => {
    const { platform } = makePlatform();
    platform.box.emit('data', { dps: { 102: true, 101: 'color_mode' } });
    assert.equal(platform.dps[102], true);
    assert.equal(platform.dps[101], 'color_mode');
  });
});

describe('sending data points', () => {
  test('refuses when the box is not connected', async () => {
    const { platform } = makePlatform();
    platform.box.connected = false;
    await assert.rejects(platform.send({ 102: true }), FakeHapStatusError);
    assert.equal(platform.box.sets.length, 0);
  });

  test('one message per changed data point, power and mode first, unchanged ones skipped', async () => {
    const { platform } = makePlatform();
    platform.dps = { 102: true, 101: 'video_mode' };
    await platform.send({ 111: 'ff0000', 101: 'color_mode', 102: true, 112: 80 });
    assert.deepEqual(platform.box.sets, [
      { dps: 101, set: 'color_mode' },
      { dps: 111, set: 'ff0000' },
      { dps: 112, set: 80 },
    ]);
  });

  test('a refused write becomes a HomeKit communication failure', async () => {
    const { platform, messages } = makePlatform();
    platform.box.fail = true;
    await assert.rejects(platform.send({ 102: true }), FakeHapStatusError);
    assert.match(messages.warn.join(), /Command not delivered: box refused/);
  });
});

describe('modes and brightness', () => {
  test('each family of modes has its own brightness data point', () => {
    const { platform } = makePlatform();
    platform.dps = { 101: 'color_mode' };
    assert.equal(platform.brightnessDp(), '112');
    platform.dps = { 101: 'ambi_mode' };
    assert.equal(platform.brightnessDp(), '114');
    platform.dps = { 101: 'video_mode' };
    assert.equal(platform.brightnessDp(), '104');
  });

  test('the selector input follows the mode and the scene; an unknown mode keeps the previous input', () => {
    const { platform } = makePlatform();
    platform.dps = { 101: 'music_mode' };
    assert.equal(platform.currentInput(), 2);
    platform.dps = { 101: 'ambi_mode', 113: 3 };
    assert.equal(platform.currentInput(), 7);
    platform.dps = { 101: 'setting_mode' };
    assert.equal(platform.currentInput(), 7);
  });
});

describe('grouped writes from the Home app', () => {
  test('hue and saturation become one fixed-colour command', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const { platform } = makePlatform();
    platform.setTarget('hue', 120);
    platform.setTarget('saturation', 100);
    platform.setTarget('brightness', 40);
    mock.timers.tick(150);
    await flush();
    assert.deepEqual(platform.box.sets, [
      { dps: 102, set: true },
      { dps: 101, set: 'color_mode' },
      { dps: 111, set: '00ff00' },
      { dps: 112, set: 40 },
    ]);
  });

  test('a brightness change alone keeps the current mode', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const { platform } = makePlatform();
    platform.dps = { 102: true, 101: 'video_mode', 104: 50 };
    platform.setTarget('brightness', 0);
    mock.timers.tick(150);
    await flush();
    assert.deepEqual(platform.box.sets, [{ dps: 104, set: 1 }], 'brightness never goes below 1');
  });

  test('refuses when the box is not connected', () => {
    const { platform } = makePlatform();
    platform.box.connected = false;
    assert.throws(() => platform.setTarget('hue', 10), FakeHapStatusError);
  });
});
