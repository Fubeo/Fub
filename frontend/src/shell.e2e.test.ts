// @vitest-environment happy-dom
//
// **I cinque gesti, dall'inizio alla fine** (§17.2): apri un vault, scrivi,
// rinomina, cerca, ripristina.
//
// # Cosa prova questo file, e perché nessun altro lo prova
//
// Gli altri presidi di questa shell provano dei *moduli*, e li provano bene:
// `rules/` è pura, `state/` è isolato, i due pannelli con una regola dentro
// hanno la loro. Ciò che nessuno guarda è il **cablaggio** — che il click su
// una riga apra quel documento, che la battuta successiva arrivi alla porta
// giusta con la base giusta, che una rinomina migri l'identità di ciò che è
// aperto, che una view del backend disegnata dalla shell rimandi la sua azione
// a chi l'ha disegnata. Sono tutte cose che vivono *fra* i moduli, e che oggi
// si scoprivano aprendo l'app.
//
// Qui si monta `main.ts` — il vero punto di montaggio, non una sua imitazione —
// sulla scocca vera (`index.html`), contro l'host finto (`host/finto.ts`). Ciò
// che resta finto è **il di là del confine**, e il §1.3 lo ha reso un file
// solo: è esattamente il modo in cui la
// [decisione 0015](../../docs/decisions/0015-la-forma-della-shell.md) diceva
// che questi giri sarebbero diventati possibili.
//
// # Sette gesti, contati da fuori
//
// I gesti sono **sette** [conta: gesti-della-shell], e il numero è contato da
// `conteggi.mjs` invece che ricordato. Non è pedanteria: la
// [0109](../../docs/decisions/0109-un-conteggio-che-non-si-sa-non-e-un-nome-solo.md)
// ha misurato che *una suite che si svuota in silenzio è indistinguibile da una
// suite verde*, e un file come questo si svuota nel modo più facile che ci sia
// — un `it.skip` messo per sbloccare un giro e mai tolto. Il conto lo vede,
// perché `it.skip(` non è `it(`.
//
// # I limiti, dichiarati qui perché nessuno li deduca
//
// Non è un E2E dell'**app**: il ponte Tauri, la webview e il kernel restano
// fuori (il perché sta in `host/finto.ts`). E non è un presidio di layout: in
// `happy-dom` non c'è né CSS né misura, quindi si asserisce su *cosa* c'è e
// mai su *dove*.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import type { HostFinto } from "./host/finto";

// L'host finto vive in una scatola che `vi.mock` possa vedere: i factory dei
// mock sono issati sopra gli import, quindi non possono chiudere su una
// variabile normale di questo modulo. La scatola sì, perché a leggerla è la
// factory quando il modulo viene chiesto — cioè dopo che il test l'ha riempita.
const scatola = vi.hoisted(() => ({
  host: null as HostFinto | null,
  /// Cosa risponde la modale di conferma del sistema. È l'unica altra cosa che
  /// la shell chiede al di là del confine (§1.3), e negli e2e è un `true`.
  conferma: true,
}));

// Il modulo mimato è **uno solo per tutto il file**, e delega all'host di
// adesso a ogni chiamata. Non è un vezzo: `vi.resetModules()` svuota il
// registro dei moduli ma **non** quello dei mock, quindi una factory che
// restituisse `scatola.host.modulo` verrebbe eseguita una volta sola e ogni
// prova dalla seconda in poi parlerebbe col vault della prima — con la shell
// rimontata a dovere, che è il modo migliore per non accorgersene. È costato
// due giri di misura, e sta scritto qui perché al terzo nessuno lo rifaccia.
vi.mock("./host/ipc", () => {
  const adesso = () => {
    if (!scatola.host) throw new Error("l'host finto non è stato montato");
    return scatola.host.modulo;
  };
  return {
    api: new Proxy(
      {},
      {
        get: (_t, nome: string) => (...args: unknown[]) =>
          (adesso().api as unknown as Record<string, (...a: unknown[]) => unknown>)[nome](...args),
      },
    ),
    onKernelEvent: (handler: (n: unknown) => void) =>
      adesso().onKernelEvent(handler as never),
  };
});

