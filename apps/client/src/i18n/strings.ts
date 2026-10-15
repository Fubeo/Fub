// Le stringhe **della shell**, e come si scelgono (§12.4).
//
// La [decisione 0040](../../../docs/decisions/0192-impostazioni-locale-e-temi.md) ha deciso
// chi localizza cosa: le stringhe di un componente le porta il componente, in un
// catalogo di manifest, e le risolve il kernel sulla via d'uscita dal contratto.
// Quella regola ha ristretto questa voce invece di allargarla — i pannelli dei
// provider si traducono da soli, e questa shell non conosce le chiavi di
// nessuno — e ha lasciato scoperto esattamente ciò che la shell **scrive di
// suo**: il cestino, l'esplora, la palette, i tre pannelli di sistema, e il
// testo fermo di `index.html`.
//
// `catalog.ts` è il loro catalogo, e la shell è quindi un componente come gli
// altri: un catalogo suo, la stessa scala di ripiego, e nessun accesso a quelli
// altrui.
//
// # La scala, che è quella del contratto
//
// `it-IT` → `it` → la lingua di ripiego (`it`) → **la chiave nuda**. È la stessa
// di `Strings::template`, e lo è di proposito: due scale diverse per la stessa
// app vorrebbero dire che una stringa della shell e una di un provider possono
// cadere in due lingue diverse sullo stesso schermo.
//
// L'ultimo gradino è brutto apposta, ed è la ragione scritto nella 0040: una
// chiave mancante deve essere *visibile e cercabile*, non plausibile.
//
// # Ciò che qui si può fare e in Rust no
//
// `Key` è l'unione delle chiavi del catalogo italiano, e i cataloghi delle
// altre lingue sono `Record<Key, string>`: **una chiave dimenticata in
// inglese non compila**. In Rust la stessa promessa costa un test che cammina
// sui cataloghi (`fub-features/tests/i_cataloghi.rs`), perché lì un catalogo è
// dato di manifest e le chiavi sono `&str`. Qui il compilatore la regala, e
// vale la pena prendersela: è il tipo di errore che altrimenti si scopre da una
// segnalazione.
//
// Ciò che il compilatore **non** copre è il testo fermo di `index.html`, che
// nomina le chiavi in un attributo: quello lo presidia `strings.test.ts`,
// leggendo il file vero.
//
// # I cataloghi che arrivano dopo
//
// Questo catalogo si scarica all'avvio, con la shell. Una parte del client
// che arriva con un `import()` porta le sue stringhe in un catalogo suo, fatto
// con `catalog`: la stessa lingua, la stessa scala, gli stessi nomi fra
// graffe, e chiavi che la shell non ha. È il caso dell'editor dei disegni
// (`editors/spatial/strings.ts`).
import { EN, IT, type Key } from "./catalog";
import { settings } from "../host/query";
import { onEvent } from "../state/kernel";
import { on } from "../state/store";
import type { SettingEntry } from "../host/contract";
import type { Teardown } from "../ui/lifetime";
import { setTooltip } from "../ui/tooltip";

export type { Key } from "./catalog";

/// La lingua di ripiego di questa shell, che è quella in cui è scritto.
const FALLBACK = "it";

/// Le lingue in cui la shell è tradotta, oltre a quella in cui è scritta. Un
/// catalogo di [`catalog`] le deve avere tutte: una lingua nuova non compila
/// finché ognuno non la traduce.
export type Translation = "en";

const TRANSLATIONS: Record<Translation, Record<Key, string>> = { en: EN };

const CATALOGS: Record<string, Record<string, string>> = { [FALLBACK]: IT, ...TRANSLATIONS };

/// La chiave dell'impostazione della lingua. La stessa stringa sta in
/// `fub-kernel/src/locale.rs`, come `CHIAVE_TEMA` sta in
/// `fub-host/src/settings.rs` — e per la stessa ragione: una shell in
/// TypeScript non importa una costante Rust.
export const LANGUAGE_KEY = "locale.language";

