// I gruppi del blocco nella barra di formato (E8, T11): col cursore in un
// compito la barra porta «Compito» con la scadenza, in un riquadro il tipo e la
// ripiegatura, in un blocco di codice il linguaggio e la copia.
//
// Il gruppo lo dichiara la superficie (`EditorSurface.blockGroup`), non la
// spec del comando (A-9): qui stanno, per la nota Markdown, quale blocco c'è
// sotto il cursore — una lettura pura dello stato — e i gesti di ciascuno, coi
// comandi che già esistono: le azioni dell'editor della tabella, gli stessi id
// e gli stessi gesti del menu del tasto destro (`markdown.code.copy`,
// `markdown.image.width`, `markdown.link.open`). Un gruppo nuovo è una riga di
// `GROUPS` e un caso di `blockAt`.
//
// Le voci si leggono di nuovo quando si usano: la barra tiene il disegno e
// chiede il gruppo fresco al clic, così un gesto agisce sempre sul blocco dove
// sta il cursore adesso, anche dopo che il testo sopra è cambiato.
import type { EditorState, TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { SurfaceBlockGroup } from "../../../core/registry";
import type { SurfaceMenuEntry, SurfaceMenuItem } from "../../../core/editor-menu";
import { t } from "../../../../i18n/strings";
import { calloutHead, type CalloutHead } from "./callout-head";
import { calloutName } from "./callout";
import { CALLOUT_TYPES } from "./kinds";
import { parseImage, widthWritable, rewriteImage, openImageAt, type ImageSource } from "./image-live";
import { codeBlockAt, linkAt, tableRowAt, taskAt } from "./menu";
import { REMINDER_ACTION } from "./slash";
import { liveStrings } from "./strings";

/// I linguaggi che «Linguaggio ▸» offre, col loro nome nel menu: gli altri si
/// scrivono con «Altro…». Gli stessi nel menu del tasto destro e nella barra.
export const MENU_CODE_LANGUAGES: readonly (readonly [string, string])[] = [
  ["python", "Python"],
  ["rust", "Rust"],
  ["typescript", "TypeScript"],
  ["json", "JSON"],
  ["bash", "Bash"],
];

/// Le larghezze di «Larghezza ▸», in pixel CSS; «Piena» è la colonna del
/// testo, «Originale» toglie la misura.
export const IMAGE_WIDTHS = { small: 240, medium: 480 } as const;

/// I file che `![[…]]` mostra come immagine.
const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|svg|bmp|avif|ico|tiff?)$/i;
/// I file che `![[…]]` incorpora senza essere una nota: niente «Trasclusione».
const MEDIA_FILE = /\.(?:pdf|mp3|mp4|m4a|mov|webm|ogg|ogv|wav|flac|canvas|excalidraw|drawio|xlsx|xls|ods|csv|docx|odt|pptx)$/i;
/// Una riga che è soltanto un `![[…]]`.
const EMBED_LINE = /^\s*!\[\[[^\]\n]+\]\]\s*$/;
/// Una riga citata: un riquadro continua finché le righe cominciano con `>`.
const QUOTED = /^\s*>/;

/// Il blocco sotto il cursore che ha un gruppo nella barra, con ciò che i suoi
/// gesti devono sapere. `start` dice quale blocco è: due punti dello stesso
/// blocco hanno lo stesso.
export type MarkdownBlock =
  | { readonly kind: "code"; readonly start: number; readonly language: string; readonly code: string; readonly info: { readonly from: number; readonly to: number } }
  | { readonly kind: "callout"; readonly start: number; readonly head: CalloutHead }
  | { readonly kind: "table"; readonly start: number }
  | { readonly kind: "image"; readonly start: number; readonly from: number; readonly to: number; readonly image: ImageSource }
  | { readonly kind: "base"; readonly start: number; readonly page: string }
  | { readonly kind: "transclusion"; readonly start: number; readonly page: string; readonly heading: string | null; readonly block: string | null }
  | { readonly kind: "task"; readonly start: number; readonly end: number };

export type BlockKind = MarkdownBlock["kind"];

