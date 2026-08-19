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
// # Ventuno gesti, contati da fuori
//
// I gesti sono **ventuno** [conta: gesti-della-shell], e il numero è contato da
// `conteggi.mjs` invece che ricordato. Non è pedanteria: la
// [0109](../../docs/decisions/0109-un-conteggio-che-non-si-sa-non-e-un-nome-solo.md)
// ha misurato che *una suite che si svuota in silenzio è indistinguibile da una
// suite verde*, e un file come questo si svuota nel modo più facile che ci sia
// — un `.skip` messo per sbloccare un giro e mai tolto. La prima forma del
// conto leggeva `^  it(`, cioè **il rientro di oggi**: misurato, un `.skip` sui
// sei `describe`, che stanno in colonna zero, lasciava il conto a sette e
// `npm run test` verde con `7 skipped`. Adesso il rientro non conta e un
// `.skip`/`.only`/`.todo` — su un `describe` o su un `it` — azzera il conto:
// una suite che si può *non eseguire* non si scala, si spegne rumorosamente.
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
import type { KernelNotice, SettingEntry, CommandSpec } from "./host/contract";
import { SHELL_KEYS } from "./ui/shell-keys.generated";

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
    allaChiusura: (prima: () => Promise<void>) => adesso().allaChiusura(prima),
    // `finestra` è il manico della titlebar custom (§Fase 1): in test non
    // tocchiamo finestre vere, e i metodi sono tutti no-op o ritornano
    // valori neutri.
    finestra: {
      minimizza: async () => {},
      alternaMassimizza: async () => {},
      chiudi: async () => {},
      eMassimizzata: async () => false,
      onCambio: async () => async () => {},
    },
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

/// Monta la shell su un vault finto **senza aspettare l'avvio**, con le porte
/// nominate tenute in volo.
///
/// I freni vanno messi prima di importare `main.ts`, perché l'avvio parte
/// all'import: è l'unico modo di guardare *dentro* l'apertura di un vault
/// invece che a cose fatte. Chi non ne ha bisogno usa `avvia`.
async function monta(
  file: Record<string, string>,
  impostazioni: SettingEntry[] = [],
  radice: string | null | undefined = undefined,
  freni: string[] = [],
  avviso: KernelNotice | null = null,
  comandi: CommandSpec[] = [],
): Promise<{ host: HostFinto; avvio: Promise<void>; sblocca: Map<string, () => void> }> {
  vi.resetModules();
  scatola.conferma = true;
  const host = creaHostFinto({
    file,
    view: [specDiProva(CESTINO_VIEW, "left_sidebar")],
    impostazioni,
    radice,
    avvisoDiSessione: avviso,
    comandi,
  });
  scatola.host = host;
  const sblocca = new Map(freni.map((p) => [p, host.frena(p)]));
  montaLaScocca();
  const main = await import("./main");
  return { host, avvio: main.avvio, sblocca };
}

