import { beforeEach, describe, expect, it } from "vitest";
import type { CommandSpec, SettingEntry } from "../host/contract";
import { state } from "../state/store";
import {
  allCommands,
  conflitti,
  findByChord,
  frasedeiConflitti,
  keybindingKey,
  mappaAccordi,
  matchesBinding,
  normalizza,
  registerShellCommand,
  resetShellCommands,
  type CommandEntry,
} from "./commands";

function spec(over: Partial<CommandSpec> = {}): CommandSpec {
  return {
    id: "test.cmd",
    title: "Comando",
    description: "",
    keybinding: null,
    params: [],
    scope: { writes: false, reach: "session", reversible: true },
    ...over,
  };
}

function voce(over: Partial<CommandEntry> = {}): CommandEntry {
  return {
    id: "a",
    title: "A",
    description: "",
    binding: null,
    declared: null,
    spec: null,
    run: null,
    ...over,
  };
}

const chord = (over: Partial<Parameters<typeof matchesBinding>[0]> = {}) => ({
  key: "f",
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...over,
});

beforeEach(() => {
  resetShellCommands();
  state.commandSpecs = [];
});

// La chiave d'impostazione è il gemello di `fub_abi::settings::keybinding_key`,
// e i due si provano sugli stessi casi: se divergono, la shell scriverebbe una
// chiave che il kernel non ha dichiarato — cioè un rifiuto, per fortuna, e non
// un silenzio.
describe("la chiave che tiene una scorciatoia", () => {
  it("il core nomina nudo", () => {
    expect(keybindingKey("note.create")).toBe("keys.note.create");
  });

  it("un plugin nomina dentro il proprio id, col prefisso **dopo** il namespace", () => {
    // `keys.com.acme:tasks.add` sarebbe un id nudo dichiarato da un plugin, che
    // la regola dei nomi (§7.4) rifiuta.
    expect(keybindingKey("com.acme:tasks.add")).toBe("com.acme:keys.tasks.add");
  });
});

describe("l'accordo che vale adesso", () => {
  it("l'impostazione vince sul suggerimento dichiarato", () => {
    state.commandSpecs = [spec({ id: "note.create", keybinding: "Mod-n" })];
    const entries = allCommands();
    expect(entries[0]!.binding).toBe("Mod-n");
    expect(entries[0]!.declared).toBe("Mod-n");
  });

  it("un accordo azzerato è un comando senza scorciatoia, non uno che risponde a tutto", () => {
    const m = mappaAccordi([
      {
        spec: {
          key: "keys.note.create",
          label: "",
          description: "",
          group: "",
          scope: "vault",
          kind: { kind: "text", default: "Mod-n" },
          program_writable: false,
        },
        value: "   ",
        source: "vault",
      } as SettingEntry,
    ]);
    expect(m.get("keys.note.create")).toBe("   ");
    // E il registro lo riduce a «niente»: `matchesBinding` su una stringa di
    // spazi troverebbe un accordo senza tasto.
    expect(matchesBinding(chord({ ctrlKey: true }), "   ")).toBe(false);
  });
});

describe("i due registri sono uno solo", () => {
  it("un comando di shell si esegue di qua, uno del kernel passa dalla spec", () => {
    state.commandSpecs = [spec({ id: "note.create", keybinding: "Mod-n" })];
    let fatto = false;
    registerShellCommand({
      id: "shell.graph",
      title: "commands.graph",
      description: "commands.graph.desc",
      keybinding: "Mod-Shift-g",
      run: () => {
        fatto = true;
      },
    });
    const entries = allCommands();
    expect(entries.map((e) => e.id)).toEqual(["note.create", "shell.graph"]);
    expect(entries[0]!.spec).not.toBeNull();
    expect(entries[0]!.run).toBeNull();
    entries[1]!.run!();
    expect(fatto).toBe(true);
  });

  it("dichiarare due volte lo stesso id sostituisce, non affianca", () => {
    // È ciò che succede rimontando un pannello: senza la sostituzione, la
    // seconda dichiarazione si presenterebbe come un conflitto con la prima.
    for (const _ of [1, 2]) {
      registerShellCommand({
        id: "shell.graph",
        title: "commands.graph",
        description: "commands.graph.desc",
        keybinding: "Mod-Shift-g",
        run: () => {},
      });
    }
    expect(allCommands()).toHaveLength(1);
    expect(conflitti(allCommands())).toHaveLength(0);
  });
});

describe("riconoscere un accordo", () => {
  it("`Mod-Shift-f` è Ctrl (o Cmd) + Shift + f", () => {
    expect(matchesBinding(chord({ ctrlKey: true, shiftKey: true }), "Mod-Shift-f")).toBe(true);
    expect(matchesBinding(chord({ metaKey: true, shiftKey: true }), "Mod-Shift-f")).toBe(true);
    expect(matchesBinding(chord({ ctrlKey: true }), "Mod-Shift-f")).toBe(false);
    expect(matchesBinding(chord({ shiftKey: true }), "Mod-Shift-f")).toBe(false);
  });

  it("un accordo senza modificatori viene ignorato", () => {
    // Un comando che dichiarasse `f` ruberebbe una lettera a chi scrive.
    expect(matchesBinding(chord(), "f")).toBe(false);
    expect(matchesBinding(chord(), null)).toBe(false);
  });

  it("trova il comando, da qualunque dei due registri venga", () => {
    const entries = [voce(), voce({ id: "b", binding: "Mod-Shift-f" })];
    expect(findByChord(entries, chord({ ctrlKey: true, shiftKey: true }))?.id).toBe("b");
    expect(findByChord(entries, chord({ ctrlKey: true }))).toBeUndefined();
  });
});

describe("i conflitti", () => {
  it("due comandi sullo stesso accordo si segnalano, nominandoli", () => {
    const entries = [
      voce({ id: "a", title: "Alfa", binding: "Mod-g" }),
      voce({ id: "b", title: "Beta", binding: "Mod-g" }),
      voce({ id: "c", title: "Gamma", binding: "Mod-h" }),
    ];
    expect(conflitti(entries)).toHaveLength(1);
    const frase = frasedeiConflitti(entries)!;
    expect(frase).toContain("Alfa");
    expect(frase).toContain("Beta");
    expect(frase).not.toContain("Gamma");
  });

  it("l'ordine dei modificatori non fa due accordi diversi", () => {
    // Per la tastiera `Shift-Mod-g` e `Mod-Shift-g` sono lo stesso gesto: senza
    // la forma canonica, il conflitto più facile da creare a mano sarebbe
    // proprio quello che non si vede.
    expect(normalizza("Shift-Mod-g")).toBe(normalizza("Mod-Shift-g"));
    expect(
      conflitti([voce({ id: "a", binding: "Shift-Mod-g" }), voce({ id: "b", binding: "Mod-Shift-g" })]),
    ).toHaveLength(1);
  });

  it("nessun conflitto è nessun avviso", () => {
    expect(frasedeiConflitti([voce({ binding: "Mod-g" })])).toBeNull();
    // E un comando senza accordo non litiga con gli altri senza accordo.
    expect(conflitti([voce({ id: "a" }), voce({ id: "b" })])).toHaveLength(0);
  });
});
