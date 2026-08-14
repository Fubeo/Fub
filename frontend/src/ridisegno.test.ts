// @vitest-environment happy-dom
//
// **Il banco del ridisegno** (§2.9): quanto costa disegnare, contato in
// operazioni.
//
// # Perché non un tempo
//
// La voce chiedeva «il numero che dice se è ora», e rimandava al §17.1 per
// delle soglie su vault sintetici da 10k/100k note. Quel rimando è scaduto: la
// [0113](../../docs/decisions/0113-il-banco-conta-le-operazioni.md) ha chiuso il
// §17.1 decidendo l'opposto — **un banco conta operazioni, non millisecondi**,
// perché su una macchina condivisa il tempo non è un segnale, e un conto esatto
// è esatto a qualunque taglia. Qui vale identico, con un'aggravante di questo
// lato: il tempo di un fotogramma in `happy-dom` non esiste proprio, perché non
// c'è né CSS né layout (0112).
//
// Ciò che si conta qui sono **elementi nel DOM** e **domande al ponte**: due
// quantità che non dipendono da chi altro gira sulla macchina, e che dicono la
// cosa che interessa davvero — se il prezzo di un ridisegno cresce col vault.
//
// # Cosa questo banco NON prova
//
// Non prova la virtualizzazione, e non può: virtualizzare vuol dire disegnare
// ciò che si **vede**, e cosa si vede è una domanda di layout, che qui non c'è
// (buco dichiarato n. 5 della 0112). Prova la metà che sta *prima* del layout,
// ed è la metà che la voce stessa nominava — «le manda tutte attraverso l'IPC
// prima ancora che qualcuno provi a disegnarle».
//
// E non prova la superficie che chiede **senza finestra**: quella non è un
// comportamento, è un elenco, e l'attore che guarda un elenco è un conto che
// legge il sorgente da fuori (`conteggi.mjs`, `finestre-aperte`). La divisione
// è quella della 0110: *il compilatore prende la variante che non vuol dire
// niente, il conto prende la variante che nessuno ha elencato, il test prende
// il comportamento*. Qui c'è il terzo.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HostFinto } from "./host/finto";
import type { IndexQuery } from "./host/contract";
// La finestra si legge da `rules/`, che non tocca il DOM: importare il pannello
// monterebbe mezza shell all'ora del caricamento del modulo, cioè prima che la
// scocca esista.
import { FINESTRA_DEL_LIVELLO } from "./rules/organizer";

const scatola = vi.hoisted(() => ({ host: null as HostFinto | null }));

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
    onKernelEvent: (handler: (n: unknown) => void) => adesso().onKernelEvent(handler as never),
    allaChiusura: (prima: () => Promise<void>) => adesso().allaChiusura(prima),
  };
});

vi.mock("./host/dialog", () => ({
  confirm: () => Promise.resolve(true),
  pickFolder: () => Promise.resolve("/vault"),
}));

const { creaHostFinto } = await import("./host/finto");
const grezzo = (await import("../index.html?raw")).default;

/// Un vault piatto da `quante` note nella radice.
function vaultDa(quante: number): Record<string, string> {
  const file: Record<string, string> = {};
  for (let i = 0; i < quante; i += 1) file[`nota-${String(i).padStart(5, "0")}.md`] = "x";
  return file;
}

/// Un vault di sole **cartelle**, una nota dentro ciascuna e niente in radice.
///
/// Serve perché il vault piatto lascia scoperta metà del troncamento: con zero
/// cartelle, `altreCartelle` vale zero qualunque cosa faccia il codice che lo
/// calcola — misurato, e per questo esiste questa seconda forma.
function vaultDiCartelle(quante: number): Record<string, string> {
  const file: Record<string, string> = {};
  for (let i = 0; i < quante; i += 1) file[`cartella-${String(i).padStart(5, "0")}/una.md`] = "x";
  return file;
}

/// Un host montato **senza** la shell: serve a chi prova un modulo che disegna
/// (l'anteprima) e non il cablaggio dell'avvio.
function soloHost(file: Record<string, string>): HostFinto {
  scatola.host = creaHostFinto({ file });
  return scatola.host;
}

async function avvia(file: Record<string, string>): Promise<HostFinto> {
  vi.resetModules();
  scatola.host = creaHostFinto({ file });
  const corpo = /<body[^>]*>([\s\S]*)<\/body>/.exec(grezzo);
  if (!corpo) throw new Error("index.html non ha un body");
  document.body.innerHTML = corpo[1].replace(/<script[\s\S]*?<\/script>/g, "");
  const main = await import("./main");
  await main.avvio;
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  return scatola.host;
}

