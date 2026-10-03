// Ciò che `spatial-scale.mjs` sa dei disegni che apre, e i budget con cui li
// giudica. Sta in un `.mjs` perché lo leggono in due: lo script, che gira in
// Node fuori da Vite, e `spatial-fixture.test.ts`, che verifica che il
// generatore produca proprio questi disegni.

/// Le fixture come il generatore le scrive. Un cambio del formato o degli
/// strumenti sposta il digest: i numeri di prima non si confrontano più con
/// quelli di dopo, e il test lo dice prima che lo dica lo script.
export const SPATIAL_ORACLES = Object.freeze({
  sparse: Object.freeze({ objects: 200, layers: 1, samples: 2_200, bytes: 219_305, digest: "5ab90522" }),
  dense: Object.freeze({ objects: 5_000, layers: 4, samples: 39_672, bytes: 5_071_951, digest: "46eb084a" }),
  ink: Object.freeze({ objects: 2_000, layers: 1, samples: 200_000, bytes: 14_810_234, digest: "2bf69ff0" }),
});

/// I budget dell'editor in un browser solo.
///
/// - `inkMs`: un campione della penna, dall'evento all'inchiostro disegnato
///   sull'overlay, sta in un fotogramma (16 ms), sul disegno da 2 000 tratti.
/// - `commitMs`: un tratto alzato è scritto, ridisegnato e mostrato in meno di
///   50 ms, sul disegno da 2 000 tratti.
/// - `openMs`: un disegno da 5 MB si apre, dal clic all'ultimo oggetto
///   dipinto, in meno di 500 ms.
/// - `navigationFrameMs` e `navigationLongTasks`: pan e zoom sono fluidi con
///   5 000 oggetti, cioè il 95% dei fotogrammi arriva entro 20 ms e nessun
///   task supera 50 ms.
/// - `memoryRatio`: la memoria della scena, ciò che l'editor tiene in
///   JavaScript del disegno aperto, sta entro tre volte il peso del file. Il
///   DOM del painter SVG non vi rientra: il referto lo riporta a parte, come
///   `pageRatio`, perché dipende dal painter e non dalla scena.
///
/// I budget fra due dispositivi, col tratto che arriva dal tablet, non si
/// misurano qui: servono il tablet vero e la sua rete.
export const SPATIAL_BUDGETS = Object.freeze({
  inkMs: 16,
  commitMs: 50,
  openMs: 500,
  navigationFrameMs: 20,
  navigationLongTasks: 0,
  memoryRatio: 3,
});
