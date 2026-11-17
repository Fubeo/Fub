// Il display del banco.
//
// La finestra su una sessione Wayland. Con `WAYLAND_DISPLAY` GTK apre
// la finestra in Wayland, cioè sullo schermo di chi misura, e non nel display di
// Xvfb dove il driver muove il puntatore: S3 allora dà «move target out of
// bounds» (misura del 13 novembre, T46). Il banco si ferma prima di avviare
// l'app, a meno che non si scelga: `--x11` (sotto Xvfb, con la variabile tolta)
// o `--wayland` (per lo schermo vero).
//
// Xvfb senza `-noreset` (#287). Un server X, per difetto, si rigenera quando
// esce il suo ultimo client: sotto il banco l'ultimo client è l'app dello
// scenario appena chiuso, e l'app nuova che si collega mentre il server si
// rigenera non apre il display. GTK allora non parte e l'app muore con
// `GTK_FAILED`. Misurato sul PC fisso con `xdpyinfo` lanciato 10.000 volte di
// fila sotto `xvfb-run`: senza `-noreset` 21 aperture fallite, con `-noreset`
// nessuna.
import { readdirSync, readFileSync } from "node:fs";

/// Il motivo per cui il banco non parte, o `null` se può partire.
export function waylandProblem(env, args) {
  if (!env.WAYLAND_DISPLAY || "x11" in args || "wayland" in args) return null;
  return [
    "WAYLAND_DISPLAY è impostato: GTK aprirebbe la finestra del banco in Wayland,",
    "cioè sullo schermo di chi misura, e non in Xvfb. Il banco non parte.",
    "Per il banco sotto Xvfb aggiungi --x11 e togli la variabile al comando:",
    '  xvfb-run -a -s "-screen 0 1280x800x24 -noreset" env -u WAYLAND_DISPLAY npm run bench:webview -- … --x11',
    "Per misurare sullo schermo vero, su questa sessione Wayland, aggiungi --wayland.",
  ].join("\n");
}

/// La riga con cui l'app muore quando GTK non si inizializza (tao,
/// `platform_impl/linux/event_loop.rs`).
export const GTK_FAILED = "Failed to initialize gtk backend!";

/// Il motivo per cui il display di `env.DISPLAY` può sparire fra un'app e la
/// successiva, o `null`. `commands` sono le righe di comando dei processi
/// (`argv`, per esempio da `commandLines()`): conta l'Xvfb che serve quel
/// display.
export function xvfbResetProblem(env, commands) {
  const number = /^:(\d+)(?:\.\d+)?$/.exec(env.DISPLAY ?? "")?.[1];
  if (number === undefined) return null;
  const xvfb = commands.find((argv) => /(^|\/)Xvfb$/.test(argv[0] ?? "") && argv.includes(`:${number}`));
  if (!xvfb || xvfb.includes("-noreset")) return null;
  return [
    `Xvfb su :${number} gira senza -noreset: quando l'app di uno scenario si chiude il`,
    "display si rigenera, e l'app dopo può non aprirlo («Failed to initialize gtk backend!», #287).",
    "Aggiungi -noreset agli argomenti del server:",
    '  xvfb-run -a -s "-screen 0 1280x800x24 -maxclients 2048 -noreset" …',
  ].join("\n");
}

/// Le righe di comando dei processi della macchina, da `/proc`. Soltanto
/// Linux; altrove nessuna.
export function commandLines() {
  if (process.platform !== "linux") return [];
  const commands = [];
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const argv = readFileSync(`/proc/${name}/cmdline`, "utf8").split("\0").filter(Boolean);
      if (argv.length > 0) commands.push(argv);
    } catch {
      // Un processo già uscito.
    }
  }
  return commands;
}

/// L'app è morta perché GTK non si è inizializzato.
export class GtkFailed extends Error {
  constructor(line) {
    super(line.trim());
    this.name = "GtkFailed";
  }
}

/// Un lettore dello stderr del driver, che l'app eredita: chiama `onLine` per
/// ogni riga che contiene `GTK_FAILED`, anche se arriva spezzata in due pezzi.
export function gtkWatcher(onLine) {
  let rest = "";
  return (chunk) => {
    const lines = (rest + chunk).split("\n");
    rest = lines.pop() ?? "";
    // Una riga senza fine non cresce senza limite: della coda basta quanto
    // può ancora contenere l'inizio del messaggio.
    if (rest.length > 64 * 1024) rest = rest.slice(-GTK_FAILED.length);
    for (const line of lines) if (line.includes(GTK_FAILED)) onLine(line);
  };
}

/// Apre una sessione. Se intanto l'app muore con `GTK_FAILED`, non aspetta il
/// driver (WebKitWebDriver aspetterebbe cinque minuti un'app già morta):
/// interrompe la richiesta, fa ripartire il driver e riprova **una volta**,
/// con un avviso nel log. Al secondo fallimento rilancia `GtkFailed`, dopo aver
/// rimesso in piedi il driver per lo scenario dopo. Ogni altro errore passa
/// com'è, senza nuovi tentativi.
///
/// - `open(signal)`: la richiesta della sessione, che `signal` interrompe;
/// - `watch(onLine)`: iscrive `onLine` alle righe con `GTK_FAILED` e torna la
///   funzione che la disiscrive;
/// - `restart()`: ferma il driver con ciò che ha avviato e lo rimette in ascolto;
/// - `log(text)`: dove va l'avviso.
export async function openWithGtkRetry(label, { open, watch, restart, log }) {
  for (let attempt = 1; ; attempt++) {
    const aborter = new AbortController();
    let unwatch = () => {};
    const died = new Promise((_, fail) => {
      unwatch = watch((line) => fail(new GtkFailed(line)));
    });
    try {
      return await Promise.race([open(aborter.signal), died]);
    } catch (error) {
      if (!(error instanceof GtkFailed)) throw error;
      aborter.abort();
      await restart();
      if (attempt > 1) throw error;
      log(`⚠ ${label}: l'app non ha inizializzato GTK (${error.message}); driver riavviato, un solo nuovo tentativo`);
    } finally {
      unwatch();
    }
  }
}
