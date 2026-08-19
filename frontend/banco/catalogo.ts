// Le tre scene che non sono schermate ma **cataloghi** (§31.1).
//
// Una schermata mostra un caso; un catalogo esaurisce un elenco. Servono a due
// cose diverse, e la seconda è quella che manca oggi: quando la §31.2 rifarà i
// colori e la §31.5 le elevazioni, la domanda «cosa ho cambiato» non si risponde
// guardando l'app — si risponde mettendo il prima e il dopo di *tutto* uno
// accanto all'altro. Sono anche, dette dall'altra parte, la pagina di prova che
// si consegnerà a chi scriverà un tema (§31.9).
//
//  - **componenti**: ogni `UiNode` che la shell sa disegnare, in ogni stato in
//    cui un tema lo deve distinguere. L'elenco sta in `campioni.ts` e un
//    presidio lo confronta coi `case` di `src/ui/node.ts`.
//  - **tavolozza**: ogni token del foglio col suo nome, il suo valore e — per i
//    colori — il contrasto **reso** sopra le quattro superfici. I nomi non sono
//    scritti qui: si leggono dal foglio montato, quindi un token nuovo compare
//    da solo e uno tolto sparisce da solo.
//  - **campionario**: la scala tipografica per intero, coi due caratteri, i tre
//    pesi e l'interlinea, su prosa vera.
//
// Il tutto **senza la shell**: qui non gira `main.ts`. Ciò che è identico è ciò
// che deve esserlo — i tre strati montati dallo stesso caricatore, e il renderer
// vero per i componenti.
import "../src/theme/struttura.css";
import foglioScuro from "../src/theme/serie/foglio-scuro.css?raw";
import foglioChiaro from "../src/theme/serie/foglio-chiaro.css?raw";
import pelle from "../src/theme/serie/pelle.css?raw";
import { monta } from "../src/theme/loader";
import { contrasto } from "../src/theme/contrasto";
import { mountTree } from "../src/ui/node";
import { CAMPIONI } from "./campioni";

const parametri = new URLSearchParams(window.location.search);
const LUCE = parametri.get("luce") === "light" ? "light" : "dark";
const QUALE = parametri.get("catalogo") ?? "componenti";

// I tre strati, nell'ordine del §29: la struttura arriva dall'`import` qui
// sopra, il foglio e la pelle dal caricatore — per **sostituzione**, come
// nell'app.
monta(pelle, "pelle");
monta(LUCE === "light" ? foglioChiaro : foglioScuro, "foglio");
document.documentElement.dataset.theme = LUCE;

const radice = document.getElementById("catalogo")!;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  testo?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (testo !== undefined) n.textContent = testo;
  return n;
}

function testata(titolo: string): void {
  const t = el("div", "catalogo-testata");
  t.append(el("h1", undefined, titolo), el("span", "luce", LUCE === "light" ? "chiaro" : "scuro"));
  radice.append(t);
}

function sezione(titolo: string): HTMLElement {
  const s = el("section", "sezione");
  s.append(el("h2", undefined, titolo));
  const g = el("div", "griglia");
  s.append(g);
  radice.append(s);
  return g;
}

// ---------------------------------------------------------------------------
// Componenti.
// ---------------------------------------------------------------------------

function componenti(): void {
  testata("Componenti");
  for (const campione of CAMPIONI) {
    const griglia = sezione(campione.titolo);
    for (const stato of campione.stati) {
      const cella = el("div", "cella");
      cella.append(el("span", "didascalia", stato.nome));
      const provino = el("div", "provino");
      // Il renderer **vero**, con una porta che non fa niente: un click dentro
      // un catalogo non ha un provider a cui arrivare, e non deve avere un
      // errore da mostrare.
      mountTree(provino, stato.node, async () => {});
      cella.append(provino);
      griglia.append(cella);
    }
  }
}

// ---------------------------------------------------------------------------
// Tavolozza.
// ---------------------------------------------------------------------------

/// I nomi dei token, **letti dal foglio montato** e nel suo ordine.
///
/// Non da un elenco scritto qui: un elenco a mano è la seconda metà di una
/// coppia che nessuno tiene insieme, e il giorno che diverge il catalogo non
/// diventa rosso — smette solo di mostrare un token, che è il difetto che
/// questa seduta è nata per non avere più.
function nomiDeiToken(): string[] {
  const testo = LUCE === "light" ? foglioChiaro : foglioScuro;
  const senzaCommenti = testo.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...senzaCommenti.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]!);
}

/// Le quattro superfici su cui un inchiostro può stare. Sono i quattro fondi che
/// la pelle usa davvero, e sono anche quelle che `contrast.test.ts` enumera:
/// il catalogo mostra lo stesso conto, misurato sull'altro lato — lì dal foglio
/// come testo, qui da `getComputedStyle` sulla pagina.
const SUPERFICI = ["--bg", "--bg-chrome", "--bg-elev", "--bg-input"] as const;

