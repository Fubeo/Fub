// I comandi del Disegno completo nel menu ≡ e nella ricerca Ctrl+/ (piano K6,
// T9a; `docs/architecture/disegno-completo.md`, «L'indice e i pezzi pigri»).
//
// Le voci vengono dall'indice (`indice.ts`), col loro posto e il loro tasto.
// Il motore dice quali valgono per la selezione di adesso (`comandi`, T4): una
// voce che non vale si vede spenta, col suo perché. Una voce con parametri
// apre la finestra di T6 (`motore/finestre.ts`); le altre girano subito.
//
// Il posto dice dove sta: `menu/<sottomenu>` nel menu ≡, o
// `menu/<sottomenu>/<sotto>` per un sottomenu dentro il sottomenu (i nomi che
// il catalogo accetta sono `SOTTOMENU` di `crates/fub-disegno/src/catalogo.rs`),
// e ogni posto, col percorso intero, nella ricerca.

import type { DrawingCommandInfo, DrawingDisabledReason } from "../../../host/contract";
import { resolvedLanguage } from "../../../i18n/strings";
import { displayBinding } from "../../../ui/commands";
import type { MenuItem } from "../../../ui/menu";
import { t, type DrawKey } from "../strings";
import { FILE_VISUALIZZA } from "../tools/editor/chrome/visualizza";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { MotoreAssente, SessioneMotore } from "../motore/sessione";
import type { Indice, VoceIndice } from "./indice";
import { tastoDelComando, type RegolaTasti } from "./tasti";

/// Quanto si aspetta che la sessione del motore si apra (come `carica.ts`: un
/// numero suo, perché un import di valore da `motore/gesti` porterebbe la
/// superficie nel chunk del Completo).
const ATTESA_MOTORE_MS = 2_000;

/// La sessione aperta del motore: se si sta aprendo, aspetta al più
/// `ATTESA_MOTORE_MS`. `null` se il motore non c'è.
async function sessioneDi(motore: MotoreDelDisegno): Promise<SessioneMotore | null> {
  const adesso = motore.adesso();
  return adesso === "apertura" ? motore.pronta(ATTESA_MOTORE_MS) : adesso;
}

/// Quali comandi del motore valgono adesso: per id, o perché il motore non
/// risponde.
export interface StatoComandi {
  /// `null` se il motore non ha risposto.
  readonly per: ReadonlyMap<string, DrawingCommandInfo> | null;
  /// Perché il motore manca, se manca.
  readonly assente: MotoreAssente["perche"] | null;
  /// Le voci del client che l'editor sa fare (K6 T11): `null` se la voce si fa, il
  /// perché se è spenta, `undefined` se l'editor non la conosce.
  readonly clientVoce?: (id: string) => string | null | undefined;
  /// La spunta di una voce del client, dove l'editor ne ha una (K6 T11, giro E): ≡ ›
  /// Visualizza mostra lo stato vero della superficie. `undefined` se la voce non ne ha.
  readonly clientStato?: (id: string) => boolean | undefined;
}

/// Una voce della ricerca Ctrl+/, come la legge la tavolozza.
export interface VoceRicerca {
  /// L'id della voce: ciò che i recenti ricordano.
  readonly key: string;
  readonly label: string;
  /// Il nome nell'altra lingua, che la ricerca trova lo stesso.
  readonly altreLingue: readonly string[];
  /// Dove sta: «Colonna › Disegna».
  readonly path: string;
  /// Il tasto, come lo scrive il motore.
  readonly hint?: string;
  readonly disabled: boolean;
  /// Il perché, se è spenta.
  readonly description?: string;
  readonly run: () => void;
}

/// Dove va una voce che non è un comando del motore: lo strumento lo sceglie
/// l'editor.
export type EseguiVoce = (voce: VoceIndice) => void;

