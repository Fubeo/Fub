import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandSpec, SettingEntry } from "../host/contract";
import { state } from "../state/store";
import { SHELL_KEYS } from "./shell-keys.generated";
import {
  rejectedChords,
  allCommands,
  advance,
  conflicts,
  findByChord,
  conflictMessage,
  commandOfKeybindingKey,
  ariaBinding,
  displayBinding,
  modifierName,
  keybindingKey,
  parseChords,
  reservedChord,
  chordMap,
  matchesBinding,
  normalize,
  shadowedPrefixes,
  registerShellCommand,
  unregisterShellCommand,
  resetShellCommands,
  registerCommandForm,
  registerCommandStarter,
  openCommandForm,
  hasCommandForm,
  hasKernelCommand,
  launchCommand,
  resetCommandForms,
  canCreateDrawing,
  newEntries,
  newKindLabel,
  newKinds,
  newDrawing,
  registerNewKindHost,
  registerComponentRow,
  showComponent,
  loadKeyOverrides,
  validateKeybinding,
  keyboardPlatform,
  type CommandEntry,
} from "./commands";

/// L'unica cosa che questo modulo chiede al backend è l'elenco delle
/// impostazioni, e la chiede in un punto solo (`loadKeyOverrides`): il doppio è
/// una funzione, non un host finto, perché di superficie ce n'è una.
const fromBackend = vi.fn(async (): Promise<SettingEntry[]> => []);
vi.mock("../host/query", () => ({ settings: () => fromBackend() }));

/// I componenti accesi: `null` (la mappa non è arrivata) vale tutto acceso.
const spatial = vi.hoisted(() => ({ on: null as boolean | null }));
/// Gli altri editor spenti, quando la mappa c'è.
const off = vi.hoisted(() => new Set<string>());
vi.mock("../state/components", () => ({
  components: () =>
    spatial.on === null ? null : { uiOn: (ui: string) => !off.has(ui) && (ui !== "editors/spatial" || spatial.on) },
}));
/// Gli avvisi che il menu «Nuovo» dà.
const notices = vi.hoisted(() => [] as { message: string; tone: string }[]);
vi.mock("./notify", () => ({ notify: (message: string, tone = "info") => notices.push({ message, tone }) }));

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
    surfaces: [],
    ...over,
  };
}

function entry(over: Partial<CommandEntry> = {}): CommandEntry {
  return {
    id: "a",
    title: "A",
    description: "",
    layer: "global",
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
  resetCommandForms();
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
      id: "shell.switcher",
      title: "commands.switcher",
      description: "commands.switcher.desc",
      layer: "global",
      run: () => {},
    });
    // Prima: quello dichiarato dalla tabella generata.
    expect(allCommands()[0]!.binding).toBe("Mod-o");

    fromBackend.mockResolvedValue([settingEntry("keys.shell.switcher", "Mod-Alt-o")]);
    await loadKeyOverrides();

    const entry = allCommands()[0]!;
    expect(entry.binding).toBe("Mod-Alt-o");
    // E `declared` continua a dire quello di fabbrica, che è ciò da cui il
    // pannello sa scrivere «questo l'hai cambiato tu».
    expect(entry.declared).toBe("Mod-o");
  });

  it("la combinazione nuova è quella che la tastiera trova", async () => {
    let done = false;
    registerShellCommand({
      id: "shell.switcher",
      title: "commands.switcher",
      description: "commands.switcher.desc",
      layer: "global",
      run: () => {
        done = true;
      },
    });
    fromBackend.mockResolvedValue([settingEntry("keys.shell.switcher", "Mod-Alt-o")]);
    await loadKeyOverrides();

    // La vecchia non risponde più, e la nuova sì: senza la seconda metà, una
    // scorciatoia «riconfigurata» che risponde a tutte e due sarebbe un
    // conflitto che nessuno ha dichiarato.
    expect(findByChord(allCommands(), chord({ key: "o", ctrlKey: true }))).toBeUndefined();
    const found = findByChord(allCommands(), chord({ key: "o", ctrlKey: true, altKey: true }));
    expect(found?.id).toBe("shell.switcher");
    found!.run!();
    expect(done).toBe(true);
  });

  it("un accordo azzerato lascia il comando senza scorciatoia", async () => {
    registerShellCommand({
      id: "shell.switcher",
      title: "commands.switcher",
      description: "commands.switcher.desc",
      layer: "global",
      run: () => {},
    });
    fromBackend.mockResolvedValue([settingEntry("keys.shell.switcher", "")]);
    await loadKeyOverrides();
    expect(allCommands()[0]!.binding).toBeNull();
  });
});

