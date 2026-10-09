// Le scelte della galleria di «Nuovo disegno», senza DOM.
//
// Che schede ci sono, come si chiamano, che argomenti parte il comando e che
// cosa si ricorda per la prossima volta. Sono funzioni pure apposta: la
// galleria (`gallery.ts`) le chiama e le disegna, e si provano senza un browser.
//
// L'elenco dei modelli lo dà il comando: le scelte del suo parametro `template`,
// nell'ordine in cui le dichiara, con i titoli nella lingua dell'host. Questa
// parte aggiunge ciò che il comando non sa: a quale modello corrisponde un file
// da mostrare in anteprima, e che cosa dice la riga sotto il nome.

import type { CommandSpec, ParamKind, VaultEntry } from "../../../host/contract";
import { catalogLanguage, resolvedLanguage } from "../../../i18n/strings";
import { TEMPLATE_IDS, wordsOf, type Lang, type TemplateId } from "./content";
import { t } from "./strings";

/// Il modello che non ha file: il documento nuovo del provider.
export const BLANK = "blank";

/// La chiave dello stato di vista che ricorda l'ultima scelta.
export const CHOICE_KEY = "drawing.new.template";

/// L'impostazione che dice la cartella dei modelli del vault, e il suo valore
/// quando nessuno ha scelto.
export const TEMPLATES_SETTING = "draw.templates";
export const TEMPLATES_FOLDER = "Templates";

/// Il bundle che dichiara l'impostazione.
export const DRAW_BUNDLE = "fub.draw";

/// Una scheda: un modello da scegliere.
export interface Card {
  /// Il valore del parametro `template` del comando.
  readonly id: string;
  /// Il nome, come lo chiama il comando.
  readonly title: string;
  /// Il modello ha un file da mostrare? `blank` no, e un modello che questa
  /// versione non conosce nemmeno.
  readonly file: TemplateId | null;
  /// La riga che dice a che cosa serve, se questa versione la conosce.
  readonly note: string | null;
}

/// Un disegno del vault da copiare.
export interface VaultDrawing {
  /// Il percorso nel vault, che è il valore del parametro `from`.
  readonly path: string;
  /// Il nome, senza cartella e senza estensione.
  readonly name: string;
}

/// Ciò che la galleria fa creare: un modello, o la copia di un disegno.
export type Selection =
  | { readonly kind: "template"; readonly id: string }
  | { readonly kind: "from"; readonly path: string };

/// La scelta con cui la galleria si apre la prima volta.
export const FIRST: Selection = { kind: "template", id: BLANK };

/// La lingua dei file dei modelli per chi guarda: l'inglese se l'interfaccia è
/// in inglese, l'italiano per ogni altra. È la regola del comando, che sceglie
/// il file della lingua dell'host.
export function previewLanguage(): Lang {
  return catalogLanguage(resolvedLanguage()) === "en" ? "en" : "it";
}

/// Il parametro `name` della spec, se c'è.
function parameter(spec: CommandSpec, name: string): CommandSpec["params"][number] | undefined {
  return spec.params.find((param) => param.name === name);
}

/// `kind` come elenco di scelte, se lo è.
function choicesOf(kind: ParamKind): readonly { readonly value: string; readonly title: string }[] | null {
  return kind.kind === "choice" ? kind.value : null;
}

/// Il modello `id` ha un file nella galleria?
export function isTemplateId(id: string): id is TemplateId {
  return (TEMPLATE_IDS as readonly string[]).includes(id);
}

/// Le schede: le scelte del parametro `template` nell'ordine del comando, coi
/// loro titoli. Senza spec, cioè se la shell non l'ha ancora, gli otto modelli
/// che questa versione porta, coi nomi della lingua di chi guarda; se la spec
/// non ha il parametro, il solo «Vuoto», che è ciò che il comando sa fare.
export function cardsOf(spec: CommandSpec | undefined, lang: Lang = previewLanguage()): Card[] {
  const card = (id: string, title: string): Card => {
    const known = id === BLANK || isTemplateId(id);
    return {
      id,
      title,
      file: isTemplateId(id) ? id : null,
      note: known ? t(`draw.new.note.${id as typeof BLANK | TemplateId}`) : null,
    };
  };
  const fallback = (id: string): string => (isTemplateId(id) ? wordsOf(lang).names[id] : t("draw.new.blank"));
  if (spec === undefined) return [BLANK, ...TEMPLATE_IDS].map((id) => card(id, fallback(id)));
  const param = parameter(spec, "template");
  const choices = param === undefined ? null : choicesOf(param.kind);
  if (choices === null || choices.length === 0) return [card(BLANK, fallback(BLANK))];
  return choices.map((choice) => card(choice.value, choice.title.trim() === "" ? fallback(choice.value) : choice.title));
}

/// Il comando copia un disegno del vault? Senza spec sì: è ciò che il comando
/// sa fare; con una spec senza il parametro `from`, no.
export function offersVault(spec: CommandSpec | undefined): boolean {
  return spec === undefined || parameter(spec, "from") !== undefined;
}

/// La cartella dei modelli del vault dall'impostazione: senza barre ai bordi
/// e senza spazi, la cartella di serie se non è un testo. Il testo vuoto è la
/// radice del vault, ed è una scelta come un'altra.
export function templatesFolder(value: unknown): string {
  if (typeof value !== "string") return TEMPLATES_FOLDER;
  return value.trim().replace(/^\/+|\/+$/g, "");
}

/// I disegni da offrire in `folder`: i file `.svg` che stanno direttamente
/// lì, per nome. Un file che non è una scena lo rifiuta il comando, con la sua
/// frase, quando lo si sceglie.
export function vaultDrawings(entries: readonly VaultEntry[], folder: string): VaultDrawing[] {
  const prefix = folder === "" ? "" : `${folder}/`;
  return entries
    .filter((entry) => /\.svg$/i.test(entry.id) && entry.id.startsWith(prefix) && !entry.id.slice(prefix.length).includes("/"))
    .map((entry) => ({ path: entry.id, name: entry.id.slice(prefix.length).replace(/\.svg$/i, "") }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/// Gli argomenti di `drawing.create`: soltanto ciò che si è riempito. Il
/// modello vuoto è l'assenza di `template`, come dice il comando.
export function createArgs(name: string, folder: string, choice: Selection): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  if (name.trim() !== "") args.name = name.trim();
  if (folder.trim() !== "") args.folder = folder.trim();
  if (choice.kind === "from") args.from = choice.path;
  else if (choice.id !== BLANK) args.template = choice.id;
  return args;
}

/// Che cosa si scrive nello stato della vista: l'id del modello, o `from:` e il
/// percorso del disegno.
export function memoryOf(choice: Selection): string {
  return choice.kind === "from" ? `from:${choice.path}` : choice.id;
}

/// La scelta che la memoria dice, se c'è ancora: un modello che il comando
/// offre, o un disegno che la cartella ha. Altrimenti, e per un valore che non
/// è un testo, la prima: «Vuoto».
export function selectionFrom(memory: unknown, cards: readonly Card[], drawings: readonly VaultDrawing[]): Selection {
  if (typeof memory !== "string") return FIRST;
  if (memory.startsWith("from:")) {
    const path = memory.slice("from:".length);
    return drawings.some((drawing) => drawing.path === path) ? { kind: "from", path } : FIRST;
  }
  return cards.some((card) => card.id === memory) ? { kind: "template", id: memory } : FIRST;
}
