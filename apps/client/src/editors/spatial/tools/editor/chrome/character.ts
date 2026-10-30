// Il gruppo «Carattere» della riga delle opzioni (S5): mentre si scrive un
// testo, la famiglia, il corpo e le quattro enfasi di ciò che è scelto nel
// campo, o di ciò che si scriverà. Sono i controlli della barra del carattere
// dei documenti, in forma compatta: la scelta del carattere e il campo
// numerico del kit, e le enfasi coi tasti di Scrittura (Ctrl+B, I, U,
// Ctrl+Maiusc+X). Il colore resta il pozzo della barra, che già scrive nel
// campo.
//
// Il gruppo non tiene stato: legge l'aspetto dal campo (`field.look()`) e
// gli dà i cambi (`restyle`, `emphasize`). La scelta del carattere prende il
// fuoco mentre è aperta: il campo non si conclude, e lo riprende chiusa.

import { fontButton, type FontChoice } from "../../../../../kit/font-picker";
import { numberField } from "../../../../../kit/number-field";
import { formatNumber } from "../../../number";
import { t, type DrawKey } from "../../../strings";
import type { Emphasis } from "../../rich";
import { TEXT_FAMILIES } from "../../text";
import type { EditorContext } from "../context";

export interface CharacterContext {
  /// Rilegge il gruppo «Carattere» dal campo, e lo mostra mentre si scrive.
  syncCharacter: () => void;
}

/// Il corpo più piccolo e più grande che il gruppo scrive, in unità del
/// disegno.
const MIN_SIZE = 1;
const MAX_SIZE = 1000;

const EMPHASES: ReadonlyArray<{ readonly which: Emphasis; readonly label: DrawKey; readonly glyph: string; readonly look: Partial<CSSStyleDeclaration> }> = [
  { which: "bold", label: "draw.text.bold", glyph: "G", look: { fontWeight: "700" } },
  { which: "italic", label: "draw.text.italic", glyph: "C", look: { fontStyle: "italic" } },
  { which: "underline", label: "draw.text.underline", glyph: "S", look: { textDecoration: "underline" } },
  { which: "strike", label: "draw.text.strike", glyph: "ab", look: { textDecoration: "line-through" } },
];

