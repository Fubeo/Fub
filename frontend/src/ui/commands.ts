// **Il registro dei comandi della shell** (§18.2): un elenco solo, di cui la
// palette e la tastiera sono due lettori.
//
// Fino a questa voce ce n'erano due, e nessuno dei due lo sapeva. Da una parte i
// comandi del kernel, dichiarati dai provider e portati qui da `list_commands`:
// quelli avevano un id, un titolo, una descrizione e un suggerimento di
// scorciatoia. Dall'altra le azioni **della shell** — passare a Lettura, aprire
// il pannello dei file, aprire il grafo — che non essendo comandi del kernel non
// erano comandi affatto: erano bottoni, e chi non li trovava con il mouse non li
// trovava.
//
// # Perché un comando di shell non si registra nel kernel
//
// Perché il kernel non lo saprebbe eseguire. Un `CommandProvider` gira dentro
// l'host, e «mostra il pannello dei file» è un gesto che vive nella webview:
// registrarlo di là vorrebbe dire un comando che il kernel elenca e non sa
// invocare, cioè una bugia dentro il registro. Quindi la forma è la stessa
// — id, titolo, descrizione, accordo — e ciò che cambia è **chi lo esegue**:
// `run()` di qua, `invoke_command` di là. Questo modulo è il posto in cui la
// differenza smette di riguardare chiunque altro.
//
// # La sequenza
//
// L'ultima cosa che mancava alla voce, e non era un pezzo di questo registro: è
// una **sintassi** in più — `Mod-k d`, due tasti uno dopo l'altro — e uno stato
// che dura fra i due. La sintassi sta qui sotto (`leggiAccordi`, `avanza`); lo
// stato sta in `ui/keyboard.ts`, perché è una cosa che scade e che si mostra, e
// niente di ciò riguarda chi tiene l'elenco dei comandi. Costo sul contratto:
// **zero**. `CommandSpec.keybinding` è una stringa dalla 0009, e una stringa con
// uno spazio dentro ci sta senza chiedere niente a nessuno.
//
// # E la scorciatoia di un comando di shell si riconfigura
//
// Fino alla [0116](../../../docs/decisions/0116-lo-scope-di-una-chiave-segue-la-vita-di-chi-la-dichiara.md)
// no, e la ragione stava nella [0077](../../../docs/decisions/0077-una-scorciatoia-e-una-chiave.md):
// la chiave che la tiene la fabbrica il kernel registrando un `CommandProvider`,
// e un comando che vive nella webview un provider non ce l'ha. La via d'uscita
// non è stata dargliene uno finto — sarebbe un comando che il registro elenca e
// non sa invocare — ma osservare che di quel provider serviva **solo** la
// chiave: `keys.shell.*` è dichiarata dal bundle di core come le altre
// impostazioni dell'app, e di **macchina**, perché un comando di shell esiste
// prima di ogni vault. Da qui in poi la tabella degli accordi arriva generata
// (`shell-keys.generated.ts`) e questo modulo non distingue più i due registri
// se non per chi esegue.
import type { CommandSpec, SettingEntry } from "../host/contract";
import { impostazioni } from "../host/query";
import { type Chiave, t } from "../i18n/strings";
import { onEvent } from "../state/kernel";
import { state } from "../state/store";
import { SHELL_KEYS, type ShellCommandId } from "./shell-keys.generated";

/// La chiave d'impostazione che tiene la scorciatoia di un comando.
///
/// È il gemello di `fub_abi::settings::keybinding_key`, e la regola è quella dei
/// nomi (§7.4): il prefisso `keys.` entra **dentro** il namespace del
/// proprietario, perché davanti a tutto (`keys.com.acme:tasks.add`) sarebbe un
/// id nudo dichiarato da un plugin, che il kernel rifiuta. I due si provano
/// sugli stessi casi, di qua in `commands.test.ts` e di là in
/// `crates/fub-abi/src/settings.rs`.
export function keybindingKey(commandId: string): string {
  const i = commandId.indexOf(":");
  if (i < 0) return `keys.${commandId}`;
  return `${commandId.slice(0, i)}:keys.${commandId.slice(i + 1)}`;
}

