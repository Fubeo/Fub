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
import { closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands";
import { foldKeymap } from "@codemirror/language";
import { lintKeymap } from "@codemirror/lint";
import { searchKeymap } from "@codemirror/search";
import type { KeyBinding } from "@codemirror/view";
import kernelKeys from "../__fixtures__/command-keys.json";
import { obsidianKeymap } from "../editor/editor-commands";
import { conflitti, normalizza, prefissiOscurati, type CommandEntry } from "./commands";
import { SHELL_KEYS } from "./shell-keys.generated";

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

  it("nessuna scorciatoia è il prefisso di un'altra", () => {
    // La domanda che la 0081 non poteva porsi, perché una scorciatoia era un
    // accordo solo e due accordi diversi non si possono contenere. Con le
    // sequenze (§18.2) si possono: `Mod-k` e `Mod-k d` non litigano per
    // `conflitti` — non sono lo stesso accordo — e però il secondo non si preme
    // mai, perché il primo vince e parte subito. È lo stesso genere di guasto
    // di `Mod-Shift-f` dichiarato due volte: invisibile a ogni banco che guardi
    // un registro per volta.
    const oscurati = prefissiOscurati(tutti());
    expect(
      oscurati.map((o) => `${o.corto.id} («${o.corto.binding}») copre ${o.lunghe.map((e) => e.id).join(" + ")}`),
    ).toEqual([]);
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

// **Il terzo insieme di accordi: quelli montati dentro l'editor** (§26.2).
//
// I due registri di sopra sono dichiarati e riconfigurabili; l'editor ne monta
// altri due che non lo sono — i quattordici di `obsidianKeymap` e gli
// ottantotto che CodeMirror porta con `basicSetup` più `indentWithTab` — e
// finché nessuno li guardava insieme ai primi due, una collisione entrava senza
// che niente diventasse rosso. Ce ne sono **tre**, misurate e vive: nessun
// binding di CodeMirror dichiara `stopPropagation`, quindi il tasto risale a
// `document`, dove `mountKeyboard` lo passa ad `avanza` senza guardare
// `e.target` — `Ctrl+F` dentro una nota apre il pannello di ricerca dell'editor
// **e** l'overlay della shell.
//
// # Perché questo banco è un lucchetto e non uno zero
//
// Le tre collisioni non si riparano qui, e non per pigrizia: ripararle vuol
// dire rispondere a «quando l'editor ha il fuoco, l'accordo della shell scatta
// ancora?», che è la §26.1 e non è decisa. Quindi si fa come col contrasto
// (`theme/contrast.test.ts`): l'elenco di ciò che è fuori regola sta scritto
// **per nome**, con accanto chi litiga con chi, ed è rosso nei due versi — una
// quarta collisione è rossa perché non è in elenco, e una delle tre che sparisce
// è rossa perché in elenco c'è rimasta. La decisione 0151 dice perché il resto
// aspetta.
//
// # La forma letterale non è quella che si cerca
//
// La terza collisione non si trova con `grep 'Mod-Shift-\\'` dentro
// `node_modules`: in `@codemirror/commands` è scritta `Shift-Mod-\`. È lo stesso
// accordo — CodeMirror normalizza l'ordine dei modificatori, e `normalizza` di
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
const KEYMAP_EDITOR: readonly KeyBinding[] = [
  ...obsidianKeymap,
  ...closeBracketsKeymap,
  ...defaultKeymap,
  ...searchKeymap,
  ...historyKeymap,
  ...foldKeymap,
  ...completionKeymap,
  ...lintKeymap,
  indentWithTab,
];

/// Una collisione nota: la forma canonica, chi la dichiara nei due registri, e
/// il comando dell'editor che se la prende comunque.
type Scontro = readonly [canonico: string, dichiarato: string, editor: string];

/// Le tre che ci sono, e nessun'altra. Chi ne aggiunge una quarta la vede qui.
const SCONTRI_NOTI: readonly Scontro[] = [
  // `Ctrl+F` è quella che scatta due volte davvero, ed è la prova vivente che
  // l'evento risale: il pannello di CodeMirror e l'overlay della shell si
  // aprono insieme.
  ["mod-f", "shell.doc.search", "openSearchPanel"],
  ["mod-shift-\\", "shell.pane.split.down", "cursorMatchingBracket"],
  ["mod-shift-l", "shell.mode.live", "selectSelectionMatches"],
];

/// Gli accordi dei due registri dichiarati, in forma canonica, con chi li porta.
function dichiarati(): Map<string, string> {
  const per_accordo = new Map<string, string>();
  for (const [id, k] of [...Object.entries(kernelKeys), ...Object.entries(SHELL_KEYS)]) {
    const canonico = k === null ? null : normalizza(k as string);
    if (canonico) per_accordo.set(canonico, id);
  }
  return per_accordo;
}

/// Come si scrive una collisione quando il banco diventa rosso: chi, con chi, su
/// che cosa. Un elenco di accordi non basterebbe — la domanda che si fa chi
/// legge è *chi sta litigando*.
function scontro([canonico, dichiarato, editor]: Scontro): string {
  return `${canonico}: ${dichiarato} e ${editor}`;
}

describe("il terzo insieme: gli accordi che l'editor monta", () => {
  it("collide con i due registri dichiarati solo dove è scritto qui", () => {
    const noti = dichiarati();
    const trovati = new Set<string>();
    for (const b of KEYMAP_EDITOR) {
      // `linux` prima di `key`: una keymap di CodeMirror può dichiarare la
      // variante per piattaforma, e la CI gira su Linux come la maggior parte di
      // chi sviluppa. È la stessa scelta con cui la voce ha contato.
      const canonico = normalizza(b.linux ?? b.key ?? "");
      const dichiarato = canonico ? noti.get(canonico) : undefined;
      if (canonico && dichiarato) {
        trovati.add(scontro([canonico, dichiarato, b.run?.name ?? "(anonimo)"]));
      }
    }
    expect([...trovati].sort()).toEqual(SCONTRI_NOTI.map(scontro).sort());
  });

  it("nessun accordo dell'editor copre una sequenza dichiarata", () => {
    // L'altra metà della domanda della 0090, posta al terzo insieme: se un
    // comando dichiarasse `Mod-k d` e l'editor tenesse `Mod-k` — e lo tiene,
    // è `toggleWikilink` — dentro la nota la sequenza non partirebbe mai.
    // Oggi nessun registro dichiara una sequenza; il giorno che la dichiara,
    // questa riga è il posto in cui lo si scopre.
    const primi = new Set(
      KEYMAP_EDITOR.map((b) => normalizza(b.linux ?? b.key ?? "")).filter(
        (c): c is string => c !== null,
      ),
    );
    const coperte: string[] = [];
    for (const [canonico, id] of dichiarati()) {
      const [primo, ...resto] = canonico.split(" ");
      if (resto.length > 0 && primi.has(primo!)) coperte.push(`${id} («${canonico}»)`);
    }
    expect(coperte).toEqual([]);
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
