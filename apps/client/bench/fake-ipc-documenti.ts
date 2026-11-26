// La porta del banco (`fake-ipc.ts`): i casi dei documenti (videoscrittura,
// foto, schede Craft, PDF, albero, giro dell'editor, cestino, pagine).

import RICH_PROJECTION from "../src/__fixtures__/rich-projection.json";
import RICH_BENCH from "../src/__fixtures__/rich-bench.json";
import RICH_CLOSED from "../src/__fixtures__/rich-closed.json";
import type { UiNode } from "../src/host/contract";
import { photoCase } from "./photo-fixture";
import { craftSceneCase, pdfSceneCase, treeSceneCase } from "./craft-fixture";
import { rawSceneCase } from "./raw-fixture";
import { params, LIVE } from "./fake-ipc-casi";

/// Il documento di videoscrittura delle scene `document-*` (`?rich=…`), con
/// la proiezione che `fub-format-rich` dà davvero del file: quella con un po'
/// di tutto (`tests/ts_projection.rs`), oppure un `.odt`, uno pieno di
/// oggetti e uno protetto (`tests/ts_bench.rs`), o uno con due blocchi chiusi
/// (`tests/ts_projection.rs`). Come la cartella di Excel,
/// soltanto la sua scena lo ha.
const RICH_DOCS: Readonly<Record<string, { doc: string; text: string }>> = {
  docx: { doc: "Documenti/Prova.docx", text: RICH_PROJECTION.source },
  odt: { doc: "Documenti/Verbale.odt", text: RICH_BENCH.odt },
  objects: { doc: "Documenti/Oggetti.docx", text: RICH_BENCH.objects },
  readonly: { doc: "Documenti/Riservato.docx", text: RICH_BENCH.readonly },
  closed: { doc: "Documenti/Chiuso.docx", text: RICH_CLOSED.source },
};
export const RICH_DOC = RICH_DOCS[params.get("rich") ?? ""] ?? null;

/// I caratteri del vault della scena «esporta-pdf-caratteri» (T72,
/// `?esporta-caratteri=1`, vedi `export-fonts-fixture.ts`). Le altre scene
/// hanno un vault senza caratteri.
export const EXPORT_FONTS_SCENE = params.get("esporta-caratteri") === "1";

/// La foto delle scene `photo-*` (`?photo=xmp|senza`), col bundle `fub.craft`
/// acceso: la riga dei dati di LightCraft sotto la foto. Soltanto le sue
/// scene la hanno.
export const PHOTO = photoCase(params.get("photo"));

/// Il disegno delle scene `craft-*` (`?craft-scheda=<caso>`, vedi
/// `craft-fixture.ts`): la scheda di un file Craft senza anteprima, con la
/// domanda, la riga «spente», «Preparo l'anteprima…» o la frase di `missing`.
export const CRAFT_SCENE = craftSceneCase(params.get("craft-scheda"));
if (CRAFT_SCENE !== null && PHOTO !== null) throw new RangeError("craft-scheda is a vault of its own");

/// Il RAW delle scene `raw-*` (`?raw-scheda=dritto|girato|senza`, vedi
/// `raw-fixture.ts`): la scheda di una foto RAW col JPEG che ha dentro, dritto
/// o girato, o senza JPEG con la domanda di LightCraft.
export const RAW_SCENE = rawSceneCase(params.get("raw-scheda"));
if (RAW_SCENE !== null && (PHOTO !== null || CRAFT_SCENE !== null)) throw new RangeError("raw-scheda is a vault of its own");

/// Il PDF e il Word delle scene T31 (`?pdf-scena=nota|nota-senza|domanda|due-righe`,
/// vedi `craft-fixture.ts`): la nota che incorpora il PDF, la scheda del PDF
/// con la domanda sulle anteprime, il Word prestato con la domanda. Con
/// `?pdf-scena=annotato` (S2 T29) il PDF ha le sue annotazioni e la feature
/// `draw` è accesa.
export const PDF_SCENE = pdfSceneCase(params.get("pdf-scena"));
if (PDF_SCENE !== null && (PHOTO !== null || CRAFT_SCENE !== null || RAW_SCENE !== null)) throw new RangeError("pdf-scena is a vault of its own");

