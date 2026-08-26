import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandSpec, SettingEntry } from "../host/contract";
import { state } from "../state/store";
import {
  rejectedChords,
  allCommands,
  advance,
  conflicts,
  findByChord,
  conflictMessage,
  commandOfKeybindingKey,
  keybindingKey,
  parseChords,
  chordMap,
  matchesBinding,
  normalize,
  shadowedPrefixes,
  registerShellCommand,
  resetShellCommands,
  loadKeyOverrides,
  type CommandEntry,
} from "./commands";

/// L'unica cosa che questo modulo chiede al backend è l'elenco delle
/// impostazioni, e la chiede in un punto solo (`loadKeyOverrides`): il doppio è
/// una funzione, non un host finto, perché di superficie ce n'è una.
const fromBackend = vi.fn(async (): Promise<SettingEntry[]> => []);
vi.mock("../host/query", () => ({ settings: () => fromBackend() }));

/// Una riga di impostazione che è un accordo, come la manda il backend.
function settingEntry(key: string, value: string): SettingEntry {
  return {
    spec: {
      key,
      label: key,
      description: "",
      group: "",
      scope: "machine",
      kind: { kind: "text", default: "" },
      program_writable: false,
    },
    value,
    source: "machine",
  } as SettingEntry;
}

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

function entry(over: Partial<CommandEntry> = {}): CommandEntry {
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

beforeEach(async () => {
  resetShellCommands();
  state.commandSpecs = [];
  // Gli accordi riconfigurati vivono in una mappa di modulo: un banco che non
  // la svuota erediterebbe quelli del banco precedente.
  fromBackend.mockResolvedValue([]);
  await loadKeyOverrides();
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

  // Il verso opposto serve a chi ha in mano **una chiave e basta**: chi riceve
  // un `setting_changed` e deve sapere se la tastiera è cambiata (§23.13). I due
  // versi si provano sugli stessi casi, o un giro completo sarebbe due funzioni
  // che si sbagliano d'accordo.
  it("e il giro torna al comando, in tutte e due le forme", () => {
    for (const id of ["note.create", "com.acme:tasks.add", "vault.undo"]) {
      expect(commandOfKeybindingKey(keybindingKey(id))).toBe(id);
    }
  });

  it("ciò che non è una scorciatoia non le somiglia", () => {
    for (const key of [
      "appearance.theme",
      "locale.language",
      "com.acme:permissions.network",
      // `keys.` davanti al namespace: la forma che `keybindingKey` non compone
      // mai, perché sarebbe un id nudo dichiarato da un plugin.
      "keys.com.acme:tasks.add",
      "keys.",
      ":keys.tasks.add",
      "com.acme:keys.",
      "com.acme:key.tasks.add",
    ]) {
      expect(commandOfKeybindingKey(key)).toBeNull();
    }
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
    const m = chordMap([
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

describe("la scorciatoia di un comando di shell si riconfigura", () => {
  // La casella che la 0090 aveva trasferito alla §16.3, chiusa dalla 0116: la
  // chiave `keys.shell.*` la dichiara il bundle di core ed è di **macchina**,
  // perché un comando di shell esiste prima di ogni vault. Di qua non cambia
  // niente se non che questa riga smette di essere un'eccezione.
  it("l'impostazione vince sull'accordo dichiarato, come per un comando del kernel", async () => {
    registerShellCommand({
      id: "shell.graph",
      title: "commands.graph",
      description: "commands.graph.desc",
      run: () => {},
    });
    // Prima: quello dichiarato dalla tabella generata.
    expect(allCommands()[0]!.binding).toBe("Mod-Shift-g");

    fromBackend.mockResolvedValue([settingEntry("keys.shell.graph", "Mod-Alt-g")]);
    await loadKeyOverrides();

    const entry = allCommands()[0]!;
    expect(entry.binding).toBe("Mod-Alt-g");
    // E `declared` continua a dire quello di fabbrica, che è ciò da cui il
    // pannello sa scrivere «questo l'hai cambiato tu».
    expect(entry.declared).toBe("Mod-Shift-g");
  });

  it("la combinazione nuova è quella che la tastiera trova", async () => {
    let done = false;
    registerShellCommand({
      id: "shell.graph",
      title: "commands.graph",
      description: "commands.graph.desc",
      run: () => {
        done = true;
      },
    });
    fromBackend.mockResolvedValue([settingEntry("keys.shell.graph", "Mod-Alt-g")]);
    await loadKeyOverrides();

    // La vecchia non risponde più, e la nuova sì: senza la seconda metà, una
    // scorciatoia «riconfigurata» che risponde a tutte e due sarebbe un
    // conflitto che nessuno ha dichiarato.
    expect(findByChord(allCommands(), chord({ key: "g", ctrlKey: true, shiftKey: true }))).toBeUndefined();
    const found = findByChord(allCommands(), chord({ key: "g", ctrlKey: true, altKey: true }));
    expect(found?.id).toBe("shell.graph");
    found!.run!();
    expect(done).toBe(true);
  });

  it("un accordo azzerato lascia il comando senza scorciatoia", async () => {
    registerShellCommand({
      id: "shell.graph",
      title: "commands.graph",
      description: "commands.graph.desc",
      run: () => {},
    });
    fromBackend.mockResolvedValue([settingEntry("keys.shell.graph", "")]);
    await loadKeyOverrides();
    expect(allCommands()[0]!.binding).toBeNull();
  });
});

describe("i due registri sono uno solo", () => {
  it("un comando di shell si esegue di qua, uno del kernel passa dalla spec", () => {
    state.commandSpecs = [spec({ id: "note.create", keybinding: "Mod-n" })];
    let done = false;
    registerShellCommand({
      id: "shell.graph",
      title: "commands.graph",
      description: "commands.graph.desc",
      run: () => {
        done = true;
      },
    });
    const entries = allCommands();
    expect(entries.map((e) => e.id)).toEqual(["note.create", "shell.graph"]);
    expect(entries[0]!.spec).not.toBeNull();
    expect(entries[0]!.run).toBeNull();
    entries[1]!.run!();
    expect(done).toBe(true);
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
    expect(conflicts(allCommands())).toHaveLength(0);
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
    const entries = [entry(), entry({ id: "b", binding: "Mod-Shift-f" })];
    expect(findByChord(entries, chord({ ctrlKey: true, shiftKey: true }))?.id).toBe("b");
    expect(findByChord(entries, chord({ ctrlKey: true }))).toBeUndefined();
  });
});

describe("la sintassi di una scorciatoia", () => {
  it("un accordo solo, o più d'uno separati da uno spazio", () => {
    expect(parseChords("Mod-Shift-f")).toHaveLength(1);
    expect(parseChords("Mod-k d")).toHaveLength(2);
    expect(parseChords("Mod-k Mod-s")).toHaveLength(2);
    // Gli spazi di troppo non sono un errore di sintassi: chi scrive
    // un'impostazione a mano ne lascia uno in fondo, e rifiutare per quello
    // sarebbe rifiutare una scorciatoia giusta.
    expect(parseChords("  Mod-k   d  ")).toHaveLength(2);
  });

  it("il primo tasto porta un modificatore, il secondo no", () => {
    // La regola in due metà: il primo perché ruberebbe una lettera a chi
    // scrive, il secondo perché il primo ha aperto una modalità che dura quanto
    // l'attesa — dentro quella finestra la `d` non è di nessuno.
    expect(parseChords("g d")).toBeNull();
    expect(parseChords("f")).toBeNull();
    expect(parseChords("Mod-k d")).not.toBeNull();
  });

  it("un modificatore che non esiste è un rifiuto, non un tasto nudo", () => {
    // Prima di questa voce `Ctrl-k` passava e valeva `k`: cioè un tasto che
    // risponde mentre si scrive, dichiarato da chi credeva di aver scritto
    // Ctrl. Il silenzio era la parte peggiore.
    expect(parseChords("Ctrl-k")).toBeNull();
    expect(parseChords("Cmd-k")).toBeNull();
    expect(parseChords("Mod-Mod-k")).toBeNull();
    expect(parseChords("Mod-")).toBeNull();
    expect(parseChords("")).toBeNull();
    expect(parseChords(null)).toBeNull();
  });

  it("la forma canonica non guarda l'ordine dei modificatori, dentro nessun accordo", () => {
    expect(normalize("Shift-Mod-g")).toBe(normalize("Mod-Shift-g"));
    expect(normalize("Mod-k Shift-Alt-d")).toBe(normalize("Mod-k Alt-Shift-d"));
    // Ma l'ordine degli **accordi** è il gesto: due tasti invertiti sono due
    // gesti diversi, non lo stesso scritto in due modi.
    expect(normalize("Mod-k Mod-s")).not.toBe(normalize("Mod-s Mod-k"));
  });

  it("una sequenza non corrisponde mai a un tasto solo", () => {
    // `matchesBinding` risponde a chi ha in mano un tasto e nessuno stato: per
    // definizione non può riconoscere un gesto che ne vuole due.
    expect(matchesBinding(chord({ key: "k", ctrlKey: true }), "Mod-k d")).toBe(false);
    expect(findByChord([entry({ binding: "Mod-k d" })], chord({ key: "k", ctrlKey: true }))).toBeUndefined();
  });
});

describe("premere una sequenza", () => {
  const entries = [
    entry({ id: "seq", title: "Sequenza", binding: "Mod-k d" }),
    entry({ id: "solo", title: "Solo", binding: "Mod-j" }),
  ];
  const modK = chord({ key: "k", ctrlKey: true });

  it("il primo tasto apre l'attesa e non esegue niente", () => {
    const result = advance(entries, null, modK);
    expect(result.type).toBe("attende");
    // L'etichetta è ciò che si legge nella barra di stato, e si legge come si
    // scriverebbe: `Mod-K`, non `mod-k`.
    expect(result.type === "attende" && result.waiting.label).toBe("Mod-K");
  });

  it("il secondo tasto esegue, ed è nudo", () => {
    const waiting = advance(entries, null, modK);
    const result = advance(entries, waiting.type === "attende" ? waiting.waiting : null, chord({ key: "d" }));
    expect(result.type === "esegue" && result.entry.id).toBe("seq");
  });

  it("il tasto sbagliato annulla, e non arriva alla nota", () => {
    // `annulla` e non `passa`: chi ha premuto `Mod-k` ha già lasciato il gesto
    // di scrivere, e vedersi comparire una `x` è l'unico esito imprevedibile.
    const waiting = advance(entries, null, modK);
    const inside = waiting.type === "attende" ? waiting.waiting : null;
    expect(advance(entries, inside, chord({ key: "x" })).type).toBe("annulla");
    expect(advance(entries, inside, chord({ key: "Escape" })).type).toBe("annulla");
    // Fuori da un'attesa, invece, quegli stessi tasti sono testo di qualcuno.
    expect(advance(entries, null, chord({ key: "x" })).type).toBe("passa");
    expect(advance(entries, null, chord({ key: "Escape" })).type).toBe("passa");
  });

  it("tenere `Shift` per fare una maiuscola non annulla l'attesa", () => {
    // Il caso che rompe una sequenza `Mod-k D` senza che nessuno capisca
    // perché: il `keydown` del modificatore arriva **prima** di quello della
    // lettera, e conterebbe come «un tasto che non continua niente».
    const waiting = advance(entries, null, modK);
    const inside = waiting.type === "attende" ? waiting.waiting : null;
    for (const key of ["Shift", "Control", "Alt", "Meta"]) {
      expect(advance(entries, inside, chord({ key })).type).toBe("passa");
    }
  });

  it("una scorciatoia normale continua a funzionare, senza passare per l'attesa", () => {
    expect(advance(entries, null, chord({ key: "j", ctrlKey: true })).type).toBe("esegue");
  });

  it("una sequenza di tre tasti si percorre un passo alla volta", () => {
    const sequence = [entry({ id: "tre", binding: "Mod-k g d" })];
    const firstStep = advance(sequence, null, modK);
    expect(firstStep.type).toBe("attende");
    const secondStep = advance(
      sequence,
      firstStep.type === "attende" ? firstStep.waiting : null,
      chord({ key: "g" }),
    );
    expect(secondStep.type).toBe("attende");
    expect(secondStep.type === "attende" && secondStep.waiting.label).toBe("Mod-K G");
    const completed = advance(
      sequence,
      secondStep.type === "attende" ? secondStep.waiting : null,
      chord({ key: "d" }),
    );
    expect(completed.type === "esegue" && completed.entry.id).toBe("tre");
  });
});

describe("chi vince fra un accordo e il prefisso di una sequenza", () => {
  // L'accordo completo, in **qualunque ordine** stiano nel registro: se
  // dipendesse dall'ordine, la stessa coppia si comporterebbe in due modi a
  // seconda di chi si è registrato prima.
  const short = entry({ id: "corto", title: "Corto", binding: "Mod-k" });
  const long = entry({ id: "lunga", title: "Lunga", binding: "Mod-k d" });
  const modK = chord({ key: "k", ctrlKey: true });

  it("il corto esegue subito, e non aspetta due secondi per scoprire se arriva la `d`", () => {
    expect(advance([short, long], null, modK).type).toBe("esegue");
    expect(advance([long, short], null, modK).type).toBe("esegue");
  });

  it("e la sequenza oscurata si dice all'avvio, invece di lasciarla scoprire premendo", () => {
    const darkened = shadowedPrefixes([short, long]);
    expect(darkened).toHaveLength(1);
    expect(darkened[0]!.short.id).toBe("corto");
    expect(darkened[0]!.long.map((e) => e.id)).toEqual(["lunga"]);
    const phrase = conflictMessage([short, long])!;
    expect(phrase).toContain("Corto");
    expect(phrase).toContain("Lunga");
  });

  it("due sequenze che condividono il primo tasto non si oscurano: sono un prefisso comune", () => {
    const a = entry({ id: "a", binding: "Mod-k d" });
    const b = entry({ id: "b", binding: "Mod-k s" });
    expect(shadowedPrefixes([a, b])).toHaveLength(0);
    expect(conflicts([a, b])).toHaveLength(0);
    // E sono davvero due gesti distinti fino in fondo.
    const waiting = advance([a, b], null, chord({ key: "k", ctrlKey: true }));
    const inside = waiting.type === "attende" ? waiting.waiting : null;
    expect(advance([a, b], inside, chord({ key: "s" })).type === "esegue").toBe(true);
  });
});

describe("un accordo che non si può premere si dice", () => {
  it("invece di sparire dal conteggio dei conflitti", () => {
    // Il buco che le sequenze rendono facile da cadere dentro: una scorciatoia
    // è una stringa che l'utente scrive a mano, e prima di questa voce una
    // scritto male finiva in un `continue` — non un conflitto, vero, ma
    // nemmeno una scorciatoia, e nessuno lo diceva.
    const malformedEntry = entry({ id: "x", title: "Storto", binding: "Ctrl-k" });
    expect(conflicts([malformedEntry])).toHaveLength(0);
    expect(rejectedChords([malformedEntry]).map((e) => e.id)).toEqual(["x"]);
    expect(conflictMessage([malformedEntry])).toContain("Storto");
  });

  it("e un comando senza scorciatoia non è un accordo storto", () => {
    expect(rejectedChords([entry({ binding: null })])).toHaveLength(0);
  });
});

describe("i conflitti", () => {
  it("due comandi sullo stesso accordo si segnalano, nominandoli", () => {
    const entries = [
      entry({ id: "a", title: "Alfa", binding: "Mod-g" }),
      entry({ id: "b", title: "Beta", binding: "Mod-g" }),
      entry({ id: "c", title: "Gamma", binding: "Mod-h" }),
    ];
    expect(conflicts(entries)).toHaveLength(1);
    const phrase = conflictMessage(entries)!;
    expect(phrase).toContain("Alfa");
    expect(phrase).toContain("Beta");
    expect(phrase).not.toContain("Gamma");
  });

  it("l'ordine dei modificatori non fa due accordi diversi", () => {
    // Per la tastiera `Shift-Mod-g` e `Mod-Shift-g` sono lo stesso gesto: senza
    // la forma canonica, il conflitto più facile da creare a mano sarebbe
    // proprio quello che non si vede.
    expect(normalize("Shift-Mod-g")).toBe(normalize("Mod-Shift-g"));
    expect(
      conflicts([entry({ id: "a", binding: "Shift-Mod-g" }), entry({ id: "b", binding: "Mod-Shift-g" })]),
    ).toHaveLength(1);
  });

  it("nessun conflitto è nessun avviso", () => {
    expect(conflictMessage([entry({ binding: "Mod-g" })])).toBeNull();
    // E un comando senza accordo non litiga con gli altri senza accordo.
    expect(conflicts([entry({ id: "a" }), entry({ id: "b" })])).toHaveLength(0);
  });
});
