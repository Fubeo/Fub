// Il catalogo delle icone del disegno: ogni figura `draw-…` sta qui, col
// tratto delle icone della shell (griglia di 24, soltanto tracciati, estremi
// tondi). Gli strumenti, i comandi e i pannelli le chiamano per nome; un test
// vieta di registrarne altrove.
//
// Si registrano una volta per tutte le superfici, al primo editor o pannello
// che le chiede, e restano finché la shell vive, come quelle di serie.

import { icon, registerIcon } from "../../ui/icons";

// Gli strumenti e i comandi.
/// Le icone della barra, col costrutto di `ui/icons.ts`.
const STATE: Readonly<Record<string, readonly string[]>> = {
  "draw-select": ["M6 3v15.5l4.2-4.1 2.9 6.6 2.6-1.1-2.9-6.5H19z"],
  // Una mano aperta: quattro dita e il pollice.
  "draw-hand": ["M8 13V5.5a1.5 1.5 0 0 1 3 0V12", "M11 11V4a1.5 1.5 0 0 1 3 0v7", "M14 11V5.5a1.5 1.5 0 0 1 3 0V13", "M17 9.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.6-2.2L4.5 15.6a1.6 1.6 0 0 1 2.4-2.1L8 14.5"],
  // Una lente.
  "draw-zoom": ["M4 10.5a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0-13 0", "M15.5 15.5L20 20"],
  "draw-pen": ["M4 20l1-4.5L16 4.5a2.1 2.1 0 0 1 3 3L8 18.5z", "M14 6.5l3 3"],
  "draw-eraser": ["M9 20h11", "M5.5 15.5l9.6-9.6a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12.5 18.5 9 20l-3.5-1.5a2 2 0 0 1 0-3z", "M10 11l5 5"],
  "draw-rect": ["M4 6h16v12H4z"],
  "draw-ellipse": ["M3 12a9 6.5 0 1 0 18 0a9 6.5 0 1 0-18 0"],
  "draw-line": ["M5 19L19 5"],
  "draw-arrow": ["M5 19L19 5", "M10 5h9v9"],
  // Due quadratini, uno in alto a sinistra e uno in basso a destra, e il
  // gomito che li unisce con la freccia.
  "draw-connector": ["M3 3h6v6H3z", "M15 15h6v6h-6z", "M9 6h3v12h3", "M13 16l2 2-2 2"],
  "draw-polygon": ["M7.5 4.2h9l4.5 7.8-4.5 7.8h-9L3 12z"],
  "draw-star": ["M12 3l2.1 6.6H21l-5.5 4 2.1 6.6-5.6-4.1-5.6 4.1 2.1-6.6L3 9.6h6.9z"],
  "draw-highlighter": ["M13.5 3.5l7 7-7 7-7-7z", "M6.5 10.5L3 18l3 3 7.5-3.5", "M15 21h6"],
  // Un foglietto con l'angolo piegato, e due righe.
  "draw-note": ["M5 4h14v10l-5 6H5z", "M14 20v-6h5", "M8 8.5h8", "M8 11.5h4"],
  // Un rettangolo pieno, a tratteggio.
  "draw-cover": ["M4 6h16v12H4z", "M4 11l5-5", "M4 17l11-11", "M10 18l10-10", "M16 18l4-4"],
  "draw-color-more": ["M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0", "M12 8v8", "M8 12h8"],
  "draw-undo": ["M9 14L4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 0 11H11"],
  "draw-redo": ["M15 14l5-5-5-5", "M20 9H9.5a5.5 5.5 0 0 0 0 11H13"],
  "draw-zoom-in": ["M12 5v14", "M5 12h14"],
  "draw-zoom-out": ["M5 12h14"],
  "draw-fit": ["M4 9V4h5", "M15 4h5v5", "M20 15v5h-5", "M9 20H4v-5"],
  "draw-duplicate": ["M9 9h11v11H9z", "M15 9V4H4v11h5"],
  "draw-group": ["M3 7V3h4", "M17 3h4v4", "M21 17v4h-4", "M7 21H3v-4", "M7 7h6v6H7z", "M11 11h6v6h-6z"],
  "draw-ungroup": ["M3 3h8v8H3z", "M13 13h8v8h-8z"],
  "draw-symbol": ["M12 2l3 3-3 3-3-3z", "M12 16l3 3-3 3-3-3z", "M5 9l3 3-3 3-3-3z", "M19 9l3 3-3 3-3-3z"],
  "draw-detach": ["M7 3l3 3-3 3-3-3z", "M17 15l3 3-3 3-3-3z", "M4 20L20 4"],
  // Tre petali uguali intorno a un centro: un originale e le sue copie.
  "draw-repeat": ["M12 14C10 10.7 10 7.3 12 4C14 7.3 14 10.7 12 14z", "M12 14C15.9 13.9 18.8 15.6 20.7 19C16.8 19.1 13.9 17.4 12 14z", "M12 14C10.1 17.4 7.2 19.1 3.3 19C5.2 15.6 8.1 13.9 12 14z"],
  "draw-order": ["M10 14H4V4h10v6", "M10 10h10v10H10z"],
  "draw-align": ["M4 3v18", "M8 6h12v5H8z", "M8 14h7v5H8z"],
  "draw-layers": ["M12 3l9 5-9 5-9-5z", "M3 13l9 5 9-5", "M3 17.5l9 5 9-5"],
  "draw-into-layer": ["M12 11l9 5-9 5-9-5z", "M12 2v7", "M9 6l3 3 3-3"],
  "draw-page-grid": ["M3 3h18v18H3z", "M9 3v18", "M15 3v18", "M3 9h18", "M3 15h18"],
  // Un foglio coi suoi segni di taglio: i bordi che continuano oltre gli
  // angoli.
  "draw-board": ["M2 6h20", "M2 18h20", "M6 2v20", "M18 2v20"],
  // Una pipetta: la punta in basso a sinistra, il bulbo in alto a destra.
  "draw-eyedropper": ["M13 9L5.5 16.5 4 20l3.5-1.5L15 11", "M11.5 7.5l5 5", "M12.5 8.5l4-4a2.1 2.1 0 0 1 3 3l-4 4"],
  // Un riquadro che scurisce verso destra, con righe sempre più fitte.
  "draw-gradient": ["M3 5h18v14H3z", "M11 5v14", "M15 5v14", "M18 5v14"],
  "draw-text": ["M5 7V4h14v3", "M12 4v16", "M9 20h6"],
  "draw-image": ["M3 5h18v14H3z", "M3 17l5-5 5 5", "M11 15l4-4 6 6", "M14.5 8.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0"],
  "draw-text-edit": ["M3 6V4h11v2", "M8.5 4v15", "M6 19h5", "M18 8v12", "M16 8h4", "M16 20h4"],
  "draw-link": ["M9.5 14.5l5-5", "M11 6.5l1.5-1.5a3.5 3.5 0 0 1 5 5L16 11.5", "M8 12.5L6.5 14a3.5 3.5 0 0 0 5 5L13 17.5"],
  "draw-unlink": ["M11 6.5l1.5-1.5a3.5 3.5 0 0 1 5 5L16 11.5", "M8 12.5L6.5 14a3.5 3.5 0 0 0 5 5L13 17.5", "M4 8h2.5", "M8 4v2.5", "M20 16h-2.5", "M16 20v-2.5"],
  "draw-open-link": ["M14 4h6v6", "M20 4l-9 9", "M18 14v6H4V6h6"],
  "draw-attributes": ["M8 7l-5 5 5 5", "M16 7l5 5-5 5", "M13.5 5l-3 14"],
  "draw-outline": ["M3 6h18", "M3 12h4", "M10 12h4", "M17 12h4", "M3.5 18h0", "M8.5 18h0", "M13.5 18h0", "M18.5 18h0"],
  "draw-transform": ["M4 10h10v10H4z", "M10 4a10 10 0 0 1 10 10", "M16.5 11.5L20 14l2.5-3.5"],
  "draw-apply-transform": ["M2 17L6 5h9l-4 12z", "M15 16.5l2.5 2.5L22 14"],
  "draw-to-path": ["M5 19C5 11 11 5 19 5", "M3 17h4v4H3z", "M17 3h4v4h-4z"],
  "draw-to-shape": ["M3 19c2-3 3.5 0 5.5-2.5S12 16 14 13", "M13 3h8v8h-8z"],
  "draw-boolean": ["M3 10a7 7 0 1 0 14 0a7 7 0 1 0-14 0", "M7 14a7 7 0 1 0 14 0a7 7 0 1 0-14 0"],
  // Un'immagine coi suoi monti, e sotto il tracciato che se ne ricava.
  "draw-trace-image": ["M3 3h11v9H3z", "M3 10l3-3 3 3 2-2 3 3", "M6 21c3 0 4-5 7.5-5s4 3 6.5 3", "M19.5 17.5h3v3h-3z"],
  "draw-text-path": ["M3 20C6 12 18 12 21 20", "M7 4h10", "M12 4v9"],
  // Le due squadre della taglierina, che si incrociano.
  "draw-crop": ["M6 2v16h16", "M2 6h16v16"],
  // Le stesse, barrate.
  "draw-uncrop": ["M6 2v16h16", "M2 6h16v16", "M3 3l18 18"],
  // Un cerchio pieno in un quadrato a tratti: fuori dalla forma non si vede.
  "draw-mask": ["M3 6V3h3", "M10 3h4", "M18 3h3v3", "M21 10v4", "M21 18v3h-3", "M14 21h-4", "M6 21H3v-3", "M3 14v-4", "M6 12a6 6 0 1 0 12 0a6 6 0 1 0-12 0"],
  "draw-nodes": ["M4 3v12l3.2-3.1 2.3 5.1 2-.9-2.3-5H15z", "M16 16h5v5h-5z"],
  "draw-builder": ["M3 9a6 6 0 1 0 12 0a6 6 0 1 0-12 0", "M9 9h11v11H9z", "M5 17v5", "M2.5 19.5h5"],
  // Due anelli in basso, e le lame che si incrociano verso l'alto.
  "draw-scissors": ["M3.5 18a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0", "M15.5 18a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0", "M7.8 16.2L17 3", "M16.2 16.2L7 3"],
  // Una linea che si gonfia in mezzo, e il punto che la allarga.
  "draw-width": ["M2 12C6 7.5 18 7.5 22 12C18 16.5 6 16.5 2 12z", "M12 3v18", "M10 5l2-2 2 2", "M10 19l2 2 2-2"],
  "draw-bezier": ["M12 21L7 12l3-8h4l3 8z", "M12 21v-7.5", "M10.5 12a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0"],
  // Tre punti, e la curva che vi passa.
  "draw-curvature": ["M4 18C4 11 7.5 7 12 7s8 4 8 11", "M2.5 18a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0", "M10.5 7a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0", "M18.5 18a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0"],
  "draw-node-add": ["M3 19c4-6 14-6 18 0", "M10.5 13h3v3h-3z", "M12 3v6", "M9 6h6"],
  "draw-node-delete": ["M3 19c4-6 14-6 18 0", "M10.5 13h3v3h-3z", "M9 6h6"],
  "draw-node-corner": ["M3 20l9-13 9 13", "M12 4l3 3-3 3-3-3z"],
  "draw-node-smooth": ["M3 20C3 13 7 8 12 8s9 5 9 12", "M10.5 6.5h3v3h-3z", "M7 8h3.5", "M13.5 8H20"],
  "draw-node-symmetric": ["M3 20C3 13 7 8 12 8s9 5 9 12", "M10.5 8a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0", "M5 8h5.5", "M13.5 8H19"],
  "draw-segment-line": ["M3 17h4v4H3z", "M17 3h4v4h-4z", "M7 17L17 7"],
  "draw-segment-curve": ["M3 17h4v4H3z", "M17 3h4v4h-4z", "M7 19c7 0 12-5 12-12"],
  "draw-node-break": ["M2 12h6", "M16 12h6", "M8 10h3v4H8z", "M13 10h3v4h-3z"],
  "draw-node-join": ["M2 12h4", "M18 12h4", "M10.5 10.5h3v3h-3z", "M6 9l3 3-3 3", "M18 9l-3 3 3 3"],
  "draw-lasso": ["M3.5 9.5a8.5 5.5 0 1 0 17 0a8.5 5.5 0 1 0-17 0", "M8 14.5c-2 1.5-2 4 0 4.5s3.5 0 3.5 2.5"],
  "draw-selection": ["M4 7V4h3", "M10 4h4", "M17 4h3v3", "M20 10v4", "M20 17v3h-3", "M14 20h-4", "M7 20H4v-3", "M4 14v-4"],
  "draw-back": ["M10 6l-6 6 6 6", "M4 12h16"],
  "draw-history": ["M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5", "M3.5 4v4.5H8", "M12 7.5V12l3 2"],
  "draw-access": ["M12 2.75a1.75 1.75 0 1 0 0 3.5a1.75 1.75 0 1 0 0-3.5z", "M5 8.5l7 1.5 7-1.5", "M12 10v4.5", "M8.5 21l3.5-6.5 3.5 6.5"],
  // L'elenco delle tavole: due fogli affiancati, ognuno col suo nome sopra.
  "draw-boards": ["M3 8.5h8v11H3z", "M14 8.5h7v7h-7z", "M3 5h5", "M14 5h4"],
  // Presenta: uno schermo sul suo piede, col triangolo del via.
  "draw-present": ["M3 4.5h18v11H3z", "M12 15.5V20", "M8.5 20h7", "M10.5 7.5l4 2.5-4 2.5z"],
  // Le forme: un quadrato, un cerchio e un triangolo.
  "draw-library": ["M3 3h8v8H3z", "M13 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0", "M12 14l5 7H7z"],
  // I simboli: un rombo, come «Crea simbolo», sopra una pila di fogli.
  "draw-symbols": ["M12 2.5l4.5 4.5-4.5 4.5L7.5 7z", "M4.5 14l7.5 4 7.5-4", "M4.5 18l7.5 4 7.5-4"],
};

