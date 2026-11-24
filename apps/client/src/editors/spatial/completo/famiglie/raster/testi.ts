// I testi della famiglia «raster» del Disegno completo (piano K6): le chiavi
// delle sue finestre e sezioni che l'indice generato non porta. Gli effetti
// col filtro SVG (Ombra esterna, Bagliori, Sfuma, Sfocatura gaussiana): i
// nomi dei campi e delle scelte, i metodi di fusione come nel pannello
// Trasparenza.

export const TESTI: Readonly<Record<string, { readonly it: string; readonly en: string }>> = {
  "campo:mode": { it: "Metodo", en: "Mode" },
  "campo:opacity": { it: "Opacità", en: "Opacity" },
  "campo:x": { it: "Spostamento X", en: "X Offset" },
  "campo:y": { it: "Spostamento Y", en: "Y Offset" },
  "campo:blur": { it: "Sfocatura", en: "Blur" },
  "campo:shade": { it: "Ombra con", en: "Shade" },
  "scelta:shade:color": { it: "Colore", en: "Color" },
  "scelta:shade:darkness": { it: "Scurezza", en: "Darkness" },
  "campo:color": { it: "Colore", en: "Color" },
  "campo:darkness": { it: "Scurezza", en: "Darkness" },
  "campo:source": { it: "Origine", en: "Source" },
  "scelta:source:center": { it: "Centro", en: "Center" },
  "scelta:source:edge": { it: "Bordo", en: "Edge" },
  "campo:radius": { it: "Raggio", en: "Radius" },
  "scelta:mode:normal": { it: "Normale", en: "Normal" },
  "scelta:mode:darken": { it: "Scurisci", en: "Darken" },
  "scelta:mode:multiply": { it: "Moltiplica", en: "Multiply" },
  "scelta:mode:color-burn": { it: "Brucia colore", en: "Color Burn" },
  "scelta:mode:lighten": { it: "Schiarisci", en: "Lighten" },
  "scelta:mode:screen": { it: "Schermo", en: "Screen" },
  "scelta:mode:color-dodge": { it: "Scherma colore", en: "Color Dodge" },
  "scelta:mode:overlay": { it: "Sovrapponi", en: "Overlay" },
  "scelta:mode:soft-light": { it: "Luce soffusa", en: "Soft Light" },
  "scelta:mode:hard-light": { it: "Luce intensa", en: "Hard Light" },
  "scelta:mode:difference": { it: "Differenza", en: "Difference" },
  "scelta:mode:exclusion": { it: "Esclusione", en: "Exclusion" },
  "scelta:mode:hue": { it: "Tonalità", en: "Hue" },
  "scelta:mode:saturation": { it: "Saturazione", en: "Saturation" },
  "scelta:mode:color": { it: "Colore", en: "Color" },
  "scelta:mode:luminosity": { it: "Luminosità", en: "Luminosity" },
};
