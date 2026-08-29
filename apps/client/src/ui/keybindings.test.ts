// @vitest-environment happy-dom
//
// **La domanda sui conflitti, posta ai due registri insieme.**
//
// `commands.test.ts` la faceva già — `expect(conflitti(allCommands()))
// .toHaveLength(0)` — ma in un banco `allCommands()` vede solo il registry
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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { editorKeymap } from "../editors/text/test-support";
import kernelKeys from "../__fixtures__/command-keys.json";
import { obsidianKeymap } from "../editor/editor-commands";
import { conflicts, normalize, shadowedPrefixes, registerShellCommand, resetShellCommands, type CommandEntry } from "./commands";
import { mountKeyboard } from "./keyboard";
import { openLifetime, type Lifetime } from "./lifetime";
import { SHELL_KEYS } from "./shell-keys.generated";

/// Una voce come la vedono `conflitti` e la tastiera. Titolo e descrizione sono
/// l'id perché qui non si legge testo: si contano accordi, e un id dice meglio
/// di un titolo tradotto **chi** sta litigando quando il test diventa rosso.
function entry(id: string, binding: string | null): CommandEntry {
  return { id, title: id, description: id, binding, declared: binding, spec: null, run: null };
}

/// Tutti i comandi che questa app spedisce, da tutti e due i registri.
function allRegisteredCommands(): CommandEntry[] {
  const fromKernel = Object.entries(kernelKeys as Record<string, string | null>).map(([id, k]) =>
    entry(id, k),
  );
  const fromShell = Object.entries(SHELL_KEYS as Record<string, string | null>).map(([id, k]) =>
    entry(id, k),
  );
  return [...fromKernel, ...fromShell];
}

describe("gli accordi dei due registri, guardati insieme", () => {
  it("nessuna scorciatoia è dichiarata due volte", () => {
    const groups = conflicts(allRegisteredCommands());
    // Il messaggio nomina i contendenti: chi rompe questo test vuole sapere
    // *con chi* ha litigato, non che ha litigato.
    expect(groups.map((g) => `${g[0]!.binding}: ${g.map((e) => e.id).join(" + ")}`)).toEqual([]);
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
    const withChord = (o: object) => Object.values(o).filter((v) => v !== null).length;
    expect(withChord(kernelKeys)).toBeGreaterThan(0);
    expect(withChord(SHELL_KEYS)).toBeGreaterThan(5);
  });

  it("nessuna scorciatoia è il prefisso di un'altra", () => {
    // La domanda che la 0081 non poteva porsi, perché una scorciatoia era un
    // accordo solo e due accordi diversi non si possono contenere. Con le
    // sequenze (§18.2) si possono: `Mod-k` e `Mod-k d` non litigano per
    // `conflicts` — non sono lo stesso accordo — e però il secondo non si preme
    // mai, perché il primo vince e parte subito. È lo stesso genere di guasto
    // di `Mod-Shift-f` dichiarato due volte: invisibile a ogni banco che guardi
    // un registro per volta.
    const darkened = shadowedPrefixes(allRegisteredCommands());
    expect(
      darkened.map((o) => `${o.short.id} («${o.short.binding}») copre ${o.long.map((e) => e.id).join(" + ")}`),
    ).toEqual([]);
  });

  it("gli accordi dichiarati sono accordi che questa shell onora", () => {
    // `normalize` risponde `null` a una combinazione senza modificatori, e la
    // tastiera la ignora per non rubare una lettera a chi scrive: un comando
    // che dichiarasse `f` non avrebbe scorciatoia e non lo direbbe a nessuno.
    for (const [id, k] of [...Object.entries(kernelKeys), ...Object.entries(SHELL_KEYS)]) {
      if (k === null) continue;
      expect(normalize(k as string), `${id} dichiara "${k}"`).not.toBeNull();
    }
  });
});