// Le proprietà: allinea, ordina, testo, pagina, punte.
/// Le icone del pannello, col costrutto di `ui/icons.ts`.
const PROPERTIES: Readonly<Record<string, readonly string[]>> = {
  "draw-align-left": ["M4 3v18", "M8 6h12v4H8z", "M8 14h7v4H8z"],
  "draw-align-center": ["M12 3v18", "M6 6h12v4H6z", "M8.5 14h7v4h-7z"],
  "draw-align-right": ["M20 3v18", "M4 6h12v4H4z", "M9 14h7v4H9z"],
  "draw-align-top": ["M3 4h18", "M6 8h4v12H6z", "M14 8h4v7h-4z"],
  "draw-align-middle": ["M3 12h18", "M6 6h4v12H6z", "M14 8.5h4v7h-4z"],
  "draw-align-bottom": ["M3 20h18", "M6 4h4v12H6z", "M14 9h4v7h-4z"],
  "draw-distribute-x": ["M4 4v16", "M20 4v16", "M10 7h4v10h-4z"],
  "draw-distribute-y": ["M4 4h16", "M4 20h16", "M7 10h10v4H7z"],
  "draw-order-front": ["M5 4h14", "M12 20V8", "M7 13l5-5 5 5"],
  "draw-order-forward": ["M12 19V6", "M7 11l5-5 5 5"],
  "draw-order-backward": ["M12 5v13", "M7 13l5 5 5-5"],
  "draw-order-back": ["M5 20h14", "M12 4v12", "M7 11l5 5 5-5"],
  "draw-anchor-start": ["M4 6h16", "M4 10h10", "M4 14h16", "M4 18h10"],
  "draw-anchor-middle": ["M4 6h16", "M7 10h10", "M4 14h16", "M7 18h10"],
  "draw-anchor-end": ["M4 6h16", "M10 10h10", "M4 14h16", "M10 18h10"],
  "draw-text-point": ["M8 5h10", "M13 5v12", "M3 19h4", "M5 17v4"],
  "draw-text-area": ["M4 4h16v16H4z", "M8 8h8", "M12 8v8"],
  "draw-text-bold": ["M7 5h6a3.5 3.5 0 0 1 0 7H7z", "M7 12h7a3.5 3.5 0 0 1 0 7H7z"],
  "draw-text-italic": ["M10 5h8", "M6 19h8", "M14 5l-4 14"],
  "draw-text-underline": ["M7 4v7a5 5 0 0 0 10 0V4", "M5 20h14"],
  "draw-text-strike": ["M4 12h16", "M16 7.5C15.4 6 13.8 5 12 5c-2.2 0-4 1.2-4 3 0 1.3.8 2.1 2 2.6", "M8 16.5c.6 1.5 2.2 2.5 4 2.5 2.2 0 4-1.2 4-3 0-.7-.2-1.2-.6-1.6"],
  "draw-ratio": ["M9 8V6.5a3 3 0 0 1 6 0V8", "M9 16v1.5a3 3 0 0 0 6 0V16", "M12 10v4"],
  "draw-portrait": ["M7 3h10v18H7z"],
  "draw-landscape": ["M3 7h18v10H3z"],
  "draw-section": ["M8 10l4 4 4-4"],
  // Le punte delle linee: una linea orizzontale con la punta a sinistra
  // (l'inizio) o a destra (la fine). Le icone sono soltanto tratti: una forma
  // piena è il suo contorno con dentro altri contorni a un'unità l'uno
  // dall'altro, che a 16 e a 24 px si vedono come un riempimento.
  "draw-tip-none": ["M3 12h18"],
  "draw-tip-triangle-start": ["M21 12h-9.5", "M11.5 6.5 3 12l8.5 5.5z", "M10.5 8.34 4.84 12l5.66 3.66z", "M9.5 10.18 6.68 12l2.82 1.82z", "M8.5 12h.01"],
  "draw-tip-triangle-end": ["M3 12h9.5", "M12.5 6.5 21 12l-8.5 5.5z", "M13.5 8.34 19.16 12l-5.66 3.66z", "M14.5 10.18 17.32 12l-2.82 1.82z", "M15.5 12h.01"],
  "draw-tip-vee-start": ["M3 12h18", "M9.5 7 3 12l6.5 5"],
  "draw-tip-vee-end": ["M3 12h18", "M14.5 7 21 12l-6.5 5"],
  "draw-tip-circle-start": ["M21 12h-9", "M3 12a4.5 4.5 0 1 0 9 0 4.5 4.5 0 1 0-9 0z", "M4 12a3.5 3.5 0 1 0 7 0 3.5 3.5 0 1 0-7 0z", "M5 12a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0z", "M6 12a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0z", "M7 12a.5 .5 0 1 0 1 0 .5 .5 0 1 0-1 0z"],
  "draw-tip-circle-end": ["M3 12h9", "M12 12a4.5 4.5 0 1 0 9 0 4.5 4.5 0 1 0-9 0z", "M13 12a3.5 3.5 0 1 0 7 0 3.5 3.5 0 1 0-7 0z", "M14 12a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0z", "M15 12a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0z", "M16 12a.5 .5 0 1 0 1 0 .5 .5 0 1 0-1 0z"],
  "draw-tip-square-start": ["M21 12h-10", "M3 8h8v8H3z", "M4 9h6v6H4z", "M5 10h4v4H5z", "M6 11h2v2H6z"],
  "draw-tip-square-end": ["M3 12h10", "M13 8h8v8h-8z", "M14 9h6v6h-6z", "M15 10h4v4h-4z", "M16 11h2v2h-2z"],
  "draw-tip-diamond-start": ["M21 12h-8", "M13 12l-5-5-5 5 5 5z", "M11.59 12 8 8.41 4.41 12 8 15.59z", "M10.17 12 8 9.83 5.83 12 8 14.17z", "M7.24 12 8 11.24 8.76 12 8 12.76z"],
  "draw-tip-diamond-end": ["M3 12h8", "M11 12l5-5 5 5-5 5z", "M12.41 12 16 8.41 19.59 12 16 15.59z", "M13.83 12 16 9.83 18.17 12 16 14.17z", "M15.24 12 16 11.24 16.76 12 16 12.76z"],
  "draw-tip-bar-start": ["M21 12H4", "M4 6.5v11"],
  "draw-tip-bar-end": ["M3 12h17", "M20 6.5v11"],
  // Una punta che non è della raccolta: un punto interrogativo al posto della forma.
  "draw-tip-other-start": ["M13 12h8", "M5.6 9.2a2.9 2.9 0 1 1 4.6 2.3c-1.2.8-1.8 1.4-1.8 2.7", "M8.4 17.6h.01"],
  "draw-tip-other-end": ["M3 12h8", "M13.6 9.2a2.9 2.9 0 1 1 4.6 2.3c-1.2.8-1.8 1.4-1.8 2.7", "M16.4 17.6h.01"],
  "draw-tips-swap": ["M4 8h14", "M14.5 4.5 18 8l-3.5 3.5", "M20 16H6", "M9.5 12.5 6 16l3.5 3.5"],
};

