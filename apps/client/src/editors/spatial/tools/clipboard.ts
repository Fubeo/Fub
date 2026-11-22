// Gli appunti, a ogni livello: la selezione come documento SVG, e un SVG
// incollato come elementi del disegno.
//
// - **Copiare** scrive un SVG completo, che si apre anche da solo: la radice
//   dichiara i namespace del disegno e `fub:version`, ha un `viewBox` attorno
//   a ciò che si vede della selezione, e `width` e `height` nell'unità del
//   disegno. Ogni elemento porta il suo testo; chi stava in un contenitore
//   trasformato, o che gli dava uno stile, prende su di sé la trasformazione
//   e lo stile che ereditava, come quando esce da un contenitore
//   (`place.ts`). Ciò a cui rimanda e che resta fuori, una sfumatura o la
//   forma di un `use`, anche per un colore ereditato, va in un `defs`, e
//   così i fogli di stile del disegno se un blocco estraneo può usarli.
// - **Incollare** è un `batch` solo, un passo di annulla. Un SVG di FubDraw
//   rientra com'era, elemento per elemento, nel livello che riceve; un
//   livello diventa un gruppo, col suo nome per titolo. Un SVG di un altro
//   programma entra in un gruppo nuovo, alla sua misura: ciò che il formato
//   ammette resta modificabile, il resto entra in blocchi estranei, che non
//   eseguono niente. Fra disegni con unità diverse la misura vera resta.
// - **Le risorse** dei `defs` della radice che ciò che entra usa vanno nella
//   `defs` del disegno, prima di chi le usa (`resources.ts`): una privata
//   come copia, una condivisa o che non è di FubDraw resta quella del
//   disegno se è la stessa, con lo stesso id. Un campione resta quello del
//   disegno con lo stesso id, o diventa quello con lo stesso nome e lo
//   stesso colore, e chi lo usa ne prende il colore di adesso come
//   ripiego; se arriva con un nome già preso, prende il primo libero
//   (`swatches.ts`). Uno stile che gli oggetti seguono viaggia con loro: è
//   quello del disegno con lo stesso id e lo stesso tipo, o quello del suo
//   tipo con lo stesso nome e lo stesso aspetto; se no arriva, e con un
//   nome già preso prende il primo libero (`styles.ts`). Chi segue uno
//   stile che non entra e che il disegno non ha lo lascia. Una punta delle
//   linee (`tips.ts`) uguale a una del disegno, a parte l'id, è quella del
//   disegno: una linea con le punte rientra con le sue, senza marcatori
//   doppi, anche da un altro disegno. Un simbolo è quello del disegno
//   copiato dallo stesso simbolo della stessa libreria, o col suo stesso
//   nome che gli è uguale, a parte gli id, con ciò che usa: le istanze
//   incollate tornano al simbolo da cui sono venute, anche in un altro
//   disegno che l'ha già. Se arriva, il suo contenuto ha id da oggetto, e
//   con un nome già preso prende il primo libero (`symbols.ts`).
//   Ciò che nessuno usa resta fuori. Con un foglio di stile, che può
//   rimandarvi, restano dove sono.
// - **Id nuovi.** Ogni id cambia, e i riferimenti interni lo seguono:
//   `url(#…)`, `href`, gli attributi ARIA, l'inizio e la fine delle
//   animazioni, i selettori dei fogli di stile. Un foglio di un altro
//   programma vale solo dentro il suo gruppo (`stylesheet.ts`).
// - **I connettori e le etichette.** Un capo agganciato a un oggetto
//   incollato nomina il suo id nuovo, e così un'etichetta il suo connettore o
//   la sua forma; un capo agganciato a ciò che non entra, e un'etichetta
//   senza il suo connettore o la sua forma, perdono `fub:from`, `fub:to`,
//   `fub:along` o `fub:inside`, e restano un capo libero e un testo qualunque
//   (`connector-copies.ts`). Un valore fuori grammatica resta com'è. La copia
//   scrive l'SVG con gli id di prima.
// - **Byte per byte.** Ciò che non deve cambiare resta come era scritto: fra
//   due disegni con le stesse unità, da un livello senza trasformazioni a un
//   altro, un giro di copia e incolla riporta gli stessi byte, id a parte.
// - **Fuori:** il CSS non si interpreta e nessuna risorsa esterna si carica.
//   Le entità di un `DOCTYPE` si sostituiscono col loro testo, perché il
//   disegno che riceve non le dichiara.
//
// Il codice sta in `clipboard/`: le misure e l'albero XML (`base.ts`), la
// riscrittura del testo (`rewriter.ts`), copiare (`copy.ts`), leggere ciò che
// si incolla (`read.ts`), il trasloco delle risorse (`lift.ts`) e il piano
// dell'incolla (`plan.ts`). Questo file ne ri-esporta i nomi pubblici.

import type { ClipboardEntry } from "../../../platform/clipboard";
import type { Teardown } from "../../../ui/lifetime";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { DrawKey } from "../strings";
import { SVG_TYPE } from "./clipboard/base";
import { looksLikeSvg, type PasteProblem } from "./clipboard/read";

export { SVG_TYPE } from "./clipboard/base";
export { copySvg, type CopyInput } from "./clipboard/copy";
export { looksLikeSvg, readPaste, pasteFrame, symbolKey, type PasteProblem, type PasteSource, type PasteTarget, type PastePlan } from "./clipboard/read";
export { planPaste } from "./clipboard/plan";

