# homebridge-hubaura

Local HomeKit control for the Hubaura Sync Box (Tuya protocol 3.4, model RD200): colour light, TV sync, music and film modes, 12 scenes. No cloud at runtime.

Pilote la Sync Box Hubaura depuis l'app Maison, en local : lampe colorée, Synchro TV, Musique, Film et 12 scènes. Aucun passage par le cloud en fonctionnement.

Le fabricant ne publie pas ses DP Tuya : ceux d'`index.js` ont été relevés depuis l'app (`101` mode, `102` marche, `104` luminosité TV, `111` couleur, `112` luminosité couleur, `113` scène, `114` luminosité scène). La box n'applique que le dernier DP d'un message groupé : le plugin envoie donc un message par DP.

## Installation

Le plugin n'est pas sur npm : installe-le depuis ce dossier, puis ajoute à la config Homebridge :

```json
{ "platform": "Hubaura", "nom": "Ambilight", "id": "DEVICE_ID", "key": "LOCAL_KEY", "ip": "192.168.1.x" }
```

`id` et `key` s'obtiennent avec [tinytuya](https://github.com/jasonacox/tinytuya) ou la plateforme Tuya IoT. `ip` est facultatif : après deux échecs le plugin cherche la box sur le réseau. Le sélecteur de modes est publié hors du pont : ajoute-le à l'app Maison avec le code de Homebridge.

Testé sur une seule box.