vi.mock("./host/dialog", () => ({
  confirm: () => Promise.resolve(scatola.conferma),
  pickFolder: () => Promise.resolve("/vault"),
}));

const { creaHostFinto, CESTINO_VIEW, specDiProva } = await import("./host/finto");
const grezzo = (await import("../index.html?raw")).default;

/// La scocca vera, rimessa in piedi come la webview la trova.
function montaLaScocca(): void {
  const corpo = /<body[^>]*>([\s\S]*)<\/body>/.exec(grezzo);
  if (!corpo) throw new Error("index.html non ha un body");
  document.body.innerHTML = corpo[1].replace(/<script[\s\S]*?<\/script>/g, "");
}

/// Monta la shell su un vault finto e **aspetta che l'avvio sia finito**.
async function avvia(file: Record<string, string>): Promise<HostFinto> {
  vi.resetModules();
  scatola.conferma = true;
  scatola.host = creaHostFinto({
    file,
    view: [specDiProva(CESTINO_VIEW, "left_sidebar")],
  });
  montaLaScocca();
  const main = await import("./main");
  await main.avvio;
  await riposa();
  return scatola.host;
}

/// Lascia girare ciò che è stato messo in coda: la shell fa quasi tutto con
/// delle promesse, e un gesto ne accende sempre qualcuna che il gesto non
/// attende.
async function riposa(giri = 6): Promise<void> {
  for (let i = 0; i < giri; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

/// Aspetta che una condizione diventi vera, o fallisce dicendo cosa aspettava.
/// Serve ai due pezzi che hanno un timer loro — il debounce della ricerca e
/// quello del salvataggio — e a nient'altro.
async function attendi(cosa: string, cond: () => boolean, entro = 2000): Promise<void> {
  const scadenza = Date.now() + entro;
  while (Date.now() < scadenza) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`non è mai successo: ${cosa}`);
}

function righeDelleNote(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("#file-list .row.note")];
}

function riga(nome: string): HTMLElement {
  const trovata = righeDelleNote().find((r) => r.textContent?.trim() === nome);
  if (!trovata) {
    const viste = righeDelleNote().map((r) => r.textContent?.trim());
    throw new Error(`nell'albero non c'è «${nome}», ci sono: ${viste.join(", ")}`);
  }
  return trovata;
}

/// Apre il menu contestuale su una riga e sceglie la voce con quell'etichetta.
async function menuContestuale(su: HTMLElement, voce: string): Promise<void> {
  su.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  const menu = document.getElementById("context-menu");
  if (!menu) throw new Error("il menu contestuale non si è aperto");
  const bottoni = [...menu.querySelectorAll("button")];
  const scelto = bottoni.find((b) => b.textContent === voce);
  if (!scelto) {
    throw new Error(`nel menu non c'è «${voce}», ci sono: ${bottoni.map((b) => b.textContent)}`);
  }
  scelto.click();
  await riposa();
}

/// Il testo dell'editor, letto dal DOM di CodeMirror come lo legge chi guarda.
function testoAVideo(): string {
  const righe = [...document.querySelectorAll(".cm-content .cm-line")];
  return righe.map((r) => r.textContent).join("\n");
}

const VAULT = {
  "Benvenuto.md": "Il primo documento di questo vault.\n",
  "note/Riunione.md": "Appunti della riunione di martedì.\n",
  "note/Spesa.md": "pane, latte, arance\n",
};

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("apri un vault", () => {
  it("la finestra parte sul vault iniziale, con l'albero e la prima nota aperta", async () => {
    const host = await avvia(VAULT);

    // Il vault che l'host propone all'avvio, non uno scelto da qui.
    expect(document.querySelector("#vault-path")?.textContent).toBe("/vault");
    expect(righeDelleNote().map((r) => r.textContent?.trim())).toEqual(["Benvenuto"]);
    expect(testoAVideo()).toContain("Il primo documento");

    // **Con una finestra da uno** (§14.4): l'apertura non chiede il vault
    // intero per aprire una nota. È la specie di fatto che si vede solo da
    // questa parte del confine, e che guardando lo schermo non si vede.
    const perLaPrimaNota = host
      .aPorta("queryIndex")
      .map((c) => c.args[0] as { kind: string; page?: { limit: number } | null })
      .filter((q) => q.kind === "entries" && q.page?.limit === 1);
    expect(perLaPrimaNota.length).toBeGreaterThan(0);
  });

  it("una cartella si apre e mostra ciò che ha dentro, non prima", async () => {
    await avvia(VAULT);
    expect(righeDelleNote().map((r) => r.textContent?.trim())).toEqual(["Benvenuto"]);

    const cartella = [...document.querySelectorAll<HTMLElement>("#file-list .row.folder")].find(
      (r) => r.textContent?.includes("note"),
    );
    expect(cartella).toBeDefined();
    cartella?.click();
    await attendi("la cartella si apre", () => righeDelleNote().length === 3);
    expect(righeDelleNote().map((r) => r.textContent?.trim()).sort()).toEqual([
      "Benvenuto",
      "Riunione",
      "Spesa",
    ]);
  });
});

