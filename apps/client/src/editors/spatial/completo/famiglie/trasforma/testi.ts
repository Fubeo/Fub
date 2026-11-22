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
  "campo:dx": { it: "Orizzontale", en: "Horizontal" },
  "campo:dy": { it: "Verticale", en: "Vertical" },
  "campo:angle": { it: "Angolo", en: "Angle" },
  "campo:sx": { it: "Scala", en: "Scale" },
  "campo:axis": { it: "Asse", en: "Axis" },
  "scelta:axis:vertical": { it: "Verticale", en: "Vertical" },
  "scelta:axis:horizontal": { it: "Orizzontale", en: "Horizontal" },
  "unita:dx": { it: "pt", en: "pt" },
  "unita:dy": { it: "pt", en: "pt" },
  "unita:angle": { it: "°", en: "°" },
  "unita:sx": { it: "%", en: "%" },
};