describe("i due registri sono uno solo", () => {
  it("un comando di shell si esegue di qua, uno del kernel passa dalla spec", () => {
    state.commandSpecs = [spec({ id: "note.create", keybinding: "Mod-n" })];
    let done = false;
    registerShellCommand({
      id: "shell.switcher",
      title: "commands.switcher",
      description: "commands.switcher.desc",
      layer: "global",
      run: () => {
        done = true;
      },
    });
    const entries = allCommands();
    expect(entries.map((e) => e.id)).toEqual(["note.create", "shell.switcher"]);
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
        id: "shell.switcher",
        title: "commands.switcher",
        description: "commands.switcher.desc",
        layer: "global",
        run: () => {},
      });
    }
    expect(allCommands()).toHaveLength(1);
    expect(conflicts(allCommands())).toHaveLength(0);
  });

  it("chi si smonta ritira la sua dichiarazione, non quella di chi è arrivato dopo", () => {
    const declare = (): Parameters<typeof registerShellCommand>[0] => ({
      id: "shell.switcher",
      title: "commands.switcher",
      description: "commands.switcher.desc",
      layer: "global",
      run: () => {},
    });
    const first = declare();
    registerShellCommand(first);
    unregisterShellCommand(first);
    expect(allCommands()).toHaveLength(0);

    // Un rimontaggio dichiara di nuovo prima che il vecchio abbia finito di
    // smontarsi: lo smontaggio in ritardo non deve portarsi via il nuovo.
    registerShellCommand(first);
    const second = declare();
    registerShellCommand(second);
    unregisterShellCommand(first);
    expect(allCommands()).toHaveLength(1);
    unregisterShellCommand(second);
    expect(allCommands()).toHaveLength(0);
  });
});

describe("il modulo proprio di un comando", () => {
  it("si apre con ciò che chi lo apre sa già", () => {
    const opened: Record<string, string>[] = [];
    registerCommandForm("drawing.create", (prefill) => opened.push({ ...prefill }));
    expect(hasCommandForm("drawing.create")).toBe(true);
    expect(openCommandForm("drawing.create", { folder: "Schemi" })).toBe(true);
    expect(openCommandForm("drawing.create")).toBe(true);
    expect(opened).toEqual([{ folder: "Schemi" }, {}]);
  });

  it("senza un modulo registrato non apre niente e lo dice", () => {
    expect(hasCommandForm("drawing.create")).toBe(false);
    expect(openCommandForm("drawing.create", { folder: "Schemi" })).toBe(false);
  });

  it("registrare due volte lo stesso id sostituisce, e chi toglie il vecchio non toglie il nuovo", () => {
    // È ciò che fa un rimontaggio: il modulo nuovo prende il posto del vecchio,
    // e la funzione di chiusura del vecchio, chiamata dopo, non lo porta via.
    const calls: string[] = [];
    const removeOld = registerCommandForm("drawing.create", () => calls.push("vecchio"));
    const removeNew = registerCommandForm("drawing.create", () => calls.push("nuovo"));
    removeOld();
    expect(openCommandForm("drawing.create")).toBe(true);
    expect(calls).toEqual(["nuovo"]);
    removeNew();
    expect(hasCommandForm("drawing.create")).toBe(false);
    expect(openCommandForm("drawing.create")).toBe(false);
  });

  it("i moduli non toccano il registro dei comandi: la voce del kernel resta una, senza `run`", () => {
    state.commandSpecs = [spec({ id: "drawing.create", title: "Nuovo disegno" })];
    registerCommandForm("drawing.create", () => {});
    const entries = allCommands().filter((e) => e.id === "drawing.create");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.run).toBeNull();
    expect(entries[0]!.spec).not.toBeNull();
  });
});