// Gli oggetti.
/// Le icone dei segni, col costrutto di `ui/icons.ts`: il lucchetto e
/// l'occhio sbarrato.
const OBJECTS: Readonly<Record<string, readonly string[]>> = {
  "draw-lock": ["M6 11h12v9H6z", "M8.5 11V8a3.5 3.5 0 0 1 7 0v3"],
  "draw-hidden": ["M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z", "M9.5 12a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0", "M4 4l16 16"],
};

// La cronologia.
/// Le icone del pannello, col costrutto di `ui/icons.ts`: il triangolo del
/// punto di adesso, la bandierina del segno e la croce che lo toglie.
const HISTORY_PANEL: Readonly<Record<string, readonly string[]>> = {
  "draw-here": ["M8 5.5l10 6.5-10 6.5z"],
  "draw-mark": ["M6 21V4", "M6 4h11.5l-2.5 4.5 2.5 4.5H6"],
  "draw-unmark": ["M7 7l10 10", "M17 7L7 17"],
};

// Le tavole.
/// Le icone del pannello, col costrutto di `ui/icons.ts`: il più di «Nuova
/// tavola» e il triangolo della tavola di adesso.
const BOARDS_PANEL: Readonly<Record<string, readonly string[]>> = {
  "draw-board-add": ["M12 5v14", "M5 12h14"],
  "draw-board-here": ["M8 5.5l10 6.5-10 6.5z"],
};