/// I profili d'esportazione delle scene `esporta-pdf-profili*`
/// (`?profili-pdf=1`, T79): due profili salvati, «Relazione» predefinito del
/// vault, come risponde `pdf.profiles` del core. Il finto non ha i comandi del
/// PDF: senza il parametro, come senza `draw`, il comando non c'è.
export const PDF_PROFILES = params.get("profili-pdf") === "1"
  ? {
      profiles: [
        { id: "relazione", name: "Relazione", same_name: false, future: false, error: null, profile: { versione: 1, nome: "Relazione", tema: "relazione" } },
        { id: "tesi", name: "Tesi con commenti", same_name: false, future: false, error: null, profile: { versione: 1, nome: "Tesi con commenti", tema: "accademico", frontespizio: { frontespizio: true, indice: true, profondita_indice: 2, segnalibri: true } } },
      ],
      default_name: "Di serie",
      vault_default: "relazione",
      type_default: null,
      note_type: null,
      effective: { id: "relazione", from: "vault" },
    }
  : null;

/// L'albero delle scene T26 (`?albero=miniature|xmp`, vedi
/// `craft-fixture.ts`): le cartelle «Foto 2026» e «Progetti» con le miniature
/// accese, e gli XMP mostrati o nascosti.
export const TREE_SCENE = treeSceneCase(params.get("albero"));
if (TREE_SCENE !== null && (PHOTO !== null || CRAFT_SCENE !== null || RAW_SCENE !== null || PDF_SCENE !== null)) {
  throw new RangeError("albero is a vault of its own");
}

/// Il cestino con tre file (`?cestino=3`): la scena del telefono che guarda
/// i bottoni «Ripristina» di righe vicine. Le altre scene lo hanno vuoto.
export const TRASH_FULL = params.get("cestino") === "3";
/// La pagina del giorno (T39): `?giorno=1` dichiara la view `day_page` e la
/// cartella delle giornaliere del componente dei template (`daily.folder`).
export const DAY_PAGE = params.get("giorno") === "1";
/// La pagina del tipo (T33): `?live=tipo-pagina` dichiara la view
/// `note_type_page` del componente delle proprietà.
export const TYPE_PAGE = params.get("live") === "tipo-pagina";

/// «Svuota il cestino» in fondo al cestino, o la sua domanda al posto del
/// bottone, nella forma del provider `trash` (fub-features, `trash.rs`): un
/// nodo `fub.confirm` con la chiave del bottone, la domanda col conto delle
/// voci, il sì e il no, e il no per Esc.
export function trashEmptyNode(count: number, asking: boolean): UiNode {
  const key = "trash-empty";
  if (!asking) {
    return { node: "button", key, label: "Svuota il cestino", intent: "danger", action: { action: "empty", payload: null } };
  }
  const cancel = { action: "cancel", payload: null };
  return {
    node: "custom",
    key,
    ns: "fub.confirm",
    payload: { cancel },
    fallback: [
      { node: "text", content: `Distruggo definitivamente ${count} voci del cestino? Non si torna indietro.` },
      { node: "button", label: "Svuota il cestino", intent: "danger", action: { action: "empty_confirm", payload: null } },
      { node: "button", label: "Annulla", intent: "neutral", action: cancel },
    ],
  };
}

/// Il cestino pieno nella forma del provider `trash` (fub-features,
/// `trash.rs`): una colonna con l'elenco, ogni voce una riga col nome, quando
/// è stata cestinata e «Ripristina», e sotto «Svuota il cestino» o, con
/// `asking`, la sua domanda.
export function trashWithThree(asking = false): UiNode {
  const row = (id: string, original: string, when: string): UiNode => ({
    node: "stack",
    key: id,
    dir: "row",
    gap: 1,
    children: [
      { node: "list_item", title: original, subtitle: `Cestinata il ${when}`, action: null, selected: false },
      { node: "button", key: `restore:${id}`, label: "Ripristina", intent: "primary", action: { action: "restore", payload: { entry: id, original } } },
    ],
  });
  return {
    node: "stack",
    dir: "column",
    gap: 1,
    children: [
      {
        node: "list",
        items: [
          row("1-Bozza.md", "Bozza", "19 agosto 2026, 09:02"),
          row("2-Lista della spesa.md", "Lista della spesa", "18 agosto 2026, 17:40"),
          row("3-Prima idea.md", "Prima idea", "12 agosto 2026, 11:05"),
        ],
      },
      trashEmptyNode(3, asking),
    ],
  };
}

/// Una Live con un disegno incorporato (la scheda di disegno, T46): il banco
/// accende la feature `draw`, come l'host col componente dei disegni.
export const LIVE_DRAWS = Object.keys(LIVE?.files ?? {}).some((id) => /\.svg$/i.test(id));
