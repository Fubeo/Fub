// L'indice di prova del banco per il menu ≡ e la ricerca Ctrl+/ del Disegno
// completo (K6 T9a). Le voci sono quelle del prototipo `PLAN-ui/disegno-completo.html`
// (lo stato `menu`, Oggetto, e lo stato `tavolozza`, la ricerca «sposta»), con
// il loro posto nell'indice di oggi: `?indice=prova` le porta al Completo, al
// posto dell'indice generato, che oggi è vuoto (nessuna riga è ancora fatta).
// Il perché delle voci spente lo dà `comandiProva`, come il motore vero.
//
// Le voci del tracciato stanno in Oggetto › Tracciato, «Sposta…» in Oggetto ›
// Trasforma e «Sposta sul livello corrente» in Oggetto › Disponi, come nel
// prototipo: il terzo livello di ≡ (K6 T9c, `SOTTOMENU` del catalogo).

import type { DrawingCommandInfo, DrawingDisabledReason } from "../src/host/contract";
import type { FileIndice, VoceIndice } from "../src/editors/spatial/completo/indice";

/// Una voce della prova: il nome nelle due lingue, il posto, il tasto e il comando.
function voce(id: string, posto: string, it: string, en: string, comando: string, tasto: string | null, famiglia: string): VoceIndice {
  return {
    fonte: "motore",
    id,
    chiamata: { comando },
    etichetta: { it, en },
    posto,
    famiglia,
    tasto,
    effetto: "cambia",
    finestra: false,
  };
}

/// Le voci della prova, nell'ordine dell'indice: prima il menu Oggetto, poi la
/// ricerca «sposta» (che il prototipo elenca nello stesso ordine).
export const INDICE_PROVA: FileIndice = {
  voci: [
    voce("draw.group", "menu/oggetto", "Raggruppa", "Group", "disegno.raggruppa", "Ctrl+G", "tracciati"),
    voce("draw.ungroup", "menu/oggetto", "Separa", "Ungroup", "disegno.separa", "Ctrl+Shift+G", "tracciati"),
    voce("draw.unlockAll", "menu/oggetto", "Sblocca tutto", "Unlock all", "disegno.sblocca-tutto", "Ctrl+Alt+2", "nucleo"),
    voce("draw.path.join", "menu/oggetto/tracciato", "Unisci", "Join", "disegno.unisci", "Ctrl+J", "tracciati"),
    voce("draw.path.reverse", "menu/oggetto/tracciato", "Inverti direzione tracciato", "Reverse path direction", "disegno.inverti", null, "tracciati"),
    voce("draw.path.outline", "menu/oggetto/tracciato", "Contorno in forma", "Outline shape", "disegno.contorno-in-forma", null, "tracciati"),
    voce("draw.move.path", "menu/oggetto/tracciato", "Sposta tracciato…", "Move path…", "disegno.sposta-tracciato", null, "tracciati"),
    voce("draw.move", "menu/oggetto/trasforma", "Sposta…", "Move…", "disegno.sposta", "Ctrl+Shift+M", "trasforma"),
    voce("draw.move.layer", "menu/oggetto/disponi", "Sposta sul livello corrente", "Move to the current layer", "disegno.sposta-livello", null, "livelli"),
    voce("draw.symbol.move", "colonna/oggetti", "Spostamento simboli", "Symbol move", "disegno.sposta-simbolo", "Shift+S", "simboli"),
    voce("draw.sample.move", "ispettore/risorse", "Sposta campione", "Move swatch", "disegno.sposta-campione", null, "dati"),
  ],
};

/// Il perché di una voce spenta, come lo dà il motore: un codice, o un testo
/// libero per `other` (il campione delle Risorse).
const PERCHE_CAMPIONE: DrawingDisabledReason = { other: { text: "Scegli prima un campione nelle Risorse." } };

/// Lo stato di ogni comando della prova per la selezione `selection`: quelli
/// che valgono, e quelli spenti col loro perché (come il motore vero).
export function comandiProva(selection: readonly string[]): DrawingCommandInfo[] {
  const n = selection.length;
  const acceso = (id: string): DrawingCommandInfo => ({ id, enabled: true, disabled_reason: null });
  const spento = (id: string, perche: DrawingDisabledReason): DrawingCommandInfo => ({ id, enabled: false, disabled_reason: perche });
  return [
    n >= 2 ? acceso("disegno.raggruppa") : spento("disegno.raggruppa", "needs_two"),
    spento("disegno.separa", "needs_group"),
    acceso("disegno.sblocca-tutto"),
    n >= 2 ? acceso("disegno.unisci") : spento("disegno.unisci", "needs_two"),
    n >= 1 ? acceso("disegno.inverti") : spento("disegno.inverti", "needs_path"),
    n >= 1 ? acceso("disegno.contorno-in-forma") : spento("disegno.contorno-in-forma", "no_selection"),
    n >= 1 ? acceso("disegno.sposta-tracciato") : spento("disegno.sposta-tracciato", "needs_path"),
    n >= 1 ? acceso("disegno.sposta") : spento("disegno.sposta", "no_selection"),
    n >= 1 ? acceso("disegno.sposta-livello") : spento("disegno.sposta-livello", "no_selection"),
    acceso("disegno.sposta-simbolo"),
    spento("disegno.sposta-campione", PERCHE_CAMPIONE),
  ];
}