// **Il terzo insieme di accordi: quelli montati dentro l'editor** (§26.2).
//
// I due registri di sopra sono dichiarati e riconfigurabili; l'editor ne monta
// altri due che non lo sono — i quattordici di `obsidianKeymap` e gli
// ottantotto che CodeMirror porta con `basicSetup` più `indentWithTab` — e
// finché nessuno li guardava insieme ai primi due, una collisione entrava senza
// che niente diventasse rosso. Ce ne sono **tre**, misurate e vive: nessun
// binding di CodeMirror dichiara `stopPropagation`, quindi il tasto risale a
// `document`, dove `mountKeyboard` lo legge. Un tempo lo passava ad `advance`
// senza guardare `e.target`, e `Ctrl+F` dentro una nota apriva il pannello di
// ricerca dell'editor **e** l'overlay della shell. Da 0156 non è più così: il
// fuoco decide, e dentro l'editor vince l'editor.
//
// # Perché questo banco è un lucchetto e non uno zero
//
// Le tre collisioni non si riparano qui, e non per pigrizia: la domanda che le
// risolveva — «quando l'editor ha il fuoco, l'accordo della shell scatta
// ancora?» — era la §26.1, e adesso è decisa (0156): a runtime decide il fuoco,
// dentro l'editor vince l'editor, fuori vince la shell. Ma il lucchetto resta,
// perché la domanda di questo banco è un'altra — i **due registri dichiarano
// ancora gli stessi tre accordi**, e finché li dichiarano insieme serve un
// posto che ne nomini il litigio, perché una quarta collisione che entrasse
// domani non ha una voce che la raccoglie. Quindi si fa come col contrasto
// (`theme/contrast.test.ts`): l'elenco di ciò che è fuori regola sta scritto
// **per nome**, con accanto chi litiga con chi, ed è rosso nei due versi — una
// quarta collisione è rossa perché non è in elenco, e una delle tre che
// sparisce è rossa perché in elenco c'è rimasta. Il banco che presidia il
// runtime sta più sotto: è «chi tiene i tre accordi quando l'editor ha il
// fuoco», e prova `mountKeyboard`.
//
// # La forma letterale non è quella che si cerca
//
// La terza collisione non si trova con `grep 'Mod-Shift-\\'` dentro
// `node_modules`: in `@codemirror/commands` è scritta `Shift-Mod-\`. È lo stesso
// accordo — CodeMirror normalizza l'ordine dei modificatori, e `normalize` di
// qua fa lo stesso — e cercarla alla lettera porta a concludere che non esista.
// È la ragione per cui questo banco confronta **forme canoniche** e non stringhe.

/// Gli accordi che `basicSetup` monta, ricostruiti dalle sette keymap che lo
/// compongono, più `indentWithTab` che `editor.ts` aggiunge accanto.
///
/// È una ricostruzione e va detto: `editor.ts` importa `basicSetup` dal pacchetto
/// `codemirror`, che è un'estensione opaca, e da un'estensione non si estrae un
/// elenco di tasti. Se un giorno quel pacchetto cambiasse composizione, questo
/// elenco resterebbe indietro senza dirlo — è il solo punto in cui questo banco
/// crede a qualcosa invece di misurarlo.
const KEYMAP_EDITOR = editorKeymap;

/// Una collisione nota: la forma canonica, chi la dichiara nei due registri, e
/// il comando dell'editor che se la prende comunque.
type CollisionPair = readonly [canonicalChord: string, declared: string, editor: string];

/// Le tre che ci sono, e nessun'altra. Chi ne aggiunge una quarta la vede qui.
const KNOWN_COLLISIONS: readonly CollisionPair[] = [
  // `Ctrl+F` era quella che scattava due volte davvero, ed è la prova che
  // l'evento risale: il pannello di CodeMirror e l'overlay della shell si
  // aprivano insieme. Da 0156 a runtime non scattano più entrambi: decide il
  // fuoco, e dentro l'editor vince l'editor.
  ["mod-f", "shell.doc.search", "openSearchPanel"],
  ["mod-shift-\\", "shell.pane.split.down", "cursorMatchingBracket"],
  ["mod-shift-l", "shell.mode.live", "selectSelectionMatches"],
];