/// Le lingue in cui la shell sa parlare, cioè quelle che vale la pena offrire
/// nel pannello: una lingua senza catalogo ricadrebbe sull'italiano.
export function catalogLanguages(): string[] {
  return Object.keys(CATALOGS);
}

/// Dove la shell ricorda l'ultima **scelta** di lingua.
///
/// Stesso mestiere della cache del tema, e stesso buco dichiarato: le
/// impostazioni si leggono dal canale dati, che vuole un vault aperto, e al
/// primo fotogramma non c'è niente da leggere. Ricordare la *scelta* e non la
/// lingua risolta è ciò che fa ripartire chi ha lasciato «come il sistema»
/// seguendo il sistema di **oggi**.
const CACHE = "fub.locale.language";

/// La scelta corrente, così com'è scritto nell'impostazione.
let choice = "";

/// Il proprietario di una rilettura asincrona. La generazione rende vecchia
/// ogni richiesta precedente; `active` impedisce a una risposta che arriva dopo
/// lo smontaggio di cambiare una finestra già rimontata.
type RereadOwner = {
  active: boolean;
  generation: number;
};

/// Chi va avvisato quando la lingua cambia: chi ha già disegnato del testo.
type LanguageRegistration = { listener: () => void };
const listeners: LanguageRegistration[] = [];

/// La lingua che vale, date la scelta e quella del sistema.
///
/// Gemella di `temaEffettivo`, e con la stessa regola per i valori strani: la
/// stringa vuota è «come il sistema» (la convenzione delle chiavi `locale.*`), e
/// lo è anche qualunque cosa non sia una stringa — un `settings.json` scritto a
/// mano non deve poter spegnere le stringhe.
export function effectiveLanguage(choice: unknown, systemLanguage: string): string {
  return typeof choice === "string" && choice.trim() !== "" ? choice.trim() : systemLanguage;
}

/// Il catalogo da cui pescare, per una lingua: la scala della 0040, i primi tre
/// gradini. Il quarto — la chiave nuda — lo fa `t`, perché è l'assenza di un
/// catalogo e non un catalogo.
export function catalogFor(language: string): Record<string, string> {
  return CATALOGS[catalogLanguage(language)]!;
}

/// La lingua del catalogo che serve davvero una lingua chiesta. Il ripiego è
/// lo stesso del contratto (`Strings::template`): la lingua di default dei
/// manifest del core, così shell e provider non parlano due lingue diverse.
export function catalogLanguage(language: string): string {
  const lower = language.toLowerCase();
  const base = lower.split(/[-_]/)[0] ?? "";
  if (CATALOGS[lower]) return lower;
  if (CATALOGS[base]) return base;
  return FALLBACK;
}

/// La lingua in cui la shell sta parlando adesso, per `lang` e per formattare
/// date e numeri accanto al testo: quella chiesta se il catalogo è il suo
/// (`it-IT` resta `it-IT`), quella del catalogo se è caduta sul ripiego.
export function resolvedLanguage(): string {
  const requested = languageCurrent();
  const catalog = catalogLanguage(requested);
  return requested.toLowerCase().split(/[-_]/)[0] === catalog ? requested : catalog;
}

/// La lingua corrente. Fuori da un browser (i test) `navigator` può non esserci.
function languageCurrent(): string {
  const systemLanguage = typeof navigator === "undefined" ? FALLBACK : navigator.language || FALLBACK;
  return effectiveLanguage(choice, systemLanguage);
}

/// Allinea il documento al testo che `t()` sta per restituire. Non si usa un
/// valore fermo in `index.html`: dopo un cambio di lingua anche i lettori che
/// non guardano una regione devono ricevere la lingua della pagina.
function applyDocumentLanguage(): void {
  if (typeof document === "undefined" || !document.documentElement) return;
  // La lingua del testo che si legge, non quella chiesta: con il sistema in
  // francese il testo è inglese, e va letto con la voce inglese.
  document.documentElement.lang = resolvedLanguage();
}