const CHIAVI_PERCHE: Readonly<Record<Exclude<DrawingDisabledReason, { readonly other: unknown }>, DrawKey>> = {
  no_selection: "draw.disabled.no_selection",
  needs_path: "draw.disabled.needs_path",
  needs_text: "draw.disabled.needs_text",
  needs_group: "draw.disabled.needs_group",
  needs_two: "draw.disabled.needs_two",
  needs_anchors: "draw.disabled.needs_anchors",
  fub_ink: "draw.disabled.fub_ink",
  read_only: "draw.disabled.read_only",
  unmapped: "draw.disabled.unmapped",
};

/// Il perché di una voce spenta: il codice tipato del motore, con il suo testo,
/// o il testo che il motore ha dato per `other`. Senza codice, una frase
/// generica.
export function testoPerche(motivo: DrawingDisabledReason | null | undefined): string {
  if (motivo === null || motivo === undefined) return t("draw.disabled.generic");
  if (typeof motivo === "string") return t(CHIAVI_PERCHE[motivo]);
  return t("draw.disabled.other", { text: motivo.other.text });
}

/// Il perché del motore assente, come frase intera.
function testoAssente(perche: MotoreAssente["perche"]): string {
  return perche === "spento" ? t("draw.disabled.engine_off") : t("draw.disabled.engine_stopped");
}

/// Chiede al motore quali comandi valgono per `selezione`. Se la sessione si
/// sta aprendo, aspetta al più `ATTESA_MOTORE_MS`; se il motore manca, lo dice.
export async function statoComandi(motore: MotoreDelDisegno | null, selezione: readonly string[]): Promise<StatoComandi> {
  if (motore === null) return { per: null, assente: "spento" };
  const sessione = await sessioneDi(motore);
  if (sessione === null) return { per: null, assente: motore.assente()?.perche ?? "spento" };
  const risposta = await sessione.comandi([...selezione]).catch(() => null);
  if (risposta === null) return { per: null, assente: "errore" };
  if (!Array.isArray(risposta)) return { per: null, assente: risposta.perche };
  return { per: new Map(risposta.map((info) => [info.id, info])), assente: null };
}

/// Se una voce vale adesso, e il suo perché se no. Uno strumento lo sceglie
/// l'editor, e vale sempre. Una voce del client vale se l'editor la fa (`clientVoce`),
/// spenta col suo perché se la dice spenta, e non collegata se non la conosce.
export function statoVoce(voce: VoceIndice, stato: StatoComandi): { readonly disabled: boolean; readonly perche?: string } {
  if ("strumento" in voce.chiamata) return { disabled: false };
  if ("client" in voce.chiamata) {
    const cliente = stato.clientVoce?.(voce.chiamata.client);
    if (cliente === null) return { disabled: false };
    if (typeof cliente === "string") return { disabled: true, perche: cliente };
    return { disabled: true, perche: t("draw.disabled.unmapped") };
  }
  if (stato.per === null) return { disabled: true, perche: testoAssente(stato.assente ?? "spento") };
  const info = stato.per.get(voce.chiamata.comando);
  if (info === undefined) return { disabled: true, perche: t("draw.disabled.unmapped") };
  if (info.enabled) return { disabled: false };
  return { disabled: true, perche: testoPerche(info.disabled_reason) };
}

/// Il nome di una voce nella lingua della shell.
export function nomeVoce(voce: VoceIndice): string {
  return resolvedLanguage() === "en" ? voce.etichetta.en : voce.etichetta.it;
}

