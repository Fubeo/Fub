// La sezione «Tipi» del cassetto (E5): i tipi di nota del vault, ognuno con
// la sua icona e quante note lo nominano. Il clic apre la nota del tipo, che
// si apre e si modifica come ogni nota.
//
// Sta fra le appuntate e «Tutte le note», con le stesse righe e lo stesso
// titolo delle altre sezioni (`.panel-title`, `.tree-row`): non c'è una pelle
// sua. Senza tipi (o senza cartella dei tipi) la sezione non c'è, come le
// appuntate vuote; col filtro aperto si fa da parte con loro.
//
// I conteggi li dice il core (`note.type.list`): la regola di chi è di un
// tipo è una sola. Si rileggono quando l'indice cambia, raccolti in un giro
// solo, mai per battuta.
import { onEvent } from "../state/kernel";
import { listNoteTypes, NO_TYPES, type NoteType, type NoteTypeList } from "../state/note-types";
import { TYPES_FOLDER_SETTING } from "../state/note-type-commands";
import { on, state } from "../state/store";
import { t, onLanguage } from "../i18n/strings";
import type { Lifetime } from "../ui/lifetime";
import { drawTypeIcon } from "../ui/note-type-menu";
import { Race } from "../ui/race";
import { setTooltip } from "../ui/tooltip";

/// Quanto si aspetta dopo l'ultimo cambio dell'indice prima di rileggere.
const SETTLE_MS = 250;

export interface ExplorerTypesOptions {
  readonly lifetime: Lifetime;
  /// La sezione va subito dopo questo elemento.
  readonly after: HTMLElement;
  /// Il filtro è aperto: la sezione si fa da parte.
  readonly covered: () => boolean;
  /// Apre la nota del tipo.
  readonly open: (doc: string) => void;
}

export interface ExplorerTypes {
  /// Ridisegna ciò che si sa, senza rileggere (il filtro si è aperto o chiuso).
  render(): void;
}

export function mountExplorerTypes(options: ExplorerTypesOptions): ExplorerTypes {
  const { lifetime } = options;
  const title = document.createElement("div");
  title.className = "panel-title";
  title.id = "types-title";
  title.setAttribute("role", "heading");
  title.setAttribute("aria-level", "2");
  const label = document.createElement("span");
  const count = document.createElement("span");
  count.className = "panel-count";
  title.append(label, count);
  const list = document.createElement("ul");
  list.id = "types-list";
  list.className = "plain-list";
  list.setAttribute("role", "list");
  list.setAttribute("aria-labelledby", title.id);
  title.hidden = true;
  list.hidden = true;
  options.after.after(title, list);
  lifetime.add(() => {
    title.remove();
    list.remove();
  });

  let known: NoteTypeList = NO_TYPES;
  const render = (): void => {
    if (lifetime.closed) return;
    const hide = known.types.length === 0 || options.covered();
    title.hidden = hide;
    list.hidden = hide;
    label.textContent = t("explorer.types");
    count.textContent = String(known.types.length);
    list.replaceChildren(...known.types.map((type) => typeRow(type, options.open)));
  };
  const markActive = (): void => {
    for (const row of list.querySelectorAll<HTMLElement>(".tree-row")) {
      if (row.dataset.path === state.currentDoc) row.setAttribute("aria-current", "true");
      else row.removeAttribute("aria-current");
    }
  };

  const reads = new Race();
  const read = () => reads.last(async (expected) => {
    // Senza vault non c'è un kernel a cui chiedere.
    const next = state.vaultRoot === "" ? NO_TYPES : await expected(listNoteTypes().catch(() => NO_TYPES));
    if (lifetime.closed) return;
    known = next;
    render();
    markActive();
  });
  let timer: ReturnType<typeof setTimeout> | null = null;
  const soon = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void read();
    }, SETTLE_MS);
  };
  lifetime.add(() => {
    if (timer !== null) clearTimeout(timer);
  });
  lifetime.add(on("vault", () => void read()));
  lifetime.add(on("documents", soon));
  lifetime.add(onEvent("index_updated", soon));
  lifetime.add(onEvent("setting_changed", (event) => {
    if (event.key === TYPES_FOLDER_SETTING) soon();
  }));
  lifetime.add(on("active-doc", markActive));
  lifetime.add(onLanguage(render));
  void read();
  return { render };
}

/// La riga di un tipo: la sua icona, il nome, quante note (lo zero non si
/// scrive, come nelle cartelle).
function typeRow(type: NoteType, open: (doc: string) => void): HTMLLIElement {
  const li = document.createElement("li");
  const row = document.createElement("div");
  row.className = "tree-row note type-row";
  row.dataset.path = type.doc;
  row.dataset.type = type.name;
  setTooltip(row, type.doc);
  const icon = document.createElement("span");
  icon.className = "row-icon";
  icon.setAttribute("aria-hidden", "true");
  drawTypeIcon(icon, type.icon);
  const name = document.createElement("span");
  name.className = "row-name";
  name.textContent = type.name;
  row.append(icon, name);
  if (type.notes > 0) {
    const notes = document.createElement("span");
    notes.className = "row-count";
    notes.setAttribute("aria-hidden", "true");
    notes.textContent = String(type.notes);
    row.append(notes);
  }
  // Si apre anche da tastiera: Tab ci arriva, Invio apre il tipo.
  row.tabIndex = 0;
  row.setAttribute("role", "link");
  row.addEventListener("click", () => open(type.doc));
  row.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.defaultPrevented) return;
    event.preventDefault();
    open(type.doc);
  });
  li.append(row);
  return li;
}