/// Il blocco che contiene `pos`, o `null` dove non c'è un blocco con un
/// gruppo (testo, titolo, riga vuota fra due blocchi).
export function blockAt(state: EditorState, pos: number): MarkdownBlock | null {
  const code = codeBlockAt(state, pos);
  if (code) return { kind: "code", start: code.from, language: code.language, code: code.code, info: code.info };
  const line = state.doc.lineAt(pos);
  if (QUOTED.test(line.text)) {
    // Si sale fino alla testata: un riquadro è la citazione che comincia con
    // `[!tipo]`, e una riga vuota o non citata lo chiude.
    for (let number = line.number; number >= 1; number--) {
      const above = state.doc.line(number);
      if (!QUOTED.test(above.text)) break;
      const head = calloutHead(above.text);
      if (head) return { kind: "callout", start: above.from, head };
    }
    return null;
  }
  if (tableRowAt(state, pos)) {
    let first = line.number;
    while (first > 1 && tableRowAt(state, state.doc.line(first - 1).from)) first--;
    return { kind: "table", start: state.doc.line(first).from };
  }
  const trimmed = line.text.trim();
  const image = trimmed === "" ? null : parseImage(trimmed);
  if (image && (image.syntax === "markdown" || IMAGE_FILE.test(image.file))) {
    const from = line.from + line.text.indexOf(trimmed);
    return { kind: "image", start: line.from, from, to: from + trimmed.length, image };
  }
  if (EMBED_LINE.test(line.text)) {
    const link = linkAt(state, line.from + line.text.indexOf("!"));
    if (link?.kind === "wikilink" && link.embed && link.page !== "") {
      if (/\.base$/i.test(link.page)) return { kind: "base", start: line.from, page: link.page };
      if (!IMAGE_FILE.test(link.page) && !MEDIA_FILE.test(link.page)) {
        return { kind: "transclusion", start: line.from, page: link.page, heading: link.heading, block: link.block };
      }
    }
    return null;
  }
  if (taskAt(state, pos)) return { kind: "task", start: line.from, end: line.to };
  return null;
}

/// Il blocco della selezione: quello del cursore, o quello che contiene tutta
/// la selezione. Più cursori, o una selezione su più blocchi: nessuno.
export function selectionBlock(state: EditorState): MarkdownBlock | null {
  if (state.selection.ranges.length > 1) return null;
  const { from, to, head } = state.selection.main;
  const here = blockAt(state, head);
  if (!here || from === to) return here;
  const first = blockAt(state, from);
  const last = blockAt(state, to);
  return first && last && first.kind === here.kind && last.kind === here.kind && first.start === here.start && last.start === here.start ? here : null;
}

/// La ripiegatura della testata di un riquadro, accesa o spenta: `[!tip]`
/// diventa `[!tip]+` (ripiegabile, aperto) e `[!tip]-` o `[!tip]+` tornano
/// `[!tip]`. Si riscrive soltanto il segno.
export function toggleCalloutFoldable(state: EditorState, start: number): TransactionSpec | null {
  const line = state.doc.lineAt(start);
  const head = calloutHead(line.text);
  if (!head) return null;
  const at = line.from + head.typeText.to + 1;
  return head.fold
    ? { changes: { from: at, to: at + 1, insert: "" }, userEvent: "input" }
    : { changes: { from: at, insert: "+" }, userEvent: "input" };
}

/// Il tipo nuovo del riquadro: soltanto i byte fra `[!` e `]`.
function setType(state: EditorState, start: number, type: string): TransactionSpec | null {
  const line = state.doc.lineAt(start);
  const head = calloutHead(line.text);
  if (!head) return null;
  return { changes: { from: line.from + head.typeText.from, to: line.from + head.typeText.to, insert: type }, userEvent: "input" };
}

/// Ciò che i gesti dei gruppi chiedono alla superficie che li ospita.
export interface BlockGroupHost {
  /// Legge lo stato del testo adesso.
  read<T>(read: (state: EditorState) => T): T;
  /// Una modifica dell'utente, nella cronologia locale; `null` non scrive.
  write(change: (state: EditorState) => TransactionSpec | null): boolean;
  /// Un gesto sulla vista: il riquadro dell'immagine, la colonna del testo.
  view(gesture: (view: EditorView) => boolean): boolean;
  /// Si scrive adesso: modalità di scrittura e non in sola lettura.
  editable(): boolean;
  /// Copia negli appunti, e lo dice.
  copy(text: string): void;
  /// Apre la nota (o il file) di un link, al titolo o al blocco.
  openLink(page: string, heading: string | null, block: string | null): void;
  /// «Modifica qui» sulla trasclusione del blocco che comincia in `start`
  /// (`transclusion.ts`): `false` se lì non si scrive. Senza, la voce non c'è.
  editHere?(start: number): boolean;
}

