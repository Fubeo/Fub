// La ricerca dei comandi del disegno (E3): Ctrl+/ apre un campo e il catalogo
// dei comandi (`commands.ts`), col tasto e il posto da cui vengono. Un comando spento si
// vede col perché, e non si sceglie. I comandi usati da poco stanno in cima.
// Con il Disegno completo aperto la ricerca cerca fra le voci del suo indice
// (K6 T9a, `completo/comandi.ts`): ogni voce col suo posto, il suo tasto e il
// suo perché. La prima apertura carica l'indice, e nessuna famiglia; se
// l'indice non arriva, lo dice, con «Riprova».
// La palette dello Scrittoio (Ctrl+Maiusc+P) resta sua.

import { createList, openDialog } from "../../../../../kit";
import { fuzzyScore } from "../../../../../ui/fuzzy";
import { openLifetime } from "../../../../../ui/lifetime";
import type { MenuItem } from "../../../../../ui/menu";
import { t } from "../../../strings";
import type { EditorContext } from "../context";
import { azioniVoci, type DrawCommand } from "./commands";

export interface CommandSearchContext {
  /// Apre la ricerca dei comandi.
  searchCommands: () => void;
  /// Il Disegno completo aperto, con le sue voci (K6 T9a); `null` senza il
  /// Completo, e allora menu e ricerca sono quelli di oggi.
  completoVoci?: () => VociCompleto | null;
}

/// Ciò che il Disegno completo dà al menu ≡ e alla ricerca (K6 T9a). Lo
/// implementa `completo/index.ts`: qui se ne dice solo la forma.
export interface VociCompleto {
  /// Le voci dei sottomenu del menu ≡; se l'indice non arriva, lo dice.
  menu(selezione: () => readonly string[], azioni: AzioniVociCompleto): Promise<readonly MenuItem[]>;
  /// Le voci per la ricerca; `null` se l'indice non arriva.
  ricerca(selezione: () => readonly string[], azioni: AzioniVociCompleto): Promise<readonly FoundCommand[] | null>;
}

/// Ciò che l'editor dà al Completo per una voce (K6 T9a).
export interface AzioniVociCompleto {
  /// Lo strumento del motore: l'editor lo sceglie. I comandi del motore non
  /// passano di qui: partono da `eseguiVoce`.
  readonly strumento: (id: string) => void;
  /// Una voce del client (la vista della banda, K6 T11): l'editor la fa con il suo id.
  readonly client: (id: string) => void;
  /// Rifà la richiesta dell'indice, per chi lo mostra.
  readonly riprova: () => void;
}

/// Un comando che si cerca: quelli del catalogo, o le voci del Completo.
export type FoundCommand = Pick<DrawCommand, "label" | "path" | "hint" | "disabled" | "description" | "run"> & {
  /// L'id del catalogo: ciò che i recenti ricordano.
  readonly key: string;
  /// Il nome nelle altre lingue: la ricerca lo trova lo stesso (K6 T9a).
  readonly altreLingue?: readonly string[];
};

/// Quanti comandi recenti si ricordano.
const RECENT_LIMIT = 5;

/// I comandi per `query`, dai più pertinenti: prima quelli il cui nome
/// comincia con la ricerca, poi quelli che la contengono, poi quelli che ne
/// hanno le lettere in ordine, nel nome o nel posto; a parità i più compatti.
/// Senza ricerca, i recenti in cima e poi tutti nel loro ordine.
export function rankCommands(all: readonly FoundCommand[], query: string, recent: readonly string[]): FoundCommand[] {
  const q = query.trim().toLowerCase();
  if (q === "") {
    const first = recent.flatMap((key) => all.find((one) => one.key === key) ?? []);
    return [...first, ...all.filter((one) => !recent.includes(one.key))];
  }
  const scored: { one: FoundCommand; rank: number; score: number; at: number }[] = [];
  all.forEach((one, at) => {
    const label = one.label.toLowerCase();
    // Il nome nella lingua di adesso e quelli nelle altre: la ricerca li trova tutti.
    const nomi = [label, ...(one.altreLingue ?? []).map((nome) => nome.toLowerCase())];
    const posti = nomi.map((nome) => nome.indexOf(q)).filter((posto) => posto >= 0);
    if (nomi.some((nome) => nome.startsWith(q))) scored.push({ one, rank: 0, score: 0, at });
    else if (posti.length > 0) scored.push({ one, rank: 1, score: Math.min(...posti), at });
    else {
      const sparse = fuzzyScore(one.label, q);
      const placed = sparse === null ? fuzzyScore(`${one.path} ${one.label}`, q) : null;
      if (sparse !== null) scored.push({ one, rank: 2, score: sparse, at });
      else if (placed !== null) scored.push({ one, rank: 3, score: placed, at });
    }
  });
  scored.sort((a, b) => a.rank - b.rank || a.score - b.score || a.at - b.at);
  return scored.map(({ one }) => one);
}