/// Gli accordi dei due registri dichiarati, in forma canonica, con chi li porta.
function declared(): Map<string, string> {
  const for_chord = new Map<string, string>();
  for (const [id, k] of [...Object.entries(kernelKeys), ...Object.entries(SHELL_KEYS)]) {
    const canonicalChord = k === null ? null : normalize(k as string);
    if (canonicalChord) for_chord.set(canonicalChord, id);
  }
  return for_chord;
}

/// Come si scrive una collisione quando il banco diventa rosso: chi, con chi, su
/// che cosa. Un elenco di accordi non basterebbe — la domanda che si fa chi
/// legge è *chi sta litigando*.
function formatCollision([canonicalChord, declared, editor]: CollisionPair): string {
  return `${canonicalChord}: ${declared} e ${editor}`;
}

describe("il terzo insieme: gli accordi che l'editor monta", () => {
  it("collide con i due registri dichiarati solo dove è scritto qui", () => {
    const known = declared();
    const found = new Set<string>();
    for (const b of KEYMAP_EDITOR) {
      // `linux` prima di `key`: una keymap di CodeMirror può dichiarare la
      // variante per piattaforma, e la CI gira su Linux come la maggior parte di
      // chi sviluppa. È la stessa scelta con cui la voce ha contato.
      const canonicalChord = normalize(b.linux ?? b.key ?? "");
      const declared = canonicalChord ? known.get(canonicalChord) : undefined;
      if (canonicalChord && declared) {
        found.add(formatCollision([canonicalChord, declared, b.run?.name ?? "(anonimo)"]));
      }
    }
    expect([...found].sort()).toEqual(KNOWN_COLLISIONS.map(formatCollision).sort());
  });

  it("nessun accordo dell'editor copre una sequenza dichiarata", () => {
    // L'altra metà della domanda della 0090, posta al terzo insieme: se un
    // comando dichiarasse `Mod-k d` e l'editor tenesse `Mod-k` — e lo tiene,
    // è `toggleWikilink` — dentro la nota la sequenza non partirebbe mai.
    // Oggi nessun registro dichiara una sequenza; il giorno che la dichiara,
    // questa riga è il posto in cui lo si scopre.
    const editorPrefixes = new Set(
      KEYMAP_EDITOR.map((b) => normalize(b.linux ?? b.key ?? "")).filter(
        (c): c is string => c !== null,
      ),
    );
    const coveredSequences: string[] = [];
    for (const [canonicalChord, id] of declared()) {
      const [first, ...rest] = canonicalChord.split(" ");
      if (rest.length > 0 && editorPrefixes.has(first!)) {
        coveredSequences.push(`${id} («${canonicalChord}»)`);
      }
    }
    expect(coveredSequences).toEqual([]);
  });

  // Il test del test, per la stessa ragione dell'altro: due elenchi vuoti non
  // collidono mai, e un `import` che domani rendesse `KEYMAP_EDITOR` vuoto
  // lascerebbe il primo caso verde a vuoto — con le tre collisioni sparite dai
  // dati e non dall'app.
  it("gli accordi dell'editor sono davvero tanti", () => {
    expect(obsidianKeymap.length).toBeGreaterThan(10);
    expect(KEYMAP_EDITOR.length).toBeGreaterThan(90);
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

// **Chi tiene i tre accordi quando l'editor ha il fuoco** (0156).
//
// Il lucchetto di sopra dice che i due registri dichiarano gli stessi tre
// accordi, e li dichiarano ancora: quello è un fatto di elenchi, e non è
// cambiato. Questo banco prova il runtime — la decisione che la §26.1 ha
// preso — e la domanda è una sola: quando il tasto nasce dentro l'editor,
// `mountKeyboard` lo esegue o si ritira? Lo fa solo per i tre che l'editor
// monta anche lui, e solo quando non c'è una sequenza in corso; per tutto il
// resto la shell resta attiva, e con l'editor a fuoco come senza.
describe("chi tiene i tre accordi quando l'editor ha il fuoco", () => {
  const lifetimes: Lifetime[] = [];

  beforeEach(() => {
    resetShellCommands();
    // I tre che l'editor monta anche lui, più i due comandi che l'editor non
    // ha, per presidiare la metà che resta attiva e il caso dell'overlay.
    registerShellCommand({
      id: "shell.doc.search",
      title: "commands.doc.search",
      description: "commands.doc.search.desc",
      run: () => {},
    });
    registerShellCommand({
      id: "shell.pane.split.down",
      title: "commands.pane.split.down",
      description: "commands.pane.split.down.desc",
      run: () => {},
    });
    registerShellCommand({
      id: "shell.mode.live",
      title: "commands.mode.live",
      description: "commands.mode.live.desc",
      run: () => {},
    });
    registerShellCommand({
      id: "shell.mode.reading",
      title: "commands.mode.reading",
      description: "commands.mode.reading.desc",
      run: () => {},
    });
    registerShellCommand({
      id: "shell.palette",
      title: "commands.palette",
      description: "commands.palette.desc",
      run: () => {},
    });
  });

  afterEach(() => {
    for (const v of lifetimes) v.close();
    lifetimes.length = 0;
    document.querySelectorAll(".cm-editor").forEach((el) => el.remove());
    document
      .querySelectorAll("#command-palette, #quick-switcher, #context-menu, #icon-picker")
      .forEach((el) => el.remove());
  });

  function mount(): string[] {
    const executed: string[] = [];
    const lifetime = openLifetime();
    lifetimes.push(lifetime);
    mountKeyboard(lifetime, (entry) => executed.push(entry.id));
    return executed;
  }

  function editorAFocus(): Element {
    const editor = document.createElement("div");
    editor.className = "cm-editor";
    // Un figlio, non l'editor stesso: `e.target` è il nodo più interno, e
    // `closest` è la domanda che `dentroLEditor` fa.
    const child = document.createElement("span");
    editor.appendChild(child);
    document.body.appendChild(editor);
    return child;
  }

  function keydown(target: Element, key: string, modifiers: { shift?: boolean } = {}): KeyboardEvent {
    const event = new KeyboardEvent("keydown", {
      key,
      ctrlKey: true,
      shiftKey: modifiers.shift ?? false,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    return event;
  }

  it("`Mod-f` nato dentro l'editor non esegue la ricerca della shell", () => {
    const executed = mount();
    keydown(editorAFocus(), "f");
    expect(executed).toEqual([]);
  });

  it("lo stesso `Mod-f` nato fuori dall'editor esegue la ricerca della shell", () => {
    const executed = mount();
    keydown(document.body, "f");
    expect(executed).toEqual(["shell.doc.search"]);
  });

  it("un accordo che l'editor non monta resta attivo anche dentro l'editor", () => {
    const executed = mount();
    keydown(editorAFocus(), "p", { shift: true }); // Mod-Shift-p = shell.palette
    expect(executed).toEqual(["shell.palette"]);
  });

  it("un overlay aperto non lascia passare `Mod-e` alla shell", () => {
    const executed = mount();
    const palette = document.createElement("div");
    palette.id = "command-palette";
    document.body.appendChild(palette);

    const event = keydown(document.body, "e");

    expect(executed).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it("lo stesso `Mod-e` senza overlay esegue il comando della shell", () => {
    const executed = mount();
    const event = keydown(document.body, "e");

    expect(executed).toEqual(["shell.mode.reading"]);
    expect(event.defaultPrevented).toBe(true);
  });
});