/// Sostituisce `{nome}` con l'argomento che si chiama così.
///
/// Le stesse regole del motore del contratto (`fub_abi::text::expand`), e non
/// per simmetria: una graffa raddoppiata è letterale (serve a scrivere
/// `{{"chiave": valore}}`), e un nome senza argomento **resta a vista** invece
/// di sparire — una frase con un buco si nota, una frase a cui manca una parola
/// no.
///
/// I due motori sono la sola coppia che il repo dichiarava gemella senza che
/// niente la tenesse tale, e divergevano già: di là un nome è **tutto ciò che
/// precede la prima `}`**, qui era `\w+`, quindi un argomento che si chiama
/// `foo-bar` — o `città` — veniva sostituito dal kernel e restava scritto a
/// video dalla shell (difetto 0224). Adesso è lo stesso cammino, passo per
/// passo, e a tenerlo tale è la fixture del mirror delle regole (`espansione`
/// in `rules/rules-mirror.test.ts`): un motore che cambia da solo è rosso.
///
/// Il nome si cerca **fra le chiavi proprie** dell'oggetto e non con un
/// accesso nudo: `{constructor}` in JavaScript trova qualcosa in qualunque
/// oggetto, e sarebbe una funzione stampata in mezzo a una frase.
export function expand(template: string, args: Record<string, string | number>): string {
  let outside = "";
  let rest = template;
  for (;;) {
    const where = rest.search(/[{}]/);
    if (where < 0) break;
    outside += rest.slice(0, where);
    const brace = rest[where]!;
    rest = rest.slice(where + 1);
    // Raddoppiata = letterale, per l'una e per l'altra.
    if (rest[0] === brace) {
      outside += brace;
      rest = rest.slice(1);
      continue;
    }
    // Una graffa chiusa spaiata è testo: non c'è niente da chiudere.
    if (brace === "}") {
      outside += "}";
      continue;
    }
    const end = rest.indexOf("}");
    // Una graffa aperta che non si chiude mai: testo fino alla fine.
    if (end < 0) {
      outside += "{";
      break;
    }
    const name = rest.slice(0, end);
    outside += Object.prototype.hasOwnProperty.call(args, name) ? String(args[name]) : `{${name}}`;
    rest = rest.slice(end + 1);
  }
  return outside + rest;
}

/// Il testo di una chiave, nella lingua di chi guarda.
/// La frase giusta per un numero: `one` per il singolare della lingua che si
/// sta parlando, `other` per tutto il resto. Le regole le sa `Intl`: in
/// italiano e in inglese «uno» è singolare, ma una lingua nuova non deve
/// portarsi dietro l'assunzione.
export function plural(count: number, one: Key, other: Key, args: Record<string, string | number> = {}): string {
  return t(singular(count) ? one : other, { count, n: count, ...args });
}

/// Se `count` vuole la forma singolare nella lingua che si sta parlando.
function singular(count: number): boolean {
  try {
    return new Intl.PluralRules(resolvedLanguage()).select(count) === "one";
  } catch {
    return count === 1;
  }
}

/// I nomi fra graffe di un modello del catalogo: `"«{name}»: {reason}"` →
/// `"name" | "reason"`. Le graffe raddoppiate sono testo, come in [`expand`].
type Placeholders<S extends string> = S extends `${string}{${infer Rest}`
  ? Rest extends `{${infer After}`
    ? Placeholders<After>
    : Rest extends `${infer Name}}${infer After}`
      ? Name | Placeholders<After>
      : never
  : never;

/// Gli argomenti che il modello italiano di `K` nomina, obbligatori: un
/// `{motivo}` che il chiamante passa come `reason` non compila, invece di
/// arrivare a schermo come graffa. Altri nomi restano ammessi (`plural`
/// aggiunge sempre `count` e `n`). Su una chiave calcolata (`K` unione) vale
/// la forma di una qualunque delle chiavi possibili: la prova piena è sulle
/// chiamate con la chiave scritta. Una chiave forzata (`as never`, letta da
/// un attributo) non promette niente e non chiede niente.
export type ArgsFor<K extends Key> = TemplateArgs<typeof IT, K>;