/// Il nome di ogni pezzo di un posto: la scheda (`colonna`) o il gruppo
/// (`disegna`). `principale` non si scrive; un pezzo senza nome non c'è.
const NOMI_PEZZO: Readonly<Record<string, DrawKey>> = {
  file: "draw.completo.gruppo.file",
  modifica: "draw.completo.gruppo.modifica",
  oggetto: "draw.completo.gruppo.oggetto",
  testo: "draw.completo.gruppo.testo",
  selezione: "draw.completo.gruppo.selezione",
  effetto: "draw.completo.gruppo.effetto",
  visualizza: "draw.completo.gruppo.visualizza",
  scegli: "draw.completo.gruppo.scegli",
  disegna: "draw.completo.gruppo.disegna",
  forme: "draw.completo.gruppo.forme",
  trasforma: "draw.completo.gruppo.trasforma",
  colore: "draw.completo.gruppo.colore",
  oggetti: "draw.completo.gruppo.oggetti",
  prospettiva: "draw.completo.gruppo.prospettiva",
  misura: "draw.completo.gruppo.misura",
  vista: "draw.completo.gruppo.vista",
  design: "draw.completo.gruppo.design",
  livelli: "draw.completo.gruppo.livelli",
  risorse: "draw.completo.gruppo.risorse",
  cronologia: "draw.completo.gruppo.cronologia",
  documento: "draw.completo.gruppo.documento",
  colonna: "draw.completo.posto.colonna",
  ispettore: "draw.completo.posto.ispettore",
  finestra: "draw.completo.posto.finestra",
  banda: "draw.completo.posto.banda",
  "tasto-destro": "draw.completo.posto.tasto-destro",
  tavolozza: "draw.completo.posto.tavolozza",
  testata: "draw.completo.posto.testata",
  interno: "draw.completo.posto.interno",
  // Il terzo livello di ≡ (`SOTTOMENU` del catalogo); `trasforma` e `oggetto`
  // hanno già il loro nome.
  colori: "draw.completo.sotto.colori",
  tracciato: "draw.completo.sotto.tracciato",
  disponi: "draw.completo.sotto.disponi",
  fusione: "draw.completo.sotto.fusione",
  inviluppo: "draw.completo.sotto.inviluppo",
  blocca: "draw.completo.sotto.blocca",
  nascondi: "draw.completo.sotto.nascondi",
  uguale: "draw.completo.sotto.uguale",
  deforma: "draw.completo.sotto.deforma",
  stilizza: "draw.completo.sotto.stilizza",
  distorci: "draw.completo.sotto.distorci",
  guide: "draw.completo.sotto.guide",
};

/// Dove sta un posto, come percorso leggibile: «Colonna › Disegna». Il
/// `menu` di testa non si scrive: il gruppo del menu basta.
export function percorsoPosto(posto: string): string {
  return posto
    .split("/")
    .filter((pezzo) => pezzo !== "principale" && pezzo !== "menu")
    .flatMap((pezzo) => (pezzo in NOMI_PEZZO ? [t(NOMI_PEZZO[pezzo])] : []))
    .join(" › ");
}

/// Il tasto che una riga mostra: quello che fa partire il comando, come lo dà la
/// regola dei tasti (`tasti.ts`), scritto come gli altri tasti di Fub. Nessuno
/// finché la regola non c'è (l'indice non è arrivato), o se il tasto dell'indice
/// è coperto da un tasto di Fub o perso in un conflitto: la riga non lo promette.
export function tastoMostrato(regola: RegolaTasti | null, id: string): string | undefined {
  const tasto = regola === null ? null : tastoDelComando(regola, id);
  return tasto === null ? undefined : displayBinding(tasto);
}

/// Le file di Oggetto › Tracciato (K6 T12): i comandi sul tracciato intero,
/// il tracciato composto (un sottomenu, `RACCOLTE_DEI_MENU`), gli strumenti di precisione, la penna intelligente.
/// Gli id sono quelli della mappa del motore (`crates/fub-disegno/mappa.tsv`).
const FILE_TRACCIATO: readonly (readonly string[])[] = [
  ["path.join", "path.reverse", "object.path.outlineStroke", "object.path.addAnchorPoints", "path.removeAnchors", "object.path.divideObjectsBelow"],
  ["object.compoundPath.make", "object.compoundPath.release"],
  [
    "addon.pathtools.smooth",
    "addon.pathtools.corner",
    "addon.pathtools.equalize",
    "addon.pathtools.removeKeepShape",
    "addon.pathtools.close",
    "addon.pathtools.crossings",
    "addon.pathtools.expandDashes",
  ],
  ["addon.pen.closeJoin"],
];

