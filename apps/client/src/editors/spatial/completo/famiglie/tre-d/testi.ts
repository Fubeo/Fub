// I testi della famiglia «tre-d» del Disegno completo (piano K6): le chiavi
// delle sue finestre che l'indice generato non porta: i campi degli effetti 3D
// (Estrusione e smusso, Rivoluzione, Ruota, Gonfia).

export const TESTI: Readonly<
  Record<string, { readonly it: string; readonly en: string }>
> = {
  "campo:depth": { it: "Profondità", en: "Depth" },
  "campo:twist": { it: "Torsione", en: "Twist" },
  "campo:taper": { it: "Rastremazione", en: "Taper" },
  "campo:cap": { it: "Chiusura", en: "Cap" },
  "campo:bevel": { it: "Smusso", en: "Bevel" },
  "campo:bevelWidth": { it: "Larghezza smusso", en: "Bevel Width" },
  "campo:bevelHeight": { it: "Altezza smusso", en: "Bevel Height" },
  "campo:bevelRepeat": { it: "Ripetizioni smusso", en: "Bevel Repeat" },
  "campo:bevelSpace": { it: "Spazio fra gli smussi", en: "Bevel Space" },
  "campo:bevelInside": { it: "Smusso verso l'interno", en: "Bevel Inside" },
  "campo:bevelBothSides": { it: "Smusso sui due lati", en: "Bevel Both Sides" },
  "campo:volume": { it: "Volume", en: "Volume" },
  "campo:bothSides": { it: "Gonfia i due lati", en: "Inflate Both Sides" },
  "campo:rotationX": { it: "Rotazione X", en: "Rotation X" },
  "campo:rotationY": { it: "Rotazione Y", en: "Rotation Y" },
  "campo:rotationZ": { it: "Rotazione Z", en: "Rotation Z" },
  "campo:perspectiveAngle": { it: "Prospettiva", en: "Perspective" },
  "campo:perspective": {
    it: "Prospettiva (forma vecchia)",
    en: "Perspective (legacy)",
  },
  "campo:shade": { it: "Ombreggia", en: "Shade" },
  "campo:lightColor": { it: "Colore della luce", en: "Light Color" },
  "campo:lights": { it: "Luci", en: "Lights" },
  "campo:lightRotation": { it: "Rotazione della luce", en: "Light Rotation" },
  "campo:lightHeight": { it: "Altezza della luce", en: "Light Height" },
  "campo:lightBehind": { it: "Luce da dietro", en: "Light Behind" },
  "campo:lightIntensity": { it: "Intensità della luce", en: "Light Intensity" },
  "campo:lightSoftness": { it: "Morbidezza della luce", en: "Light Softness" },
  "campo:ambient": { it: "Luce ambiente", en: "Ambient Light" },
  "campo:lightAzimuth": {
    it: "Azimut della luce (forma vecchia)",
    en: "Light Azimuth (legacy)",
  },
  "campo:lightElevation": {
    it: "Elevazione della luce (forma vecchia)",
    en: "Light Elevation (legacy)",
  },
  "campo:angle": { it: "Angolo", en: "Angle" },
  "campo:offset": { it: "Distanza dall'asse", en: "Offset" },
  "campo:edge": { it: "Bordo", en: "Edge" },
  "campo:segments": { it: "Segmenti", en: "Segments" },
  "campo:expandVisibleOnly": {
    it: "Espandi solo le facce visibili",
    en: "Expand Visible Only",
  },
  "scelta:bevel:none": { it: "Nessuno", en: "None" },
  "scelta:bevel:classic": { it: "Classico", en: "Classic" },
  "scelta:bevel:rounded": { it: "Arrotondato", en: "Rounded" },
  "scelta:bevel:cove": { it: "Concavo", en: "Cove" },
  "scelta:bevel:step": { it: "A gradino", en: "Step" },
  "scelta:bevel:ogee": { it: "A gola", en: "Ogee" },
  "scelta:edge:left": { it: "Bordo sinistro", en: "Left Edge" },
  "scelta:edge:right": { it: "Bordo destro", en: "Right Edge" },
};
