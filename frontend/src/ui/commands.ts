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
// Ne resta scoperta una cosa, ed è nominata nella
// [0077](../../../docs/decisions/0077-una-scorciatoia-e-una-chiave.md): la
// scorciatoia di un comando di shell **non è ancora riconfigurabile**, perché la
// chiave che la terrebbe la fabbrica il kernel registrando un provider, e qui un
// provider non c'è.
import type { CommandSpec, SettingEntry } from "../host/contract";
import { impostazioni } from "../host/query";
import { type Chiave, t } from "../i18n/strings";
import { state } from "../state/store";
import { SHELL_KEYS, type ShellCommandId } from "./shell-keys";

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
    binding: vuotoENull(SHELL_KEYS[c.id]),
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

/// Questa combinazione è l'accordo scritto?
///
/// La sintassi è quella delle spec (`Mod-Shift-f`), dove `Mod` è Ctrl o Cmd. Un
/// accordo **senza modificatori viene ignorato**: un comando che dichiarasse `f`
/// ruberebbe una lettera a chi sta scrivendo una nota. Vale anche per ciò che
/// l'utente riconfigura, e non è una restrizione dimenticata lì: la shell non ha
/// modi (§18.1), quindi un tasto nudo non ha un momento in cui è libero.
export function matchesBinding(e: KeyChord, binding: string | null): boolean {
  if (!binding) return false;
  const parti = binding.split("-");
  const tasto = parti.pop();
  if (!tasto) return false;
  const mods = parti.map((p) => p.toLowerCase());
  if (mods.length === 0) return false;
  const mod = e.ctrlKey || e.metaKey;
  const vuole = (nome: string) => mods.includes(nome);
  return (
    e.key.toLowerCase() === tasto.toLowerCase() &&
    vuole("mod") === mod &&
    vuole("shift") === e.shiftKey &&
    vuole("alt") === e.altKey
  );
}

/// Il comando il cui accordo efficace corrisponde, se ce n'è uno.
///
/// **Il primo**, e l'ordine è quello di `allCommands`: con un conflitto in piedi
/// qualcuno deve vincere, e vincere in modo prevedibile è meglio che non fare
/// niente — chi preme quei tasti vuole che succeda qualcosa. Che ci sia un
/// conflitto lo dice `conflitti`, una volta sola, invece che ogni volta che si
/// preme.
export function findByChord(entries: CommandEntry[], e: KeyChord): CommandEntry | undefined {
  return entries.find((entry) => matchesBinding(e, entry.binding));
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

/// Un accordo in forma canonica: modificatori in ordine, tutto minuscolo.
/// `null` se non è un accordo che questa shell onora (nessun modificatore).
export function normalizza(binding: string): string | null {
  const parti = binding.split("-");
  const tasto = parti.pop();
  if (!tasto) return null;
  const mods = parti.map((p) => p.toLowerCase()).sort();
  if (mods.length === 0) return null;
  return [...mods, tasto.toLowerCase()].join("-");
}

/// I conflitti in una frase, o `null` se non ce ne sono.
///
/// Nomina i comandi, perché «hai due comandi sullo stesso tasto» manda a
/// cercare quali: la frase intera è ciò che permette di andare nelle
/// impostazioni e cambiarne uno.
export function frasedeiConflitti(entries: CommandEntry[]): string | null {
  const gruppi = conflitti(entries);
  if (gruppi.length === 0) return null;
  return gruppi
    .map((g) =>
      t("commands.conflict", {
        chord: g[0]!.binding ?? "",
        commands: g.map((e) => e.title).join(", "),
      }),
    )
    .join(" ");
}