// L'accessibilità.
/// Le icone della gravità, col costrutto di `ui/icons.ts`: il triangolo
/// dell'avviso e il cerchio della nota.
const ACCESSIBILITY_PANEL: Readonly<Record<string, readonly string[]>> = {
  "draw-access-warning": ["M12 3.5L21.5 20H2.5z", "M12 9.5V14", "M12 17v.01"],
  "draw-access-info": ["M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z", "M12 11v5.5", "M12 7.5v.01"],
};

// I suggerimenti.
/// La lampadina, sul reticolo delle icone.
const SUGGESTIONS: Readonly<Record<string, readonly string[]>> = {
  "draw-suggestion": ["M9 18h6", "M10 21h4", "M12 3a6 6 0 0 0-3.8 10.6c.6.5.8 1.2.8 1.9V16h6v-.5c0-.7.2-1.4.8-1.9A6 6 0 0 0 12 3z"],
};

// I campioni.
/// Le icone della sezione, col costrutto di `ui/icons.ts`: il più di «Nuovo
/// campione…».
const SWATCHES_PANEL: Readonly<Record<string, readonly string[]>> = {
  "draw-swatches-add": ["M12 5v14", "M5 12h14"],
};

// I connettori.
/// Il riquadro di un oggetto agganciato, lo stesso in ogni figura: due
/// oggetti, e fra loro la linea di quel tipo.
const FROM = "M3 15h6v6H3z";
const TO = "M15 3h6v6h-6z";
/// Le icone della sezione, col costrutto di `ui/icons.ts`.
const CONNECTOR_PANEL: Readonly<Record<string, readonly string[]>> = {
  "draw-connector-straight": [FROM, TO, "M9 15 15 9"],
  "draw-connector-elbow": [FROM, TO, "M9 18h3V6h3"],
  "draw-connector-curved": [FROM, TO, "M9 18c3.5 0 2.5-12 6-12"],
};