/// Un'azione **della shell**, dichiarata da chi ce l'ha.
///
/// La dichiara il pannello al montaggio, e non un elenco in `main.ts`: è la
/// regola che tiene i moduli aciclici e che ha già smontato il monolite (§1.1) —
/// chi ha interesse dichiara, e nessuno tiene la lista di tutti.
export interface ShellCommand {
  /// Uno degli id in tabella, e nessun altro: è così che l'accordo di un
  /// comando di shell finisce dove il presidio dei conflitti lo può leggere
  /// (0081). Un comando nuovo non compila finché non si dichiara di là.
  id: ShellCommandId;
  title: Chiave;
  description: Chiave;
  run: () => void | Promise<void>;
}

/// Un comando **come lo vedono la palette e la tastiera**, da qualunque parte
/// del confine venga.
export interface CommandEntry {
  id: string;
  title: string;
  description: string;
  /// L'accordo che vale adesso: l'impostazione se l'utente l'ha cambiata,
  /// altrimenti quello dichiarato. Vuoto diventa `null` — una scorciatoia
  /// azzerata è una scorciatoia che non c'è, non una che risponde a nessun
  /// tasto.
  binding: string | null;
  /// L'accordo dichiarato da chi ha scritto il comando, per dire «questo l'hai
  /// cambiato tu».
  declared: string | null;
  /// La spec del kernel, per chi deve invocarlo attraverso l'IPC (parametri,
  /// piano, raggio). `null` per un comando di shell.
  spec: CommandSpec | null;
  /// Cosa fare per eseguirlo di qua. `null` per un comando del kernel.
  run: (() => void | Promise<void>) | null;
}

/// I comandi di shell dichiarati finora. Una mappa e non un array perché
/// dichiarare due volte lo stesso id è ciò che succede a chi rimonta un
/// pannello, e la seconda dichiarazione deve **sostituire** la prima invece di
/// affiancarla — altrimenti un rimontaggio si presenterebbe da solo come un
/// conflitto di scorciatoie con sé stesso.
const shell = new Map<string, ShellCommand>();

export function registerShellCommand(command: ShellCommand): void {
  shell.set(command.id, command);
}

/// Solo per i banchi: un registro che non si svuota fra un test e l'altro
/// porterebbe dentro i comandi dichiarati dal test precedente.
export function resetShellCommands(): void {
  shell.clear();
}

/// Gli accordi riconfigurati, letti dalle impostazioni.
///
/// La mappa è chiave d'impostazione → valore, e non id di comando → accordo:
/// così chi la riempie non deve conoscere i comandi, e chi la legge fa una
/// domanda sola. Che il *default* di quella chiave sia il suggerimento
/// dichiarato è ciò che rende superflua ogni fusione — il valore che arriva **è**
/// l'accordo, sempre.
let overrides = new Map<string, string>();

/// Rilegge gli accordi **quando una scorciatoia cambia**, da qualunque finestra.
///
/// Senza questa riga la mappa si rinfrescava in due soli momenti — l'apertura di
/// un vault e l'apertura della palette — e ne seguiva una cosa che nessuno aveva
/// scritto e che si scopre solo provandola: si rimappa un comando dal pannello,
/// si preme la combinazione nuova, e non succede niente. La scorciatoia era
/// scritta, letta e mostrata giusta; a non saperlo era la tastiera, che l'elenco
/// ce l'aveva vecchio.
///
/// Vale doppio da quando un vault può proporre i propri tasti (§23.13): adottare
/// una scorciatoia è precisamente il gesto dopo il quale ci si aspetta che
/// premerla funzioni.
///
/// Il filtro sulla chiave non è un'ottimizzazione: `setting_changed` arriva per
/// ogni interruttore di questo pannello, e rileggere l'elenco dei comandi a ogni
/// spunta sarebbe una chiamata al backend per una cosa che non c'entra.
export function mountKeyOverrides(): void {
  onEvent("setting_changed", (e) => {
    if (commandOfKeybindingKey(e.key) === null) return;
    void loadKeyOverrides();
  });
}