describe("la porta di un comando del kernel", () => {
  it("il kernel lo dichiara o non lo dichiara: un modulo registrato non lo fa esistere", () => {
    registerCommandForm("drawing.create", () => {});
    expect(hasKernelCommand("drawing.create")).toBe(false);
    expect(launchCommand("drawing.create")).toBe(false);
    state.commandSpecs = [spec({ id: "drawing.create" })];
    expect(hasKernelCommand("drawing.create")).toBe(true);
  });

  it("apre il modulo proprio, se c'è, con ciò che sa già", () => {
    state.commandSpecs = [spec({ id: "drawing.create" })];
    const opened: Record<string, string>[] = [];
    const started: string[] = [];
    registerCommandForm("drawing.create", (prefill) => opened.push({ ...prefill }));
    registerCommandStarter((e) => started.push(e.id));
    expect(launchCommand("drawing.create", { folder: "Schemi" })).toBe(true);
    expect(opened).toEqual([{ folder: "Schemi" }]);
    expect(started).toEqual([]);
  });

  it("senza modulo ripiega sulla palette, sullo stesso comando e con lo stesso prefill", () => {
    state.commandSpecs = [spec({ id: "drawing.create" })];
    const started: { id: string; prefill: Readonly<Record<string, string>> }[] = [];
    registerCommandStarter((e, prefill) => started.push({ id: e.id, prefill }));
    expect(launchCommand("drawing.create", { folder: "Schemi" })).toBe(true);
    expect(started).toEqual([{ id: "drawing.create", prefill: { folder: "Schemi" } }]);
  });

  it("se la shell non ha detto come far partire la palette, dice di no", () => {
    state.commandSpecs = [spec({ id: "drawing.create" })];
    const remove = registerCommandStarter(() => {});
    remove();
    expect(launchCommand("drawing.create")).toBe(false);
  });
});

describe("le porte di «Nuovo disegno…»", () => {
  it("si mostrano soltanto se il kernel dichiara il comando", () => {
    expect(canCreateDrawing()).toBe(false);
    expect(newDrawing("Schemi")).toBe(false);
    state.commandSpecs = [spec({ id: "drawing.create" })];
    expect(canCreateDrawing()).toBe(true);
    // Un altro comando con un nome simile non basta.
    state.commandSpecs = [spec({ id: "note.create" }), spec({ id: "drawing.delete" })];
    expect(canCreateDrawing()).toBe(false);
  });

  it("«Nuovo» dice la nota sempre, e il disegno se il kernel li fa e i disegni sono accesi", () => {
    expect(newKinds()).toEqual(["note", "folder"]);
    state.commandSpecs = [spec({ id: "drawing.create" })];
    expect(newKinds()).toEqual(["note", "drawing", "folder"]);
    spatial.on = false;
    expect(newKinds()).toEqual(["note", "folder"]);
    spatial.on = true;
    expect(newKinds()).toEqual(["note", "drawing", "folder"]);
    spatial.on = null;
  });

  it("aprono il modulo proprio con la cartella, e la radice non la passano", () => {
    state.commandSpecs = [spec({ id: "drawing.create" })];
    const opened: Record<string, string>[] = [];
    registerCommandForm("drawing.create", (prefill) => opened.push({ ...prefill }));
    expect(newDrawing("Scienze/Fisica")).toBe(true);
    expect(newDrawing("")).toBe(true);
    expect(newDrawing()).toBe(true);
    expect(opened).toEqual([{ folder: "Scienze/Fisica" }, {}, {}]);
  });

  it("senza modulo ripiegano sulla palette dello stesso comando, con la cartella nel campo", () => {
    state.commandSpecs = [spec({ id: "drawing.create" })];
    const started: { id: string; prefill: Readonly<Record<string, string>> }[] = [];
    registerCommandStarter((e, prefill) => started.push({ id: e.id, prefill }));
    expect(newDrawing("Scienze")).toBe(true);
    expect(newDrawing()).toBe(true);
    expect(started).toEqual([
      { id: "drawing.create", prefill: { folder: "Scienze" } },
      { id: "drawing.create", prefill: {} },
    ]);
  });
});

