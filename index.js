// Sync Box Hubaura (Tuya 3.4, modèle RD200) dans l'app Maison, en local. Les DP viennent d'un relevé fait depuis l'app Tuya le 30/10/2026, le fabricant ne les publie pas.
// Le mode 101 suit l'onglet de l'app : setting_mode n'y dure que le temps d'ouvrir les réglages. Chaque famille de modes a sa propre luminosité.
const TuyAPI = require('tuyapi');
const PLUGIN = 'homebridge-hubaura', PLATEFORME = 'Hubaura', ATTENTE = 10000, REGROUPEMENT = 150;
const MODE = '101', MARCHE = '102', LUM_TV = '104', COULEUR = '111', LUM_COULEUR = '112', SCENE = '113', LUM_SCENE = '114';
const VIDEO = 'video_mode', MUSIQUE = 'music_mode', FILM = 'film_mode', UNIE = 'color_mode', AMBIANCE = 'ambi_mode';
const SCENES = ['Lecture', 'Réveil', 'Bonne nuit', 'Ciel', 'Romantique', 'Coloré', 'Rêveur', 'Dynamique', 'Boucle', 'Magnifique', 'Tournesol', 'Arc-en-ciel'];  // valeurs 1 à 12 du DP 113, dans l'ordre de la grille de l'app
const ENTREES = [{ titre: 'Synchro TV', mode: VIDEO }, { titre: 'Musique', mode: MUSIQUE }, { titre: 'Film', mode: FILM }, { titre: 'Couleur fixe', mode: UNIE },
  ...SCENES.map((titre, i) => ({ titre, mode: AMBIANCE, scene: i + 1 }))];

function versRgb(h, s) {
  const c = s / 100, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = 1 - c, i = Math.floor(h / 60) % 6;
  const [r, v, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][i];
  return [r, v, b].map(n => Math.round((n + m) * 255).toString(16).padStart(2, '0')).join('');
}

function depuisRgb(hex) {
  const [r, v, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255), max = Math.max(r, v, b), d = max - Math.min(r, v, b);
  if (!d) return { h: 0, s: 0 };
  const h = max === r ? ((v - b) / d) % 6 : max === v ? (b - r) / d + 2 : (r - v) / d + 4;
  return { h: Math.round((h * 60 + 360) % 360), s: Math.round((d / max) * 100) };
}

class Hubaura {
  constructor(log, config, api) {
    this.log = log; this.api = api; this.config = config; this.dps = {}; this.echecs = 0; this.derniere = 1;
    if (!config.id || !config.key) { log.error('id et key requis dans config.json'); return; }
    api.on('didFinishLaunching', () => this.publier());
    this.box = new TuyAPI({ id: config.id, key: config.key, ip: config.ip, version: '3.4', issueGetOnConnect: true });
    this.box.on('connected', () => { this.echecs = 0; this.log.info('Box connectée'); });
    this.box.on('disconnected', () => this.planifier());
    this.box.on('error', e => this.log.debug(`Box : ${e.message}`));
    const recevoir = d => { if (d?.dps) { Object.assign(this.dps, d.dps); this.rafraichir(); } };
    this.box.on('data', recevoir); this.box.on('dp-refresh', recevoir);
    this.connecter();
  }

  async connecter() {
    try {
      if (this.echecs >= 2) { this.box.device.ip = undefined; await this.box.find({ timeout: 30 }); this.log.info(`Box retrouvée sur ${this.box.device.ip}`); }  // bail DHCP changé
      await this.box.connect();
    } catch (e) {
      if (++this.echecs === 2) this.log.warn(`Box injoignable : ${e.message}`);
      this.planifier();
    }
  }

  planifier() {
    if (this.attente) return;
    this.attente = setTimeout(() => { this.attente = null; if (!this.box.isConnected()) this.connecter(); }, ATTENTE);
  }

