// In che luce si guarda Fub: risolvere la scelta, applicarla, seguirla.
//
// La scelta è un'impostazione — `appearance.theme`, di **macchina**
// (`fub-host/src/settings.rs`) — e vale tre cose: `light`, `dark`, o la
// stringa vuota, che nella convenzione delle impostazioni che delegano al
// sistema (le `locale.*`) vuol dire *chiedilo a chi sta sotto*.
//
// # Perché la risolve la shell, e non il CSS
//
// «Come il sistema» ha una forma nativa in CSS: `@media
// (prefers-color-scheme: dark)`. Non la usiamo, e la ragione è che con quella
// i valori del tema scuro andrebbero scritti **due volte** — una nella media
// query, per chi non ha scelto, e una in `[data-theme="dark"]`, per chi ha
// scelto scuro su un sistema chiaro. Due liste di venti colori che devono
// restare uguali sono due liste che divergono, e diverge quella meno guardata:
// la seconda.
//
// Risolvendo qui, il CSS vede sempre un tema **concreto** e ne dichiara uno
// solo in più rispetto al default (`theme/tokens.css`). Il guadagno secondario
// è che «quale tema vale» diventa una funzione pura di due argomenti, e una
// funzione pura si prova; una media query si prova solo aprendo l'app.
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
import { impostazioni } from "../host/query";
import { onEvent } from "../state/kernel";
import { on } from "../state/store";

/// Le due luci. Non c'è un terzo valore: «come il sistema» è una **scelta**,
/// non un tema, e tenerli nello stesso tipo è il modo in cui poi si finisce a
/// scrivere `if (tema === "system")` dentro un renderer.
export type Tema = "light" | "dark";

/// La chiave dell'impostazione. La stessa stringa sta in
/// `fub-host/src/settings.rs`, che è dove la chiave **esiste**: una shell in
/// TypeScript non ha modo di importare una costante Rust.
///
/// Divergere costerebbe caro e in silenzio — l'impostazione resterebbe nel
/// pannello, la si potrebbe cambiare, e non succederebbe niente — quindi le
/// tiene insieme un presidio che gira dal lato Rust
/// (`fub-host/tests/interruttori.rs`): legge **questo file** e verifica che
/// la chiave che ci trova sia una di quelle che il core dichiara davvero.
export const CHIAVE_TEMA = "appearance.theme";

/// Dove la shell ricorda l'ultima **scelta** — non l'ultimo tema risolto.
///
/// La differenza conta: ricordando la scelta, chi ha lasciato «come il sistema»
/// riparte seguendo il sistema di *oggi*; ricordando il tema risolto,
/// ripartirebbe seguendo quello di ieri sera.
const CACHE = "fub.appearance.theme";

/// La query che il browser risponde per la luce del sistema.
const QUERY_SCURO = "(prefers-color-scheme: dark)";

/// La scelta corrente, così com'è scritta nell'impostazione.
let scelta = "";

/// Chi va avvisato quando il tema effettivo cambia (l'editor: il suo flag
/// `dark` non è un colore e il CSS non lo può cambiare da solo).
let avvisa: (tema: Tema) => void = () => {};

/// Il tema che vale, date la scelta e la luce del sistema.
///
/// Qualunque cosa che non sia `light` o `dark` è «come il sistema»: la stringa
/// vuota (il default dello schema), ma anche un `settings.json` scritto a mano
/// con un valore che non esiste. Un valore ignoto che facesse cadere il tema in
/// un terzo stato sarebbe un file di configurazione capace di rendere l'app
/// illeggibile, e la 0036 ha già deciso che non lo è.
export function temaEffettivo(scelta: unknown, sistemaScuro: boolean): Tema {
  if (scelta === "light" || scelta === "dark") return scelta;
  return sistemaScuro ? "dark" : "light";
}

/// Cosa dice il sistema **adesso**.
///
/// Il ripiego è lo scuro, che è la luce in cui Fub è sempre stato: un motore
/// senza `matchMedia` non deve inaugurare un aspetto che nessuno ha scelto.
function sistemaScuro(): boolean {
  return window.matchMedia?.(QUERY_SCURO).matches ?? true;
}

/// Il tema che la pagina sta portando.
export function temaCorrente(): Tema {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/// Scrive il tema sulla radice, e avvisa chi non può leggerlo dal CSS.
///
/// Sta sull'elemento **radice** e non sul `body` perché è lì che stanno i token
/// (`:root`), e una custom property dichiarata su `<html>` non si ridefinisce
/// da `<body>` senza ripetere l'intero blocco.
function applica(): void {
  const prossimo = temaEffettivo(scelta, sistemaScuro());
  if (prossimo === document.documentElement.dataset.theme) return;
  document.documentElement.dataset.theme = prossimo;
  avvisa(prossimo);
}

/// Rilegge la scelta dall'impostazione, se c'è un vault che possa rispondere.
async function rileggi(): Promise<void> {
  try {
    // Senza filtro per componente: l'id del bundle di core (`fub.core`) è una
    // costante di Rust, e ricopiarla qui creerebbe la seconda metà di una
    // coppia che nessun presidio tiene insieme. La chiave basta a trovarla, e
    // l'elenco intero è la stessa query che il pannello delle impostazioni fa
    // già a ogni apertura.
    const entry = (await impostazioni()).find((e) => e.spec.key === CHIAVE_TEMA);
    if (!entry) return;
    scelta = typeof entry.value === "string" ? entry.value : "";
    localStorage.setItem(CACHE, scelta);
    applica();
  } catch {
    // Nessun vault aperto, o il canale dati che non risponde: si resta su
    // quello che la cache diceva. Un tema è la cosa meno urgente da cui far
    // fallire un avvio.
  }
}

/// Accende il tema: applica subito ciò che si sa, poi insegue le due sorgenti
/// che lo possono cambiare — il sistema e l'impostazione.
export function mountTheme(onChange: (tema: Tema) => void): void {
  try {
    scelta = localStorage.getItem(CACHE) ?? "";
  } catch {
    scelta = "";
  }
  // Prima di registrare l'avviso: chi montiamo dopo (l'editor) legge il tema
  // corrente alla nascita, e avvisarlo di un cambiamento che non ha ancora
  // visto vorrebbe dire chiamarlo prima che esista.
  applica();
  avvisa = onChange;

  // Il sistema che cambia luce mentre l'app è aperta. Riguarda solo chi ha
  // lasciato «come il sistema», e `applica()` lo sa già: se la scelta è
  // esplicita, ricalcola lo stesso valore e non fa niente.
  window.matchMedia?.(QUERY_SCURO).addEventListener("change", applica);

  // L'impostazione che cambia: da questo pannello, da un'altra finestra, da un
  // `settings.json` riscritto sotto. L'evento non porta il valore (§11.1), e
  // quindi si rilegge.
  onEvent("setting_changed", () => void rileggi());
  // E il momento in cui la domanda diventa **rispondibile**: un vault aperto.
  on("vault", () => void rileggi());
}