// Le sfumature.
/// Le icone della sezione, col costrutto di `ui/icons.ts`.
const GRADIENT_PANEL: Readonly<Record<string, readonly string[]>> = {
  "draw-gradient-add": ["M12 5v14", "M5 12h14"],
  "draw-gradient-remove": ["M5 12h14"],
  "draw-gradient-reverse": ["M4 8h14", "M14 4l4 4-4 4", "M20 16H6", "M10 12l-4 4 4 4"],
  "draw-gradient-presets": ["M4 4h7v7H4z", "M13 4h7v7h-7z", "M4 13h7v7H4z", "M13 13h7v7h-7z"],
};

// Le campiture.
/// Il riquadro di ogni figura: lo stesso delle altre icone di una sezione.
const FRAME = "M4 4h16v16H4z";
/// Un puntino della figura delle puntinate: un cerchietto pieno per il tratto.
const dot = (x: number, y: number): string => `M${x - 0.6} ${y}a0.6 0.6 0 1 0 1.2 0a0.6 0.6 0 1 0-1.2 0z`;
/// Le icone della sezione, col costrutto di `ui/icons.ts`: la figura di
/// ogni campitura pronta, di una personalizzata e di un motivo.
const HATCH_PANEL: Readonly<Record<string, readonly string[]>> = {
  "draw-hatch-none": [FRAME, "M4 20 20 4"],
  "draw-hatch-diagonal": [FRAME, "M4 12 12 4", "M4 20 20 4", "M12 20l8-8"],
  "draw-hatch-cross": [FRAME, "M4 12 12 4", "M4 20 20 4", "M12 20l8-8", "M12 4l8 8", "M4 4l16 16", "M4 12l8 8"],
  "draw-hatch-horizontal": [FRAME, "M4 8h16", "M4 12h16", "M4 16h16"],
  "draw-hatch-dots": [FRAME, dot(8, 8), dot(16, 8), dot(12, 12), dot(8, 16), dot(16, 16)],
  "draw-hatch-grid": [FRAME, "M4 9.33h16", "M4 14.67h16", "M9.33 4v16", "M14.67 4v16"],
  "draw-hatch-custom": [FRAME, "M4 9c3-3 5 3 8 0s5 3 8 0", "M4 15c3-3 5 3 8 0s5 3 8 0"],
  "draw-hatch-pattern": [FRAME, "M12 4v8h8", "M4 12h8v8"],
};