describe("la porta della riga di un componente", () => {
  it("senza registrazione non apre niente e lo dice", () => {
    expect(showComponent("fub.motore-vettoriale")).toBe(false);
  });

  it("apre con l'ultima registrata, e togliere una vecchia non toglie la nuova", () => {
    const first: string[] = [];
    const second: string[] = [];
    const stopFirst = registerComponentRow((id) => first.push(id));
    const stopSecond = registerComponentRow((id) => second.push(id));
    expect(showComponent("fub.motore-vettoriale")).toBe(true);
    stopFirst();
    expect(showComponent("fub.search")).toBe(true);
    expect(first).toEqual([]);
    expect(second).toEqual(["fub.motore-vettoriale", "fub.search"]);
    stopSecond();
    expect(showComponent("fub.search")).toBe(false);
  });
});

describe("l'arbitrato tra strati", () => {
  it("sceglie superficie, profilo, documento, riquadro e globale in quest'ordine", async () => {
    const layers = [
      ["shell.switcher", "global"],
      ["shell.pane.split.right", "pane"],
      ["shell.doc.search", "document"],
      ["shell.mode.live", "profile"],
      ["shell.mode.reading", "surface"],
    ] as const;
    for (const [id, layer] of layers) {
      registerShellCommand({
        id,
        title: "commands.switcher",
        description: "commands.switcher.desc",
        layer,
        run: () => {},
      });
    }
    fromBackend.mockResolvedValue(
      layers.map(([id]) => settingEntry(keybindingKey(id), "Mod-z")),
    );
    await loadKeyOverrides();

    const ordered = allCommands();
    expect(ordered.map((command) => command.layer)).toEqual([
      "surface",
      "profile",
      "document",
      "pane",
      "global",
    ]);
    expect(advance(ordered, null, chord({ key: "z", ctrlKey: true }))).toMatchObject({
      type: "esegue",
      entry: { id: "shell.mode.reading" },
    });
  });

  it("non espone un comando indisponibile", () => {
    registerShellCommand({
      id: "shell.mode.live",
      title: "commands.mode.live",
      description: "commands.mode.live.desc",
      layer: "profile",
      available: () => false,
      run: () => {},
    });
    expect(allCommands()).toEqual([]);
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
    // Prima di questa voce `Meta-k` passava e valeva `k`: cioè un tasto che
    // risponde mentre si scrive, dichiarato da chi credeva di aver scritto
    // Meta. Il silenzio era la parte peggiore.
    expect(parseChords("Meta-k")).toBeNull();
    expect(parseChords("Cmd-k")).toBeNull();
    // Fuori dal Mac sarebbe Ctrl tenuto due volte.
    expect(parseChords("Mod-Ctrl-k")).toBeNull();
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
    const malformedEntry = entry({ id: "x", title: "Storto", binding: "Meta-k" });
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

describe("la parola Ctrl", () => {
  it("sul Mac è Control, e non Cmd", () => {
    const recent = entry({ id: "recent", binding: "Ctrl-Tab" });
    const save = entry({ id: "save", binding: "Mod-s" });
    expect(advance([recent], null, chord({ key: "Tab", ctrlKey: true }), "mac").type).toBe("esegue");
    // Cmd-Tab è del sistema, e Ctrl-s sul Mac non è Cmd-s.
    expect(advance([recent], null, chord({ key: "Tab", metaKey: true }), "mac").type).toBe("passa");
    expect(advance([save], null, chord({ key: "s", ctrlKey: true }), "mac").type).toBe("passa");
    expect(advance([save], null, chord({ key: "s", metaKey: true }), "mac").type).toBe("esegue");
    expect(matchesBinding(chord({ key: "Tab", ctrlKey: true }), "Ctrl-Tab", "mac")).toBe(true);
  });

  it("fuori dal Mac è il tasto di Mod, e i due si contendono lo stesso gesto", () => {
    const recent = entry({ id: "recent", title: "Recente", binding: "Ctrl-Tab" });
    expect(advance([recent], null, chord({ key: "Tab", ctrlKey: true }), "other").type).toBe("esegue");
    expect(advance([recent], null, chord({ key: "Tab", ctrlKey: true }), "any").type).toBe("esegue");
    expect(matchesBinding(chord({ key: "Tab", ctrlKey: true }), "Ctrl-Tab", "other")).toBe(true);
    const next = entry({ id: "next", title: "Dopo", binding: "Mod-Tab" });
    expect(conflicts([recent, next]).map((group) => group.map((e) => e.id))).toEqual([["recent", "next"]]);
    // E la corta piegata oscura la lunga.
    const long = entry({ id: "long", binding: "Mod-Tab d" });
    expect(shadowedPrefixes([recent, long]).map(({ short }) => short.id)).toEqual(["recent"]);
    // La forma canonica tiene la parola che si è scritta.
    expect(normalize("Shift-Ctrl-Tab")).toBe("ctrl-shift-tab");
  });
});

describe("gli accordi del sistema", () => {
  it("si riconoscono per piattaforma", () => {
    expect(reservedChord("Mod-Tab", "mac")).toBe("Mod-Tab");
    expect(reservedChord("Mod-Tab", "other")).toBeNull();
    expect(reservedChord("Alt-F4", "other")).toBe("Alt-F4");
    expect(reservedChord("Ctrl-ArrowLeft", "mac")).toBe("Ctrl-ArrowLeft");
    // Fuori dal Mac Ctrl-← è il salto di parola, e lo dichiara chi vuole.
    expect(reservedChord("Ctrl-ArrowLeft", "other")).toBeNull();
    expect(reservedChord("Mod-s || Alt-Tab", "any")).toBe("Alt-Tab");
    expect(reservedChord("Meta-k", "any")).toBeNull();
  });

  it("nessun accordo di serie della shell è del sistema, su nessuna piattaforma", () => {
    const taken = Object.entries(SHELL_KEYS)
      .filter(([, binding]) => reservedChord(binding, "any") !== null)
      .map(([id, binding]) => `${id}: ${binding}`);
    expect(taken).toEqual([]);
  });

  it("sul Mac i tasti che mancano si leggono con Fn", () => {
    expect(displayBinding("Mod-PageDown", "mac")).toBe("⌘Fn↓");
    expect(displayBinding("Mod-PageDown", "other")).toBe("Ctrl+PgDn");
  });
});

describe("alternative keyboard gestures", () => {
  it("dispatches every alternative, including a sequence, without stealing Meta on Linux", () => {
    const choice = entry({ binding: "Mod-x || Mod-k d" });
    expect(advance([choice], null, chord({ key: "x", ctrlKey: true }), "other").type).toBe("esegue");
    const first = advance([choice], null, chord({ key: "k", ctrlKey: true }), "other");
    expect(first.type).toBe("attende");
    expect(advance([choice], first.type === "attende" ? first.waiting : null, chord({ key: "d" }), "other").type).toBe("esegue");
    expect(advance([choice], null, chord({ key: "x", metaKey: true }), "other").type).toBe("passa");
    expect(keyboardPlatform("MacIntel")).toBe("mac");
  });

  it("rejects duplicate or truncated alternative bindings before saving", () => {
    expect(validateKeybinding("Mod-x || Mod-k d").valid).toBe(true);
    expect(validateKeybinding("Mod-x || Mod-x")).toEqual({ valid: false, reason: "duplicate" });
    expect(validateKeybinding("Mod-x || ")).toEqual({ valid: false, reason: "empty-alternative" });
    expect(validateKeybinding(Array.from({ length: 9 }, (_, i) => `Mod-${i}`).join(" || ")))
      .toEqual({ valid: false, reason: "too-many" });
  });
});

describe("una scorciatoia come si preme", () => {
  it("si legge coi nomi dei tasti, e su macOS coi simboli", () => {
    expect(displayBinding("Mod-Shift-f", "other")).toBe("Ctrl+Shift+F");
    expect(displayBinding("Mod-Shift-f", "mac")).toBe("⌘⇧F");
    expect(displayBinding("Mod-k d", "other")).toBe("Ctrl+K D");
    expect(displayBinding("Alt-F10", "other")).toBe("Alt+F10");
    expect(displayBinding("Shift-F2", "mac")).toBe("⇧F2");
    expect(displayBinding("Shift-Space", "other")).toBe("Shift+Space");
    expect(displayBinding("Mod-o || Mod-k o", "other")).toBe("Ctrl+O");
    expect(displayBinding(null, "other")).toBe("");
    // Un modificatore da solo è quel tasto, tenuto.
    expect(displayBinding("Mod", "other")).toBe("Ctrl");
    expect(displayBinding("Mod", "mac")).toBe("⌘");
    expect(modifierName("Shift", "other")).toBe("Shift");
    expect(modifierName("alt", "mac")).toBe("⌥");
    expect(modifierName("Ctrl", "other")).toBe("Ctrl");
    expect(modifierName("Ctrl", "mac")).toBe("⌃");
    expect(modifierName("Meta", "other")).toBeNull();
    expect(displayBinding("Ctrl-Shift-Tab", "mac")).toBe("⌃⇧Tab");
    expect(displayBinding("Ctrl-Shift-Tab", "other")).toBe("Ctrl+Shift+Tab");
    // Ciò che non si sa leggere resta scritto, non sparisce.
    expect(displayBinding("Hyper-x", "other")).toBe("Hyper-x");
  });
});

describe("una scorciatoia come si annuncia", () => {
  it("usa i nomi di KeyboardEvent, non i simboli che si leggono", () => {
    expect(ariaBinding("Mod-Shift-PageDown", "other")).toBe("Control+Shift+PageDown");
    expect(ariaBinding("Mod-Shift-e", "mac")).toBe("Meta+Shift+E");
    expect(ariaBinding("Ctrl-Tab", "mac")).toBe("Control+Tab");
    expect(ariaBinding("Ctrl-Tab", "other")).toBe("Control+Tab");
    expect(ariaBinding("Mod-Alt-ArrowLeft", "other")).toBe("Control+Alt+ArrowLeft");
    expect(ariaBinding("Mod--", "other")).toBe("Control+-");
    expect(ariaBinding("Mod-o || Mod-k o", "other")).toBe("Control+O");
    // Una sequenza non ha forma in `aria-keyshortcuts`, dove lo spazio separa
    // le alternative: non si dichiara piuttosto che dichiararne un'altra.
    expect(ariaBinding("Mod-k d", "other")).toBe("");
    expect(ariaBinding(null, "other")).toBe("");
    expect(ariaBinding("Hyper-x", "other")).toBe("");
  });
});

describe("il menu «Nuovo»", () => {
  const ALL = ["document.create", "sheet.create", "drawing.create", "canvas.create", "note.from_template"];
  const made: string[] = [];
  let removeHost: () => void = () => {};

  beforeEach(() => {
    made.length = 0;
    notices.length = 0;
    off.clear();
    spatial.on = null;
    removeHost = registerNewKindHost({
      note: (folder) => made.push(`nota:${folder}`),
      folder: (folder) => made.push(`cartella:${folder}`),
    });
  });

  afterEach(() => removeHost());

  /// Il lanciatore dei modelli dello Scrittoio, come lo dichiara.
  function declareTemplates(): void {
    registerShellCommand({
      id: "shell.launcher.templates",
      title: "launcher.command.templates",
      description: "launcher.command.templates.desc",
      layer: "global",
      run: () => void made.push("modelli"),
    });
  }

  const labels = (folder = ""): string[] => newEntries(folder).map((entry) => entry.label);

  it("senza componenti oltre alle note ha la nota e la cartella", () => {
    expect(newKinds()).toEqual(["note", "folder"]);
    expect(labels()).toEqual(["Nota", "Cartella"]);
  });

  it("con tutti i comandi ha l'ordine di S34, la riga prima di «da un modello» e Ctrl+N accanto alla nota", () => {
    state.commandSpecs = ALL.map((id) => spec({ id }));
    declareTemplates();
    registerShellCommand({ id: "shell.note.new", title: "commands.note.new", description: "commands.note.new.desc", layer: "global", run: () => {} });
    const entries = newEntries("");
    expect(entries.map((entry) => entry.label)).toEqual([
      "Nota",
      "Documento (.docx)",
      "Foglio (.xlsx)",
      "Disegno (.svg)",
      "Lavagna (.canvas)",
      "Nota da un modello…",
      "Cartella",
    ]);
    expect(entries.filter((entry) => entry.separator).map((entry) => entry.kind)).toEqual(["template"]);
    expect(entries[0]!.hint).toBe(displayBinding("Mod-n"));
    expect(entries[0]!.hint).not.toBe("");
    expect(entries.slice(1).every((entry) => entry.hint === undefined)).toBe(true);
  });

  it("ogni voce di un file c'è se il kernel dichiara il comando e il suo editor è acceso", () => {
    state.commandSpecs = [spec({ id: "document.create" }), spec({ id: "canvas.create" })];
    expect(newKinds()).toEqual(["note", "document", "canvas", "folder"]);
    spatial.on = true;
    off.add("editors/rich");
    expect(newKinds()).toEqual(["note", "canvas", "folder"]);
    off.add("editors/canvas");
    state.commandSpecs = ALL.map((id) => spec({ id }));
    off.add("editors/grid");
    expect(newKinds()).toEqual(["note", "drawing", "folder"]);
  });

  it("«da un modello» vuole il lanciatore dei modelli e il comando del kernel", () => {
    state.commandSpecs = [spec({ id: "note.from_template" })];
    expect(newKinds()).not.toContain("template");
    declareTemplates();
    expect(newKinds()).toContain("template");
    state.commandSpecs = [];
    expect(newKinds()).not.toContain("template");
  });

  it("le voci fanno nascere il file nella cartella data; la radice non la passa", () => {
    state.commandSpecs = ALL.map((id) => spec({ id }));
    const started: { id: string; prefill: Readonly<Record<string, string>> }[] = [];
    registerCommandStarter((entry, prefill) => started.push({ id: entry.id, prefill }));
    for (const entry of newEntries("Scienze")) entry.run();
    expect(made).toEqual(["nota:Scienze", "cartella:Scienze"]);
    expect(started).toEqual([
      { id: "document.create", prefill: { folder: "Scienze" } },
      { id: "sheet.create", prefill: { folder: "Scienze" } },
      { id: "drawing.create", prefill: { folder: "Scienze" } },
      { id: "canvas.create", prefill: { folder: "Scienze" } },
    ]);
    started.length = 0;
    newEntries("").find((entry) => entry.kind === "sheet")!.run();
    expect(started).toEqual([{ id: "sheet.create", prefill: {} }]);
    expect(notices).toEqual([]);
  });

  it("«da un modello» apre il lanciatore dei modelli", async () => {
    state.commandSpecs = [spec({ id: "note.from_template" })];
    declareTemplates();
    newEntries("").find((entry) => entry.kind === "template")!.run();
    await vi.waitFor(() => expect(made).toEqual(["modelli"]));
  });

  it("un comando che sparisce a menu aperto: la voce resta, e scelta lo dice con un avviso", () => {
    state.commandSpecs = [spec({ id: "sheet.create" })];
    const started: string[] = [];
    registerCommandStarter((entry) => started.push(entry.id));
    const entries = newEntries("");
    state.commandSpecs = [];
    entries.find((entry) => entry.kind === "sheet")!.run();
    expect(started).toEqual([]);
    expect(notices).toEqual([
      { message: `«${newKindLabel("sheet")}» adesso non si può creare: il componente che lo fa non è più acceso.`, tone: "guasto" },
    ]);
  });

  it("senza chi fa le note e le cartelle (una cornice senza albero) le due voci non ci sono", () => {
    removeHost();
    state.commandSpecs = [spec({ id: "drawing.create" })];
    expect(labels()).toEqual(["Disegno (.svg)"]);
  });
});
