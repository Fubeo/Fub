// Le voci del documento nella banda di stato: il foglio del cursore, le
// parole, la lingua, «Registra» quando è acceso.
//
// Le parole sono quelle di Proprietà › Conteggio (`countText`): una fonte
// sola, e un clic porta lì. Il conteggio del documento si rifà quando cambia
// il documento, quello della selezione quando cambia la selezione.
import type { Node as PmNode } from "prosemirror-model";
import type { Selection } from "prosemirror-state";
import type { SurfaceStatusItem } from "../core/registry";
import { t } from "../../i18n/strings";
import type { RichEngine } from "./engine";
import { languageName } from "./properties";
import { countText } from "./review";
import type { RichSide } from "./side";

export function richStatus(engine: RichEngine, side: RichSide): () => readonly SurfaceStatusItem[] {
  let counted: { doc: PmNode | null; words: number } = { doc: null, words: 0 };
  let selected: { selection: Selection | null; words: number } = { selection: null, words: 0 };
  return () => {
    const numbers = new Intl.NumberFormat(document.documentElement.lang || undefined);
    const { doc, selection } = engine.read((state) => ({ doc: state.doc, selection: state.selection }));
    if (doc !== counted.doc) counted = { doc, words: countText(doc).words };
    const items: SurfaceStatusItem[] = [];
    const sheet = engine.sheetOf();
    if (sheet) items.push({ id: "page", text: t("rich.status.page", { at: numbers.format(sheet.at), total: numbers.format(sheet.total) }) });
    const count = numbers.format(counted.words);
    let text = t("rich.status.words", { count });
    if (!selection.empty) {
      if (selection !== selected.selection) selected = { selection, words: countText(doc, selection.from, selection.to).words };
      text = t("rich.status.words.selected", { selected: numbers.format(selected.words), count });
    }
    items.push({ id: "words", text, hint: t("rich.status.words.hint"), open: () => side.show("properties", "count") });
    const language = engine.language();
    if (language) items.push({ id: "language", text: languageName(language), hint: t("rich.status.language") });
    if (engine.tracking()) items.push({ id: "tracking", text: t("rich.status.tracking"), hint: t("rich.track.switch") });
    return items;
  };
}