/// Lo stesso per la chiave `K` di un catalogo qualunque `C`, i cui testi sono
/// i modelli nella lingua di ripiego.
export type TemplateArgs<C extends Readonly<Record<string, string>>, K extends keyof C> = [K] extends [never]
  ? [args?: Record<string, string | number>]
  : K extends keyof C
    ? [Placeholders<C[K]>] extends [never]
      ? [args?: Record<string, string | number>]
      : [args: Record<Placeholders<C[K]>, string | number> & Record<string, string | number>]
    : never;

export function t<K extends Key>(key: K, ...[args = {}]: ArgsFor<K>): string {
  const template = catalogFor(languageCurrent())[key] ?? IT[key] ?? key;
  return expand(template, args);
}

/// Il catalogo di una parte del client che arriva quando serve.
///
/// Questo catalogo si scarica all'avvio, con la shell. Una parte grande che
/// arriva con un `import()`, come l'editor dei disegni, porta le sue stringhe
/// con sé, e chi non la apre non le scarica. Parla la lingua della shell, con
/// la stessa scala di ripiego, gli stessi nomi fra graffe e gli stessi
/// plurali; le chiavi sono sue, e il tipo le tiene complete in ogni lingua
/// come `Key` tiene quelle della shell.
export interface Catalog<C extends Readonly<Record<string, string>>> {
  /// Il testo di una chiave, nella lingua di chi guarda, come [`t`].
  t<K extends keyof C & string>(key: K, ...args: TemplateArgs<C, K>): string;
  /// La frase giusta per un numero, come [`plural`].
  plural(count: number, one: keyof C & string, other: keyof C & string, args?: Record<string, string | number>): string;
  /// I testi per una lingua, con la scala di [`catalogFor`].
  catalogFor(language: string): Readonly<Record<string, string>>;
}

/// Un catalogo coi modelli di `source`, scritti nella lingua di ripiego, e le
/// loro traduzioni.
export function catalog<const C extends Readonly<Record<string, string>>>(
  source: C,
  translations: Readonly<Record<Translation, Readonly<Record<keyof C, string>>>>,
): Catalog<C> {
  const fallback: Readonly<Record<string, string>> = source;
  const tables: Readonly<Record<string, Readonly<Record<string, string>>>> = { [FALLBACK]: fallback, ...translations };
  const tableFor = (language: string): Readonly<Record<string, string>> => tables[catalogLanguage(language)] ?? fallback;
  const text = (key: string, args: Record<string, string | number>): string =>
    expand(tableFor(languageCurrent())[key] ?? fallback[key] ?? key, args);
  return {
    t: (key, ...args) => text(key, (args as [Record<string, string | number>?])[0] ?? {}),
    plural: (count, one, other, args = {}) => text(singular(count) ? one : other, { count, n: count, ...args }),
    catalogFor: tableFor,
  };
}

/// Gli attributi che il testo fermo di `index.html` può chiedere, e dove
/// finisce ciò che si trova.
///
/// Un solo attributo per elemento sarebbe bastato al 90% dei casi e non al
/// rest: un pulsante ha un testo **e** un `title`, e un campo ha un
/// segnaposto e un nome accessibile. Sono quattro nomi e non un mini-linguaggio
/// dentro un attributo, che è la forma che si finisce per dover parsare.
const ATTRIBUTES = [
  ["data-i18n", "testo"],
  ["data-i18n-title", "tooltip"],
  ["data-i18n-placeholder", "placeholder"],
  ["data-i18n-label", "aria-label"],
] as const;

/// Riempie il testo fermo: `<button data-i18n="app.close">` diventa «Chiudi».
///
/// Gira al montaggio e a ogni cambio di lingua. Il testo scritto nell'HTML resta
/// comunque quello italiano — non è un segnaposto vuoto — perché è ciò che si
/// vede se questa funzione non gira: un ripiego che è già la lingua di ripiego.
export function applyStrings(root: ParentNode = document): void {
  applyDocumentLanguage();
  for (const [attribute, where] of ATTRIBUTES) {
    for (const el of root.querySelectorAll<HTMLElement>(`[${attribute}]`)) {
      const key = el.getAttribute(attribute) as Key;
      const text = t(key);
      if (where === "testo") el.textContent = text;
      else if (where === "tooltip") setTooltip(el, text);
      else el.setAttribute(where, text);
    }
  }
}

