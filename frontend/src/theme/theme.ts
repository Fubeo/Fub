// In che luce si guarda Fub: risolvere la scelta, applicarla, seguirla.
//
// La scelta è un'impostazione — `appearance.theme`, di **macchina**
// (`fub-host/src/settings.rs`) — e vale tre cose: `light`, `dark`, o la
// stringa vuota, che nella convenzione delle impostazioni che delegano al
// sistema (le `locale.*`) vuol dire *chiedilo a chi sta sotto*.

// # Perché la risolve la shell, e non il CSS
//
// «Come il sistema» ha una forma nativa in CSS: `@media
// (prefers-color-scheme: dark)`. Non la usiamo, e la ragione è che con quella
// i valori del tema scuro andrebbero scritti **due volte** — una nella media
// query, per chi non ha scelto, e una per chi ha scelto scuro su un sistema
// chiaro. Due liste che devono restare uguali sono due liste che divergono,
// e diverge quella meno guardata: la seconda.
//
// Risolvendo qui, il caricatore (`theme/loader.ts`) monta un foglio **solo**:
// quello della luce che vale, e nessun altro — nel CSS non c'è più nessun
// tema di default e nessun `[data-theme]` da battere in specificità. Il
// guadagno secondario resta: «quale tema vale» è una funzione pura di due
// argomenti, e una funzione pura si prova; una media query si prova solo
// aprendo l'app.
//
// # Il primo disegno
//
// Le impostazioni si leggono dal canale dati, che vuole un vault aperto: al
// primo fotogramma non c'è ancora niente da leggere. La shell tiene quindi
// l'ultima scelta in `localStorage` e la applica **prima** di chiedere, così
// chi ha scelto chiaro su un sistema scuro non vede l'app accendersi scura per
// mezzo secondo. Non è una seconda sorgente di verità: è una cache, e il valore
// che comanda la sovrascrive appena arriva.
//
// Resta un buco dichiarato, e sta scritto qui perché è il posto in cui si
// vede: un'impostazione di **macchina** non è leggibile finché non si apre un
// **vault**. Per il tema la cache lo copre dal secondo avvio in poi; la
// soluzione vera — il livello macchina raggiungibile senza vault — è lavoro
// delle impostazioni, non di questa voce, e inventarle qui un comando IPC
// apposta avrebbe allargato il confine (§16.6) per un cliente solo.
import { settings } from "../host/query";
import { onEvent } from "../state/kernel";
import { on } from "../state/store";
import type { Lifetime } from "../ui/lifetime";
import sheetScuro from "./serie/sheet-dark.css?raw";
import sheetChiaro from "./serie/sheet-light.css?raw";
import skin from "./serie/skin.css?raw";
import fonts from "./serie/fonts.css?raw";
import { mount } from "./loader";

/// Le due luci. Non c'è un terzo valore: «come il sistema» è una **scelta**,
/// non un tema, e tenerli nello stesso tipo è il modo in cui poi si finisce a
/// scrivere `if (tema === "system")` dentro un renderer.
export type Theme = "light" | "dark";

/// La chiave dell'impostazione. La stessa stringa sta in
/// `fub-host/src/settings.rs`, che è dove la chiave **esiste**: una shell in
/// TypeScript non ha modo di importare una costante Rust.
///
/// Divergere costerebbe caro e in silenzio — l'impostazione resterebbe nel
/// pannello, la si potrebbe cambiare, e non succederebbe niente — quindi le
/// tiene insieme un presidio che gira dal lato Rust
/// (`fub-host/tests/interruttori.rs`): legge **questo file** e verifica che
/// la chiave che ci trova sia una di quelle che il core dichiara davvero.
export const THEME_KEY = "appearance.theme";

/// Dove la shell ricorda l'ultima **scelta** — non l'ultimo tema risolto.
///
/// La differenza conta: ricordando la scelta, chi ha lasciato «come il sistema»
/// riparte seguendo il sistema di *oggi*; ricordando il tema risolto,
/// ripartirebbe seguendo quello di ieri sera.
const CACHE = "fub.appearance.theme";

/// La query che il browser risponde per la luce del sistema.
const DARK_QUERY = "(prefers-color-scheme: dark)";

let choice = "";

/// La luce montata, per il guard «cambio solo se serve» di `applica()`.
/// Resta in sync con `dataset.theme`, ma la tiene qui il modulo e non il DOM,
/// così il primo montaggio (dataset vuoto) non salta il foglio.
let mountedLight: Theme | null = null;

/// Chi va avvisato quando il tema effettivo cambia (l'editor: il suo flag
/// `dark` non è un colore e il CSS non lo può cambiare da solo).
let warn: (theme: Theme) => void = () => {};

/// Il tema che vale, date la scelta e la luce del sistema.
///
/// Qualunque cosa che non sia `light` o `dark` è «come il sistema»: la stringa
/// vuota (il default dello schema), ma anche un `settings.json` scritto a mano
/// con un valore che non esiste. Un valore ignoto che facesse cadere il tema in
/// un terzo stato sarebbe un file di configurazione capace di rendere l'app
/// illeggibile, e la 0036 ha già deciso che non lo è.
export function effectiveTheme(choice: unknown, systemDark: boolean): Theme {
  if (choice === "light" || choice === "dark") return choice;
  return systemDark ? "dark" : "light";
}