/// Perché un SVG non si incolla, a parole: le stesse frasi per il Semplice e per
/// il Completo.
export const PASTE_PROBLEMS: Readonly<Record<PasteProblem, DrawKey>> = {
  "too-large": "draw.paste.too_large",
  malformed: "draw.paste.malformed",
  "not-svg": "draw.paste.not_svg",
  empty: "draw.paste.empty",
  entities: "draw.paste.entities",
};

// --- Il ponte con il Completo (K6 T11) ---------------------------------------
//
// Copiare e incollare nel Completo passano dal motore (`completo/appunti.ts`),
// e i tasti e il menu del Semplice li raggiungono di qui: il Completo registra i
// suoi appunti per il motore che apre, mentre è aperto, e la superficie registra
// la sua cronologia. Un motore senza registrazione resta nel Semplice.

/// Ciò che c'è negli appunti di sistema, letto una volta: il testo, un SVG, le
/// immagini che il motore sa leggere, e i tipi che non sa leggere (`altri`), di
/// cui chi incolla dice che non si incolla niente.
export interface LetturaAppunti {
  readonly testo: string | null;
  readonly svg: string | null;
  readonly immagini: readonly { readonly tipo: string; readonly byte: Blob }[];
  readonly altri: readonly string[];
}

/// Le immagini che `clipboard.importImage` del motore legge.
const IMMAGINI_LETTE: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/tiff", "image/bmp"]);
/// I tipi che non sono un contenuto da incollare: il testo, l'HTML e gli elenchi
/// del browser, e l'SVG, che ha la sua lettura.
const TIPI_NEUTRI: ReadonlySet<string> = new Set(["text/plain", "text/html", "text/uri-list", "Files", SVG_TYPE]);

/// Gli appunti che un evento `paste` porta: il browser li dà solo lì, in modo
/// sincrono. `null` se l'evento non ha `clipboardData`.
export function leggiAppuntiDaEvento(data: DataTransfer | null): LetturaAppunti | null {
  if (data === null) return null;
  const testo = data.getData("text/plain");
  const svgTesto = data.getData(SVG_TYPE);
  const svg = looksLikeSvg(svgTesto) ? svgTesto : looksLikeSvg(testo) ? testo : null;
  const immagini = Array.from(data.files)
    .filter((file) => IMMAGINI_LETTE.has(file.type))
    .map((file) => ({ tipo: file.type, byte: file }));
  const altri = Array.from(data.types).filter((tipo) => !TIPI_NEUTRI.has(tipo) && !IMMAGINI_LETTE.has(tipo));
  return { testo: testo === "" ? null : testo, svg, immagini, altri: [...new Set(altri)] };
}

/// Gli appunti che il menu legge dalla shell (`readClipboard`). Un tipo che non
/// si legge non c'è: nessuno errore.
export async function leggiAppuntiDaVoci(voci: readonly ClipboardEntry[]): Promise<LetturaAppunti> {
  let testo: string | null = null;
  let svg: string | null = null;
  const immagini: { tipo: string; byte: Blob }[] = [];
  const altri = new Set<string>();
  const leggi = (voce: ClipboardEntry, tipo: string): Promise<Blob | null> => voce.getType(tipo).catch(() => null);
  for (const voce of voci) {
    for (const tipo of voce.types) {
      if (IMMAGINI_LETTE.has(tipo)) {
        const byte = await leggi(voce, tipo);
        if (byte !== null) immagini.push({ tipo, byte });
      } else if (tipo === "text/plain" && testo === null) {
        testo = (await (await leggi(voce, tipo))?.text().catch(() => null)) || null;
      } else if (tipo === SVG_TYPE && svg === null) {
        svg = (await (await leggi(voce, tipo))?.text().catch(() => null)) || null;
      } else if (!TIPI_NEUTRI.has(tipo) && !IMMAGINI_LETTE.has(tipo)) {
        altri.add(tipo);
      }
    }
  }
  if (svg === null && testo !== null && looksLikeSvg(testo)) svg = testo;
  return { testo, svg: svg !== null && looksLikeSvg(svg) ? svg : null, immagini, altri: [...altri] };
}

/// Gli appunti del Completo per un motore: copia, taglia, incolla e cancella la
/// cronologia (`completo/appunti.ts`).
export interface AppuntiCompleto {
  copia(tipo: "copy" | "cut"): Promise<void>;
  incolla(lettura: LetturaAppunti): Promise<void>;
  incollaDaMenu(): Promise<void>;
  cancellaCronologia(): Promise<void>;
}

const completi = new WeakMap<MotoreDelDisegno, AppuntiCompleto>();
const cronologie = new WeakMap<MotoreDelDisegno, () => void>();

/// Il Completo registra i suoi appunti per il motore che ha aperto; il teardown li ritira.
export function registraAppuntiCompleto(motore: MotoreDelDisegno, appunti: AppuntiCompleto): Teardown {
  completi.set(motore, appunti);
  return () => {
    if (completi.get(motore) === appunti) completi.delete(motore);
  };
}

/// Gli appunti del Completo registrati per `motore`, o `null`: il Semplice copia da sé.
export function appuntiCompletoDi(motore: MotoreDelDisegno | null | undefined): AppuntiCompleto | null {
  return motore ? (completi.get(motore) ?? null) : null;
}

/// La superficie registra come svuotare la sua cronologia di annulla e ripeti.
export function registraCronologia(motore: MotoreDelDisegno, svuota: () => void): Teardown {
  cronologie.set(motore, svuota);
  return () => {
    if (cronologie.get(motore) === svuota) cronologie.delete(motore);
  };
}

/// La cronologia della superficie che `motore` ha, o `null`.
export function cronologiaDi(motore: MotoreDelDisegno | null | undefined): (() => void) | null {
  return motore ? (cronologie.get(motore) ?? null) : null;
}
