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

async function call(base, method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new WebDriverError(response.status, payload.value);
  return payload.value;
}

/// Una sessione: un'app avviata da `tauri-driver`, chiusa con `close()`.
export async function openSession(base, application, { timeoutMs = 120_000 } = {}) {
  const started = performance.now();
  const value = await call(base, "POST", "/session", {
    capabilities: { alwaysMatch: { "tauri:options": { application } } },
  });
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
  const keyActions = (text) => [...text].flatMap((ch) => [{ type: "keyDown", value: ch }, { type: "keyUp", value: ch }]);
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
    /// Tasti veri, uno alla volta, dalla tastiera virtuale del driver.
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
