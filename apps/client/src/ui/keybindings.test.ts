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
import { describe, expect, it } from "vitest";
import { editorKeymap } from "../editors/text/test-support";
import kernelKeys from "../__fixtures__/command-keys.json";
import { obsidianKeymap } from "../editor/editor-commands";
import { conflicts, normalize, shadowedPrefixes, type CommandEntry } from "./commands";
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
// ottantotto che CodeMirror porta con `basicSetup` più `indentWithTab`. Questo
// banco inventaria le collisioni dichiarate, ma non decide il possesso runtime:
// una keymap può rifiutare un evento per stato della vista, e solo
// `defaultPrevented` dell'evento reale lo dice. Quella precedenza causale è
// verificata con una `TextEngine` montata in `keyboard.test.ts`.
//
// # Perché questo banco è un lucchetto e non uno zero
//
// Le collisioni non si riparano qui: questo è un inventario dei due registri e
// dell'editor. L'elenco scritto nomina le collisioni note; una quarta è rossa
// perché non è in elenco, e una delle tre che sparisce è rossa perché in elenco
// c'è rimasta. Non è una allowlist della tastiera.

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
/// il comando dell'editor che dichiara lo stesso accordo.
type CollisionPair = readonly [canonicalChord: string, declared: string, editor: string];

/// Le tre che ci sono, e nessun'altra. Chi ne aggiunge una quarta la vede qui.
const KNOWN_COLLISIONS: readonly CollisionPair[] = [
  // `Ctrl+F` ha mostrato che l'evento risale dal pannello di ricerca
  // CodeMirror fino al documento. Se la keymap lo consuma, la precedenza è
  // verificata causalmente in `keyboard.test.ts`, non da questa lista.
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