/// Gli elementi che l'albero dei file tiene nel DOM: il prezzo di un ridisegno.
function elementiDellAlbero(): number {
  return document.querySelectorAll("#file-list *").length;
}

/// Le domande del canale dati arrivate al ponte, come le ha ricevute.
function domande(host: HostFinto): IndexQuery[] {
  return host.aPorta("queryIndex").map((c) => c.args[0] as IndexQuery);
}

describe("il prezzo di un ridisegno (§2.9)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("due vault che differiscono per quattromila note disegnano lo stesso albero", async () => {
    // Il conto NON è «poco»: è **lo stesso**. Una soglia («meno di mille
    // elementi») sarebbe un numero da rinegoziare a ogni riga aggiunta a una
    // voce dell'albero; questa uguaglianza dice la sola cosa che conta, cioè
    // che il prezzo è funzione della finestra e non del vault. Se qualcuno
    // toglie la finestra, la differenza è di dodicimila elementi e non di uno.
    await avvia(vaultDa(2000));
    const duemila = elementiDellAlbero();
    await avvia(vaultDa(6000));
    const seimila = elementiDellAlbero();
    expect(duemila).toBe(seimila);
    // E il prezzo è quello della finestra, non un tetto qualunque: tre elementi
    // per nota disegnata (`li`, la riga, il nome) più la riga che dice cosa è
    // rimasto fuori.
    expect(duemila).toBe(FINESTRA_DEL_LIVELLO.limit * 3 + 1);
  });

  it("un vault più piccolo della finestra si disegna intero, e senza dire niente", async () => {
    await avvia(vaultDa(30));
    expect(elementiDellAlbero()).toBe(30 * 3);
    expect(document.querySelectorAll("#file-list .row.troncata")).toHaveLength(0);
  });

  it("ciò che la finestra lascia fuori l'albero lo dice, e dice quanto", async () => {
    // Metà del difetto è che nessuno lo dica: un livello troncato in silenzio è
    // una cartella che sembra averne duecento quando ne ha seimila, e chi
    // guarda smette di cercare una nota che c'è.
    await avvia(vaultDa(6000));
    const riga = document.querySelector("#file-list .row.troncata");
    expect(riga).not.toBeNull();
    expect(riga?.textContent).toContain(String(6000 - FINESTRA_DEL_LIVELLO.limit));
    // E non è una voce dell'albero: chi ci naviga con le frecce non ci si deve
    // fermare sopra.
    expect(riga?.getAttribute("role")).toBe("none");
  });

  it("anche le cartelle di troppo si contano, e sono un conto proprio", async () => {
    // Le due metà del troncamento sono **due**, e il vault piatto ne esercita
    // una sola: qui le note in radice sono zero e le cartelle duecentocinquanta,
    // quindi la riga che compare parla solo di `altreCartelle`. Senza questa
    // prova quel campo poteva valere zero fisso e la suite restava verde.
    await avvia(vaultDiCartelle(250));
    const riga = document.querySelector("#file-list .row.troncata");
    expect(riga).not.toBeNull();
    expect(riga?.textContent).toContain(String(250 - FINESTRA_DEL_LIVELLO.limit));
  });

  it("il menu «nuovo spazio» non ha una voce per cartella del vault", async () => {
    // Il secondo cliente della finestra: un menu contestuale che elenca ogni
    // cartella a ogni profondità non è un menu, è l'anagrafe travestita — ed è
    // la superficie che nessun altro presidio attraversa.
    await avvia(vaultDiCartelle(250));
    document.querySelector<HTMLElement>("#space-strip .space-chip.add")?.click();
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    const voci = [...document.querySelectorAll("#context-menu button")];
    expect(voci).toHaveLength(FINESTRA_DEL_LIVELLO.limit + 1);
    expect(voci[voci.length - 1]?.textContent).toContain(String(250 - FINESTRA_DEL_LIVELLO.limit));
  });

  it("nessuna domanda dell'avvio chiede l'anagrafe del vault senza finestra", async () => {
    // La domanda che cresce col vault è `entries` (l'anagrafe) e `folders`: se
    // una di queste parte con `page: null`, il ponte porta tutto il vault
    // qualunque cosa poi disegni la shell. `SENZA_FINESTRA` resta possibile —
    // ma va scritto, e le due domande che lo usano di proposito non sono
    // queste.
    //
    // Zona cieca dichiarata: questo guarda l'**avvio**, e ciò che la shell
    // chiede solo aprendo un pannello (la palette è il caso vero) non passa
    // di qui. Per quelle l'attore è il conto `finestre-aperte`, che le vede
    // senza doverle eseguire.
    const host = await avvia(vaultDa(2000));
    const senzaFinestra = domande(host).filter(
      (q) => (q.kind === "entries" || q.kind === "folders") && q.page === null,
    );
    expect(senzaFinestra).toEqual([]);
  });
});