/// I comandi di trasformazione dell'indice reale (K6 T13, giro 3): accesi con una selezione. Il
/// banco li dà al Completo quando non c'è `?indice=prova`, perché senza una lista le voci dicono
/// «Non ancora collegato».
export function comandiTrasformazioni(selection: readonly string[]): DrawingCommandInfo[] {
  const acceso = (id: string): DrawingCommandInfo => ({ id, enabled: true, disabled_reason: null });
  const spento = (id: string, perche: DrawingDisabledReason): DrawingCommandInfo => ({ id, enabled: false, disabled_reason: perche });
  const ids = ["disegno.object.move", "disegno.object.rotate", "disegno.object.scale", "disegno.object.reflect", "disegno.object.shear", "disegno.object.transformAgain", "disegno.object.setBounds", "disegno.object.transform", "disegno.object.resetBoundingBox"];
  return ids.map((id) => (selection.length >= 1 ? acceso(id) : spento(id, "no_selection")));
}

/// I comandi di Selezione del Disegno completo (K6 T15, giro 1), quelli che l'indice reale porta
/// (`famiglie/livelli.rs`), col perché delle voci spente come lo dà il motore. «Uguale» e «Oggetti
/// sugli stessi livelli» vogliono una scelta; «Istanza di simbolo» vuole un'istanza, e il disegno
/// del banco non ne ha. «Tutto nella tavola» e «Oggetti di testo» valgono anche senza scelta.
const PERCHE_ISTANZA: DrawingDisabledReason = { other: { text: "Non è un'istanza." } };

/// Le voci del giro 6 (K6 T15): il testo uguale vuole un testo fra le scelte, e le etichette del banco (`etichette`,
/// i loro id) sono testi; i connettori del disegno sono tracciati aperti, e non ci sono punti isolati.
const PERCHE_PUNTI_ISOLATI: DrawingDisabledReason = { other: { text: "Nel disegno non ci sono punti isolati." } };
const TESTO_UGUALE = ["fontFamily", "fontFamilyStyle", "fontFamilyStyleSize", "fontSize", "textFillColor", "textStrokeColor"];

export function comandiSelezione(selection: readonly string[], etichette: readonly string[] = []): DrawingCommandInfo[] {
  const acceso = (id: string): DrawingCommandInfo => ({ id, enabled: true, disabled_reason: null });
  const spento = (id: string, perche: DrawingDisabledReason): DrawingCommandInfo => ({ id, enabled: false, disabled_reason: perche });
  const senzaScelta = selection.length === 0;
  const conTesto = selection.some((id) => etichette.includes(id));
  const uguale = ["fillColor", "strokeColor", "strokeWeight", "fillAndStroke", "opacity", "blendingMode", "appearance", "shapeType"];
  return [
    ...uguale.map((nome) => (senzaScelta ? spento(`disegno.select.same.${nome}`, "no_selection") : acceso(`disegno.select.same.${nome}`))),
    senzaScelta
      ? spento("disegno.select.same.symbolInstance", "no_selection")
      : spento("disegno.select.same.symbolInstance", PERCHE_ISTANZA),
    senzaScelta
      ? spento("disegno.select.object.allOnSameLayers", "no_selection")
      : acceso("disegno.select.object.allOnSameLayers"),
    acceso("disegno.select.object.textObjects"),
    acceso("disegno.select.allOnArtboard"),
    // Il nucleo di Selezione (K6 T11): Tutto e Inversa valgono sempre, gli altri vogliono una scelta.
    acceso("disegno.select.all"),
    acceso("disegno.select.inverse"),
    senzaScelta ? spento("disegno.select.none", "no_selection") : acceso("disegno.select.none"),
    senzaScelta ? spento("disegno.select.nextAbove", "no_selection") : acceso("disegno.select.nextAbove"),
    senzaScelta ? spento("disegno.select.nextBelow", "no_selection") : acceso("disegno.select.nextBelow"),
    ...TESTO_UGUALE.map((nome) => {
      const id = `disegno.select.same.${nome}`;
      if (senzaScelta) return spento(id, "no_selection");
      return conTesto ? acceso(id) : spento(id, "needs_text");
    }),
    acceso("disegno.select.object.openPaths"),
    spento("disegno.select.object.strayPoints", PERCHE_PUNTI_ISOLATI),
  ];
}