/// Le file dei sottomenu del menu ≡ che le hanno (`<gruppo>`, o
/// `<gruppo>/<sotto>` per il terzo livello): le righe, per id, nell'ordine
/// della fila, e una riga di separazione fra una fila e l'altra. Un sottomenu
/// che non è qui tiene l'ordine dell'indice.
const FILE_DEI_MENU: Readonly<Record<string, readonly (readonly string[])[]>> = {
  visualizza: FILE_VISUALIZZA,
  "oggetto/tracciato": FILE_TRACCIATO,
};

/// I sottomenu che il client fa dentro un sottomenu del terzo livello: il loro
/// nome e le voci che raccolgono, per id. L'indice non ha un quarto livello
/// (`SOTTOMENU` di `crates/fub-disegno/src/catalogo.rs`): è solo come il menu
/// le mostra, e Ctrl+/ le trova col posto della mappa.
const RACCOLTE_DEI_MENU: Readonly<Record<string, readonly { readonly nome: DrawKey; readonly ids: readonly string[] }[]>> = {
  "oggetto/tracciato": [{ nome: "draw.completo.sotto.composto", ids: ["object.compoundPath.make", "object.compoundPath.release"] }],
};

/// Le voci di `chiave` che una raccolta (`RACCOLTE_DEI_MENU`) prende diventano
/// un sottomenu solo, al posto della prima, con le voci nell'ordine della
/// raccolta. Una raccolta senza voci pronte non c'è.
function raccogli(chiave: string, righe: Array<{ id: string; riga: MenuItem }>): Array<{ id: string; riga: MenuItem }> {
  let fuori = righe;
  for (const raccolta of RACCOLTE_DEI_MENU[chiave] ?? []) {
    const dentro = raccolta.ids.flatMap((id) => fuori.filter((r) => r.id === id));
    if (dentro.length === 0) continue;
    const primo = fuori.findIndex((r) => raccolta.ids.includes(r.id));
    const sotto: MenuItem = { label: t(raccolta.nome), submenu: true, items: dentro.map((r) => r.riga) };
    const voce = { id: fuori[primo]!.id, riga: sotto };
    fuori = fuori.flatMap((r, i) => (i === primo ? [voce] : raccolta.ids.includes(r.id) ? [] : [r]));
  }
  return fuori;
}

/// Le righe di un sottomenu nelle sue file (`FILE_DEI_MENU`): l'ordine delle
/// file e, dentro una fila, il suo; una riga che nessuna fila nomina va in
/// fondo, in una fila sua, nell'ordine dell'indice. La prima riga di ogni fila
/// dopo la prima porta la riga di separazione.
function inFile<T>(gruppo: string, righe: Array<{ id: string; riga: T }>, separa: (riga: T) => T): T[] {
  const file = FILE_DEI_MENU[gruppo];
  if (file === undefined) return righe.map(({ riga }) => riga);
  const posto = (id: string): { fila: number; dentro: number } => {
    const fila = file.findIndex((each) => each.includes(id));
    return fila < 0 ? { fila: file.length, dentro: 0 } : { fila, dentro: file[fila]!.indexOf(id) };
  };
  const ordinate = righe
    .map((r) => ({ ...r, ...posto(r.id) }))
    .sort((a, b) => a.fila - b.fila || a.dentro - b.dentro);
  return ordinate.map(({ riga, fila }, i) => (i > 0 && ordinate[i - 1]!.fila !== fila ? separa(riga) : riga));
}

