// @vitest-environment happy-dom
// La ricerca Ctrl+/ del disegno (piano K6, T9a): con il Completo aperto cerca
// fra le voci dell'indice, in italiano e in inglese; una voce spenta non parte
// e ripete il perché; un indice che non arriva lo dice, con «Riprova». Senza il
// Completo, il catalogo di oggi.
import { afterEach, describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../../../ui/lifetime";
import type { EditorContext } from "../context";
import { installCommandSearch, rankCommands, type FoundCommand, type VociCompleto } from "./command-search";

/// Una voce della ricerca, con il suo nome nelle due lingue.
function riga(key: string, label: string, over: Partial<FoundCommand> = {}): FoundCommand {
  return { key, label, path: "Oggetto", disabled: false, run: vi.fn(), altreLingue: [label], ...over };
}

/// Il contesto minimo dell'editor che la ricerca usa.
function editor(completo: VociCompleto | null, catalogo: FoundCommand[] = []): EditorContext {
  return {
    life: openLifetime(),
    commands: () => catalogo.map((one) => ({ ...one, id: one.key, context: "always", disabled: one.disabled })),
    asking: false,
    disposed: false,
    cancelGesture: () => undefined,
    completoVoci: () => completo,
    selection: [],
    features: new Set(),
    setTool: () => undefined,
    changeFromPanel: () => null,
    announce: () => undefined,
  } as unknown as EditorContext;
}

/// Un'attesa perché le promesse della ricerca arrivino al DOM.
const attesa = (): Promise<void> => new Promise((ok) => setTimeout(ok, 0));

/// Le righe mostrate con il loro testo.
function righeMostrate(): string[] {
  return [...document.querySelectorAll<HTMLElement>(".draw-commands-row .draw-commands-label")].map((el) => el.textContent ?? "");
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("la ricerca Ctrl+/ con il Completo (K6 T9a)", () => {
  it("una voce spenta non parte, e ripete il perché", async () => {
    const aGiu = riga("a", "Voce a");
    const spenta = riga("b", "Voce b", { disabled: true, description: "Servono due oggetti." });
    const completo: VociCompleto = {
      menu: () => Promise.resolve([]),
      ricerca: () => Promise.resolve([aGiu, spenta]),
    };
    const ctx = editor(completo);
    installCommandSearch(ctx);
    ctx.searchCommands();
    await attesa();
    const input = document.querySelector<HTMLInputElement>(".draw-commands-field input");
    // La voce spenta si dice tale anche a chi ascolta (aria-disabled), e resta raggiungibile.
    expect(document.querySelectorAll(".draw-commands-row")[1]?.getAttribute("aria-disabled")).toBe("true");
    input?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await attesa();
    expect(spenta.run).not.toHaveBeenCalled();
    expect(document.querySelector(".draw-commands-empty")?.textContent).toBe("Servono due oggetti.");
    expect(document.querySelector(".kit-dialog")).not.toBeNull();
  });

  it("l'indice che non arriva lo dice, con «Riprova» che lo chiede di nuovo", async () => {
    const ricerca = vi.fn(() => Promise.resolve(null));
    const ctx = editor({ menu: () => Promise.resolve([]), ricerca });
    installCommandSearch(ctx);
    ctx.searchCommands();
    await attesa();
    expect(document.querySelector(".draw-commands-empty")?.textContent).toBe("Il catalogo dei comandi non si è caricato.");
    const retry = document.querySelector<HTMLButtonElement>(".draw-commands-retry");
    expect(retry?.textContent).toBe("Riprova");
    retry?.click();
    await attesa();
    expect(ricerca).toHaveBeenCalledTimes(2);
  });

  it("la ricerca trova le voci in italiano e in inglese", () => {
    const voci = [riga("a", "Sposta tracciato", { altreLingue: ["Move path"] }), riga("b", "Inverti", { altreLingue: ["Reverse"] })];
    expect(rankCommands(voci, "move path", []).map((one) => one.key)).toEqual(["a"]);
    expect(rankCommands(voci, "sposta", []).map((one) => one.key)).toEqual(["a"]);
  });

  it("senza il Completo cerca nel catalogo di oggi", async () => {
    const ctx = editor(null, [riga("draw.undo", "Annulla")]);
    installCommandSearch(ctx);
    ctx.searchCommands();
    await attesa();
    expect(righeMostrate()).toEqual(["Annulla"]);
  });
});
