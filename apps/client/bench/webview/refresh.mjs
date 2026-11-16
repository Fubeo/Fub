// La frequenza dello schermo su cui gira la finestra del banco, e le soglie
// espresse in periodi. Il traguardo è la frequenza piena dello schermo, non i
// 60 Hz: una soglia di `budgets.json` può valere `{ "periodi": k }`, cioè k
// volte il periodo P = 1000/Hz, invece di un numero di ms.
//
// Il periodo lo legge il banco, dal sistema, prima di avviare l'app: l'host
// non ha una porta generica per dirlo, e una IPC nuova solo per il banco non
// serve. L'ordine:
//
// 1. `--hz=N` dalla riga di comando;
// 2. su una sessione Wayland, l'uscita a fuoco del compositor (niri, sway,
//    Hyprland), dove la finestra nuova si apre;
// 3. GDK, lo stesso `gdk_monitor_get_refresh_rate` che conosce l'host, con
//    l'ambiente che avrà l'app: vale se c'è un solo schermo, se tutti hanno
//    la stessa frequenza o se uno è il primario;
// 4. altrimenti 60 Hz, e il referto lo dice. Sotto Xvfb GDK dà 0 Hz: P resta
//    16,7 ms, come in CI.
//
// Il tetto del motore: WebKitGTK 2.54 su Linux disegna al più a 60 Hz
// (62,5 col suo timer di 16 ms), qualunque sia lo schermo. Lo dice la
// mediana del rAF a vuoto (lo scenario F1). Se P < 16 ms e la mediana sta fra
// 15 e 18,5 ms, il tetto c'è e le soglie in periodi valgono a 60 Hz
// (P efficace 16,7 ms) finché il tetto c'è: uno scenario non diventa rosso
// per colpa del motore. Una mediana lontana sia da P sia dai 60 Hz non è il
// tetto: P efficace resta P, e F1 lo segna rosso.
import { execFileSync } from "node:child_process";

/// Il periodo a 60 Hz, in ms.
export const SIXTY_HZ_MS = 1000 / 60;
/// Una frequenza fuori da questo intervallo non è una lettura (Xvfb dà 0).
const MIN_HZ = 20;
const MAX_HZ = 1000;
/// La banda della mediana del rAF a vuoto che vuol dire «tetto dei 60 Hz».
export const CAP_BAND_MS = [15, 18.5];

const valid = (hz) => typeof hz === "number" && Number.isFinite(hz) && hz >= MIN_HZ && hz <= MAX_HZ;
const round = (x, digits = 2) => Math.round(x * 10 ** digits) / 10 ** digits;

/// niri: `niri msg --json focused-output`, frequenza in mHz.
export function parseNiri(text) {
  const output = JSON.parse(text);
  const mode = output?.modes?.[output.current_mode];
  return mode ? { hz: mode.refresh_rate / 1000, name: output.name } : null;
}

/// sway: `swaymsg -t get_outputs -r`, l'uscita a fuoco, frequenza in mHz.
export function parseSway(text) {
  const output = JSON.parse(text).find((o) => o.focused) ?? null;
  return output?.current_mode ? { hz: output.current_mode.refresh / 1000, name: output.name } : null;
}

/// Hyprland: `hyprctl -j monitors`, lo schermo a fuoco, frequenza in Hz.
export function parseHyprland(text) {
  const monitor = JSON.parse(text).find((m) => m.focused) ?? null;
  return monitor ? { hz: monitor.refreshRate, name: monitor.name } : null;
}

/// GDK: una riga per schermo, «mHz primario nome».
export const GDK_SCRIPT = [
  "import gi",
  "gi.require_version('Gdk', '3.0')",
  "from gi.repository import Gdk",
  "d = Gdk.Display.get_default()",
  "for i in range(d.get_n_monitors() if d else 0):",
  "    m = d.get_monitor(i)",
  "    print(m.get_refresh_rate(), int(m.is_primary()), m.get_model() or '?')",
].join("\n");

/// Le righe di `GDK_SCRIPT`: uno schermo, o tutti alla stessa frequenza, o il
/// primario. Più schermi a frequenze diverse senza primario: nessuna scelta
/// (su Wayland GDK non sa dove si aprirà la finestra).
export function parseGdk(text) {
  const monitors = text.trim().split("\n").filter(Boolean).map((line) => {
    const [mhz, primary, ...name] = line.split(" ");
    return { hz: Number(mhz) / 1000, primary: primary === "1", name: name.join(" ") };
  }).filter((m) => valid(m.hz));
  if (monitors.length === 0) return null;
  const rates = new Set(monitors.map((m) => m.hz));
  if (rates.size === 1) return { hz: monitors[0].hz, name: monitors.map((m) => m.name).join(", ") };
  const primary = monitors.find((m) => m.primary);
  if (primary) return { hz: primary.hz, name: primary.name };
  return { hz: null, name: null, ambiguous: monitors.map((m) => `${m.name} ${round(m.hz)} Hz`) };
}