/// Cosa dice il sistema **adesso**.
///
/// Il ripiego è lo scuro, che è la luce in cui Fub è sempre stato: un motore
/// senza `matchMedia` non deve inaugurare un aspetto che nessuno ha scelto.
function systemDark(): boolean {
  return window.matchMedia?.(DARK_QUERY).matches ?? true;
}

/// Il tema che la pagina sta portando.
export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/// Scrive il tema sulla radice, monta il foglio della luce che vale, e
/// avvisa chi non può leggerlo dal CSS.
/// `data-theme` non serve più al foglio — quello montato **è** il tema — ma
/// resta un segnale vivo: il pittore del grafo lo osserva con un
/// `MutationObserver` per ridipingere i canvas, e `temaCorrente()` lo legge.
/// Per questo si scrive **dopo** aver montato il foglio: chi osserva e
/// rilegge i colori con `getComputedStyle` deve trovare quelli nuovi.
function apply(): void {
  // La pelle di serie non cambia con la luce: la monta `mountTheme` una volta
  // sola all'avvio. Qui si monta solo il foglio della luce che vale, che
  // invece cambia — ed è per questo che il guard è sulla luce, non sulla pelle.
  const light: Theme = effectiveTheme(choice, systemDark());
  if (light === mountedLight) return;
  mount(light === "light" ? sheetChiaro : sheetScuro, "foglio");
  mountedLight = light;
  document.documentElement.dataset.theme = light;
  warn(light);
}

/// Rilegge la scelta dall'impostazione, se c'è un vault che possa rispondere.
async function reread(): Promise<void> {
  try {
    // Senza filtro per componente: l'id del bundle di core (`fub.core`) è una
    // costante di Rust, e ricopiarla qui creerebbe la seconda metà di una
    // coppia che nessun presidio tiene insieme. La chiave basta a trovarla, e
    // l'elenco intero è la stessa query che il pannello delle impostazioni fa
    // già a ogni apertura.
    const entry = (await settings()).find((e) => e.spec.key === THEME_KEY);
    if (!entry) return;
    let value = typeof entry.value === "string" ? entry.value : "";
    // Lime non è più un fascio: chi lo aveva scelto resta sul buio che aveva.
    // `temaEffettivo` non lo sa e non deve saperlo — la migrazione avviene qui,
    // prima di persistere e di applicare.
    if (value === "lime") value = "dark";
    choice = value;
    localStorage.setItem(CACHE, choice);
    apply();
  } catch {
    // Nessun vault aperto, o il canale dati che non risponde: si resta su
    // quello che la cache diceva. Un tema è la cosa meno urgente da cui far
    // fallire un avvio.
  }
}

/// Accende il tema: applica subito ciò che si sa, poi insegue le due sorgenti
/// che lo possono cambiare — il sistema e l'impostazione.
export function mountTheme(lifetime: Lifetime, onChange: (theme: Theme) => void): void {
  try {
    choice = localStorage.getItem(CACHE) ?? "";
  } catch {
    choice = "";
  }
  // Lime non è più un fascio: chi lo aveva scelto resta sul buio che aveva.
  // `temaEffettivo` non lo sa e non deve saperlo — la migrazione avviene qui,
  // prima di persistere e di applicare.
  if (choice === "lime") {
    choice = "dark";
    try {
      localStorage.setItem(CACHE, "dark");
    } catch {
      // localStorage può mancare (un motore senza storage): la migrazione
      // vale in memoria, e la persistenza si rifarà al prossimo giro.
    }
  }

  // A un nuovo montaggio il banco è vuoto: `beforeEach` nei test ripulisce la
  // testa, e lo stato montato va d'accordo con quel che c'è. Senza questo
  // reset, la guardia di `applica()` salterebbe il primo montaggio perché
  // `luceMontata` ricorda il test di prima — e il foglio non si monterebbe.
  // Nell'app vera non conta: si monta una volta sola.
  mountedLight = null;
  // La pelle e i caratteri di serie non cambiano con la luce, quindi si
  // montano all'avvio; il foglio segue la luce. Montarli qui — prima di
  // `applica()` — una volta sola è il ritorno al modello originario: due
  // luci, una pelle, tre caratteri (§31.3). L'ordine fra questi due `monta()`
  // non conta più: lo dichiara `ORDINE` in `loader.ts`.
  mount(fonts, "caratteri");
  mount(skin, "pelle");
  // Prima di registrare l'avviso: chi montiamo dopo (l'editor) legge il tema
  // corrente alla nascita, e avvisarlo di un cambiamento che non ha ancora
  // visto vorrebbe dire chiamarlo prima che esista.
  apply();
  warn = onChange;

  // Il sistema che cambia luce mentre l'app è aperta. Riguarda solo chi ha
  // lasciato «come il sistema», e `applica()` lo sa già: se la scelta è
  // esplicita, ricalcola lo stesso valore e non fa niente.
  // `matchMedia` può mancare (un motore senza media query): l'elenco delle
  // sorgenti resta lo stesso, ne manca una.
  const media = window.matchMedia?.(DARK_QUERY);
  if (media) lifetime.listen(media, "change", apply);

  // L'impostazione che cambia: da questo pannello, da un'altra finestra, da un
  // `settings.json` riscritto sotto. L'evento non porta il valore (§11.1), e
  // quindi si rilegge.
  onEvent("setting_changed", () => void reread());
  // E il momento in cui la domanda diventa **rispondibile**: un vault aperto.
  on("vault", () => void reread());
}
