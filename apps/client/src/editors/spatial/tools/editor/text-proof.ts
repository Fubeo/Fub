// Il correttore nel testo dei disegni (S6): lo stesso client dei documenti
// e delle note (`editors/core/proof.ts`), sul campo di Scrittura in cui si
// scrive un testo. Un segmento per riga, verbatim: un rilievo torna al punto
// esatto della riga. I segni sono tratti del campo (`field.mark`), che una
// riga cambiata perde; il menu dei suggerimenti è quello della shell, sul
// clic destro o sul tasto del menu contestuale.
//
// Il correttore c'è quando chi monta l'editor dà le sue porte, e parla quando
// le impostazioni `proof.*` ci sono: senza, il client tace. Si controlla
// soltanto mentre si scrive; una correzione è una battuta del campo, che
// entra nel passo di annulla del testo.

import { t as shellText } from "../../../../i18n/strings";
import { ignoreKey, ProofClient, type ProofIssue } from "../../../core/proof";
import type { ProofPorts } from "../../../core/proof-ports";
import { showContextMenu, type MenuItem } from "../../../../ui/menu";
import type { Caret } from "../rich";
import { lineText } from "../rich";
import type { EditorContext } from "./context";

/// Quanto si aspetta dopo l'ultima battuta prima di chiedere.
const QUIET_MS = 400;
/// Quanti suggerimenti offre il menu.
const SUGGESTED = 4;

/// Le porte del correttore, e dove dire l'esito di «Aggiungi al dizionario».
export interface DrawProof {
  readonly ports: ProofPorts;
  readonly notify?: (message: string) => void;
}

export interface TextProofContext {
  /// Il testo del campo è cambiato, o si comincia a scrivere: il correttore
  /// lo rilegge dopo una pausa.
  proofText: () => void;
}

/// Un rilievo nel campo: dove sta, e il testo che vi stava.
interface Found {
  readonly issue: ProofIssue;
  readonly from: Caret;
  readonly to: Caret;
  readonly text: string;
  readonly key: string;
}

export function installTextProof(ctx: EditorContext): void {
  const { life, field, textInput } = ctx;
  const options: DrawProof | undefined = ctx.options.proof;
  if (options === undefined) {
    ctx.proofText = () => {};
    return;
  }
  // Il correttore di Fub prende il posto di quello del browser, come nei
  // documenti: due ondulate sulla stessa parola direbbero due cose.
  textInput.spellcheck = false;
  const client = new ProofClient(options.ports);
  life.add(() => client.dispose());
  const ignored = new Set<string>();
  let found: Found[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;
  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  life.add(cancel);

  const schedule = (delay: number): void => {
    cancel();
    generation += 1;
    if (ctx.typing === null || !ctx.editable()) {
      found = [];
      return;
    }
    const mine = generation;
    timer = setTimeout(() => {
      timer = null;
      void run(mine);
    }, delay);
  };
  ctx.proofText = () => schedule(QUIET_MS);
  life.add(client.onChange(() => schedule(0)));

  async function run(mine: number): Promise<void> {
    const rich = field.rich;
    const texts = rich.lines.map(lineText);
    let result;
    try {
      result = await client.check(texts);
    } catch {
      // Un guasto del canale non rompe la scrittura: si riprova alla prossima
      // battuta.
      return;
    }
    // Il testo è cambiato durante l'attesa, o il campo è chiuso: il prossimo
    // controllo è già in programma, e questo non vale più.
    if (mine !== generation || ctx.typing === null || field.rich !== rich || result === null) return;
    const next: Found[] = [];
    texts.forEach((text, line) => {
      for (const issue of result.segments[line] ?? []) {
        if (issue.end <= issue.start) continue;
        const said = text.slice(issue.start, issue.end);
        const key = ignoreKey(issue, said);
        if (ignored.has(key)) continue;
        next.push({ issue, from: { line, offset: issue.start }, to: { line, offset: issue.end }, text: said, key });
      }
    });
    if (next.length === 0 && found.length === 0) return;
    found = next;
    field.mark(found.map(({ issue, from, to }) => ({ from, to, className: `draw-text-proof-${issue.kind}`, title: issue.message })));
  }

  /// Il rilievo che contiene `at`, se c'è ancora.
  const hitAt = (at: Caret): Found | undefined => {
    const rich = field.rich;
    return found.find(
      (each) =>
        each.from.line === at.line &&
        at.offset >= each.from.offset &&
        at.offset <= each.to.offset &&
        lineText(rich.lines[at.line] ?? { attrs: {}, spans: [] }).slice(each.from.offset, each.to.offset) === each.text,
    );
  };

  const items = (hit: Found): MenuItem[] => {
    const out: MenuItem[] = [];
    if (ctx.editable()) {
      for (const suggestion of hit.issue.suggestions.slice(0, SUGGESTED)) {
        out.push({ label: suggestion, run: () => void field.replace(hit.from, hit.to, hit.text, suggestion) });
      }
    }
    if (out.length === 0) out.push({ label: hit.issue.message, disabled: true, run: () => {} });
    if (hit.issue.kind === "spelling") {
      out.push({
        label: shellText("proof.add_word"),
        separator: true,
        run: () => {
          ignored.add(hit.key);
          schedule(0);
          client.addWord(hit.text).then(
            (message) => {
              if (message) options.notify?.(message);
            },
            (error: unknown) => options.notify?.(error instanceof Error ? error.message : String(error)),
          );
        },
      });
    }
    out.push({
      label: shellText("proof.ignore"),
      separator: hit.issue.kind !== "spelling",
      run: () => {
        ignored.add(hit.key);
        schedule(0);
      },
    });
    return out;
  };

  // Il clic destro su un tratto segnato, o il tasto del menu col cursore lì,
  // apre i suggerimenti. Il menu prende il fuoco: il testo non si conclude, e
  // il campo lo riprende.
  life.listen(textInput, "contextmenu", (event) => {
    if (ctx.typing === null) return;
    const fromKeys = event.clientX === 0 && event.clientY === 0;
    const at = (fromKeys ? null : field.caretAtPoint(event.clientX, event.clientY)) ?? field.caret();
    const hit = hitAt(at);
    if (hit === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    ctx.asking = true;
    const done = (): void => {
      ctx.asking = false;
      if (ctx.typing !== null) field.focus();
    };
    if (fromKeys) {
      const box = textInput.getBoundingClientRect();
      showContextMenu(new MouseEvent("contextmenu", { clientX: box.left, clientY: box.bottom }), items(hit), { onClose: done });
    } else {
      showContextMenu(event, items(hit), { onClose: done });
    }
  });
}