/// Monta la shell su un vault finto e **aspetta che l'avvio sia finito**.
async function avvia(
  file: Record<string, string>,
  impostazioni: SettingEntry[] = [],
  radice: string | null | undefined = undefined,
  avviso: KernelNotice | null = null,
  comandi: CommandSpec[] = [],
): Promise<HostFinto> {
  const { host, avvio } = await monta(file, impostazioni, radice, [], avviso, comandi);
  await avvio;
  await riposa();
  return host;
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
  return [...document.querySelectorAll<HTMLElement>("#file-list .tree-row.note")];
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

/// Una riga di impostazione che è la scorciatoia di un comando **della shell**,
/// come la manda il backend: di macchina, col dichiarato per default.
function scorciatoia(id: keyof typeof SHELL_KEYS): SettingEntry {
  return {
    spec: {
      key: `keys.${id}`,
      label: id,
      description: "",
      group: "",
      scope: "machine",
      kind: { kind: "text", default: SHELL_KEYS[id] ?? "" },
      program_writable: false,
    },
    value: SHELL_KEYS[id] ?? "",
    source: "default",
  };
}

/// Apre le impostazioni sulla scheda delle scorciatoie e rende il campo della
/// riga che porta quel titolo.
async function campoDellaScorciatoia(titolo: string): Promise<HTMLInputElement> {
  document.querySelector<HTMLButtonElement>("#open-settings")!.click();
  await riposa();
  document.querySelector<HTMLButtonElement>('#settings-tabs button[data-scheda="scorciatoie"]')!
    .click();
  await riposa();
  const righe = [...document.querySelectorAll<HTMLElement>("#settings-body .setting-row")];
  const riga = righe.find((r) => r.querySelector("label")?.textContent === titolo);
  if (!riga) {
    const viste = righe.map((r) => r.querySelector("label")?.textContent);
    throw new Error(`fra le scorciatoie non c'è «${titolo}», ci sono: ${viste.join(", ")}`);
  }
  const campo = riga.querySelector("input");
  if (!campo) throw new Error(`la scorciatoia «${titolo}» è di sola lettura: non ha un campo`);
  return campo;
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
    // **Le domande che nessun dato lega partono insieme.** Aprire un vault
    // costava otto andate e ritorno sull'IPC in fila — quattro caricatori di
    // stato (`caricaLayout` ne fa due di suo) e tre elenchi del kernel — per
    // otto risposte che non si leggono a vicenda. Adesso sono due attese.
    //
    // Il conto delle chiamate non lo vedrebbe: sono le stesse otto in tutti e
    // due i casi. Il predicato è l'**attesa**, e si costruisce coi freni
    // dell'host finto invece di sperarla: si tiene in volo la risposta di una
    // porta e si guarda chi è già partito. Rosso con la forma di prima:
    // `viewState` era chiesta una volta sola, e `listCommands` mai.
    const { host, avvio, sblocca } = await monta(VAULT, [], undefined, [
      "viewState",
      "listViews",
    ]);
    await riposa();
    expect(host.aPorta("viewState").map((c) => c.args[0])).toEqual([
      "layout",
      "mode",
      "expanded",
      "activeSpace",
    ]);

    sblocca.get("viewState")!();
    await riposa();
    expect(host.aPorta("listViews")).toHaveLength(1);
    expect(host.aPorta("listCommands")).toHaveLength(1);

    sblocca.get("listViews")!();
    await avvio;
    await riposa();

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

    const cartella = [...document.querySelectorAll<HTMLElement>("#file-list .tree-row.folder")].find(
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

describe("due salvataggi della stessa nota", () => {
  it("non si accavallano: chi flussa non ne fa partire un secondo", async () => {
    // Il difetto 0030, **costruito** e non aspettato. La prima stesura di questo
    // banco batteva due volte e sperava che i due salvataggi si sovrapponessero:
    // passava verde anche togliendo la coda, perché il debounce di 400 ms li
    // metteva in fila da sé. Non provava niente, ed è stato quel verde a dire
    // dove la finestra è davvero.
    //
    // È qui: `flushPendingSave` — che parte a ogni cambio documento, a ogni
    // rinomina, a ogni azione di view che scrive — chiama `saveDoc` **subito**,
    // e il `clearTimeout` che fa prima non richiama indietro un salvataggio che
    // il timer ha già fatto partire. Senza coda erano due scritture in volo con
    // la **stessa** `base` letta tutte e due prima, e la seconda si prendeva un
    // `conflict` dal kernel su un file che aveva toccato solo l'utente.
    const host = await avvia(VAULT);

    const sblocca = host.frena("writeDocument");
    battiNellEditor("Prima battuta.");
    await attendi("la prima scrittura parte", () => host.aPorta("writeDocument").length === 1);

    // Il gesto vero che flussa: si apre un'altra nota mentre la scrittura è
    // ancora in volo. Non si aspetta — `openDocument` è ferma dentro il flush,
    // che è ferma dentro la scrittura frenata, ed è esattamente il momento.
    const cartella = document.querySelector<HTMLElement>("#file-list .tree-row.folder");
    cartella?.click();
    await attendi("la cartella si apre", () => righeDelleNote().length === 3);
    void riga("Riunione").click();
    await riposa();

    // **Il momento che conta.** Senza la coda qui le scritture sono due.
    expect(host.aPorta("writeDocument").length).toBe(1);

    sblocca();
    await attendi("la nota si apre", () => host.aPorta("readDocument").length > 1);
    await riposa();

    // Una scrittura sola, e nessun conflitto: il flush ha aspettato quella in
    // volo invece di affiancarle una gemella con la base di prima.
    expect(host.aPorta("writeDocument").length).toBe(1);
    expect(host.file()["Benvenuto.md"]).toContain("Prima battuta.");
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

describe("chiudere la finestra col ritardo che corre", () => {
  /// I due ritardi della shell — 400 ms il salvataggio, un secondo la bozza —
  /// non hanno un dopo quando la finestra si chiude, e non lo aveva nessuno:
  /// `RunEvent::Exit` di `fub-app` chiude gli indici quando la webview sta già
  /// morendo, e ciò che era in RAM non lo chiedeva più nessuno (difetto 0205).
  ///
  /// I banchi non aspettano il ritardo: chiudono **mentre corre**, che è
  /// esattamente il caso, e guardano cos'è arrivato all'host.
  it("l'ultima battuta va sul disco invece di sparire", async () => {
    const host = await avvia(VAULT);
    battiNellEditor("l'ultima riga prima di chiudere");

    await host.chiudi();

    // Il testo battuto si aggiunge in fondo alla nota, quindi ciò che parte per
    // il disco è **tutto** il documento: si guarda dentro, non uguale.
    const scritte = host.aPorta("writeDocument").map((c) => String(c.args[1]));
    expect(
      scritte.join("\n--- e poi ---\n"),
      "la finestra si è chiusa mentre il ritardo del salvataggio correva: " +
        "l'ultima battuta non è arrivata al disco",
    ).toContain("l'ultima riga prima di chiudere");
  });

  /// L'altra metà, e la ragione per cui la chiusura non chiede conferma: se il
  /// disco rifiuta, il testo deve restare **nella bozza**, che è la rete tesa
  /// apposta sotto questo caso (§15.2).
  ///
  /// La domanda qui non è «la bozza c'è» — il ramo di fallimento di `saveDoc` la
  /// scrive comunque — ma **se la chiusura l'ha aspettata**: una scrittura
  /// lanciata e non attesa, in questa riga, corre contro la distruzione della
  /// finestra, e chi arriva secondo non arriva. Quindi la bozza si tiene in volo
  /// e si guarda se la chiusura è già finita senza di lei.
  it("la chiusura aspetta la bozza, invece di lanciarla e andarsene", async () => {
    const host = await avvia(VAULT);
    battiNellEditor("la riga che il disco non vuole");
    const ripara = host.guasta("writeDocument", "disco pieno");
    const sblocca = host.frena("saveDraft");

    let chiusa = false;
    const chiusura = host.chiudi().then(() => {
      chiusa = true;
    });
    await riposa();

    const bozze = host.aPorta("saveDraft").map((c) => String(c.args[1]));
    expect(
      bozze.join("\n--- e poi ---\n"),
      "il salvataggio è fallito chiudendo e nessuno ha scritto la bozza: " +
        "l'ultima battuta non è in nessuno dei due posti",
    ).toContain("la riga che il disco non vuole");
    expect(
      chiusa,
      "la finestra si è chiusa mentre la bozza era ancora in volo: la battuta " +
        "che il disco ha rifiutato corre contro la distruzione della webview",
    ).toBe(false);

    sblocca();
    await chiusura;
    ripara();
  });
});

describe("le bozze di crash che smettono di arrivare sul disco", () => {
  /// Il buffer di crash (§15.2) è una rete: gira di fianco al lavoro vero e non
  /// racconta i propri inciampi, per la ragione scritta accanto a `writeDraft` —
  /// un avviso per ogni bozza non scritta insegnerebbe a ignorare gli avvisi.
  ///
  /// Ciò che invece va detto è il **passaggio**: un vault in sola lettura, un
  /// disco pieno, una share caduta spengono la rete mentre chi scrive continua a
  /// credere di averla, e lo scopre al riavvio dopo il crash, cioè quando non
  /// può più farci niente (difetto 0209). Le due metà si guardano insieme,
  /// perché sono l'una il limite dell'altra: **lo dice**, e **lo dice una volta
  /// sola** — il debounce ci riprova a ogni battuta, e una riga per tentativo
  /// sarebbe di nuovo il rumore che il silenzio voleva evitare.
  it("lo dicono la prima volta, e non a ogni tentativo", async () => {
    const host = await avvia(VAULT);
    const { avvisiRecenti } = await import("./ui/notify");
    const cieche = () =>
      avvisiRecenti().filter((a) => a.testo.includes("non arriva più sul disco"));
    // Il vault diventa di sola lettura sotto i piedi: la nota non si salva e la
    // bozza nemmeno. Il primo guasto è ciò che porta la bozza al disco senza
    // aspettare il secondo — `scriviBuffer`, fallendo, la scrive subito.
    const riparaDisco = host.guasta("writeDocument", "vault in sola lettura");
    const riparaBozza = host.guasta("saveDraft", "vault in sola lettura");

    battiNellEditor("la prima riga");
    await attendi("la prima bozza tentata", () => host.aPorta("saveDraft").length >= 1);
    expect(
      cieche().length,
      "le bozze non arrivano più sul disco e nessuno l'ha detto: la rete di " +
        "sicurezza è spenta mentre chi scrive crede di averla",
    ).toBe(1);

    battiNellEditor(" e la seconda");
    await attendi("la seconda bozza tentata", () => host.aPorta("saveDraft").length >= 2);
    expect(
      cieche().length,
      "una riga di avviso per ogni bozza tentata: è il rumore che insegna a " +
        "ignorare gli avvisi",
    ).toBe(1);

    // E la terza metà, senza la quale la prima diventa «lo dice una volta e poi
    // mai più»: una share che va e viene se ne va più di una volta, e la
    // seconda caduta è una notizia come la prima. La nota continua a non
    // salvarsi — è ciò che porta la bozza al disco — ma la bozza sì, e con lei
    // il silenzio riparte da capo.
    riparaBozza();
    battiNellEditor(" con la rete tornata");
    await attendi("la bozza scritta davvero", () => host.aPorta("saveDraft").length >= 3);
    host.guasta("saveDraft", "la share se n'è andata di nuovo");
    battiNellEditor(" e la rete di nuovo caduta");
    await attendi("la bozza tentata da capo", () => host.aPorta("saveDraft").length >= 4);
    expect(
      cieche().length,
      "la rete è caduta due volte e l'ha detto una: dopo il primo guasto il " +
        "canale resta muto per sempre",
    ).toBe(2);

    riparaDisco();
  });
});

describe("le bozze e il salvataggio vanno in fila", () => {
  /// `writeDraft`/`dropDraft` chiamano gli IPC `save_draft`/`discard_draft`
  /// dalla stessa `Coda` che serializza i salvataggi di quel buffer, e non per
  /// conto loro: senza fila, un `discard_draft` può arrivare al kernel prima
  /// di un `save_draft` già in volo, e la bozza stantia sopravvive al buffer
  /// pulito — al riavvio la si ripropone sopra contenuto buono.
  ///
  /// La corsa la scrive il banco, non la spera: `frena` tiene lo `save_draft`
  /// in volo finché non lo si libera, e si guarda cosa parte e in che ordine.
  it("un discard non scavalca uno save_draft in volo", async () => {
    const host = await avvia(VAULT);
    // Metto in volo uno save_draft e lo tengo fermo. Parte subito, perché il
    // salvataggio fallendo lo scrive senza aspettare il debounce di un secondo.
    const riparaDisco = host.guasta("writeDocument", "disco pieno");
    const sbloccaBozza = host.frena("saveDraft");
    battiNellEditor("testo che il disco rifiuta");
    await attendi(
      "la bozza parte dopo il salvataggio fallito",
      () => host.aPorta("saveDraft").length === 1,
    );
    // Lo save_draft è in volo, trattenuto dal freno.

    // Riparo il disco e batto ancora: il salvataggio riuscirebbe e, pulendo
    // il buffer, scatenerebbe il discard. Senza fila il discard partiva subito
    // — mentre lo save_draft era ancora in volo.
    riparaDisco();
    battiNellEditor(" e adesso il disco lo prende");
    // Sotto la fila il secondo salvataggio resta in coda dietro lo save_draft
    // in volo, e il suo discard non parte; senza fila partiva subito — mentre
    // lo save_draft era ancora in volo. `attendi` fallisce se la condizione non
    // si avvera entro il debounce, ed è l'esito giusto: il discard non deve
    // partire. Si ribalta l'eccezione in «non partito».
    let discardInVolo = true;
    try {
      await attendi(
        "il discard NON parte mentre save_draft è in volo",
        () => host.aPorta("discardDraft").length > 0,
        700,
      );
    } catch {
      discardInVolo = false;
    }
    expect(
      discardInVolo,
      "il discard è partito mentre lo save_draft era ancora in volo: le bozze " +
        "non vanno in fila col salvataggio",
    ).toBe(false);

    // Libero lo save_draft: il discard ha il suo turno, e gli arriva DOPO.
    sbloccaBozza();
    await attendi(
      "il discard parte dopo lo save_draft",
      () => host.aPorta("discardDraft").length === 1,
    );
    const primaBozza = host.chiamate.findIndex((c) => c.porta === "saveDraft");
    const dopoScarto = host.chiamate.findIndex((c) => c.porta === "discardDraft");
    expect(
      dopoScarto,
      "lo save_draft è arrivato al kernel dopo il discard: l'ordine non è FIFO",
    ).toBeGreaterThan(primaBozza);
  });

  /// L'altra metà di una fila che non si avvelena: uno `save_draft` rifiutato
  /// non deve fermare ciò che viene dopo. Il rigetto è inghiottito dentro
  /// `writeDraft` (la singola bozza non racconta i propri inciampi), e la
  /// `Coda` prosegue comunque — ma se così non fosse, il discard successivo
  /// non partirebbe mai, ed è ciò che si guarda.
  it("uno save_draft rifiutato non avvelena la fila", async () => {
    const host = await avvia(VAULT);
    // Anche la bozza viene rifiutata: save_draft rigetta.
    const riparaDisco = host.guasta("writeDocument", "disco pieno");
    const riparaBozza = host.guasta("saveDraft", "disco pieno");
    battiNellEditor("testo che né il disco né la bozza accettano");
    await attendi(
      "il primo save_draft rifiutato parte",
      () => host.aPorta("saveDraft").length === 1,
    );

    // Se il rigetto avvelenasse la coda, ciò che viene dopo non partirebbe mai.
    riparaDisco();
    riparaBozza();
    battiNellEditor(" e invece tutto riparte");
    // Il salvataggio riesce → pulisce il buffer → discard della bozza. Che la
    // fila sia viva dopo il rifiuto lo dice il fatto che il discard arrivi.
    await attendi(
      "il discard parte dopo lo save_draft rifiutato",
      () => host.aPorta("discardDraft").length === 1,
    );
    expect(
      host.aPorta("discardDraft").length,
      "il discard non è partito: la fila si è avvelenata al save_draft rifiutato",
    ).toBe(1);
  });
});

describe("spostare un file col testo non ancora sul disco", () => {
  /// Il gesto è la rinomina, e ciò che si guarda è **se parte**.
  ///
  /// `flushPendingSave` esiste per una ragione sola: il kernel, muovendo un
  /// file, riscrive i wikilink entranti di file di terzi, e un buffer rimasto
  /// sporco li ricopre col testo di prima al salvataggio successivo. La
  /// funzione però non alzava mai — un salvataggio fallito lo dice il buffer,
  /// che resta sporco — quindi chi la chiamava proseguiva identico che i byte
  /// fossero sul disco o no: una precondizione di cui nessuno leggeva l'esito
  /// (difetto 0206).
  it("la rinomina non parte, e lo dice", async () => {
    const host = await avvia(VAULT);
    battiNellEditor("testo che il disco rifiuta");
    const ripara = host.guasta("writeDocument", "disco pieno");

    await menuContestuale(riga("Benvenuto"), "Rinomina");
    const campo = document.querySelector<HTMLInputElement>("#file-list input");
    if (!campo) throw new Error("la riga non è diventata un campo");
    campo.value = "Indice";
    campo.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await riposa(20);

    const rinomine = host.aPorta("invokeCommand").filter((c) => c.args[0] === "note.rename");
    expect(
      rinomine,
      "il file si è mosso mentre il testo battuto era solo in RAM: la " +
        "riscrittura dei wikilink del kernel finirà sotto il salvataggio dopo",
    ).toEqual([]);
    expect(Object.keys(host.file())).toContain("Benvenuto.md");
    // E chi guarda lo sa: il rifiuto è una frase, non un gesto che non fa niente.
    expect(document.body.textContent).toContain("Benvenuto.md non è sul disco");

    ripara();
  });

  /// L'altra metà: `convertToFolder` sposta il file esattamente come la
  /// rinomina — è una rinomina — e non metteva in salvo niente affatto.
  it("la conversione in cartella mette in salvo prima di muovere", async () => {
    const host = await avvia(VAULT);
    battiNellEditor("battuta prima di convertire");

    await menuContestuale(riga("Benvenuto"), "Converti in cartella");
    await riposa(20);

    const scrittura = host.chiamate.findIndex((c) => c.porta === "writeDocument");
    const mossa = host.chiamate.findIndex(
      (c) => c.porta === "invokeCommand" && c.args[0] === "note.rename",
    );
    expect(mossa, "la conversione non è arrivata al kernel").toBeGreaterThan(-1);
    expect(
      scrittura,
      "il file è stato mosso senza mettere in salvo il buffer: il testo battuto " +
        "è ancora solo in RAM mentre il kernel riscrive i wikilink",
    ).toBeGreaterThan(-1);
    expect(scrittura).toBeLessThan(mossa);
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

describe("riconfigura una scorciatoia", () => {
  it("una scorciatoia della shell si cambia dal pannello, e da lì risponde la nuova", async () => {
    // L'ottavo gesto, e il primo che attraversa il pannello delle impostazioni.
    // È la casella che la 0090 aveva trasferito alla §16.3: la chiave
    // `keys.shell.*` la dichiara il bundle di core ed è di **macchina**, perché
    // un comando di shell esiste prima di ogni vault. Qui il gesto è quello che
    // l'utente fa — apri le impostazioni, vai alle scorciatoie, scrivi una
    // combinazione — e ciò che si asserisce è che la tastiera la onori.
    const host = await avvia(VAULT, [scorciatoia("shell.palette")]);

    const campo = await campoDellaScorciatoia("Apri la palette dei comandi");
    expect(campo.value).toBe(SHELL_KEYS["shell.palette"]);
    campo.value = "Mod-Alt-p";
    campo.dispatchEvent(new Event("change", { bubbles: true }));
    await riposa();

    // È arrivata alla porta con la chiave giusta: senza questa riga il gesto
    // potrebbe scrivere la chiave di un altro comando e sembrare a posto.
    const scritte = host.aPorta("setSetting");
    const scritta = scritte[scritte.length - 1];
    expect(scritta?.args[0]).toBe("keys.shell.palette");
    expect(scritta?.args[1]).toBe("Mod-Alt-p");

    // Il pannello intrappola il fuoco, quindi si chiude prima di premere —
    // come fa chi ha finito di configurare.
    document.querySelector<HTMLButtonElement>("#settings-close")!.click();
    await riposa();

    // La combinazione nuova apre la palette, premuta sul documento come da un
    // browser: è la riga che dice che il giro è chiuso — scritta, riletta, e
    // onorata senza riavviare niente.
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "p", ctrlKey: true, altKey: true }),
    );
    await riposa();
    expect(document.getElementById("command-palette")).not.toBeNull();

    // E la vecchia non è più di nessuno. La domanda si pone al **registro** e
    // non premendola, per un limite di questo banco che vale la pena scrivere:
    // `document` è uno solo per tutto il file e nessuno smonta i suoi
    // ascoltatori, quindi ogni `avvia()` ne lascia uno addosso — premere
    // `Mod-Shift-p` qui farebbe rispondere la tastiera di un gesto precedente,
    // che ha un registro suo e non sa niente di questa scrittura. È un fatto
    // del banco, non della shell.
    const registro = await import("./ui/commands");
    expect(
      registro.avanza(registro.allCommands(), null, {
        key: "p",
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        altKey: false,
      }),
    ).toEqual({ tipo: "passa" });
  });
});

describe("la finestra senza vault", () => {
  it("conosce comunque le scorciatoie riconfigurate, che sono della macchina", async () => {
    // Il caso per cui la famiglia `keys.shell.*` è di macchina e non di vault
    // (§16.3): `shell.vault.open` è il comando che serve ad aprire il primo
    // vault, e una sua chiave che vivesse dentro un vault esisterebbe solo dopo
    // — cioè quando serve meno. Qui non c'è nessun vault, e l'accordo che
    // l'utente ha scelto è già quello che vale.
    const accordo = { ...scorciatoia("shell.palette"), value: "Mod-Alt-p", source: "machine" };
    await avvia({}, [accordo as SettingEntry], null);
    expect(document.querySelector("#vault-path")?.textContent).not.toBe("/vault");

    // La domanda si pone al **registro** e non premendo, per il limite del banco
    // scritto qui sopra: su un `document` che nessuno smonta, un tasto premuto
    // qui lo riceve anche la tastiera dei gesti precedenti. Ciò che questa riga
    // difende è l'**ordine dell'avvio** — gli accordi si rileggono prima di
    // sapere se un vault c'è — e quello si vede dal registro.
    const registro = await import("./ui/commands");
    const palette = registro.allCommands().find((e) => e.id === "shell.palette");
    expect(palette?.binding).toBe("Mod-Alt-p");
    expect(palette?.declared).toBe(SHELL_KEYS["shell.palette"]);
  });

  it("chiede l'avviso di sessione all'avvio, e lo mostra se c'è", async () => {
    // §25.5: la diagnosi «la cartella di configurazione non si può scrivere»
    // nasce all'avvio del backend, quando nessun ascoltatore esiste — una
    // spinta sarebbe persa, e la porta è un tiraggio. Questo gesto tiene ferma
    // la catena intera: la shell lo chiede (il registro del finto lo vede),
    // e lo consegna al router come un evento qualunque (lo storico dei toast
    // lo mostra). Si fa rosso in due versi: senza la chiamata in `init()`
    // il registro non vede nulla, senza l'inoltro il toast non appare.
    const avviso: KernelNotice = {
      event: {
        type: "trouble",
        severity: "warning",
        subject: null,
        error: { kind: "io", message: "`/config` non si può scrivere" },
        gate: null,
      },
      origin: { actor: { kind: "kernel" }, batch: null },
    };
    const host = await avvia({}, [], null, avviso);

    expect(host.aPorta("avvisoDiSessione").length).toBe(1);
    const { avvisiRecenti } = await import("./ui/notify");
    expect(avvisiRecenti().some((a) => a.testo.includes("non si può scrivere"))).toBe(true);

    // E una sessione sana non dice niente: il tiraggio c'è, la risposta è
    // vuota, e lo storico resta pulito. `avvisiRecenti` si ri-importa dopo
    // ogni `avvia`: `vi.resetModules` ricarica i moduli, e l'istanza di prima
    // è quella della sessione con l'avviso.
    const sana = await avvia({}, [], null);
    const { avvisiRecenti: recentiSani } = await import("./ui/notify");
    expect(sana.aPorta("avvisoDiSessione").length).toBe(1);
    expect(recentiSani().some((a) => a.testo.includes("non si può scrivere"))).toBe(false);
  });
});

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

describe("segui un link dentro la nota", () => {
  it("un `[[#Sezione]]` chiede al kernel col documento che lo ospita", async () => {
    // Il gesto è ctrl-click su un wikilink **senza pagina**, e la cosa che si
    // guarda sta di qua dal confine: *quale domanda* è partita. Un
    // `[[#Sezione]]` non nomina una nota, nomina questa — e chi lo risolve non
    // può saperlo se non gli si dice da dove si sta guardando. La shell si
    // fermava un passo prima, con un `if (!page) return`: nessuna domanda,
    // nessuna risposta, un click che non faceva niente e non diceva perché.
    const host = await avvia({
      "Benvenuto.md": "Vedi [[#Appunti]] più sotto.\n\n## Appunti\n\nEccoli.\n",
    });
    const link = document.querySelector<HTMLElement>(".cm-fub-wikilink");
    expect(link, "il live preview non ha decorato il wikilink").not.toBeNull();
    link!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, ctrlKey: true }));
    await riposa();

    const chieste = host
      .aPorta("queryIndex")
      .map((c) => c.args[0] as { kind: string; target?: { value: { page: string } }; from?: string | null })
      .filter((q) => q.kind === "resolve");
    expect(chieste).toHaveLength(1);
    expect(chieste[0]!.target?.value.page).toBe("");
    expect(chieste[0]!.from).toBe("Benvenuto.md");
  });
});

describe("la palette flussa prima di un comando che scrive", () => {
  // Il flush-before-patch di M3: un comando che scrive documenti riscrive
  // file — il kernel muove i wikilink entranti, la rinomina sposta la nota —
  // e un buffer rimasto sporco li ricoprirebbe col testo di prima al
  // salvataggio successivo. È la stessa guardia di `nonInSalvo`
  // dell'esploratore, e si prova qui perché la palette è l'altro posto in cui
  // un comando parte: la spec dichiara `writes`, e chi invoca deve salvare
  // prima di calcolare le patch.
  //
  // La spec è quella vera di `note.create` (commands.rs): un parametro `name`
  // facoltativo, raggio `document` — quindi niente piano, apply diretto.
  const specNoteCreate: CommandSpec = {
    id: "note.create",
    title: "Nuova nota",
    description: "",
    keybinding: null,
    params: [{ name: "name", title: "Nome", description: "", kind: { kind: "text" }, required: false }],
    scope: { writes: true, reach: "document", reversible: true },
  };

  it("un buffer sporco si salva prima che note.create parta", async () => {
    const host = await avvia(VAULT, [], undefined, null, [specNoteCreate]);
    battiNellEditor("testo non ancora salvato");

    // La palette si apre con la scorciatoia di default, come da un browser.
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "p", ctrlKey: true, shiftKey: true }),
    );
    await riposa();
    expect(document.getElementById("command-palette")).not.toBeNull();

    const input = document.querySelector<HTMLInputElement>(".palette-input")!;
    input.value = "Nuova nota";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await riposa();

    // Il comando ha un parametro facoltativo: la palette mostra il form.
    const campo = document.querySelector<HTMLInputElement>(".palette-form input")!;
    campo.value = "Appunti.md";
    const form = document.querySelector<HTMLFormElement>(".palette-form")!;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await riposa();

    const flush = host.chiamate.findIndex((c) => c.porta === "writeDocument");
    const invocato = host.chiamate.findIndex(
      (c) => c.porta === "invokeCommand" && c.args[0] === "note.create",
    );
    expect(invocato, "note.create non è arrivato al kernel").toBeGreaterThan(-1);
    expect(flush, "il buffer sporco non è stato salvato affatto").toBeGreaterThan(-1);
    // **Il momento che conta.** Senza il flush, `writeDocument` non c'è (il
    // debounce di 400 ms non è scaduto) e il comando parte col testo solo in
    // RAM: `flush` sarebbe -1 e questa riga rossa.
    expect(flush, "il comando è partito prima del flush").toBeLessThan(invocato);
  });

  it("un comando di sola lettura non flussa", async () => {
    // La spec è quella vera di `search.open` (commands.rs): nessuno scope
    // dichiarato, quindi `read_only` per default. Un comando che non scrive
    // non deve pagare il giro del flush — e il banco lo prova col buffer
    // sporco: se la palette flussasse comunque, `writeDocument` avrebbe una
    // chiamata.
    const specSearchOpen: CommandSpec = {
      id: "search.open",
      title: "Cerca nel vault",
      description: "",
      keybinding: null,
      params: [{ name: "query", title: "Query", description: "", kind: { kind: "text" }, required: true }],
      scope: { writes: false, reach: "session", reversible: true },
    };
    const host = await avvia(VAULT, [], undefined, null, [specSearchOpen]);
    battiNellEditor("testo non ancora salvato");

    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "p", ctrlKey: true, shiftKey: true }),
    );
    await riposa();
    const input = document.querySelector<HTMLInputElement>(".palette-input")!;
    input.value = "Cerca nel vault";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await riposa();

    const campo = document.querySelector<HTMLInputElement>(".palette-form input")!;
    campo.value = "rust";
    const form = document.querySelector<HTMLFormElement>(".palette-form")!;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await riposa();

    expect(host.aPorta("invokeCommand").some((c) => c.args[0] === "search.open")).toBe(true);
    expect(
      host.aPorta("writeDocument"),
      "un comando di sola lettura non deve salvare i buffer",
    ).toHaveLength(0);
  });
});