export function installCommandSearch(ctx: EditorContext): void {
  const recent: string[] = [];
  /// La vita della ricerca aperta: chiudere l'editor la chiude.
  let open: ReturnType<typeof openLifetime> | null = null;
  ctx.life.add(() => open?.close());

  /// Il catalogo com'è adesso, senza il Completo.
  const commands = (): FoundCommand[] => ctx.commands().map((one) => ({ ...one, key: one.id }));

  ctx.searchCommands = () => {
    if (ctx.asking || ctx.disposed) return;
    ctx.asking = true;
    ctx.cancelGesture();
    const own = openLifetime();
    open = own;
    const completo = ctx.completoVoci?.() ?? null;
    const body = document.createElement("div");
    body.className = "draw-commands";
    const field = document.createElement("label");
    field.className = "draw-commands-field";
    const name = document.createElement("span");
    name.textContent = t("draw.commands.search");
    const input = document.createElement("input");
    input.type = "search";
    input.autocomplete = "off";
    input.spellcheck = false;
    field.append(name, input);
    const rows = document.createElement("div");
    rows.className = "draw-commands-list";
    rows.setAttribute("aria-label", t("draw.commands"));
    const empty = document.createElement("p");
    empty.className = "draw-commands-empty";
    empty.setAttribute("role", "status");
    body.append(field, rows, empty);
    // «Riprova» c'è solo quando l'indice non arriva: una riga nascosta pesa nel
    // layout della finestra, e la tavolozza di oggi non deve cambiare altezza.
    let riprova: HTMLButtonElement | null = null;
    const mostraRiprova = (): void => {
      if (riprova !== null) return;
      riprova = document.createElement("button");
      riprova.type = "button";
      riprova.className = "kit-button draw-commands-retry";
      riprova.textContent = t("draw.window.retry");
      riprova.addEventListener("click", () => carica());
      body.append(riprova);
    };
    const nascondiRiprova = (): void => {
      riprova?.remove();
      riprova = null;
    };

    let chosen: FoundCommand | null = null;
    let aperta = true;
    /// Le voci mostrate: quelle del catalogo, o quelle del Completo quando
    /// arrivano. `caricando` finché l'indice del Completo non risponde.
    let tutte: readonly FoundCommand[] = completo === null ? commands() : [];
    let caricando = completo !== null;
    const azioni = azioniVoci(ctx, () => carica());
    const dialog = openDialog<null>({
      title: t("draw.commands"),
      body,
      actions: [{ id: "close", label: t("draw.commands.close"), value: null }],
      dismissValue: null,
      lifetime: own,
      className: "draw-commands-dialog",
    });
    const list = createList<FoundCommand>({
      container: rows,
      role: "listbox",
      items: [],
      owner: input,
      key: (one) => one.key,
      render: (one, row) => {
        row.classList.add("draw-commands-row");
        // Le voci spente restano raggiungibili con le frecce, perché Invio
        // ripeta il perché (K6 T9a): la lista non le salta, e `segnaSpente` le
        // dice spente a ogni aggiornamento.
        const label = document.createElement("span");
        label.className = "draw-commands-label";
        label.textContent = one.label;
        const where = document.createElement("span");
        where.className = "draw-commands-path";
        where.textContent = one.path;
        row.append(label, where);
        if (one.hint !== undefined && one.hint !== "") {
          const kbd = document.createElement("kbd");
          kbd.className = "draw-commands-key";
          kbd.textContent = one.hint;
          row.append(kbd);
        }
        if (one.disabled && one.description !== undefined) {
          const why = document.createElement("span");
          why.className = "draw-commands-why";
          why.textContent = one.description;
          row.append(why);
        }
      },
      onActivate: (one) => {
        // Una voce spenta non parte: dice di nuovo perché (K6 T9a).
        if (one.disabled) {
          if (one.description !== undefined) empty.textContent = one.description;
          return;
        }
        chosen = one;
        dialog.close(null);
      },
      lifetime: own,
    });
    /// Le voci spente hanno `aria-disabled`, come dice l'a11y. La lista del kit
    /// lo toglie a ogni aggiornamento, perché non le salta: lo si rimette qui.
    const segnaSpente = (shown: readonly FoundCommand[]): void => {
      [...rows.querySelectorAll<HTMLElement>(".draw-commands-row")].forEach((row, at) => {
        if (shown[at]?.disabled === true) row.setAttribute("aria-disabled", "true");
        else row.removeAttribute("aria-disabled");
      });
    };
    const refresh = (): void => {
      if (caricando) return;
      const shown = rankCommands(tutte, input.value, recent);
      list.setItems(shown);
      segnaSpente(shown);
      if (shown.length > 0) empty.textContent = "";
      else empty.textContent = completo !== null && tutte.length === 0 ? t("draw.completo.indice.empty") : t("draw.commands.none");
    };
    /// Chiede le voci al Completo: il primo giro carica l'indice, e nessuna
    /// famiglia. Se l'indice non arriva, lo dice, con «Riprova».
    const carica = (): void => {
      if (completo === null) return;
      caricando = true;
      nascondiRiprova();
      list.setItems([]);
      empty.textContent = t("draw.completo.indice.loading");
      void completo.ricerca(() => [...ctx.selection], azioni).then((voci) => {
        if (!aperta || ctx.disposed) return;
        caricando = false;
        if (voci === null) {
          tutte = [];
          empty.textContent = t("draw.completo.indice.failed");
          mostraRiprova();
          return;
        }
        tutte = voci;
        refresh();
      });
    };
    own.listen(input, "input", refresh);
    refresh();
    carica();
    input.focus();
    void dialog.result.then(() => {
      aperta = false;
      ctx.asking = false;
      own.close();
      if (open === own) open = null;
      const run = chosen;
      if (run === null || ctx.disposed) return;
      const at = recent.indexOf(run.key);
      if (at >= 0) recent.splice(at, 1);
      recent.unshift(run.key);
      recent.length = Math.min(recent.length, RECENT_LIMIT);
      run.run();
    });
  };
}