/// Il menu ≡ con i sottomenu dell'indice (`menu/<sottomenu>`), nell'ordine in
/// cui l'indice li dà. Una voce di `menu/<sottomenu>/<sotto>` sta in un
/// sottomenu dentro il sottomenu, al posto della prima voce che lo porta. Una
/// voce spenta si vede, col suo perché. Un sottomenu con le sue file
/// (`FILE_DEI_MENU`) le ha in ordine, separate da una riga.
export function menuComando(indice: Indice, stato: StatoComandi, esegui: EseguiVoce, regola: RegolaTasti | null = null): MenuItem[] {
  // Per ogni sottomenu le sue righe: una voce, o il nome di un sotto.
  const gruppi = new Map<string, Array<{ id: string; riga: MenuItem | string }>>();
  const sotti = new Map<string, Array<{ id: string; riga: MenuItem }>>();
  for (const voce of indice.voci) {
    const [scheda, gruppo, sotto, oltre] = voce.posto.split("/");
    if (scheda !== "menu" || gruppo === undefined || !(gruppo in NOMI_PEZZO) || oltre !== undefined) continue;
    if (sotto !== undefined && !(sotto in NOMI_PEZZO)) continue;
    const { disabled, perche } = statoVoce(voce, stato);
    const hint = tastoMostrato(regola, voce.id);
    const riga: MenuItem = {
      label: nomeVoce(voce),
      ...(hint === undefined ? {} : { hint }),
      disabled,
      ...(perche === undefined ? {} : { description: perche }),
      run: () => esegui(voce),
    };
    // Una voce del client con la spunta mostra lo stato vero della superficie.
    const spunta = "client" in voce.chiamata ? stato.clientStato?.(voce.chiamata.client) : undefined;
    if (typeof spunta === "boolean") {
      riga.choice = "checkbox";
      riga.checked = spunta;
    }
    const elenco = gruppi.get(gruppo) ?? [];
    gruppi.set(gruppo, elenco);
    if (sotto === undefined) {
      elenco.push({ id: voce.id, riga });
      continue;
    }
    const chiave = `${gruppo}/${sotto}`;
    const dentro = sotti.get(chiave);
    if (dentro === undefined) {
      sotti.set(chiave, [{ id: voce.id, riga }]);
      elenco.push({ id: voce.id, riga: chiave });
    } else dentro.push({ id: voce.id, riga });
  }
  if (gruppi.size === 0) return [{ label: t("draw.completo.indice.empty"), disabled: true }];
  return [...gruppi].map(([gruppo, righe]) => ({
    label: t(NOMI_PEZZO[gruppo]),
    submenu: true,
    items: inFile(
      gruppo,
      righe.map(({ id, riga }) => {
        if (typeof riga !== "string") return { id, riga };
        const sotto = riga.slice(gruppo.length + 1);
        const items = inFile(riga, raccogli(riga, sotti.get(riga)!), (dentro) => ({ ...dentro, separator: true }));
        const voce: MenuItem = { label: t(NOMI_PEZZO[sotto]), submenu: true, items };
        return { id, riga: voce };
      }),
      (riga) => ({ ...riga, separator: true }),
    ),
  }));
}

/// Il menu ≡ quando l'indice non arriva: lo dice, con «Riprova».
export function menuNonCaricato(riprova: () => void): MenuItem[] {
  return [
    { label: t("draw.completo.indice.failed"), disabled: true },
    { label: t("draw.window.retry"), run: riprova },
  ];
}

/// Tutte le voci dell'indice per la ricerca Ctrl+/, col posto, il tasto e il
/// perché di quelle spente. Chi le filtra sceglie con `rankCommands`.
export function vociRicerca(indice: Indice, stato: StatoComandi, esegui: EseguiVoce, regola: RegolaTasti | null = null): VoceRicerca[] {
  // Le letture interne (posto `interno`) le usano l'ispettore e i test: non sono voci per chi cerca.
  return indice.voci.filter((voce) => voce.posto !== "interno").map((voce) => {
    const { disabled, perche } = statoVoce(voce, stato);
    const hint = tastoMostrato(regola, voce.id);
    return {
      key: voce.id,
      label: nomeVoce(voce),
      altreLingue: [voce.etichetta.it, voce.etichetta.en],
      path: percorsoPosto(voce.posto),
      ...(hint === undefined ? {} : { hint }),
      disabled,
      ...(perche === undefined ? {} : { description: perche }),
      run: () => esegui(voce),
    };
  });
}

