import { beforeEach, describe, expect, it } from "vitest";
import type { CommandSpec, SettingEntry } from "../host/contract";
import { state } from "../state/store";
import {
  accordiRifiutati,
  allCommands,
  avanza,
  conflitti,
  findByChord,
  frasedeiConflitti,
  keybindingKey,
  leggiAccordi,
  mappaAccordi,
  matchesBinding,
  normalizza,
  prefissiOscurati,
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
    //
    // Il `conflitti` qui sotto parla **solo** di questo: in un banco
    // `allCommands()` vede il registro della shell e basta, perché le spec del
    // kernel arrivano da `list_commands` a runtime. La domanda sui conflitti
    // veri — i due registri insieme — sta in `keybindings.test.ts`, ed è nata
    // dopo che questa riga verde ha lasciato passare `Mod-Shift-f` dichiarato
    // da tutte e due le parti (0081).
    for (const _ of [1, 2]) {
      registerShellCommand({
        id: "shell.graph",
        title: "commands.graph",
        description: "commands.graph.desc",
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

describe("la sintassi di una scorciatoia", () => {
  it("un accordo solo, o più d'uno separati da uno spazio", () => {
    expect(leggiAccordi("Mod-Shift-f")).toHaveLength(1);
    expect(leggiAccordi("Mod-k d")).toHaveLength(2);
    expect(leggiAccordi("Mod-k Mod-s")).toHaveLength(2);
    // Gli spazi di troppo non sono un errore di sintassi: chi scrive
    // un'impostazione a mano ne lascia uno in fondo, e rifiutare per quello
    // sarebbe rifiutare una scorciatoia giusta.
    expect(leggiAccordi("  Mod-k   d  ")).toHaveLength(2);
  });

  it("il primo tasto porta un modificatore, il secondo no", () => {
    // La regola in due metà: il primo perché ruberebbe una lettera a chi
    // scrive, il secondo perché il primo ha aperto una modalità che dura quanto
    // l'attesa — dentro quella finestra la `d` non è di nessuno.
    expect(leggiAccordi("g d")).toBeNull();
    expect(leggiAccordi("f")).toBeNull();
    expect(leggiAccordi("Mod-k d")).not.toBeNull();
  });

  it("un modificatore che non esiste è un rifiuto, non un tasto nudo", () => {
    // Prima di questa voce `Ctrl-k` passava e valeva `k`: cioè un tasto che
    // risponde mentre si scrive, dichiarato da chi credeva di aver scritto
    // Ctrl. Il silenzio era la parte peggiore.
    expect(leggiAccordi("Ctrl-k")).toBeNull();
    expect(leggiAccordi("Cmd-k")).toBeNull();
    expect(leggiAccordi("Mod-Mod-k")).toBeNull();
    expect(leggiAccordi("Mod-")).toBeNull();
    expect(leggiAccordi("")).toBeNull();
    expect(leggiAccordi(null)).toBeNull();
  });

  it("la forma canonica non guarda l'ordine dei modificatori, dentro nessun accordo", () => {
    expect(normalizza("Shift-Mod-g")).toBe(normalizza("Mod-Shift-g"));
    expect(normalizza("Mod-k Shift-Alt-d")).toBe(normalizza("Mod-k Alt-Shift-d"));
    // Ma l'ordine degli **accordi** è il gesto: due tasti invertiti sono due
    // gesti diversi, non lo stesso scritto in due modi.
    expect(normalizza("Mod-k Mod-s")).not.toBe(normalizza("Mod-s Mod-k"));
  });

  it("una sequenza non corrisponde mai a un tasto solo", () => {
    // `matchesBinding` risponde a chi ha in mano un tasto e nessuno stato: per
    // definizione non può riconoscere un gesto che ne vuole due.
    expect(matchesBinding(chord({ key: "k", ctrlKey: true }), "Mod-k d")).toBe(false);
    expect(findByChord([voce({ binding: "Mod-k d" })], chord({ key: "k", ctrlKey: true }))).toBeUndefined();
  });
});

describe("premere una sequenza", () => {
  const entries = [
    voce({ id: "seq", title: "Sequenza", binding: "Mod-k d" }),
    voce({ id: "solo", title: "Solo", binding: "Mod-j" }),
  ];
  const modK = chord({ key: "k", ctrlKey: true });

  it("il primo tasto apre l'attesa e non esegue niente", () => {
    const esito = avanza(entries, null, modK);
    expect(esito.tipo).toBe("attende");
    // L'etichetta è ciò che si legge nella barra di stato, e si legge come si
    // scriverebbe: `Mod-K`, non `mod-k`.
    expect(esito.tipo === "attende" && esito.attesa.etichetta).toBe("Mod-K");
  });

  it("il secondo tasto esegue, ed è nudo", () => {
    const attesa = avanza(entries, null, modK);
    const esito = avanza(entries, attesa.tipo === "attende" ? attesa.attesa : null, chord({ key: "d" }));
    expect(esito.tipo === "esegue" && esito.entry.id).toBe("seq");
  });

  it("il tasto sbagliato annulla, e non arriva alla nota", () => {
    // `annulla` e non `passa`: chi ha premuto `Mod-k` ha già lasciato il gesto
    // di scrivere, e vedersi comparire una `x` è l'unico esito imprevedibile.
    const attesa = avanza(entries, null, modK);
    const dentro = attesa.tipo === "attende" ? attesa.attesa : null;
    expect(avanza(entries, dentro, chord({ key: "x" })).tipo).toBe("annulla");
    expect(avanza(entries, dentro, chord({ key: "Escape" })).tipo).toBe("annulla");
    // Fuori da un'attesa, invece, quegli stessi tasti sono testo di qualcuno.
    expect(avanza(entries, null, chord({ key: "x" })).tipo).toBe("passa");
    expect(avanza(entries, null, chord({ key: "Escape" })).tipo).toBe("passa");
  });

  it("tenere `Shift` per fare una maiuscola non annulla l'attesa", () => {
    // Il caso che rompe una sequenza `Mod-k D` senza che nessuno capisca
    // perché: il `keydown` del modificatore arriva **prima** di quello della
    // lettera, e conterebbe come «un tasto che non continua niente».
    const attesa = avanza(entries, null, modK);
    const dentro = attesa.tipo === "attende" ? attesa.attesa : null;
    for (const key of ["Shift", "Control", "Alt", "Meta"]) {
      expect(avanza(entries, dentro, chord({ key })).tipo).toBe("passa");
    }
  });

  it("una scorciatoia normale continua a funzionare, senza passare per l'attesa", () => {
    expect(avanza(entries, null, chord({ key: "j", ctrlKey: true })).tipo).toBe("esegue");
  });

  it("una sequenza di tre tasti si percorre un passo alla volta", () => {
    const tre = [voce({ id: "tre", binding: "Mod-k g d" })];
    const uno = avanza(tre, null, modK);
    expect(uno.tipo).toBe("attende");
    const due = avanza(tre, uno.tipo === "attende" ? uno.attesa : null, chord({ key: "g" }));
    expect(due.tipo).toBe("attende");
    expect(due.tipo === "attende" && due.attesa.etichetta).toBe("Mod-K G");
    const fine = avanza(tre, due.tipo === "attende" ? due.attesa : null, chord({ key: "d" }));
    expect(fine.tipo === "esegue" && fine.entry.id).toBe("tre");
  });
});

describe("chi vince fra un accordo e il prefisso di una sequenza", () => {
  // L'accordo completo, in **qualunque ordine** stiano nel registro: se
  // dipendesse dall'ordine, la stessa coppia si comporterebbe in due modi a
  // seconda di chi si è registrato prima.
  const corto = voce({ id: "corto", title: "Corto", binding: "Mod-k" });
  const lunga = voce({ id: "lunga", title: "Lunga", binding: "Mod-k d" });
  const modK = chord({ key: "k", ctrlKey: true });

  it("il corto esegue subito, e non aspetta due secondi per scoprire se arriva la `d`", () => {
    expect(avanza([corto, lunga], null, modK).tipo).toBe("esegue");
    expect(avanza([lunga, corto], null, modK).tipo).toBe("esegue");
  });

  it("e la sequenza oscurata si dice all'avvio, invece di lasciarla scoprire premendo", () => {
    const oscurati = prefissiOscurati([corto, lunga]);
    expect(oscurati).toHaveLength(1);
    expect(oscurati[0]!.corto.id).toBe("corto");
    expect(oscurati[0]!.lunghe.map((e) => e.id)).toEqual(["lunga"]);
    const frase = frasedeiConflitti([corto, lunga])!;
    expect(frase).toContain("Corto");
    expect(frase).toContain("Lunga");
  });

  it("due sequenze che condividono il primo tasto non si oscurano: sono un prefisso comune", () => {
    const a = voce({ id: "a", binding: "Mod-k d" });
    const b = voce({ id: "b", binding: "Mod-k s" });
    expect(prefissiOscurati([a, b])).toHaveLength(0);
    expect(conflitti([a, b])).toHaveLength(0);
    // E sono davvero due gesti distinti fino in fondo.
    const attesa = avanza([a, b], null, chord({ key: "k", ctrlKey: true }));
    const dentro = attesa.tipo === "attende" ? attesa.attesa : null;
    expect(avanza([a, b], dentro, chord({ key: "s" })).tipo === "esegue").toBe(true);
  });
});

describe("un accordo che non si può premere si dice", () => {
  it("invece di sparire dal conteggio dei conflitti", () => {
    // Il buco che le sequenze rendono facile da cadere dentro: una scorciatoia
    // è una stringa che l'utente scrive a mano, e prima di questa voce una
    // scritta male finiva in un `continue` — non un conflitto, vero, ma
    // nemmeno una scorciatoia, e nessuno lo diceva.
    const storto = voce({ id: "x", title: "Storto", binding: "Ctrl-k" });
    expect(conflitti([storto])).toHaveLength(0);
    expect(accordiRifiutati([storto]).map((e) => e.id)).toEqual(["x"]);
    expect(frasedeiConflitti([storto])).toContain("Storto");
  });

  it("e un comando senza scorciatoia non è un accordo storto", () => {
    expect(accordiRifiutati([voce({ binding: null })])).toHaveLength(0);
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
