// @vitest-environment happy-dom
//
// Il bilancio di ogni menu, per ogni posto di `menu-cases.ts`: al massimo nove
// voci e quattro gruppi al primo livello, ciò che cancella per ultimo, niente
// voci grigie senza un perché, niente doppioni con la mini-barra, solo le
// parole del lessico, e nessun tasto per muoversi nel menu scritto dentro il
// menu (frecce, Invio, Esc: li mostra la riga dei suggerimenti). Tab no: nei
// menu del testo è il gesto che rientra (Aumenta il rientro, Tab).
//
// Le regole stanno in `budgetIssues`, pura: un caso finto che le rompe tutte
// prova che la guardia morde, prima che i casi veri provino che passano.
import { afterEach, describe, expect, it, vi } from "vitest";
import { forbiddenIn } from "../i18n/lexicon";
import type { ComposedEditorMenu } from "../panels/editor-menu";
import { closeContextMenu, showContextMenu, type MenuItem } from "./menu";
import { MENU_CASES } from "./menu-cases";

// Le voci dei plugin passano dall'host vero: qui nessuna view ne offre.
vi.mock("./context-views", () => ({ contextMenuItems: async () => [], hasContextMenuViews: () => false }));

const MAX_ITEMS = 9;
const MAX_GROUPS = 4;

/// I tasti che muovono dentro un menu, nelle due lingue e coi loro segni.
/// Tab resta fuori: scritto accanto a «Aumenta il rientro» è un gesto del testo.
const NAVIGATION_WORDS = /\b(?:frecc(?:ia|e)|invio|enter|return|esc|escape|arrows?)\b|[↑↓←→⏎↵⎋]/iu;
/// Un accordo con un modificatore è la scorciatoia di un gesto (Ctrl+Invio
/// apre): quella si scrive. Un tasto da solo che naviga, no.
const MODIFIER = /\b(?:ctrl|cmd|alt|maiusc|shift|mod|meta|opzione|option)\b|[⌘⌥⇧⌃]/iu;

/// Tutte le voci, dentro i sottomenu, che si possono leggere senza aprirli.
function flatten(items: readonly MenuItem[]): MenuItem[] {
  return items.flatMap((item) => [item, ...(Array.isArray(item.items) ? flatten(item.items) : [])]);
}

/// Scrive un tasto per muoversi nel menu: nel nome o nella spiegazione basta
/// nominarlo; nella scorciatoia, un tasto di navigazione senza modificatore.
function namesNavigation(item: MenuItem): boolean {
  if (NAVIGATION_WORDS.test(item.label) || NAVIGATION_WORDS.test(item.description ?? "")) return true;
  const hint = item.hint ?? "";
  return NAVIGATION_WORDS.test(hint) && !MODIFIER.test(hint);
}

/// Che cosa un menu composto sbaglia del bilancio; vuoto se niente.
/// `drawn` è il testo del menu disegnato, piede compreso.
function budgetIssues(menu: ComposedEditorMenu, miniBar: boolean, drawn: string): string[] {
  const issues: string[] = [];
  const top = (menu.clipboard.length > 0 ? 1 : 0) + menu.items.length;
  const groups =
    menu.items.reduce((count, item, index) => count + (index === 0 || item.separator ? 1 : 0), 0) + (menu.clipboard.length > 0 ? 1 : 0);
  const all = [...flatten(menu.clipboard), ...flatten(menu.items), ...flatten(menu.searchable)];

  if (top > MAX_ITEMS) issues.push(`${top} voci al primo livello (al massimo ${MAX_ITEMS})`);
  if (groups > MAX_GROUPS) issues.push(`${groups} gruppi al primo livello (al massimo ${MAX_GROUPS})`);
  const firstDanger = menu.items.findIndex((item) => item.danger);
  if (firstDanger >= 0 && !menu.items.slice(firstDanger).every((item) => item.danger)) issues.push("il pericoloso non sta per ultimo");
  for (const item of all.filter((entry) => entry.disabled && !entry.description)) issues.push(`«${item.label}» è grigia senza un perché`);
  if (miniBar && menu.items.some((item) => item.label === "Formato")) issues.push("ripete la mini-barra");
  for (const item of all.filter((entry) => forbiddenIn(entry.label) !== null)) issues.push(`«${item.label}» esce dal lessico`);
  for (const item of all.filter(namesNavigation)) issues.push(`«${item.label}» scrive un tasto per muoversi nel menu`);
  const loose = NAVIGATION_WORDS.exec(drawn);
  if (loose) issues.push(`il menu disegnato scrive «${loose[0]}»`);
  return issues;
}

/// Disegna il menu come lo apre la shell e ne legge il testo, piede compreso.
function drawnText(menu: ComposedEditorMenu): string {
  showContextMenu({ x: 10, y: 10 }, [...menu.items], {
    pointer: true,
    ...(menu.header ? { header: menu.header } : {}),
    clipboard: menu.clipboard,
    searchable: menu.searchable,
  });
  const text = document.querySelector(".context-menu")?.textContent ?? "";
  closeContextMenu();
  return text;
}

afterEach(() => {
  closeContextMenu();
});

describe("la guardia del bilancio", () => {
  it("morde su un menu finto che rompe ogni regola", () => {
    const item = (label: string, extra: Partial<MenuItem> = {}): MenuItem => ({ label, run: () => {}, ...extra });
    const fake: ComposedEditorMenu = {
      clipboard: [item("Taglia"), item("Copia")],
      items: [
        item("Uno"),
        item("Elimina", { danger: true }),
        item("Due", { separator: true }),
        item("Tre", { separator: true }),
        item("Quattro", { separator: true }),
        item("Formato"),
        item("Spenta", { disabled: true }),
        item("Scegli", { hint: "Invio" }),
        item("Vai giù", { description: "con le frecce" }),
      ],
      searchable: [],
    };
    const issues = budgetIssues(fake, true, "Uno Due ↑↓ per scegliere");
    expect(issues).toEqual([
      "10 voci al primo livello (al massimo 9)",
      "5 gruppi al primo livello (al massimo 4)",
      "il pericoloso non sta per ultimo",
      "«Spenta» è grigia senza un perché",
      "ripete la mini-barra",
      "«Scegli» scrive un tasto per muoversi nel menu",
      "«Vai giù» scrive un tasto per muoversi nel menu",
      "il menu disegnato scrive «↑»",
    ]);
  });

  it("lascia stare la scorciatoia di un gesto che usa Invio con un modificatore", () => {
    const menu: ComposedEditorMenu = { clipboard: [], items: [{ label: "Apri di lato", hint: "Ctrl+Invio", run: () => {} }], searchable: [] };
    expect(budgetIssues(menu, false, "Apri di lato")).toEqual([]);
  });
});

describe.each(MENU_CASES)("il menu di $place", (menuCase) => {
  it("sta nel bilancio", () => {
    const { menu, miniBar, close } = menuCase.open();
    try {
      expect(budgetIssues(menu, miniBar, drawnText(menu))).toEqual([]);
    } finally {
      close();
    }
  });
});
