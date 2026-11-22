// Le parole della famiglia «trasforma» del Disegno completo (piano K6, T13, giro 3): le
// finestre con anteprima di Sposta, Ruota, Scala, Rifletti e Inclina. Il Completo le legge
// quando la famiglia è pronta, prima di aprire la finestra del comando.

import type { Etichette } from "../../opzioni";

export const TESTI: Etichette = {
  "azione:object.move": { it: "Sposta", en: "Move" },
  "azione:object.rotate": { it: "Ruota", en: "Rotate" },
  "azione:object.scale": { it: "Scala", en: "Scale" },
  "azione:object.reflect": { it: "Rifletti", en: "Reflect" },
  "azione:object.shear": { it: "Inclina", en: "Shear" },
  "azione:object.transformEach": { it: "Trasforma singolarmente", en: "Transform Each" },
  "campo:scaleH": { it: "Scala orizzontale", en: "Horizontal scale" },
  "campo:scaleV": { it: "Scala verticale", en: "Vertical scale" },
  "campo:moveH": { it: "Spostamento orizzontale", en: "Horizontal move" },
  "campo:moveV": { it: "Spostamento verticale", en: "Vertical move" },
  "campo:rotate": { it: "Angolo", en: "Angle" },
  "unita:scaleH": { it: "%", en: "%" },
  "unita:scaleV": { it: "%", en: "%" },
  "unita:moveH": { it: "px", en: "px" },
  "unita:moveV": { it: "px", en: "px" },
  "unita:rotate": { it: "°", en: "°" },
  "campo:dx": { it: "Orizzontale", en: "Horizontal" },
  "campo:dy": { it: "Verticale", en: "Vertical" },
  "campo:angle": { it: "Angolo", en: "Angle" },
  "campo:sx": { it: "Scala", en: "Scale" },
  "campo:axis": { it: "Asse", en: "Axis" },
  "scelta:axis:vertical": { it: "Verticale", en: "Vertical" },
  "scelta:axis:horizontal": { it: "Orizzontale", en: "Horizontal" },
  "unita:dx": { it: "px", en: "px" },
  "unita:dy": { it: "px", en: "px" },
  "unita:angle": { it: "°", en: "°" },
  "unita:sx": { it: "%", en: "%" },
  // Disponi (K6 T13): la misura di ciascuno e l'opacità casuale, con le loro finestre.
  "azione:addon.arrange.size": { it: "Imposta", en: "Set" },
  "azione:addon.arrange.randomizeOpacity": { it: "Applica", en: "Apply" },
  "campo:width": { it: "Larghezza", en: "Width" },
  "campo:height": { it: "Altezza", en: "Height" },
  "campo:proportional": { it: "Proporzionale", en: "Proportional" },
  "campo:min": { it: "Minimo", en: "Minimum" },
  "campo:max": { it: "Massimo", en: "Maximum" },
  "campo:seed": { it: "Seme", en: "Seed" },
  "unita:width": { it: "px", en: "px" },
  "unita:height": { it: "px", en: "px" },
  "unita:min": { it: "%", en: "%" },
  "unita:max": { it: "%", en: "%" },
};