// Gli effetti.
/// Le icone della sezione, col costrutto di `ui/icons.ts`.
const EFFECTS_PANEL: Readonly<Record<string, readonly string[]>> = {
  "draw-effect-add": ["M12 5v14", "M5 12h14"],
  "draw-effect-remove": ["M5 12h14"],
  "draw-effect-shown": ["M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"],
  "draw-effect-hidden": ["M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", "M4 4l16 16"],
  "draw-effect-chevron": ["M8 10l4 4 4-4"],
};

// L'impianto nuovo: la mano e lo zoom, il menu, gli interruttori della vista,
// le schede dell'ispettore, il riempimento e il contorno.
const CHROME: Readonly<Record<string, readonly string[]>> = {
  // Una mano aperta: quattro dita e il pollice.
  "draw-hand": ["M8 13V5.5a1.5 1.5 0 0 1 3 0V11", "M11 10V4.5a1.5 1.5 0 0 1 3 0V11", "M14 10.5V6a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7h-.5a6 6 0 0 1-4.6-2.2L3.6 15.4a1.5 1.5 0 0 1 2.3-1.9L8 15.5"],
  "draw-zoom": ["M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13z", "M15.5 15.5 20 20", "M8 10.5h5", "M10.5 8v5"],
  "draw-menu": ["M4 6h16", "M4 12h16", "M4 18h16"],
  "draw-export": ["M12 4v11", "M8 8l4-4 4 4", "M5 14v5h14v-5"],
  // Due frecce che girano fra i due quadrati di Riempimento e Contorno.
  "draw-swap": ["M7 4h7a3 3 0 0 1 3 3v7", "M14 11l3 3 3-3", "M17 20h-7a3 3 0 0 1-3-3v-7", "M10 13l-3-3-3 3"],
  "draw-none": ["M5 5h14v14H5z", "M5 19 19 5"],
  "draw-rulers": ["M3 3h18v5H8v13H3z", "M7 3v2.5", "M11 3v2.5", "M15 3v2.5", "M19 3v2.5", "M3 12h2.5", "M3 16h2.5"],
  "draw-guides": ["M8 3v18", "M3 15h18"],
  "draw-snap": ["M7 4v7a5 5 0 0 0 10 0V4", "M7 8h3", "M14 8h3"],
  "draw-navigator": ["M3 5h18v14H3z", "M12 10h6v6h-6z"],
  "draw-hide-ui": ["M3 5h18v14H3z", "M7 9h0", "M4 4l16 16"],
  "draw-commands": ["M5 8l4 4-4 4", "M12 17h7"],
  "draw-keys": ["M3 6h18v12H3z", "M7 10h.01", "M11 10h.01", "M15 10h.01", "M8 14h8"],
  "draw-design": ["M4 6h10", "M18 6h2", "M4 12h4", "M12 12h8", "M4 18h12", "M20 18h0", "M16 4v4", "M10 10v4", "M18 16v4"],
  "draw-resources": ["M4 4h7v7H4z", "M13 4h7v7h-7z", "M4 13h7v7H4z", "M16.5 13v7", "M13 16.5h7"],
  "draw-flip-h": ["M12 3v18", "M9 7 4 17h5z", "M15 7l5 10h-5z"],
  "draw-flip-v": ["M3 12h18", "M7 9 17 4v5z", "M7 15l10 5v-5z"],
  "draw-rotate": ["M20 11a8 8 0 1 0-2.3 5.7", "M20 4v7h-7"],
  "draw-simple": ["M4 20l1-4.5L16 4.5a2.1 2.1 0 0 1 3 3L8 18.5z"],
  "draw-more": ["M6 12h.01", "M12 12h.01", "M18 12h.01"],
};

/// Tutte le figure, per nome.
export const DRAW_ICONS: Readonly<Record<string, readonly string[]>> = {
  ...STATE,
  ...PROPERTIES,
  ...OBJECTS,
  ...HISTORY_PANEL,
  ...BOARDS_PANEL,
  ...ACCESSIBILITY_PANEL,
  ...SUGGESTIONS,
  ...SWATCHES_PANEL,
  ...CONNECTOR_PANEL,
  ...GRADIENT_PANEL,
  ...HATCH_PANEL,
  ...EFFECTS_PANEL,
  ...CHROME,
};

/// Registra le figure che mancano. Si chiama a ogni montaggio: costa un giro
/// sul catalogo.
export function ensureDrawIcons(): void {
  for (const [name, paths] of Object.entries(DRAW_ICONS)) if (icon(name) === "") registerIcon(name, paths);
}