function defaultRun(command, argv, env) {
  return execFileSync(command, argv, { env, encoding: "utf8", timeout: 3_000, stdio: ["ignore", "pipe", "ignore"] });
}

/// La frequenza dello schermo per il banco: `{ hz, periodMs, source, notes }`.
/// `env` è l'ambiente che avrà l'app (con `--x11` senza `WAYLAND_DISPLAY`);
/// `run(comando, argomenti, env)` torna lo stdout o lancia.
export function displayRate({ args = {}, env = process.env, platform = process.platform, run = defaultRun } = {}) {
  const notes = [];
  const done = (hz, source) => ({ hz: round(hz), periodMs: round(1000 / hz), source, notes });
  if (args.hz !== undefined) {
    const hz = Number(args.hz);
    if (!valid(hz)) throw new Error(`--hz=${args.hz} non è una frequenza fra ${MIN_HZ} e ${MAX_HZ} Hz`);
    return done(hz, "--hz");
  }
  if (platform === "linux") {
    const probes = [];
    if (env.WAYLAND_DISPLAY) {
      if (env.NIRI_SOCKET) probes.push(["niri", "niri", ["msg", "--json", "focused-output"], parseNiri]);
      if (env.SWAYSOCK) probes.push(["sway", "swaymsg", ["-t", "get_outputs", "-r"], parseSway]);
      if (env.HYPRLAND_INSTANCE_SIGNATURE) probes.push(["hyprland", "hyprctl", ["-j", "monitors"], parseHyprland]);
    }
    if (env.WAYLAND_DISPLAY || env.DISPLAY) probes.push(["gdk", "python3", ["-c", GDK_SCRIPT], parseGdk]);
    for (const [name, command, argv, parse] of probes) {
      try {
        const read = parse(run(command, argv, env));
        if (read?.ambiguous) notes.push(`GDK vede più schermi a frequenze diverse (${read.ambiguous.join("; ")}): usa --hz=`);
        else if (read && valid(read.hz)) return done(read.hz, `${name}: ${read.name}`);
        else notes.push(`${name}: nessuna frequenza valida`);
      } catch (error) {
        notes.push(`${name}: ${String(error?.message ?? error).split("\n")[0]}`);
      }
    }
  }
  notes.push("frequenza non letta: 60 Hz");
  return done(60, "predefinita");
}

/// Il tetto del motore dalla mediana del rAF a vuoto: `{ capped, periodMs,
/// effectiveMs, rafMedianMs, label }`. `effectiveMs` è il periodo con cui si
/// risolvono le soglie in periodi.
export function engineCap(rafMedianMs, periodMs) {
  if (typeof rafMedianMs !== "number" || !Number.isFinite(rafMedianMs)) {
    return { capped: false, periodMs, effectiveMs: periodMs, rafMedianMs: null, label: "rAF a vuoto non misurato: le soglie in periodi valgono con P dello schermo" };
  }
  const [low, high] = CAP_BAND_MS;
  const capped = periodMs < 16 && rafMedianMs >= low && rafMedianMs <= high;
  const effectiveMs = capped ? round(SIXTY_HZ_MS) : periodMs;
  const label = capped
    ? `tetto del motore: rAF a vuoto ${round(rafMedianMs, 1)} ms con P ${round(periodMs)} ms; le soglie in periodi valgono a 60 Hz finché il tetto c'è`
    : rafMedianMs > 1.1 * periodMs
      ? `il rAF a vuoto (${round(rafMedianMs, 1)} ms) non segue lo schermo (P ${round(periodMs)} ms) e non è il tetto dei 60 Hz`
      : `il rAF a vuoto segue lo schermo (${round(rafMedianMs, 1)} ms, P ${round(periodMs)} ms)`;
  return { capped, periodMs, effectiveMs, rafMedianMs: round(rafMedianMs, 2), label };
}

/// Una voce di `budgets.json` in ms: un numero resta quello, `{ periodi: k }`
/// diventa k × `periodMs`, arrotondato al decimo. `undefined` senza voce.
export function resolveLimit(entry, periodMs) {
  if (entry === undefined || entry === null) return undefined;
  if (typeof entry === "number") return entry;
  if (typeof entry === "object" && typeof entry.periodi === "number") return Math.round(entry.periodi * periodMs * 10) / 10;
  throw new Error(`soglia non valida in budgets.json: ${JSON.stringify(entry)}`);
}

/// Se una sezione di `budgets.json` ha soglie in periodi: allora serve il
/// rAF a vuoto (F1) prima degli altri scenari.
export function hasPeriodLimits(limits) {
  return Object.values(limits ?? {}).some((entry) => typeof entry === "object" && entry !== null);
}