/// Un token è un colore se il suo valore, reso, è un colore pieno che il conto
/// sa leggere. I veli e le ombre (`rgb(… / …)`, `0 1px 2px …`) non lo sono, e
/// il loro contrasto non è una funzione dei soli token: si mostrano col loro
/// valore e senza conti, che è la cosa vera da dire.
function eColore(valore: string): boolean {
  return /^#|^rgba?\(/i.test(valore.trim()) && !/\/\s*0?\.\d/.test(valore);
}

function tavolozza(): void {
  testata("Tavolozza");
  const stile = getComputedStyle(document.documentElement);
  const valore = (nome: string) => stile.getPropertyValue(nome).trim();
  const fondi = Object.fromEntries(SUPERFICI.map((s) => [s, valore(s)])) as Record<string, string>;

  const s = el("section", "sezione");
  s.append(el("h2", undefined, `${nomiDeiToken().length} token del foglio`));
  radice.append(s);

  for (const nome of nomiDeiToken()) {
    const v = valore(nome);
    const riga = el("div", "token");

    const campione = el("span", "campione-colore");
    if (eColore(v)) campione.style.background = v;
    else campione.style.background = "transparent";
    riga.append(campione);

    const testo = el("div");
    testo.append(el("span", "token-nome", nome), el("span", "token-valore", v));
    riga.append(testo);

    const conti = el("div", "conti");
    if (eColore(v)) {
      for (const fondo of SUPERFICI) {
        if (nome === fondo) continue;
        let rapporto: number;
        try {
          rapporto = contrasto(v, fondi[fondo]!);
        } catch {
          continue;
        }
        const c = el("span", "conto");
        c.dataset.esito = rapporto >= 4.5 ? "aa" : rapporto >= 3 ? "ui" : "sotto";
        c.append(
          document.createTextNode(`${fondo.slice(2)} `),
          el("b", undefined, rapporto.toFixed(1)),
        );
        conti.append(c);
      }
    }
    riga.append(conti);
    s.append(riga);
  }
}

// ---------------------------------------------------------------------------
// Campionario.
// ---------------------------------------------------------------------------

const PROSA =
  "Non si migliora ciò che non si guarda: un gradino che non si vede, un allineamento che salta, un'ombra che non stacca.";

function campionario(): void {
  testata("Campionario");

  const scala = ["--text-xs", "--text-sm", "--text-base", "--text-md", "--text-lg", "--text-xl"];
  const pesi: [string, string][] = [
    ["normale", "400"],
    ["medium", "var(--weight-medium)"],
    ["bold", "var(--weight-bold)"],
  ];

  for (const [famiglia, token] of [
    ["Carattere dell'interfaccia", "--font-ui"],
    ["Carattere monospaziato", "--font-mono"],
  ] as const) {
    const s = el("section", "sezione");
    s.append(el("h2", undefined, famiglia));
    for (const misura of scala) {
      for (const [nomePeso, peso] of pesi) {
        const riga = el("div", "riga-scala");
        riga.append(el("span", "didascalia", `${misura.slice(2)} · ${nomePeso}`));
        const testo = el("p", "misura", PROSA);
        testo.style.margin = "0";
        testo.style.fontFamily = `var(${token})`;
        testo.style.fontSize = `var(${misura})`;
        testo.style.fontWeight = peso;
        riga.append(testo);
        s.append(riga);
      }
    }
    radice.append(s);
  }

  // L'interlinea e la spaziatura, che sono gli altri due token della voce del
  // tema e non si vedono su una riga sola.
  const s = el("section", "sezione");
  s.append(el("h2", undefined, "Interlinea e spaziatura"));
  for (const [nome, stile] of [
    ["normale", ""],
    ["leading-tight", "line-height: var(--leading-tight)"],
    ["tracking-caps", "letter-spacing: var(--tracking-caps); text-transform: uppercase"],
  ] as const) {
    const riga = el("div", "riga-scala");
    riga.append(el("span", "didascalia", nome));
    const p = el("p", "misura", `${PROSA} ${PROSA}`);
    p.style.margin = "0";
    p.setAttribute("style", `${p.getAttribute("style") ?? ""};${stile}`);
    riga.append(p);
    s.append(riga);
  }
  radice.append(s);
}

// ---------------------------------------------------------------------------

const CATALOGHI: Record<string, () => void> = { componenti, tavolozza, campionario };

const disegna = CATALOGHI[QUALE];
if (!disegna) {
  // Un catalogo che non esiste è un errore del fotografo, non uno stato da
  // fotografare: si vede subito e dice quali ce ne sono.
  radice.textContent = `Non esiste il catalogo «${QUALE}». Ce ne sono tre: ${Object.keys(CATALOGHI).join(", ")}.`;
} else {
  disegna();
}

// Il segnale che il fotografo aspetta. Un `networkidle` non basta a un catalogo
// che non chiede niente alla rete, e un tempo fisso è la cosa che rende un banco
// visivo intermittente: qui la pagina dice da sé quando ha finito di disegnare.
document.documentElement.dataset.banco = "pronto";