/// Il nome di una famiglia scritta come pila CSS: la prima, senza virgolette.
export function familyName(stack: string): string {
  const first = stack.split(",")[0]?.trim() ?? "";
  return first.replace(/^(["'])(.*)\1$/, "$2");
}

/// Il generico di ripiego di una pila CSS, se la chiude.
function genericOf(stack: string): string | undefined {
  const last = stack.split(",").pop()?.trim();
  return last === "serif" || last === "sans-serif" || last === "monospace" ? last : undefined;
}

export function installCharacter(ctx: EditorContext, group: HTMLElement): void {
  const { life, drawingFonts } = ctx;
  group.hidden = true;

  /// Le famiglie che si scelgono: quelle di Fub, poi quelle del vault con la
  /// funzione «Caratteri»; ogni nome con la pila che scrive.
  let stacks = new Map<string, string>();
  const choices = (): FontChoice[] => {
    const out: FontChoice[] = [];
    stacks = new Map();
    const add = (stack: string, source: FontChoice["source"]): void => {
      const family = familyName(stack);
      if (family === "" || stacks.has(family)) return;
      stacks.set(family, stack);
      out.push({ family, source, generic: genericOf(stack) });
    };
    for (const stack of TEXT_FAMILIES) add(stack, "system");
    return out;
  };

  const writing = (): boolean => ctx.typing !== null && ctx.editable();

  /// Il campo, dopo un cambio dal gruppo: il testo va al suo posto, e il
  /// gruppo dice com'è adesso.
  const changed = (): void => {
    ctx.placeText();
    syncCharacter();
  };

  const fonts = fontButton({
    label: t("draw.properties.family"),
    mixedText: t("draw.chrome.mixed"),
    value: null,
    fonts: choices(),
    text: fontText(),
    lifetime: life,
    onChange: (family) => {
      if (!writing()) return;
      ctx.field.restyle("font-family", stacks.get(family) ?? family);
      changed();
    },
    // La scelta prende il fuoco: il campo non si conclude, e lo riprende.
    onOpenChange: (open) => {
      ctx.asking = open;
      if (!open && ctx.typing !== null) ctx.field.focus();
    },
  });
  group.append(fonts.element);

  const size = numberField({
    label: t("draw.sizes"),
    labelHidden: true,
    value: null,
    places: 1,
    min: MIN_SIZE,
    max: MAX_SIZE,
    mixedText: t("draw.chrome.mixed"),
    problem: (problem) => t(problem === "mixed" ? "draw.properties.problem.mixed" : PROBLEMS[problem], { units: "px" }),
    lifetime: life,
    onCommit: (value) => {
      if (!writing()) return;
      ctx.field.restyle("font-size", formatNumber(Math.min(MAX_SIZE, Math.max(MIN_SIZE, value)), 2));
      changed();
    },
  });
  group.append(size.element);
  // Il campo del corpo prende il fuoco come la scelta del carattere: il
  // testo resta aperto finché si scrive il numero, e lo riprende dopo.
  // Il puntatore arriva prima che il campo perda il fuoco.
  life.listen(size.element, "mousedown", () => {
    if (ctx.typing !== null) ctx.asking = true;
  });
  life.listen(size.input, "focus", () => {
    if (ctx.typing !== null) ctx.asking = true;
  });
  life.listen(size.input, "blur", () => {
    if (!ctx.asking) return;
    ctx.asking = false;
    if (ctx.typing !== null && document.activeElement === document.body) ctx.field.focus();
  });
  life.listen(size.input, "keydown", (event) => {
    if (event.key === "Enter" || event.key === "Escape") queueMicrotask(() => ctx.typing !== null && ctx.field.focus());
  });

  const toggles = EMPHASES.map(({ which, label, glyph, look }) => {
    const control = ctx.button(group, "draw-button", () => t(label), null, () => {
      if (!writing()) return;
      ctx.field.emphasize(which);
      changed();
    });
    const letter = document.createElement("span");
    letter.className = "draw-size-glyph";
    letter.setAttribute("aria-hidden", "true");
    letter.textContent = glyph;
    letter.style.setProperty("--draw-size", "15px");
    Object.assign(letter.style, look);
    control.append(letter);
    return { which, control };
  });

  /// Il gruppo come il campo: visibile mentre si scrive, coi valori di ciò
  /// che è scelto.
  function syncCharacter(): void {
    const on = writing();
    group.hidden = !on;
    if (!on) {
      fonts.close();
      return;
    }
    const look = ctx.field.look();
    fonts.setValue(look.family === null ? null : familyName(look.family));
    size.setValue(look.size);
    for (const { which, control } of toggles) control.setAttribute("aria-pressed", String(look.emphasis[which]));
  }
  ctx.syncCharacter = syncCharacter;

  // Una famiglia del vault che arriva cambia l'elenco.
  life.add(drawingFonts.watch(() => fonts.setFonts(choices())));
}

const PROBLEMS = {
  empty: "draw.properties.problem.empty",
  syntax: "draw.properties.problem.syntax",
  unit: "draw.properties.problem.unit",
  relative: "draw.properties.problem.relative",
  finite: "draw.properties.problem.finite",
} as const satisfies Record<string, DrawKey>;

/// Le parole della scelta del carattere.
function fontText(): { search: string; empty: string; groups: Record<FontChoice["source"], string> } {
  return {
    search: t("draw.character.search"),
    empty: t("draw.character.empty"),
    groups: {
      recent: t("draw.character.recent"),
      document: t("draw.character.document"),
      vault: t("draw.character.vault"),
      system: t("draw.character.fub"),
    },
  };
}