/// Chi ridisegna quando la lingua cambia, **iscritto da sé**.
///
/// La scocca la rifà `applicaStringhe`, e i pannelli li rifà l'host dei
/// pannelli; restano le superfici che disegnano testo e non sono né l'una né
/// gli altri — il pulsante degli avvisi, quello delle attività e le superfici
/// degli editor. Si iscrivono qui invece di essere chiamate da `main.ts`: chi
/// disegna del testo sa di disegnarlo, e il punto di montaggio non deve tenere
/// un elenco di chi lo fa — un elenco che si scopre incompleto solo cambiando
/// lingua e guardando bene.
///
/// Torna **come smettere**, come `onKernelEvent` in `host/ipc.ts` e come
/// `trapFocus`. Chi si iscrive deve affidare il disposer a una `Lifetime`:
/// `lifetime.add(onLanguage(redraw))`. `mountStrings` raccoglie nello stesso
/// modo le proprie iscrizioni a lingua, kernel e store, così il suo chiamante
/// può smontarle tutte insieme.
export function onLanguage(listener: () => void): Teardown {
  const registration: LanguageRegistration = { listener };
  listeners.push(registration);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    const i = listeners.indexOf(registration);
    if (i >= 0) listeners.splice(i, 1);
  };
}

/// Rilegge la scelta dall'impostazione, se c'è un vault che possa rispondere.
async function reread(owner: RereadOwner): Promise<void> {
  const generation = ++owner.generation;
  let entries: SettingEntry[];
  try {
    entries = await settings();
  } catch {
    // Nessun vault aperto, o il canale dati che non risponde: si resta su ciò
    // che la cache diceva. Una lingua è la cosa meno urgente da cui far fallire
    // un avvio.
    return;
  }
  // Una risposta non può più applicarsi se nel frattempo è partita una
  // rilettura più nuova o il chiamante è stato smontato.
  if (!owner.active || owner.generation !== generation) return;
  const entry = entries.find((e) => e.spec.key === LANGUAGE_KEY);
  if (!entry) return;
  const next = typeof entry.value === "string" ? entry.value : "";
  if (next === choice) return;
  choice = next;
  // La cache è una memoria di cortesia: se il browser la vieta, la scelta
  // arrivata dall'impostazione resta comunque autorevole per questa finestra.
  try {
    localStorage.setItem(CACHE, choice);
  } catch {
    // Best effort: non impedire né l'applicazione né l'avviso del cambio.
  }
  applyStrings();
  // Una copia: un ascoltatore che si disiscrive mentre viene chiamato
  // altrimenti accorcerebbe l'array sotto l'iteratore, e il successivo
  // salterebbe il turno.
  for (const { listener } of [...listeners]) listener();
}

/// Accende le stringhe: applica subito ciò che si sa, poi insegue l'unica
/// sorgente che le può cambiare — l'impostazione.
///
/// Il sistema non è una seconda sorgente da inseguire come per il tema: la
/// lingua della webview non cambia mentre l'app è aperta, e se cambiasse
/// cambierebbe riavviandola.
export function mountStrings(onChange: () => void): Teardown {
  const owner: RereadOwner = { active: true, generation: 0 };
  try {
    choice = localStorage.getItem(CACHE) ?? "";
  } catch {
    choice = "";
  }
  applyStrings();
  const stopLanguage = onLanguage(onChange);
  const stopSetting = onEvent("setting_changed", () => {
    if (owner.active) void reread(owner);
  });
  const stopVault = on("vault", () => {
    if (owner.active) void reread(owner);
  });
  return () => {
    if (!owner.active) return;
    owner.active = false;
    owner.generation++;
    stopVault();
    stopSetting();
    stopLanguage();
  };
}