describe("scrivi", () => {
  it("ciò che si batte arriva al disco, e discende dalla revisione che si era letta", async () => {
    const host = await avvia(VAULT);
    const letture = host.aPorta("readDocument");
    const letta = letture[letture.length - 1];
    expect(letta?.args[0]).toBe("Benvenuto.md");

    battiNellEditor("Una riga nuova.");
    await attendi("il salvataggio parte", () => host.aPorta("writeDocument").length > 0);

    const scritta = host.aPorta("writeDocument")[0];
    expect(scritta.args[0]).toBe("Benvenuto.md");
    expect(String(scritta.args[1])).toContain("Una riga nuova.");
    // **La guardia della 0092**: si scrive dichiarando da cosa si partiva, e
    // ciò da cui si partiva è la revisione che la lettura ha risposto — non un
    // `dictated` che copre in silenzio ciò che c'era.
    expect(scritta.args[2]).toEqual({ kind: "descends_from", value: "r1" });
    expect(host.file()["Benvenuto.md"]).toContain("Una riga nuova.");
  });
});

describe("rinomina", () => {
  it("il nome pagina cambia, cartella ed estensione restano, e la nota aperta segue", async () => {
    const host = await avvia(VAULT);

    await menuContestuale(riga("Benvenuto"), "Rinomina");
    const campo = document.querySelector<HTMLInputElement>("#file-list input");
    if (!campo) throw new Error("la riga non è diventata un campo");
    campo.value = "Indice";
    campo.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await riposa();
    await attendi("la rinomina arriva al kernel", () => host.aPorta("invokeCommand").length > 0);
    await riposa();

    const invocato = host.aPorta("invokeCommand")[0];
    expect(invocato.args[0]).toBe("note.rename");
    expect(invocato.args[1]).toEqual({ doc: "Benvenuto.md", to: "Indice.md" });
    expect(Object.keys(host.file())).toContain("Indice.md");

    // L'identità del documento aperto la migra **l'evento**, non il chiamante
    // (§13.1): il buffer che si salverà dopo deve avere il nome nuovo, o la
    // prima battuta successiva ricreerebbe la nota vecchia.
    await attendi("l'albero si riscrive", () =>
      righeDelleNote().some((r) => r.textContent?.trim() === "Indice"),
    );
    battiNellEditor("dopo la rinomina");
    await attendi("il salvataggio parte", () => host.aPorta("writeDocument").length > 0);
    const scritta = host.aPorta("writeDocument")[0];
    expect(scritta.args[0]).toBe("Indice.md");
    // **E col nome nuovo segue anche la base.** Il path da solo non basta a
    // provarlo: senza la migrazione del buffer, la battuta dopo la rinomina ne
    // fa nascere uno nuovo — che scrive sul path giusto, ma `dictated`, cioè
    // coprendo qualunque cosa ci sia senza guardare. Misurato: togliendo la
    // migrazione, un presidio che guardasse solo il path resterebbe **verde**.
    expect(scritta.args[2]).toEqual({ kind: "descends_from", value: "r1" });
  });
});