describe("il prezzo di un'anteprima (§2.9)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("le immagini non partono tutte insieme: chi decide quando è il browser", async () => {
    // La metà fattibile del *lazy loading*: la shell non calcola cosa si vede —
    // non ha layout, e non l'avrà nemmeno in una webview vera senza pagarlo —
    // ma può **dichiarare che non vuole deciderlo lei**. Vale per ogni HTML che
    // entra, quindi sta nel punto unico (§3.6) e non nell'anteprima: il secondo
    // cliente lo eredita senza saperlo.
    soloHost({ "nota.md": '<p><img src="a.png"><img src="b.png"></p>' });
    const { updatePreview } = await import("./panels/preview");
    const el = document.createElement("div");
    document.body.appendChild(el);
    await updatePreview(el, "nota.md");
    const immagini = [...el.querySelectorAll("img")];
    expect(immagini).toHaveLength(2);
    expect(immagini.map((i) => i.getAttribute("loading"))).toEqual(["lazy", "lazy"]);
    expect(immagini.map((i) => i.getAttribute("decoding"))).toEqual(["async", "async"]);
  });

  it("la stessa nota trasclusa tre volte si chiede al kernel una volta sola", async () => {
    // La profondità degli embed era limitata, la larghezza no — e un
    // `![[Glossario]]` ripetuto erano viaggi identici sul ponte. Il memo dura
    // la singola idratazione, e la sua correttezza è la promessa che
    // `FormatProvider::render_html` fa: la resa di un blocco dipende dal
    // blocco.
    const embed = (page: string, h = "") =>
      `<div class="embed" data-embed-page="${page}" data-embed-heading="${h}"></div>`;
    const host = soloHost({
      "nota.md": embed("Glossario") + embed("Glossario") + embed("Glossario"),
    });
    const { updatePreview } = await import("./panels/preview");
    const el = document.createElement("div");
    document.body.appendChild(el);
    await updatePreview(el, "nota.md");
    const embeds = host.aPorta("queryIndex").filter((c) => c.args[0]?.kind === "render_embed");
    expect(embeds).toHaveLength(1);
    expect(el.querySelectorAll(".embed-loaded")).toHaveLength(3);
  });

  it("due sezioni diverse della stessa nota restano due domande", async () => {
    // Il secondo guasto del memo, e quello che una chiave sbagliata renderebbe
    // muto: unificare per **pagina** invece che per pagina *e* punto
    // mostrerebbe tre volte la stessa sezione senza dirlo a nessuno.
    const embed = (page: string, h: string) =>
      `<div class="embed" data-embed-page="${page}" data-embed-heading="${h}"></div>`;
    const host = soloHost({
      "nota.md": embed("Glossario", "A") + embed("Glossario", "B") + embed("Glossario", "A"),
    });
    const { updatePreview } = await import("./panels/preview");
    const el = document.createElement("div");
    document.body.appendChild(el);
    const embeds = host.aPorta("queryIndex").filter((c) => c.args[0]?.kind === "render_embed");
    expect(embeds.map((c) => c.args[0]?.heading)).toEqual(["A", "B"]);
  });

  it("l'ancora di blocco di un embed arriva al kernel, e distingue due domande", async () => {
    // La terza coordinata. `![[Nota#^b]]` trasclude **quel blocco**: se la
    // chiave del memo non la porta, due embed della stessa pagina con due
    // ancore diverse si scambiano la risposta — che è lo stesso guasto del
    // test qui sopra, un campo più in là. E se non la porta la chiamata, il
    // blocco non arriva affatto e si vede la nota intera, che è la risposta
    // plausibile che nasconde l'errore.
    const embed = (page: string, b: string) =>
      `<div class="embed" data-embed-page="${page}" data-embed-block="${b}"></div>`;
    const host = soloHost({
      "nota.md": embed("Glossario", "b1") + embed("Glossario", "b2") + embed("Glossario", "b1"),
    });
    const { updatePreview } = await import("./panels/preview");
    const el = document.createElement("div");
    document.body.appendChild(el);
    const embeds = host.aPorta("queryIndex").filter((c) => c.args[0]?.kind === "render_embed");
    expect(embeds.map((c) => c.args[0]?.block)).toEqual(["b1", "b2"]);
    expect(host.aPorta("renderEmbed").map((c) => c.args[2])).toEqual(["b1", "b2"]);
    expect(el.querySelectorAll(".embed-loaded")).toHaveLength(3);
  });
});