  async envoyer(data) {
    const { HapStatusError, HAPStatus } = this.api.hap;
    if (!this.box?.isConnected()) throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    const avant = { ...this.dps }, envoyes = new Set();
    Object.assign(this.dps, data); this.rafraichir();
    try {
      for (const dp of [MARCHE, MODE, ...Object.keys(data)]) {  // la box n'applique que le dernier DP d'un message groupé : un message par DP, marche et mode d'abord
        if (dp in data && !envoyes.has(dp) && avant[dp] !== data[dp]) { envoyes.add(dp); await this.box.set({ dps: Number(dp), set: data[dp] }); }
      }
    } catch (e) {
      this.log.warn(`Commande non transmise : ${e.message}`);
      throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  dpLuminosite() { const m = this.dps[MODE]; return m === UNIE ? LUM_COULEUR : m === AMBIANCE ? LUM_SCENE : LUM_TV; }
  couleur() { return depuisRgb(this.dps[COULEUR] || 'ffffff'); }

  viser(cle, v) {  // Maison envoie luminosité, teinte et saturation séparément : regroupées, la luminosité d'une couleur ne touche pas celle de la synchro
    const { HapStatusError, HAPStatus } = this.api.hap;
    if (!this.box?.isConnected()) throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    if (cle === 'lum') this.lumVisee = Math.max(1, v);
    else this.vise = { ...(this.vise || this.couleur()), [cle]: v };
    clearTimeout(this.regroupement);
    this.regroupement = setTimeout(() => {
      const vise = this.vise, lum = this.lumVisee; this.vise = this.lumVisee = null;
      const data = vise ? { [MARCHE]: true, [MODE]: UNIE, [COULEUR]: versRgb(vise.h, vise.s), ...(lum ? { [LUM_COULEUR]: lum } : {}) } : { [this.dpLuminosite()]: lum };
      this.envoyer(data).catch(() => {});
    }, REGROUPEMENT);
  }

  entree() {  // setting_mode ne dure que le temps des réglages de l'app : on garde l'entrée précédente
    const i = ENTREES.findIndex(e => e.mode === this.dps[MODE] && (e.scene == null || e.scene === this.dps[SCENE]));
    if (i >= 0) this.derniere = i + 1;
    return this.derniere;
  }

  rafraichir() {
    if (!this.lampe) return;
    const { Characteristic: C } = this.api.hap, { h, s } = this.couleur();
    this.lampe.updateCharacteristic(C.On, !!this.dps[MARCHE]).updateCharacteristic(C.Brightness, this.dps[this.dpLuminosite()] ?? 100);
    if (!this.vise && !this.lumVisee) this.lampe.updateCharacteristic(C.Hue, h).updateCharacteristic(C.Saturation, s);
    this.selecteur?.updateCharacteristic(C.Active, this.dps[MARCHE] ? 1 : 0).updateCharacteristic(C.ActiveIdentifier, this.entree());
  }

  publier() {  // une télé HomeKit est le seul moyen d'avoir une liste de choix dans une tuile, et Maison exige qu'elle soit publiée hors du pont
    const { Service: S, Characteristic: C, Categories, uuid } = this.api.hap, nom = `${this.config.nom || 'Ambilight'} Modes`;
    const acc = new this.api.platformAccessory(nom, uuid.generate(`${PLUGIN}:${nom}`), Categories.TELEVISION);
    this.selecteur = acc.addService(S.Television, nom);
    this.selecteur.setCharacteristic(C.ConfiguredName, nom).setCharacteristic(C.SleepDiscoveryMode, C.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);
    this.selecteur.getCharacteristic(C.Active).onGet(() => (this.dps[MARCHE] ? 1 : 0)).onSet(v => this.envoyer({ [MARCHE]: !!v }));
    this.selecteur.getCharacteristic(C.ActiveIdentifier).onGet(() => this.entree()).onSet(v => {
      const { mode, scene } = ENTREES[v - 1];
      return this.envoyer({ [MARCHE]: true, [MODE]: mode, ...(scene == null ? {} : { [SCENE]: scene }) });
    });
    ENTREES.forEach(({ titre }, i) => {
      const e = acc.addService(S.InputSource, titre, `entree-${i + 1}`);
      e.setCharacteristic(C.Identifier, i + 1).setCharacteristic(C.ConfiguredName, titre).setCharacteristic(C.IsConfigured, C.IsConfigured.CONFIGURED)
        .setCharacteristic(C.InputSourceType, C.InputSourceType.OTHER).setCharacteristic(C.CurrentVisibilityState, C.CurrentVisibilityState.SHOWN);
      this.selecteur.addLinkedService(e);
    });
    this.rafraichir();
    this.api.publishExternalAccessories(PLUGIN, [acc]);
  }

  accessories(rendre) {
    const { Service: S, Characteristic: C } = this.api.hap;
    if (!this.box) return rendre([]);
    const nom = this.config.nom || 'Ambilight';
    this.lampe = new S.Lightbulb(nom, 'lampe');
    this.lampe.getCharacteristic(C.On).onGet(() => !!this.dps[MARCHE]).onSet(v => this.envoyer({ [MARCHE]: !!v }));
    this.lampe.getCharacteristic(C.Brightness).onGet(() => this.dps[this.dpLuminosite()] ?? 100).onSet(v => this.viser('lum', v));
    this.lampe.getCharacteristic(C.Hue).onGet(() => this.couleur().h).onSet(v => this.viser('h', v));
    this.lampe.getCharacteristic(C.Saturation).onGet(() => this.couleur().s).onSet(v => this.viser('s', v));
    const info = new S.AccessoryInformation().setCharacteristic(C.Manufacturer, 'Hubaura').setCharacteristic(C.Model, 'Sync Box ST-HDMI').setCharacteristic(C.SerialNumber, `${this.config.id}-lampe`);
    this.rafraichir();
    rendre([{ name: nom, getServices: () => [info, this.lampe] }]);
  }
}

module.exports = api => api.registerPlatform(PLUGIN, PLATEFORME, Hubaura);