/// Il comando che una chiave di scorciatoia nomina, o `null`. Gemello di
/// `fub_abi::settings::command_of_keybinding_key`, e i due si provano sugli
/// stessi casi.
export function commandOfKeybindingKey(key: string): string | null {
  const i = key.indexOf(":");
  if (i < 0) {
    const nome = key.startsWith("keys.") ? key.slice("keys.".length) : "";
    return nome === "" ? null : nome;
  }
  const ns = key.slice(0, i);
  const resto = key.slice(i + 1);
  if (ns === "" || !resto.startsWith("keys.")) return null;
  const nome = resto.slice("keys.".length);
  return nome === "" ? null : `${ns}:${nome}`;
}

export async function loadKeyOverrides(): Promise<void> {
  try {
    overrides = mappaAccordi(await impostazioni());
  } catch {
    // Un vault che non sa dire come è configurato non è un motivo per lasciare
    // la tastiera muta: restano gli accordi dichiarati, che sono quelli con cui
    // la shell è nata.
    overrides = new Map();
  }
}

/// Le righe di impostazione che sono accordi, come mappa. Pura, per il banco.
export function mappaAccordi(entries: SettingEntry[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const entry of entries) {
    if (typeof entry.value === "string") m.set(entry.spec.key, entry.value);
  }
  return m;
}

/// Tutti i comandi: quelli del kernel per primi, nell'ordine in cui li dichiara,
/// poi quelli della shell.
export function allCommands(): CommandEntry[] {
  const dal_kernel = state.commandSpecs.map((spec) => ({
    id: spec.id,
    title: spec.title,
    description: spec.description,
    binding: vuotoENull(overrides.get(keybindingKey(spec.id)) ?? spec.keybinding),
    declared: spec.keybinding,
    spec,
    run: null,
  }));
  const dalla_shell = [...shell.values()].map((c) => ({
    id: c.id,
    title: t(c.title),
    description: t(c.description),
    // La stessa riga dei comandi del kernel, e da questa voce lo è per davvero
    // (§16.3): l'accordo riconfigurato se c'è, il dichiarato se no. La chiave si
    // compone allo stesso modo, perché la regola è una sola — cambia solo il
    // livello in cui il valore vive, che per un comando di shell è la macchina.
    binding: vuotoENull(overrides.get(keybindingKey(c.id)) ?? SHELL_KEYS[c.id]),
    declared: SHELL_KEYS[c.id] ?? null,
    spec: null,
    run: c.run,
  }));
  return [...dal_kernel, ...dalla_shell];
}

function vuotoENull(binding: string | null | undefined): string | null {
  const s = (binding ?? "").trim();
  return s === "" ? null : s;
}