/// I nomi dei gruppi, nella lingua dell'interfaccia.
const LABELS = {
  task: "blockgroup.task",
  callout: "blockgroup.callout",
  base: "blockgroup.base",
  transclusion: "blockgroup.transclusion",
  table: "blockgroup.table",
  code: "blockgroup.code",
  image: "blockgroup.image",
} as const satisfies Record<BlockKind, Parameters<typeof liveStrings.t>[0]>;

/// Le voci di ogni gruppo: chi non scrive ha soltanto quelle che non scrivono.
type Build<K extends BlockKind> = (block: Extract<MarkdownBlock, { kind: K }>, host: BlockGroupHost, writable: boolean) => SurfaceMenuEntry[];

const GROUPS: { readonly [K in BlockKind]: Build<K> } = {
  // La scadenza è la `@` del compito, che in un compito propone `📅` (il
  // comando `markdown.date`), scritta in fondo alla riga. Il promemoria
  // (T36) apre la scelta del giorno e dell'ora sul compito (`REMINDER_ACTION`).
  task: (block, host, writable) => {
    if (!writable) return [];
    const toEnd = () => void host.write((state) => {
      const line = state.doc.lineAt(Math.min(block.end, state.doc.length));
      return { selection: { anchor: line.to }, scrollIntoView: true };
    });
    return [{
      id: "markdown.date",
      label: liveStrings.t("blockgroup.task.due"),
      icon: "fmt-date",
      action: "markdown.date",
      run: toEnd,
    }, {
      id: REMINDER_ACTION,
      label: liveStrings.t("blockgroup.task.reminder"),
      icon: "fmt-alarm",
      action: REMINDER_ACTION,
      run: toEnd,
    }];
  },
  callout: (block, host, writable) => writable ? [
    {
      id: "markdown.callout.type",
      label: calloutName(block.head.type),
      icon: "fmt-callout",
      description: liveStrings.t("live.callout.types"),
      items: CALLOUT_TYPES.map((type): SurfaceMenuItem => ({
        id: `markdown.callout.type.${type}`,
        label: calloutName(type),
        radio: true,
        checked: type === block.head.type,
        run: () => void host.write((state) => setType(state, block.start, type)),
      })),
    },
    {
      id: "markdown.callout.fold",
      label: liveStrings.t("blockgroup.callout.foldable"),
      checked: block.head.fold !== null,
      run: () => void host.write((state) => toggleCalloutFoldable(state, block.start)),
    },
  ] : [],
  base: (block, host) => [{
    id: "markdown.link.open",
    label: liveStrings.t("blockgroup.base.full"),
    icon: "fmt-expand",
    run: () => host.openLink(block.page, null, null),
  }],
  // «Modifica qui» (E14) scrive nella nota d'origine: c'è dove la nota che
  // ospita si scrive, e per una sezione o un blocco, non per la nota intera.
  transclusion: (block, host, writable) => [
    {
      id: "markdown.link.open",
      label: liveStrings.t("blockgroup.transclusion.open"),
      icon: "fmt-open",
      run: () => host.openLink(block.page, block.heading, block.block),
    },
    ...(writable && host.editHere && (block.heading !== null || block.block !== null) ? [{
      id: "markdown.transclusion.edit",
      // Il blocco sincronizzato (T30) si scrive dove sta: niente «Modifica qui».
      label: liveStrings.t(block.block !== null ? "blockgroup.synced.edit" : "blockgroup.transclusion.edit"),
      run: () => void host.editHere?.(block.start),
    }] : []),
  ],
  // Le azioni della tabella, coi nomi corti della barra: le spegne la
  // superficie dove non c'è una tabella da cambiare.
  table: () => [
    { id: "markdown.table.row.after", label: liveStrings.t("blockgroup.table.row"), icon: "fmt-plus", action: "markdown.table.row.after" },
    { id: "markdown.table.column.after", label: liveStrings.t("blockgroup.table.column"), icon: "fmt-plus", action: "markdown.table.column.after" },
    {
      id: "markdown.table.sort",
      label: liveStrings.t("blockgroup.table.sort"),
      icon: "fmt-sort",
      items: [
        { id: "markdown.table.sort.ascending", label: t("table.menu.sub.sort_ascending"), action: "markdown.table.sort.ascending" },
        { id: "markdown.table.sort.descending", label: t("table.menu.sub.sort_descending"), action: "markdown.table.sort.descending" },
      ],
    },
  ],
  code: (block, host, writable) => {
    const current = block.language.toLowerCase();
    const known = MENU_CODE_LANGUAGES.find(([value]) => value === current);
    const language = (value: string, label: string): SurfaceMenuItem => ({
      id: `markdown.code.language.${value || "text"}`,
      label,
      radio: true,
      checked: current === value,
      run: () => void host.write((state) => {
        const fresh = codeBlockAt(state, Math.min(block.start, state.doc.length));
        return fresh ? { changes: { from: fresh.info.from, to: fresh.info.to, insert: value }, userEvent: "input" } : null;
      }),
    });
    return [
      ...(writable ? [{
        id: "markdown.code.language",
        label: known?.[1] ?? (block.language || t("editor_menu.code.plain")),
        description: t("editor_menu.code.language"),
        items: [
          ...(known || block.language === "" ? [] : [{ id: "markdown.code.language.current", label: block.language, radio: true, checked: true }]),
          ...MENU_CODE_LANGUAGES.map(([value, label]) => language(value, label)),
          language("", t("editor_menu.code.plain")),
        ],
      }] : []),
      { id: "markdown.code.copy", label: liveStrings.t("blockgroup.code.copy"), icon: "copy", run: () => host.copy(block.code) },
    ];
  },
  image: (block, host, writable) => {
    if (!writable) return [];
    const width = (value: number | null, full: number): SurfaceMenuItem => ({
      id: `markdown.image.width.${value ?? "original"}`,
      label: t(value === null ? "editor_menu.image.original" : value === full ? "editor_menu.image.full" : value === IMAGE_WIDTHS.small ? "editor_menu.image.small" : "editor_menu.image.medium"),
      radio: true,
      checked: block.image.width === value,
      run: () => void host.write((state) => rewriteImage(state, block.from, block.to, { width: value })),
    });
    return [
      ...(widthWritable(block.image) ? [{
        id: "markdown.image.width",
        label: t("editor_menu.image.width"),
        // La colonna del testo si misura quando il menu si apre, non a ogni
        // cambio di blocco: è una lettura dell'impaginazione.
        load: async (): Promise<SurfaceMenuEntry[]> => {
          let full = 0;
          host.view((view) => {
            full = Math.round(view.contentDOM.clientWidth);
            return true;
          });
          return [width(IMAGE_WIDTHS.small, full), width(IMAGE_WIDTHS.medium, full), ...(full > 0 ? [width(full, full)] : []), width(null, full)];
        },
      }] : []),
      {
        id: "markdown.image.replace",
        label: liveStrings.t("blockgroup.image.alt"),
        run: () => void host.view((view) => openImageAt(view, block.from, block.to)),
      },
    ];
  },
};

/// Il gruppo del blocco in `pos`, o di quello della selezione quando `pos` è
/// `null`. Un gruppo senza voci (un compito in sola lettura) non c'è.
export function markdownBlockGroup(host: BlockGroupHost, pos: number | null): SurfaceBlockGroup | null {
  const block = host.read((state) => (pos === null ? selectionBlock(state) : blockAt(state, Math.min(pos, state.doc.length))));
  if (!block) return null;
  const build = GROUPS[block.kind] as Build<typeof block.kind>;
  const items = build(block as never, host, host.editable());
  if (items.length === 0) return null;
  // La trasclusione di un blocco è il blocco sincronizzato (T30).
  const label = block.kind === "transclusion" && block.block !== null ? "blockgroup.synced" : LABELS[block.kind];
  return { id: block.kind, label: liveStrings.t(label), items };
}