describe("cerca", () => {
  it("la casella trova, e il risultato apre il documento", async () => {
    const host = await avvia(VAULT);
    const casella = document.querySelector<HTMLInputElement>("#search-input");
    if (!casella) throw new Error("la casella di ricerca non c'è");

    casella.value = "arance";
    casella.dispatchEvent(new Event("input", { bubbles: true }));
    await attendi(
      "i risultati arrivano",
      () => document.querySelectorAll("#search-results li").length > 0,
    );

    const risultati = [...document.querySelectorAll<HTMLElement>("#search-results li")];
    expect(risultati.map((r) => r.textContent)).toHaveLength(1);
    expect(risultati[0].textContent).toContain("Spesa");

    risultati[0].click();
    await attendi("il documento cercato si apre", () =>
      host.aPorta("readDocument").some((c) => c.args[0] === "note/Spesa.md"),
    );
    await riposa();
    expect(testoAVideo()).toContain("pane, latte, arance");
  });
});

describe("ripristina", () => {
  it("una nota cestinata torna dalla view del cestino, che la shell non conosce", async () => {
    const host = await avvia(VAULT);

    await menuContestuale(riga("Benvenuto"), "Elimina");
    await attendi("la nota è nel cestino", () => host.cestino().length === 1);
    expect(Object.keys(host.file())).not.toContain("Benvenuto.md");

    // Il cestino è un `ViewProvider`: la shell disegna l'albero che riceve e
    // rimanda l'azione a chi l'ha disegnato, **senza sapere cosa faccia**. È il
    // percorso di un plugin, ed è il solo dei cinque gesti che non passa da una
    // riga di questo bundle.
    await attendi("la view del cestino si disegna", () => vociDelCestino().length === 1);
    vociDelCestino()[0].click();
    await attendi("la nota è tornata", () => Object.keys(host.file()).includes("Benvenuto.md"));

    const azioni = host.aPorta("viewAction");
    const azione = azioni[azioni.length - 1];
    expect(azione?.args[0]).toBe(CESTINO_VIEW);
    expect(azione?.args[3]).toBe("restore");
  });
});

function vociDelCestino(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("#views-left .ui-list-item")];
}

/// Batte del testo nell'editor.
///
/// La view di CodeMirror si ripesca dal DOM con `findFromDOM`, che è **come la
/// trova la tastiera di questa shell** (`ui/keyboard.ts`): il tipo `Editor` non
/// la espone, e allargarlo per un banco di prova vorrebbe dire che il resto
/// della shell può prenderla — è la stessa scelta di `editor/editor.test.ts`.
/// Un `beforeinput` finto non basterebbe: in `happy-dom` non c'è
/// `execCommand`, e l'evento che il browser vero traduce in una modifica qui
/// non lo traduce nessuno.
function battiNellEditor(testo: string): void {
  const scocca = document.querySelector<HTMLElement>(".cm-editor");
  const view = scocca?.parentElement ? EditorView.findFromDOM(scocca.parentElement) : null;
  if (!view) throw new Error("l'editor non è montato");
  view.dispatch({ changes: { from: view.state.doc.length, insert: testo } });
}

describe("una rinomina che questa finestra non ha chiesto", () => {
  it("porta con sé il buffer sporco, e il salvataggio in attesa con lui", async () => {
    // Un `mv` da terminale, un'altra applicazione, un sync: la rinomina arriva
    // come evento mentre qui c'è del testo battuto e non ancora salvato. È il
    // caso che `renameDoc` non produce mai — chi rinomina da questa finestra
    // mette in salvo i buffer prima di chiedere — e quindi il solo modo di
    // provarlo è dall'evento.
    const host = await avvia(VAULT);
    battiNellEditor("testo non ancora salvato");
    host.rinominaDaFuori("Benvenuto.md", "Fuori.md");

    await attendi("il salvataggio in attesa arriva", () => host.aPorta("writeDocument").length > 0);
    const scritta = host.aPorta("writeDocument")[0];
    expect(scritta.args[0]).toBe("Fuori.md");
    expect(String(scritta.args[1])).toContain("testo non ancora salvato");
    // E il path vecchio **non** rinasce: era il difetto gemello, e sarebbe
    // passato per una nota duplicata invece che per una battuta persa.
    expect(Object.keys(host.file())).not.toContain("Benvenuto.md");
  });
});
