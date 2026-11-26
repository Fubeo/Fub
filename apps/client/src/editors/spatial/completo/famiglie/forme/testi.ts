// I testi della famiglia «forme» del Disegno completo (piano K6, T13): solo le parole
// dei campi delle finestre delle misure (`campo:<nome>`, giro 2) e di Metodo forma. I nomi corti degli
// strumenti di forma nella colonna stanno nel catalogo del Completo (`draw.engine.name.*`
// in `strings/completo.ts`), perché la colonna li mostra prima che la famiglia arrivi.

export const TESTI: Readonly<Record<string, { readonly it: string; readonly en: string }>> = {
  "campo:width": { it: "Larghezza", en: "Width" },
  "campo:height": { it: "Altezza", en: "Height" },
  "campo:radius": { it: "Raggio", en: "Radius" },
  "campo:radius1": { it: "Raggio esterno", en: "Outer radius" },
  "campo:radius2": { it: "Raggio interno", en: "Inner radius" },
  "campo:diameter": { it: "Diametro", en: "Diameter" },
  "campo:sides": { it: "Lati", en: "Sides" },
  "campo:points": { it: "Punte", en: "Points" },
  "campo:decay": { it: "Decadimento", en: "Decay" },
  "campo:segments": { it: "Segmenti", en: "Segments" },
  "campo:opacity": { it: "Opacità", en: "Opacity" },
  "campo:brightness": { it: "Luminosità", en: "Brightness" },
  "campo:growth": { it: "Crescita", en: "Growth" },
  "campo:fuzziness": { it: "Sfumatura", en: "Fuzziness" },
  "campo:rays": { it: "Raggi", en: "Rays" },
  "campo:longest": { it: "Raggio più lungo", en: "Longest ray" },
  "campo:rayFuzziness": { it: "Sfumatura dei raggi", en: "Ray fuzziness" },
  "campo:rotation": { it: "Rotazione", en: "Rotation" },
  "campo:pathLength": { it: "Lunghezza del percorso", en: "Path length" },
  "campo:rings": { it: "Anelli", en: "Rings" },
  "campo:largest": { it: "Anello più grande", en: "Largest ring" },
  "campo:direction": { it: "Direzione", en: "Direction" },
  "campo:x2": { it: "X finale", en: "End X" },
  "campo:y2": { it: "Y finale", en: "End Y" },
  "campo:fill": { it: "Riempi", en: "Fill" },
  "campo:closed": { it: "Chiuso", en: "Closed" },
  "campo:clockwise": { it: "In senso orario", en: "Clockwise" },
  // Le griglie (T13 giro 7): le righe e le colonne, o i cerchi e i raggi, con le loro
  // inclinazioni (in %, da -500 a 500), la cornice e il riempimento.
  "campo:rows": { it: "Divisori orizzontali", en: "Horizontal dividers" },
  "campo:columns": { it: "Divisori verticali", en: "Vertical dividers" },
  "campo:rowSkew": { it: "Inclinazione orizzontali", en: "Horizontal skew" },
  "campo:columnSkew": { it: "Inclinazione verticali", en: "Vertical skew" },
  "campo:frame": { it: "Cornice esterna", en: "Outside frame" },
  "campo:concentric": { it: "Divisori circolari", en: "Concentric dividers" },
  "campo:radial": { it: "Divisori radiali", en: "Radial dividers" },
  "campo:concentricSkew": { it: "Inclinazione circolari", en: "Concentric skew" },
  "campo:radialSkew": { it: "Inclinazione radiali", en: "Radial skew" },
  "campo:compound": { it: "Anelli composti", en: "Compound rings" },
  "campo:x": { it: "X", en: "X" },
  "campo:y": { it: "Y", en: "Y" },
  // La finestra di Metodo forma (T13): i quattro metodi con i nomi dei pulsanti della
  // sezione «Elaborazione tracciati» (`draw.elaborazione.*`).
  "campo:mode": { it: "Metodo", en: "Mode" },
  "scelta:mode:add": { it: "Unione", en: "Unite" },
  "scelta:mode:subtract": { it: "Meno davanti", en: "Minus Front" },
  "scelta:mode:intersect": { it: "Intersezione", en: "Intersect" },
  "scelta:mode:exclude": { it: "Escludi", en: "Exclude" },
};
