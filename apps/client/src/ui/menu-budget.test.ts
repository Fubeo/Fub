// @vitest-environment happy-dom
//
// Il bilancio di ogni menu: al massimo nove voci e quattro gruppi al primo
// livello, ciò che cancella per ultimo, niente voci grigie senza un perché,
// niente doppioni con la mini-barra, solo le parole del lessico.
import { describe, expect, it, vi } from "vitest";
import { forbiddenIn } from "../i18n/lexicon";
import type { MenuItem } from "./menu";
import { MENU_CASES } from "./menu-cases";

// Le voci dei plugin passano dall'host vero: qui nessuna view ne offre.
vi.mock("./context-views", () => ({ contextMenuItems: async () => [], hasContextMenuViews: () => false }));

/// Tutte le voci, dentro i sottomenu, che si possono leggere senza aprirli.
function flatten(items: readonly MenuItem[]): MenuItem[] {
  return items.flatMap((item) => [item, ...(Array.isArray(item.items) ? flatten(item.items) : [])]);
}

describe.each(MENU_CASES)("il menu di $place", (menuCase) => {
  const { menu, miniBar, close } = menuCase.open();
  const top = [...(menu.clipboard.length > 0 ? [{ label: "appunti" } as MenuItem] : []), ...menu.items];
  const groups = menu.items.reduce((count, item, index) => count + (index === 0 || item.separator ? 1 : 0), 0) + (menu.clipboard.length > 0 ? 1 : 0);
  const all = [...flatten(menu.clipboard), ...flatten(menu.items), ...flatten(menu.searchable)];
  close();

  it("ha al massimo nove voci e quattro gruppi", () => {
    expect(top.length).toBeLessThanOrEqual(9);
    expect(groups).toBeLessThanOrEqual(4);
  });

  it("mette il pericoloso per ultimo", () => {
    const first = menu.items.findIndex((item) => item.danger);
    if (first >= 0) expect(menu.items.slice(first).every((item) => item.danger)).toBe(true);
  });

  it("non lascia voci grigie senza motivo", () => {
    expect(all.filter((item) => item.disabled && !item.description).map((item) => item.label)).toEqual([]);
  });

  it("non ripete la mini-barra", () => {
    if (miniBar) expect(menu.items.map((item) => item.label)).not.toContain("Formato");
  });

  it("parla con le parole del lessico", () => {
    expect(all.map((item) => item.label).filter((label) => forbiddenIn(label) !== null)).toEqual([]);
  });
});
