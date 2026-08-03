// **La domanda sui conflitti, posta ai due registri insieme.**
//
// `commands.test.ts` la faceva già — `expect(conflitti(allCommands()))
// .toHaveLength(0)` — ma in un banco `allCommands()` vede solo il registro
// della shell: le spec del kernel arrivano a runtime da `list_commands`, e nei
// test `state.commandSpecs` è vuoto. Il presidio era verde perché guardava metà
// dei dati, ed è per questo che `Mod-Shift-f` ha potuto essere dichiarato da
// tutte e due le parti (0081).
//
// Qui i due registri arrivano da due sorgenti che non hanno bisogno dell'app
// accesa: gli accordi del kernel dalla fixture generata da `command_keys.rs`,
// quelli della shell da `SHELL_KEYS` — la tabella che esiste apposta perché i
// pannelli che dichiarano i comandi non si possono importare in un banco senza
// un `document`.
import { describe, expect, it } from "vitest";
import kernelKeys from "../__fixtures__/command-keys.json";
import { conflitti, normalizza, type CommandEntry } from "./commands";
import { SHELL_KEYS } from "./shell-keys";

/// Una voce come la vedono `conflitti` e la tastiera. Titolo e descrizione sono
/// l'id perché qui non si legge testo: si contano accordi, e un id dice meglio
/// di un titolo tradotto **chi** sta litigando quando il test diventa rosso.
function voce(id: string, binding: string | null): CommandEntry {
  return { id, title: id, description: id, binding, declared: binding, spec: null, run: null };
}

/// Tutti i comandi che questa app spedisce, da tutti e due i registri.
function tutti(): CommandEntry[] {
  const dal_kernel = Object.entries(kernelKeys as Record<string, string | null>).map(([id, k]) =>
    voce(id, k),
  );
  const dalla_shell = Object.entries(SHELL_KEYS as Record<string, string | null>).map(([id, k]) =>
    voce(id, k),
  );
  return [...dal_kernel, ...dalla_shell];
}

describe("gli accordi dei due registri, guardati insieme", () => {
  it("nessuna scorciatoia è dichiarata due volte", () => {
    const gruppi = conflitti(tutti());
    // Il messaggio nomina i contendenti: chi rompe questo test vuole sapere
    // *con chi* ha litigato, non che ha litigato.
    expect(gruppi.map((g) => `${g[0]!.binding}: ${g.map((e) => e.id).join(" + ")}`)).toEqual([]);
  });

  it("nessun id sta in tutti e due i registri", () => {
    // Due comandi omonimi non sarebbero un conflitto di tasti ma qualcosa di
    // peggio: la palette ne mostrerebbe due uguali e la tastiera ne
    // eseguirebbe uno solo, scelto dall'ordine di `allCommands`.
    const kernel = new Set(Object.keys(kernelKeys));
    expect(Object.keys(SHELL_KEYS).filter((id) => kernel.has(id))).toEqual([]);
  });

  // Il test del test: due tabelle vuote non litigherebbero mai, e un presidio
  // che non può fallire è peggio di nessun presidio. Se domani qualcuno
  // spostasse gli accordi altrove lasciando qui due elenchi senza tasti, il
  // primo caso resterebbe verde a vuoto — questi due lo impediscono.
  it("i due registri contengono davvero degli accordi", () => {
    const conAccordo = (o: object) => Object.values(o).filter((v) => v !== null).length;
    expect(conAccordo(kernelKeys)).toBeGreaterThan(0);
    expect(conAccordo(SHELL_KEYS)).toBeGreaterThan(5);
  });

  it("gli accordi dichiarati sono accordi che questa shell onora", () => {
    // `normalizza` risponde `null` a una combinazione senza modificatori, e la
    // tastiera la ignora per non rubare una lettera a chi scrive: un comando
    // che dichiarasse `f` non avrebbe scorciatoia e non lo direbbe a nessuno.
    for (const [id, k] of [...Object.entries(kernelKeys), ...Object.entries(SHELL_KEYS)]) {
      if (k === null) continue;
      expect(normalizza(k as string), `${id} dichiara "${k}"`).not.toBeNull();
    }
  });
});

describe("chi tiene `Mod-Shift-f`", () => {
  // Il caso che ha fatto nascere il presidio, scritto per nome: la decisione
  // 0081 dice che quell'accordo è della shell — parità con Obsidian, dove
  // Ctrl+Shift+F porta la ricerca sotto gli occhi — e che `search.open`, che
  // vuole una `query` obbligatoria, si raggiunge dalla palette. Se un giorno
  // qualcuno rimette la scorciatoia sul comando del kernel, il primo test di
  // sopra diventa rosso; questo dice **perché** era così.
  it("la shell, e `search.open` non ne ha", () => {
    expect(SHELL_KEYS["shell.panel.search"]).toBe("Mod-Shift-f");
    expect((kernelKeys as Record<string, string | null>)["search.open"]).toBeNull();
  });
});
