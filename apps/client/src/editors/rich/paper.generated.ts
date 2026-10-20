// FILE GENERATO — non modificare a mano.
//
// Le dimensioni della carta di WordCraft (`wordcraft_geom::PAPER_SIZES`), in
// punti e in verticale, arrotondate al ventesimo di punto come le conserva un
// `.docx` (crates/fub-format-rich/tests/ts_paper.rs).
//
// Rigenera con: UPDATE_MIRROR=1 cargo test -p fub-format-rich --test ts_paper

export const PAPER_SIZES: readonly { readonly name: string; readonly w: number; readonly h: number }[] = [
  { name: "Letter", w: 612, h: 792 },
  { name: "Legal", w: 612, h: 1008 },
  { name: "Executive", w: 522, h: 756 },
  { name: "A3", w: 841.9, h: 1190.55 },
  { name: "A4", w: 595.3, h: 841.9 },
  { name: "A5", w: 419.55, h: 595.3 },
  { name: "B4 (JIS)", w: 728.5, h: 1031.8 },
  { name: "B5 (JIS)", w: 515.9, h: 728.5 },
  { name: "Tabloid", w: 792, h: 1224 },
  { name: "Statement", w: 396, h: 612 },
  { name: "Envelope #10", w: 297, h: 684 },
  { name: "Envelope DL", w: 311.8, h: 623.6 },
];