/// I tasti premuti, come li descrive un evento della tastiera.
export interface KeyChord {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

// ---------------------------------------------------------------------------
// La sintassi di una scorciatoia
// ---------------------------------------------------------------------------
//
// **Un accordo, o più d'uno in sequenza** (§18.2), separati da uno spazio:
// `Mod-Shift-f` è un gesto solo, `Mod-k d` sono due tasti premuti uno dopo
// l'altro. `Mod` è Ctrl o Cmd, e i modificatori riconosciuti sono tre —
// `Mod`, `Shift`, `Alt` — e nessun altro: un `Ctrl-k` scritto a mano nelle
// impostazioni non è un accordo che questa shell onora, e viene **detto**
// invece che ignorato (`accordiRifiutati`).
//
// # Perché il primo tasto porta un modificatore e il secondo no
//
// È la regola che rende la sequenza eseguibile senza inventare una modalità, e
// le due metà si tengono. Il **primo** accordo deve portare un modificatore per
// la ragione di sempre: un comando che dichiarasse `f` ruberebbe una lettera a
// chi sta scrivendo una nota, e questa shell non ha modi, quindi un tasto nudo
// non ha un momento in cui è libero. Il **secondo** può essere nudo proprio
// perché il primo non lo era: `Mod-k` apre una modalità che dura quanto
// l'attesa, dichiarata (la barra di stato dice che è aperta) e con una via
// d'uscita (`Escape`, un tasto che non continua niente, o il tempo che scade).
// Dentro quella finestra la `d` non appartiene a nessuno, e nessuno gliela ruba.
//
// È il modello di VS Code, e la ragione per cui non è quello di vim (`g` poi
// `d`) è la stessa: `g` nudo è libero solo dove esiste una modalità normale, e
// qui non esiste. Accettare `g d` senza onorarlo sarebbe peggio che non
// accettarlo.

/// I modificatori che questa shell riconosce, e nessun altro.
const MODIFICATORI = ["mod", "shift", "alt"] as const;

/// Un accordo solo: i modificatori e il tasto, già in forma confrontabile.
export interface Accordo {
  /// Il tasto, minuscolo — come lo scrive `KeyboardEvent.key`.
  key: string;
  /// Ctrl o Cmd. Sono lo stesso modificatore per chi scrive un accordo, e due
  /// tasti diversi solo per chi ha comprato il computer.
  mod: boolean;
  shift: boolean;
  alt: boolean;
}

/// Una scorciatoia scomposta negli accordi che la compongono, o `null` se non è
/// una scorciatoia che questa shell sa premere.
///
/// `null` e non un accordo vuoto: chi la scrive deve poterlo **sapere**, e un
/// valore che si confonde con «nessuna scorciatoia» è esattamente il modo in cui
/// non lo saprebbe.
export function leggiAccordi(binding: string | null | undefined): Accordo[] | null {
  const testo = (binding ?? "").trim();
  if (testo === "") return null;
  const accordi: Accordo[] = [];
  for (const pezzo of testo.split(/\s+/)) {
    const parti = pezzo.split("-");
    const tasto = parti.pop();
    if (!tasto) return null;
    const mods = parti.map((p) => p.toLowerCase());
    // Un modificatore che non esiste non si ignora: `Ctrl-k` sarebbe letto come
    // `k` nudo — cioè un tasto che risponde mentre si scrive — e chi l'ha
    // scritto crederebbe di aver configurato Ctrl.
    if (mods.some((m) => !(MODIFICATORI as readonly string[]).includes(m))) return null;
    if (new Set(mods).size !== mods.length) return null;
    accordi.push({
      key: tasto.toLowerCase(),
      mod: mods.includes("mod"),
      shift: mods.includes("shift"),
      alt: mods.includes("alt"),
    });
  }
  const primo = accordi[0]!;
  if (!primo.mod && !primo.shift && !primo.alt) return null;
  return accordi;
}

function uguali(a: Accordo, b: Accordo): boolean {
  return a.key === b.key && a.mod === b.mod && a.shift === b.shift && a.alt === b.alt;
}

/// L'accordo che questa combinazione di tasti **è**.
function accordoPremuto(e: KeyChord): Accordo {
  return {
    key: e.key.toLowerCase(),
    mod: e.ctrlKey || e.metaKey,
    shift: e.shiftKey,
    alt: e.altKey,
  };
}

/// Un accordo in forma canonica: modificatori in ordine alfabetico, minuscolo.
/// Serve a **confrontare**, e per questo non è la forma che si legge.
function canonico(a: Accordo): string {
  const mods: string[] = [];
  if (a.alt) mods.push("alt");
  if (a.mod) mods.push("mod");
  if (a.shift) mods.push("shift");
  return [...mods, a.key].join("-");
}

/// Un accordo com'è scritto da chi lo dichiara: modificatori nell'ordine in cui
/// si pronunciano, tasto in maiuscolo. Serve a **leggere**, e per questo non è
/// la forma che si confronta — la barra di stato dice `Mod-K`, non `mod-k`.
function scrivi(a: Accordo): string {
  const mods: string[] = [];
  if (a.mod) mods.push("Mod");
  if (a.shift) mods.push("Shift");
  if (a.alt) mods.push("Alt");
  return [...mods, a.key.length === 1 ? a.key.toUpperCase() : a.key].join("-");
}

/// Questa combinazione è l'accordo scritto?
///
/// Vale per una scorciatoia di **un accordo solo**: una sequenza non corrisponde
/// mai a un tasto premuto, perché per definizione ne vuole due, e chi la deve
/// riconoscere è `avanza`.
export function matchesBinding(e: KeyChord, binding: string | null): boolean {
  const accordi = leggiAccordi(binding);
  if (!accordi || accordi.length !== 1) return false;
  return uguali(accordi[0]!, accordoPremuto(e));
}

/// Il comando il cui accordo efficace corrisponde, se ce n'è uno.
///
/// **Il primo**, e l'ordine è quello di `allCommands`: con un conflitto in piedi
/// qualcuno deve vincere, e vincere in modo prevedibile è meglio che non fare
/// niente — chi preme quei tasti vuole che succeda qualcosa. Che ci sia un
/// conflitto lo dice `conflitti`, una volta sola, invece che ogni volta che si
/// preme.
///
/// Guarda le sole scorciatoie di un accordo: la tastiera dell'app passa da
/// `avanza`, che le comprende tutte. Questo resta perché è la domanda che fa chi
/// ha in mano un tasto e nessuno stato — la palette, un banco.
export function findByChord(entries: CommandEntry[], e: KeyChord): CommandEntry | undefined {
  return entries.find((entry) => matchesBinding(e, entry.binding));
}

// ---------------------------------------------------------------------------
// La sequenza, che è uno stato
// ---------------------------------------------------------------------------

/// Quanto dura l'attesa del tasto successivo, in millisecondi.
///
/// Due secondi. Deve stare **sopra** un gesto deliberato di due tasti (tre-
/// quattro decimi per chi ha le dita sulla tastiera) e **sotto** il tempo in cui
/// si distoglie lo sguardo: la cosa da evitare non è l'attesa breve, è
/// l'attesa che sopravvive al motivo per cui era cominciata, e che fa rispondere
/// il tasto dopo a un gesto che nessuno ricorda di aver iniziato.
///
/// VS Code aspetta per sempre, e se lo può permettere perché tiene un avviso
/// fisso in fondo alla finestra. Qui sotto c'è un **editor**: il tasto dopo è
/// testo di qualcuno, e fallire per scadenza è l'unico modo di fallire che non
/// tocca la nota.
export const ATTESA_MS = 2000;

/// I tasti che da soli non sono un tasto premuto: `Shift` tenuto per fare una
/// maiuscola non deve annullare una sequenza in corso.
const SOLO_MODIFICATORI = new Set([
  "shift",
  "control",
  "alt",
  "meta",
  "altgraph",
  "capslock",
  "os",
  "dead",
]);

/// «Sto aspettando il tasto successivo»: gli accordi già premuti, e come si
/// scrivono per chi guarda la barra di stato.
export interface Attesa {
  premuti: Accordo[];
  etichetta: string;
}

/// Cosa fa la tastiera con questo tasto.
///
/// `passa` è l'unico esito che **non** consuma il tasto: tutti gli altri sono
/// gesti dell'app, e un gesto dell'app non finisce anche nella nota.
export type EsitoTasti =
  | { tipo: "passa" }
  | { tipo: "esegue"; entry: CommandEntry }
  | { tipo: "attende"; attesa: Attesa }
  | { tipo: "annulla" };

/// Un tasto, dato ciò che si stava aspettando.
///
/// Pura, e l'attesa entra ed esce invece di stare qui dentro: lo stato di una
/// sequenza è una variabile di **chi guida la tastiera**, non un secondo
/// registro dei comandi — di registro ce n'è uno solo dalla 0077, e questa è una
/// funzione che lo legge.
///
/// # Chi vince fra un accordo e il prefisso di una sequenza
///
/// **L'accordo completo**, sempre, e in qualunque ordine stiano nel registro. Se
/// esistono `Mod-k` e `Mod-k d`, premere `Mod-k` esegue il primo e il secondo
/// diventa irraggiungibile. Le tre ragioni, in ordine di peso: un tasto che
/// funziona oggi non deve diventare più lento domani (la regola opposta —
/// aspettare per vedere se arriva la `d` — mette un ritardo di due secondi su
/// ogni pressione di `Mod-k`); la sequenza è l'ultima arrivata, e chi arriva
/// paga; e soprattutto la cosa si decide **guardando il registro fermo**, quindi
/// `prefissiOscurati` la può dire all'avvio invece di lasciarla scoprire a chi
/// preme. Un conflitto che si annuncia è un conflitto che si va a sistemare
/// nelle impostazioni.
export function avanza(
  entries: CommandEntry[],
  attesa: Attesa | null,
  e: KeyChord,
): EsitoTasti {
  if (SOLO_MODIFICATORI.has(e.key.toLowerCase())) return { tipo: "passa" };
  // `Escape` annulla, e non è una scorciatoia che si possa contendere: una via
  // d'uscita che un comando potesse rubare non sarebbe una via d'uscita.
  if (attesa && e.key === "Escape") return { tipo: "annulla" };

  const premuto = accordoPremuto(e);
  const passo = attesa ? attesa.premuti.length : 0;
  let piuLungo: Accordo[] | null = null;

  for (const entry of entries) {
    const accordi = leggiAccordi(entry.binding);
    if (!accordi || accordi.length <= passo) continue;
    if (attesa && !attesa.premuti.every((a, i) => uguali(a, accordi[i]!))) continue;
    if (!uguali(accordi[passo]!, premuto)) continue;
    // Completo: si esegue subito, senza finire di guardare gli altri. È la
    // regola del prefisso, ed è per questo che sta qui e non in un secondo giro.
    if (accordi.length === passo + 1) return { tipo: "esegue", entry };
    piuLungo ??= accordi;
  }

  if (piuLungo) {
    const premuti = [...(attesa?.premuti ?? []), premuto];
    return { tipo: "attende", attesa: { premuti, etichetta: premuti.map(scrivi).join(" ") } };
  }
  // In attesa, un tasto che non continua niente **la chiude e si ferma qui**. Il
  // motivo per cui non arriva alla nota: chi ha premuto `Mod-k` ha già lasciato
  // il gesto di scrivere, e vedersi comparire una lettera è l'unico esito che
  // non si può prevedere da fuori.
  return attesa ? { tipo: "annulla" } : { tipo: "passa" };
}

/// Due o più comandi sullo stesso accordo, raggruppati.
///
/// È l'unica cosa di questa voce che senza pensarci non verrebbe gratis: la
/// palette mostra l'accordo di ognuno, ma nessuno guarda venti righe per
/// scoprire che due dicono `Mod-g`. Il confronto è sull'accordo **normalizzato**
/// — i modificatori ordinati e minuscoli — o `Shift-Mod-g` e `Mod-Shift-g`
/// sarebbero due accordi diversi per la tastiera e uguali per le dita.
export function conflitti(entries: CommandEntry[]): CommandEntry[][] {
  const per_accordo = new Map<string, CommandEntry[]>();
  for (const entry of entries) {
    if (!entry.binding) continue;
    const chiave = normalizza(entry.binding);
    if (!chiave) continue;
    const gia = per_accordo.get(chiave);
    if (gia) gia.push(entry);
    else per_accordo.set(chiave, [entry]);
  }
  return [...per_accordo.values()].filter((g) => g.length > 1);
}

/// Una scorciatoia in forma canonica: gli accordi in ordine, i modificatori in
/// ordine, tutto minuscolo. `null` se non è una scorciatoia che questa shell
/// onora — nessun modificatore sul primo tasto, un modificatore che non esiste,
/// un accordo senza tasto.
export function normalizza(binding: string): string | null {
  const accordi = leggiAccordi(binding);
  return accordi ? accordi.map(canonico).join(" ") : null;
}

/// Le scorciatoie rese **irraggiungibili** perché un'altra è un loro prefisso.
///
/// È il conflitto che nasce con le sequenze e che `conflitti` non può vedere:
/// `Mod-k` e `Mod-k d` non sono lo stesso accordo, sono uno l'inizio dell'altro,
/// e per la regola di `avanza` il corto vince e il lungo non si preme mai. Detto
/// all'avvio insieme agli altri, è una riga da sistemare nelle impostazioni;
/// scoperto premendo, sarebbe una tastiera che qualche volta non risponde.
export function prefissiOscurati(
  entries: CommandEntry[],
): { corto: CommandEntry; lunghe: CommandEntry[] }[] {
  const letti = entries
    .map((entry) => ({ entry, accordi: leggiAccordi(entry.binding) }))
    .filter((x): x is { entry: CommandEntry; accordi: Accordo[] } => x.accordi !== null);
  const esito: { corto: CommandEntry; lunghe: CommandEntry[] }[] = [];
  for (const corto of letti) {
    const lunghe = letti
      .filter(
        (lunga) =>
          lunga.accordi.length > corto.accordi.length &&
          corto.accordi.every((a, i) => uguali(a, lunga.accordi[i]!)),
      )
      .map((x) => x.entry);
    if (lunghe.length > 0) esito.push({ corto: corto.entry, lunghe });
  }
  return esito;
}

/// Gli accordi che questa shell **non sa premere**, con chi li ha scritti.
///
/// Esistono perché una scorciatoia è un'impostazione, cioè una stringa che
/// l'utente scrive a mano, e `Ctrl-k` o `d` sono i due modi più facili di
/// sbagliarla. Prima di questa voce finivano in un `continue` dentro il conteggio
/// dei conflitti: non erano un conflitto — vero — ma non erano nemmeno una
/// scorciatoia, e nessuno lo diceva. Un valore scritto e ignorato in silenzio è
/// peggio di un valore rifiutato.
export function accordiRifiutati(entries: CommandEntry[]): CommandEntry[] {
  return entries.filter((e) => e.binding !== null && normalizza(e.binding) === null);
}

/// Tutto ciò che non torna negli accordi, in una frase, o `null` se torna tutto.
///
/// Le tre cose si dicono insieme perché chiedono la stessa cosa a chi legge —
/// aprire le impostazioni e cambiare una riga — e perché sono tre modi di avere
/// un comando che non risponde: due che se lo contendono, uno coperto dal
/// proprio prefisso, uno scritto in un modo che non si può premere. Ognuna
/// **nomina i comandi**: «hai due comandi sullo stesso tasto» manda a cercare
/// quali.
export function frasedeiConflitti(entries: CommandEntry[]): string | null {
  const frasi: string[] = [];
  for (const g of conflitti(entries)) {
    frasi.push(
      t("commands.conflict", {
        chord: g[0]!.binding ?? "",
        commands: g.map((e) => e.title).join(", "),
      }),
    );
  }
  for (const { corto, lunghe } of prefissiOscurati(entries)) {
    frasi.push(
      t("commands.shadowed", {
        chord: corto.binding ?? "",
        command: corto.title,
        commands: lunghe.map((e) => `${e.title} («${e.binding}»)`).join(", "),
      }),
    );
  }
  for (const entry of accordiRifiutati(entries)) {
    frasi.push(t("commands.rejected", { chord: entry.binding ?? "", command: entry.title }));
  }
  return frasi.length === 0 ? null : frasi.join(" ");
}
