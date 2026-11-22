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
  "strumento:flare": { it: "Riflesso", en: "Flare" },
  "strumento:lineSegment": { it: "Segmento linea", en: "Line Segment" },
  "strumento:arc": { it: "Arco", en: "Arc" },
  "strumento:spiral": { it: "Spirale", en: "Spiral" },
};
