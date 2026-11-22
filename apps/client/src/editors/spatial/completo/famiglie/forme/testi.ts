// I testi della famiglia «forme» del Disegno completo (piano K6): i nomi corti
// degli strumenti di forma nella colonna e nel cassetto (`strumento:<id>`,
// l'indice porta il nome lungo, «Strumento Rettangolo»), e le finestre e le
// sezioni che l'indice generato non porta (T13 giro 1: nessuna, le finestre
// delle misure le porta lo schema).
//
// Rettangolo ed Ellisse esistono anche nel Semplice (K5): nella stessa tendina
// il nome del motore porta «(Completo)», come Selezione, Mano e Zoom (T11).

export const TESTI: Readonly<Record<string, { readonly it: string; readonly en: string }>> = {
  "strumento:rectangle": { it: "Rettangolo (Completo)", en: "Rectangle (Full)" },
  "strumento:roundedRectangle": { it: "Rettangolo arrotondato", en: "Rounded Rectangle" },
  "strumento:ellipse": { it: "Ellisse (Completo)", en: "Ellipse (Full)" },
  "strumento:polygon": { it: "Poligono", en: "Polygon" },
  "strumento:star": { it: "Stella", en: "Star" },
  "strumento:lineSegment": { it: "Segmento linea", en: "Line Segment" },
  "strumento:arc": { it: "Arco", en: "Arc" },
  "strumento:spiral": { it: "Spirale", en: "Spiral" },
  // Le parole dei campi delle finestre delle misure (`campo:<nome>`, T13 giro 2).
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
};
