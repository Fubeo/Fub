// Un client WebDriver minimo, sul protocollo W3C e `fetch`: quanto basta ai
// sei scenari, senza una dipendenza in più nel lockfile. Parla con
// `tauri-driver`, che inoltra a WebKitWebDriver (Linux) o msedgedriver
// (Windows); su macOS un driver per WKWebView non c'è.
const ELEMENT = "element-6066-11e4-a23f-4a5d6b6e9a4b";

export class WebDriverError extends Error {
  constructor(status, value) {
    super(`WebDriver ${status}: ${value?.error ?? ""} ${value?.message ?? ""}`.trim());
    this.name = "WebDriverError";
    this.value = value;
  }
}

async function call(base, method, path, body, signal) {
  const response = await fetch(`${base}${path}`, {
    method,
    signal,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new WebDriverError(response.status, payload.value);
  return payload.value;
}

/// I tasti speciali del W3C (§17.4.2 «Keyboard actions») che servono a chi
/// scrive una sonda. Attenzione ai tasti funzione: `` è **F1**, F2 è
/// ``.
export const KEY = Object.freeze({
  null: "",
  enter: "",
  shift: "",
  control: "",
  alt: "",
  escape: "",
  meta: "",
  f1: "",
  f2: "",
});

/// I modificatori, sinistri e destri: restano premuti finché il testo non
/// finisce, come nell'«Element Send Keys» del W3C.
const MODIFIER_KEYS = new Set(["", "", "", "", "", "", "", ""]);

/// Le azioni di tastiera di un testo, con la semantica di «Element Send Keys»:
/// un modificatore si preme e resta giù per i caratteri che seguono (lo stesso
/// modificatore ripetuto lo alza, `KEY.null` li alza tutti), e alla fine del
/// testo si alzano tutti, nell'ordine inverso. Così `keys(KEY.control + "f")`
/// è Ctrl+F: premere e alzare ogni carattere da solo mandava Ctrl e poi una
/// `f` nuda, e la sonda scriveva una lettera nella nota.
export function keyActions(text) {
  const actions = [];
  const held = [];
  const releaseAll = () => {
    while (held.length > 0) actions.push({ type: "keyUp", value: held.pop() });
  };
  for (const ch of text) {
    if (ch === KEY.null) {
      releaseAll();
    } else if (MODIFIER_KEYS.has(ch)) {
      const at = held.indexOf(ch);
      if (at === -1) {
        held.push(ch);
        actions.push({ type: "keyDown", value: ch });
      } else {
        held.splice(at, 1);
        actions.push({ type: "keyUp", value: ch });
      }
    } else {
      actions.push({ type: "keyDown", value: ch }, { type: "keyUp", value: ch });
    }
  }
  releaseAll();
  return actions;
}

/// Una sessione: un'app avviata da `tauri-driver`, chiusa con `close()`.
/// `signal` interrompe la richiesta della sessione: un'app già morta non si
/// aspetta (`openWithGtkRetry` in `display.mjs`).
export async function openSession(base, application, { timeoutMs = 120_000, signal } = {}) {
  const started = performance.now();
  const value = await call(base, "POST", "/session", {
    capabilities: { alwaysMatch: { "tauri:options": { application } } },
  }, signal);
  const id = value.sessionId;
  const session = `/session/${id}`;
  await call(base, "POST", `${session}/timeouts`, { script: timeoutMs, implicit: 0, pageLoad: timeoutMs });
  // La chiave W3C; un driver che ne usa un'altra (il vecchio `ELEMENT`)
  // ha comunque un solo campo, il riferimento.
  const element = (value, css) => {
    const id = value?.[ELEMENT] ?? value?.ELEMENT ?? Object.values(value ?? {})[0];
    if (typeof id !== "string") throw new Error(`nessun riferimento per «${css}»: ${JSON.stringify(value)}`);
    return id;
  };
  return {
    /// Dalla richiesta della sessione alla sessione pronta, in ms.
    openedIn: performance.now() - started,
    execute: (script, args = []) => call(base, "POST", `${session}/execute/sync`, { script, args }),
    /// `script` riceve gli argomenti e, per ultimo, la funzione da chiamare
    /// col risultato.
    executeAsync: (script, args = []) => call(base, "POST", `${session}/execute/async`, { script, args }),
    async find(css) {
      return element(await call(base, "POST", `${session}/element`, { using: "css selector", value: css }), css);
    },
    async click(css) {
      const id = await this.find(css);
      await call(base, "POST", `${session}/element/${id}/click`, {});
    },
    /// Tasti veri dalla tastiera virtuale del driver; un modificatore nel
    /// testo resta premuto fino alla fine (`keyActions`).
    async keys(text) {
      await this.actions([{ type: "key", id: "tastiera", actions: keyActions(text) }]);
    },
    /// Le azioni W3C così come sono: puntatore (anche `pointerType: "pen"`),
    /// rotella, tastiera.
    actions: (actions) => call(base, "POST", `${session}/actions`, { actions }),
    releaseActions: () => call(base, "DELETE", `${session}/actions`),
    async waitFor(script, args = [], timeoutMs = 60_000) {
      const deadline = performance.now() + timeoutMs;
      for (;;) {
        if (await call(base, "POST", `${session}/execute/sync`, { script, args })) return;
        if (performance.now() > deadline) throw new Error(`attesa scaduta: ${script}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
    /// La finestra com'è, in PNG: per capire uno scenario fallito.
    screenshot: async () => Buffer.from(await call(base, "GET", `${session}/screenshot`), "base64"),
    close: () => call(base, "DELETE", session).catch(() => null),
  };
}

/// Aspetta che il driver risponda a `/status`.
export async function waitForDriver(base, timeoutMs = 30_000) {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    try {
      const status = await call(base, "GET", "/status");
      if (status) return;
    } catch {
      // non ancora in ascolto
    }
    if (performance.now() > deadline) throw new Error(`il driver su ${base} non risponde`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
