// La pagina d'anteprima del lavoro sull'editor di FubDraw.
//
// Monta l'editor vero, `createDrawEditor` degli strumenti (FD-205), su un
// file .svg tenuto da un `SceneEngine` (FD-202). Barra, strumenti, penna
// (FD-203), camera condivisa (FD-101) e painter (FD-204) sono il codice che
// andrà nella shell: ogni gesto è un'operazione del motore, annulla e ripeti
// sono la cronologia dell'editor, e il pannello del file mostra il testo che
// si salverebbe, con le righe appena cambiate.
//
// Ciò che ancora non c'è — la superficie registrata nella shell di FD-206b —
// qui è una cucitura provvisoria, scritta per sparire: il salvataggio nel
// browser al posto del vault, il pannello del file e l'ispettore.
//
// Come il catalogo del banco, qui non gira `main.ts`: i quattro strati del
// tema si montano con lo stesso caricatore della shell, e la carta è bianca in
// entrambi i temi.

import "../src/theme/structure.css";
import darkSheet from "../src/theme/serie/sheet-dark.css?raw";
import lightSheet from "../src/theme/serie/sheet-light.css?raw";
import skin from "../src/theme/serie/skin.css?raw";
import fonts from "../src/theme/serie/fonts.css?raw";
import { mount } from "../src/theme/loader";
import { openLifetime } from "../src/ui/lifetime";
import type { TextOperation } from "../src/editors/core/text-operation";
import { parseBrush, type Pf1Brush } from "../src/editors/spatial/ink/brush";
import { decodeInk, inkToQuantized } from "../src/editors/spatial/ink/codec";
import { pf1Outline } from "../src/editors/spatial/ink/pf1";
import type { QuantizedInk, QuantizedSample } from "../src/editors/spatial/ink/sample";
import type { Role } from "../src/editors/spatial/scene/analysis";
import type { ElementItem } from "../src/editors/spatial/scene/classify";
import { SceneEngine } from "../src/editors/spatial/scene/engine";
import type { Bounds } from "../src/editors/spatial/scene/geometry";
import { createId } from "../src/editors/spatial/scene/ids";
import type { Op } from "../src/editors/spatial/scene/ops";
import { FUB_NS, SUPPORTED_VERSION, SVG_NS } from "../src/editors/spatial/scene/read";
import type { Page } from "../src/editors/spatial/painter/paint";
import { pageFor, strokeElem } from "../src/editors/spatial/tools/edit";
import { createDrawEditor, type DrawChange } from "../src/editors/spatial/tools/editor";
import { PALETTE } from "../src/editors/spatial/tools/palette";
import { ORDINE_STATI, PACCHETTI, STATI } from "./stato";

// ---------------------------------------------------------------------------
// Costanti

/// Il disegno della pagina: il nome del file e la pagina di un disegno nuovo,
/// come li scrive `serialize` del provider svg (§2).
const NOME_FILE = "Prova.svg";
const TITOLO = "Prova";
const PAGINA = { w: 1600, h: 1000 };
const PRIMO_LIVELLO = "Livello 1";

/// Oltre questa lunghezza un valore del pannello del file si accorcia, se non
/// si chiedono i valori interi; nell'ispettore si apre a richiesta.
const VALORE_CORTO = 56;

/// Che cosa ha cambiato il testo, per il pannello del file.
const ORIGINI: Readonly<Record<DrawChange["origin"], string>> = {
  input: "L’ultimo gesto",
  undo: "Annulla",
  redo: "Ripeti",
};

/// Il nome di un oggetto nell'ispettore, dal suo ruolo nella scena.
const RUOLI: Partial<Readonly<Record<Role, string>>> = {
  stroke: "Tratto a penna",
  arrow: "Freccia",
  rect: "Rettangolo",
  ellipse: "Ellisse",
  circle: "Cerchio",
  line: "Linea",
  path: "Tracciato",
  polyline: "Spezzata",
  polygon: "Poligono",
  text: "Testo",
  group: "Gruppo",
  link: "Collegamento",
};

const CHIAVE_LUCE = "fubdraw-anteprima:luce";
const CHIAVE_DISEGNO = "fubdraw-anteprima:disegno";
const CHIAVE_INTERI = "fubdraw-anteprima:valori-interi";

// ---------------------------------------------------------------------------
// Utilità

/// Il localStorage può mancare o lanciare (finestra privata, dati bloccati):
/// la pagina funziona lo stesso, e dimentica.
function leggi(chiave: string): string | null {
  try {
    return window.localStorage.getItem(chiave);
  } catch {
    return null;
  }
}

function scrivi(chiave: string, valore: string | null): void {
  try {
    if (valore === null) window.localStorage.removeItem(chiave);
    else window.localStorage.setItem(chiave, valore);
  } catch {
    // Pieno o bloccato: il disegno resta finché la pagina è aperta.
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, classe?: string, testo?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (classe) n.className = classe;
  if (testo !== undefined) n.textContent = testo;
  return n;
}

function byId<T extends HTMLElement>(id: string): T {
  const n = document.getElementById(id);
  if (!n) throw new Error(`#${id} manca nella pagina`);
  return n as T;
}

const numeri = new Intl.NumberFormat("it-IT");

function quanti(n: number, uno: string, molti: string): string {
  return `${numeri.format(n)} ${n === 1 ? uno : molti}`;
}

// ---------------------------------------------------------------------------
// Tema

type Luce = "dark" | "light";

const vita = openLifetime();
vita.listen(window, "pagehide", () => vita.close(), { once: true });

const sistemaChiaro = window.matchMedia("(prefers-color-scheme: light)");
const salvata = leggi(CHIAVE_LUCE);
let luceScelta: Luce | null = salvata === "light" || salvata === "dark" ? salvata : null;
const bottoneLuce = byId<HTMLButtonElement>("luce");

function applicaLuce(): void {
  const luce: Luce = luceScelta ?? (sistemaChiaro.matches ? "light" : "dark");
  mount(luce === "light" ? lightSheet : darkSheet, "foglio");
  document.documentElement.dataset.theme = luce;
  bottoneLuce.textContent = luce === "light" ? "Tema scuro" : "Tema chiaro";
}

mount(fonts, "caratteri");
mount(skin, "pelle");
applicaLuce();
vita.listen(sistemaChiaro, "change", () => applicaLuce());
vita.listen(bottoneLuce, "click", () => {
  luceScelta = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  scrivi(CHIAVE_LUCE, luceScelta);
  applicaLuce();
});

// ---------------------------------------------------------------------------
// Il documento: un file .svg nel motore delle operazioni

/// Un disegno nuovo, byte per byte come quello di `serialize` (§2, §3): la
/// radice, il titolo, la carta e «Livello 1» vuoto in forma aperta.
function documentoNuovo(): string {
  const livello = createId("layer", () => false);
  return [
    `<svg xmlns="${SVG_NS}" xmlns:fub="${FUB_NS}" fub:version="${SUPPORTED_VERSION}" ` +
      `viewBox="0 0 ${PAGINA.w} ${PAGINA.h}" width="${PAGINA.w}" height="${PAGINA.h}">`,
    `  <title>${TITOLO}</title>`,
    `  <rect id="fub-paper" fub:role="paper" x="0" y="0" width="${PAGINA.w}" height="${PAGINA.h}" fill="#ffffff"/>`,
    `  <g id="${livello}" fub:layer="${PRIMO_LIVELLO}">`,
    "  </g>",
    "</svg>",
    "",
  ].join("\n");
}

/// Il motore che l'editor modifica: l'editor lo tiene, la pagina lo legge.
let motore: SceneEngine = SceneEngine.open(documentoNuovo());
/// L'ultima modifica del testo e chi l'ha fatta, per il pannello del file.
let ultima: { readonly nome: string; readonly operazione: TextOperation } | null = null;

function elementi(m: SceneEngine): ElementItem[] {
  return m.scene().filter((v): v is ElementItem => v.kind === "element");
}

/// Gli oggetti del disegno in ordine di documento, come li sceglie l'editor:
/// i figli dei livelli, e quelli della radice che non sono livelli, carta,
/// titolo o descrizione.
function oggetti(m: SceneEngine): ElementItem[] {
  const voci = elementi(m);
  const livelli = new Set(voci.filter((v) => v.role === "layer").map((v) => v.path.join(".")));
  return voci.filter((v) =>
    v.path.length === 1
      ? v.role !== "layer" && v.role !== "paper" && v.role !== "title" && v.role !== "desc"
      : v.path.length === 2 && livelli.has(String(v.path[0])),
  );
}

/// La chiave con cui l'editor sceglie un oggetto: l'id, o `@` e il percorso.
function chiave(v: ElementItem): string {
  return v.id ?? `@${v.path.join(".")}`;
}

/// L'id del primo livello, dove vanno i tratti migrati.
function livelloDi(m: SceneEngine): string | null {
  for (const v of elementi(m)) if (v.role === "layer" && v.id !== null) return v.id;
  return null;
}

/// Il `viewBox` della radice, letto dal suo tag d'apertura.
function viewBox(): readonly [number, number, number, number] {
  const radice = motore.scene().find((v) => v.kind === "root");
  const tag = radice ? motore.text.slice(radice.tags.open.utf16[0], radice.tags.open.utf16[1]) : "";
  const valori = /\sviewBox\s*=\s*"([^"]*)"/.exec(tag)?.[1]?.trim().split(/[\s,]+/).map(Number) ?? [];
  if (valori.length !== 4 || valori.some((n) => !Number.isFinite(n))) return [0, 0, PAGINA.w, PAGINA.h];
  return valori as unknown as readonly [number, number, number, number];
}

function pagina(): Page {
  const [x, y, width, height] = viewBox();
  return { x, y, width, height };
}

/// Il riquadro del contorno di un tratto: le curve passano per i punti medi
/// fra i vertici, quindi stanno dentro il riquadro dei vertici.
function riquadroDi(ink: QuantizedInk, brush: Pf1Brush): Bounds | null {
  const contorno = pf1Outline(ink, brush);
  if (contorno.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of contorno) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { min: [minX, minY], max: [maxX, maxY] };
}

function unisci(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (!a || !b) return a ?? b;
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1])],
  };
}

// ---------------------------------------------------------------------------
// Salvataggio nel browser: il disegno sopravvive a un ricaricamento

/// Il file. La versione 2 aveva accanto il dispositivo di ogni tratto, che il
/// file non conserva: l'editor non lo sa, e si lascia.
interface Salvato {
  readonly v: 3;
  readonly svg: string;
}

/// Il formato di prima del motore: i tratti uno per uno.
interface SalvatoV1 {
  readonly v: 1;
  readonly tratti: readonly {
    readonly colore: string;
    readonly brush: string;
    readonly scala: number;
    readonly campioni: readonly QuantizedSample[];
  }[];
}

function salva(): void {
  if (oggetti(motore).length === 0 && ultima === null) {
    scrivi(CHIAVE_DISEGNO, null);
    return;
  }
  const dati: Salvato = { v: 3, svg: motore.text };
  scrivi(CHIAVE_DISEGNO, JSON.stringify(dati));
}

/// Riapre il file salvato. Un file che il motore non apre come disegno
/// modificabile con un livello si scarta: la pagina riparte da un foglio
/// nuovo.
function riapri(svg: unknown): boolean {
  if (typeof svg !== "string") return false;
  let m: SceneEngine;
  try {
    m = SceneEngine.open(svg);
  } catch {
    return false;
  }
  if (m.status !== "fubdraw" || livelloDi(m) === null) return false;
  motore = m;
  return true;
}

/// Porta nel file i tratti salvati col formato di prima: un `batch` di
/// `add`, fuori dalla cronologia. Il pennello passa da `parseBrush` e il `d`
/// lo ricalcola il motore.
function migra(dati: Partial<SalvatoV1>): boolean {
  if (!Array.isArray(dati.tratti)) return false;
  const livello = livelloDi(motore);
  if (livello === null) return false;
  const ops: Op[] = [];
  const presi = new Set<string>();
  let tutto: Bounds | null = null;
  for (const s of dati.tratti as SalvatoV1["tratti"]) {
    try {
      if (s.scala !== 10 && s.scala !== 100) continue;
      if (!PALETTE.some((c) => c.color === s.colore)) continue;
      const brush = parseBrush(s.brush);
      const ink: QuantizedInk = { scale: s.scala, samples: s.campioni };
      const riquadro = riquadroDi(ink, brush);
      if (!riquadro) continue;
      const id = createId("object", (x) => presi.has(x) || x === livello);
      presi.add(id);
      ops.push({ op: "add", parent: livello, pos: { last: true }, elem: strokeElem(id, s.colore, brush, ink, null) });
      tutto = unisci(tutto, riquadro);
    } catch {
      // Un tratto illeggibile si salta: gli altri restano.
    }
  }
  if (ops.length === 0) return false;
  const nuova = pageFor(pagina(), tutto);
  if (nuova !== null) ops.push({ op: "page", viewBox: nuova });
  return motore.apply({ op: "batch", label: "Tratti salvati", ops }).outcome === "applied";
}

/// Il disegno salvato, se c'è e si apre; il numero dei suoi oggetti.
function ripristina(): number {
  const testo = leggi(CHIAVE_DISEGNO);
  if (!testo) return 0;
  let dati: Record<string, unknown> | null;
  try {
    dati = JSON.parse(testo) as Record<string, unknown> | null;
  } catch {
    return 0;
  }
  const v = dati?.v;
  const riuscito = v === 3 || v === 2 ? riapri(dati!.svg) : v === 1 ? migra(dati as Partial<SalvatoV1>) : false;
  if (!riuscito) {
    motore = SceneEngine.open(documentoNuovo());
    return 0;
  }
  return oggetti(motore).length;
}

// ---------------------------------------------------------------------------
// L'editor

const ripristinati = ripristina();
const tavolo = byId<HTMLElement>("editore");
const annunci = byId<HTMLElement>("annunci");

const editor = createDrawEditor(tavolo, motore, vita, {
  onChange: (change) => {
    ultima = { nome: ORIGINI[change.origin], operazione: change.operation };
    motore = editor.engine;
    pianifica(true);
  },
});

// L'invito sul foglio vuoto: solo a vista, il foglio ha già il suo nome.
const invito = el("div", "invito");
invito.setAttribute("aria-hidden", "true");
const invitoTesto = el("div");
invitoTesto.append(el("strong", undefined, "Disegna qui"), "con la penna, il mouse o il dito; le forme sono nella barra");
invito.append(invitoTesto);
editor.element.querySelector(".draw-surface")?.append(invito);

const bottoneSvuota = byId<HTMLButtonElement>("svuota");
vita.listen(bottoneSvuota, "click", () => {
  // Come Ctrl+A e Canc: un gesto solo, e Annulla lo riporta.
  editor.select(oggetti(editor.engine).map(chiave));
  editor.deleteSelection();
  editor.focus();
});

// La selezione cambia senza toccare il testo: l'ispettore la segue alla fine
// di ogni gesto e di ogni tasto.
vita.listen(editor.element, "pointerup", () => pianifica(false));
vita.listen(editor.element, "keyup", () => pianifica(false));

let inAttesa: { file: boolean } | null = null;

/// Aggiorna la pagina al prossimo fotogramma, una volta sola anche per più
/// modifiche di fila; con `file` anche il pannello del file e il salvataggio.
function pianifica(file: boolean): void {
  if (inAttesa !== null) {
    inAttesa.file ||= file;
    return;
  }
  inAttesa = { file };
  requestAnimationFrame(() => {
    const { file: anche } = inAttesa!;
    inAttesa = null;
    aggiorna(anche);
  });
}

function aggiorna(file: boolean): void {
  const n = oggetti(motore).length;
  bottoneSvuota.disabled = n === 0 || editor.engine.status !== "fubdraw";
  invito.hidden = n > 0;
  aggiornaIspettore();
  if (file) {
    mostraFile(true);
    salva();
  }
}

// ---------------------------------------------------------------------------
// Il pannello del file

const fileMisure = byId<HTMLElement>("file-misure");
const fileModifica = byId<HTMLElement>("file-modifica");
const fileTesto = byId<HTMLElement>("file-testo");
const fileInteri = byId<HTMLInputElement>("file-interi");
let indirizzoFile: string | null = null;

fileInteri.checked = leggi(CHIAVE_INTERI) === "1";
vita.listen(fileInteri, "change", () => {
  scrivi(CHIAVE_INTERI, fileInteri.checked ? "1" : null);
  mostraFile(false);
});

/// Un URL blob del testo corrente; il precedente si revoca.
function urlDelFile(): string {
  if (indirizzoFile !== null) URL.revokeObjectURL(indirizzoFile);
  indirizzoFile = URL.createObjectURL(new Blob([motore.text], { type: "image/svg+xml" }));
  return indirizzoFile;
}

vita.add(() => {
  if (indirizzoFile !== null) URL.revokeObjectURL(indirizzoFile);
});
vita.listen(byId("file-scarica"), "click", () => {
  const a = el("a");
  a.href = urlDelFile();
  a.download = NOME_FILE;
  a.click();
});
vita.listen(byId("file-apri"), "click", () => {
  window.open(urlDelFile(), "_blank", "noopener");
});

/// Le righe del testo a LF toccate da ciò che `op` ha inserito, contate da 0.
/// Una riga solo tolta non c'è più: la conta il riassunto.
function righeToccate(op: TextOperation, testo: string): Set<number> {
  const inizi = [0];
  for (let i = testo.indexOf("\n"); i >= 0; i = testo.indexOf("\n", i + 1)) inizi.push(i + 1);
  const rigaDi = (offset: number): number => {
    let basso = 0;
    let alto = inizi.length - 1;
    while (basso < alto) {
      const mezzo = (basso + alto + 1) >> 1;
      if (inizi[mezzo]! <= offset) basso = mezzo;
      else alto = mezzo - 1;
    }
    return basso;
  };
  const righe = new Set<number>();
  let scarto = 0;
  for (const e of op.edits) {
    const da = e.from + scarto;
    scarto += e.inserted.length - (e.to - e.from);
    // Un `add` inserisce «a capo e riga»: l'a capo in testa appartiene alla
    // riga di prima, che non cambia.
    const testa = e.inserted.length - e.inserted.replace(/^\n+/, "").length;
    const coda = e.inserted.length - e.inserted.replace(/\n+$/, "").length;
    if (testa + coda >= e.inserted.length) continue;
    const prima = rigaDi(da + testa);
    const ultimaRiga = rigaDi(da + e.inserted.length - coda - 1);
    for (let r = prima; r <= ultimaRiga; r++) righe.add(r);
  }
  return righe;
}

function riassunto(op: TextOperation): string {
  let inseriti = 0;
  let tolti = 0;
  let righePiu = 0;
  let righeMeno = 0;
  for (const e of op.edits) {
    inseriti += e.inserted.length;
    tolti += e.deleted.length;
    righePiu += e.inserted.split("\n").length - 1;
    righeMeno += e.deleted.split("\n").length - 1;
  }
  const n = op.edits.length;
  const parti = [`${n} ${n === 1 ? "modifica" : "modifiche"} al testo`, `+${numeri.format(inseriti)} −${numeri.format(tolti)} caratteri`];
  const righe = righePiu - righeMeno;
  if (righe !== 0) parti.push(`${righe > 0 ? "+" : "−"}${Math.abs(righe)} ${Math.abs(righe) === 1 ? "riga" : "righe"}`);
  return parti.join(", ");
}

/// Un valore lungo, accorciato: l'inizio, l'ultimo carattere e la lunghezza.
function accorciato(valore: string): string {
  return `${valore.slice(0, VALORE_CORTO - 8)}…${valore.slice(-1)}`;
}

/// Una riga del file, coi tag, i nomi e i valori colorati. I valori lunghi si
/// accorciano, se non si chiedono interi.
function rigaColorata(riga: string, interi: boolean): DocumentFragment {
  const pezzi = document.createDocumentFragment();
  const segni = /(<\/?|\/?>)|([A-Za-z_][\w:.-]*)(=)("[^"]*"|'[^']*')/g;
  let da = 0;
  let nomeTag = false;
  for (let m = segni.exec(riga); m !== null; m = segni.exec(riga)) {
    if (m.index > da) {
      const prima = riga.slice(da, m.index);
      if (nomeTag) {
        const nome = /^[^\s/>]+/.exec(prima)?.[0] ?? "";
        pezzi.append(el("span", "x-tag", nome), prima.slice(nome.length));
      } else {
        pezzi.append(prima);
      }
    }
    nomeTag = m[1]?.startsWith("<") ?? false;
    if (m[1] !== undefined) {
      pezzi.append(el("span", "x-segno", m[1]));
    } else {
      const valore = m[4]!;
      pezzi.append(el("span", "x-nome", m[2]!), m[3]!);
      if (interi || valore.length <= VALORE_CORTO) {
        pezzi.append(el("span", "x-valore", valore));
      } else {
        pezzi.append(el("span", "x-valore", accorciato(valore)));
        pezzi.append(el("span", "x-corto", ` ${numeri.format(valore.length - 2)} car.`));
      }
    }
    da = m.index + m[0].length;
  }
  if (da < riga.length) {
    const resto = riga.slice(da);
    if (nomeTag) {
      const nome = /^[^\s/>]+/.exec(resto)?.[0] ?? "";
      pezzi.append(el("span", "x-tag", nome), resto.slice(nome.length));
    } else {
      pezzi.append(resto);
    }
  }
  return pezzi;
}

/// Ridisegna il pannello: misure, ultima modifica e testo. Con `segui` la
/// prima riga toccata si porta in vista.
function mostraFile(segui: boolean): void {
  const testo = motore.normalized;
  const byte = new TextEncoder().encode(motore.text).length;
  const [x, y, w, h] = viewBox();
  const origine = x === 0 && y === 0 ? "" : ` da ${x}, ${y}`;
  const n = oggetti(motore).length;
  fileMisure.textContent = `${numeri.format(byte)} byte · ${quanti(n, "oggetto", "oggetti")} · pagina ${w} × ${h}${origine}`;
  fileModifica.textContent = ultima
    ? `${ultima.nome}: ${riassunto(ultima.operazione)}. Il resto del file non cambia.`
    : "Ogni gesto diventa un’operazione del motore: qui compaiono le righe che cambia.";

  const toccate = ultima ? righeToccate(ultima.operazione, testo) : new Set<number>();
  const righe = testo.endsWith("\n") ? testo.slice(0, -1).split("\n") : testo.split("\n");
  const lista = el("ol", "righe");
  let prima: HTMLElement | null = null;
  for (let i = 0; i < righe.length; i++) {
    const voce = el("li", toccate.has(i) ? "riga toccata" : "riga");
    voce.append(el("span", "numero", String(i + 1)));
    const corpo = el("span", "codice");
    corpo.append(rigaColorata(righe[i]!, fileInteri.checked));
    voce.append(corpo);
    if (toccate.has(i) && prima === null) prima = voce;
    lista.append(voce);
  }
  fileTesto.replaceChildren(lista);
  if (segui && prima !== null) {
    const sopra = prima.offsetTop;
    const sotto = sopra + prima.offsetHeight;
    if (sopra < fileTesto.scrollTop || sotto > fileTesto.scrollTop + fileTesto.clientHeight) {
      fileTesto.scrollTop = Math.max(0, sopra - fileTesto.clientHeight / 3);
    }
  }
}

// ---------------------------------------------------------------------------
// Ispettore: l'oggetto selezionato, o l'ultimo del disegno

const ispettore = byId<HTMLElement>("ispettore");
const lettore = new DOMParser();

function riga(lista: HTMLDListElement, nome: string, valore: string | Node): void {
  const dd = el("dd");
  dd.append(valore);
  lista.append(el("dt", undefined, nome), dd);
}

function codice(testo: string): HTMLElement {
  return el("code", undefined, testo);
}

/// Un valore del file: intero se è corto, altrimenti accorciato e aperto a
/// richiesta.
function valoreDi(valore: string): Node {
  if (valore.length <= VALORE_CORTO) return codice(valore);
  const d = el("details");
  const sommario = el("summary");
  sommario.append(codice(accorciato(valore)), ` ${quanti(valore.length, "carattere", "caratteri")}`);
  d.append(sommario, el("pre", undefined, valore));
  return d;
}

/// L'elemento di `voce` riletto dal testo del file, come farà chi lo apre.
function rileggi(voce: ElementItem): Element | null {
  const sorgente = motore.text.slice(voce.utf16[0], voce.utf16[1]);
  const doc = lettore.parseFromString(`<svg xmlns="${SVG_NS}" xmlns:fub="${FUB_NS}">${sorgente}</svg>`, "image/svg+xml");
  const elemento = doc.documentElement.firstElementChild;
  return elemento && elemento.namespaceURI === SVG_NS ? elemento : null;
}

/// Ciò che di un tratto a penna si legge decodificando `fub:ink`.
function righeInchiostro(lista: HTMLDListElement, elemento: Element): void {
  try {
    const ink = inkToQuantized(decodeInk(elemento.getAttributeNS(FUB_NS, "ink") ?? ""));
    const campioni = ink.samples;
    const pressione = campioni[0]?.p !== undefined;
    const inclinazione = campioni[0]?.a !== undefined;
    riga(lista, "Campioni", `${numeri.format(campioni.length)}, a scala s${ink.scale}`);
    riga(lista, "Durata", `${numeri.format(campioni[campioni.length - 1]?.t ?? 0)} ms`);
    riga(lista, "Pressione", pressione ? "dalla penna, 0…255" : "simulata dalla velocità (sim=1)");
    riga(lista, "Inclinazione", inclinazione ? "sì, altitudine e azimut" : "no");
  } catch {
    riga(lista, "fub:ink", "illeggibile");
  }
}

function aggiornaIspettore(): void {
  ispettore.replaceChildren();
  const tutti = oggetti(motore);
  const scelti = editor.selection;
  const perChiave = new Map(tutti.map((v) => [chiave(v), v]));
  const voce = scelti.length > 0 ? perChiave.get(scelti[scelti.length - 1]!) : tutti[tutti.length - 1];
  if (!voce) {
    ispettore.append(el("p", "vuoto", "Disegna qualcosa, o selezionalo: qui compaiono i suoi dati, letti dal file."));
    return;
  }
  const quale =
    scelti.length === 0
      ? "L’ultimo oggetto del disegno. Con la selezione (V) qui compare quello che scegli."
      : scelti.length === 1
        ? "L’oggetto selezionato."
        : `${quanti(scelti.length, "oggetto selezionato", "oggetti selezionati")}; qui l’ultimo.`;
  ispettore.append(el("p", "quale", quale));

  const lista = el("dl");
  riga(lista, "Che cos’è", RUOLI[voce.role] ?? `<${voce.tag}>`);
  const genitore = elementi(motore).find((v) => v.path.join(".") === voce.path.slice(0, -1).join("."));
  if (genitore?.layer) riga(lista, "Livello", genitore.layer.name);
  const elemento = rileggi(voce);
  if (elemento === null) {
    riga(lista, "Testo", valoreDi(motore.text.slice(voce.utf16[0], voce.utf16[1])));
    ispettore.append(lista);
    return;
  }
  if (voce.role === "stroke") righeInchiostro(lista, elemento);
  for (const a of Array.from(elemento.attributes)) riga(lista, a.name, valoreDi(a.value));
  ispettore.append(lista);
}

// ---------------------------------------------------------------------------
// Stato del lavoro

function mostraStato(): void {
  const contenitore = byId<HTMLElement>("stato");
  for (const stato of ORDINE_STATI) {
    const pacchetti = PACCHETTI.filter((p) => p.stato === stato);
    if (pacchetti.length === 0) continue;
    const gruppo = el("section", "gruppo");
    gruppo.dataset.stato = stato;
    gruppo.append(el("h3", undefined, STATI[stato]));
    const lista = el("ul");
    for (const p of pacchetti) {
      const voce = el("li");
      const testa = el("div", "voce-testa");
      testa.append(el("span", "codice", p.codice), el("span", "titolo", p.titolo));
      if (p.pr !== undefined) {
        const repo = p.repo ?? "Fub";
        const link = el("a", "pr", p.repo === undefined ? `#${p.pr}` : `${repo}#${p.pr}`);
        link.href = `https://github.com/Fubeo/${repo}/pull/${p.pr}`;
        link.target = "_blank";
        link.rel = "noopener";
        link.title = `Fubeo/${repo}#${p.pr}`;
        testa.append(link);
      }
      voce.append(testa, el("p", "nota", p.nota));
      lista.append(voce);
    }
    gruppo.append(lista);
    contenitore.append(gruppo);
  }
}

async function mostraVersione(): Promise<void> {
  const dove = byId<HTMLElement>("versione");
  try {
    const risposta = await fetch("/__anteprima/git", { cache: "no-store" });
    if (!risposta.ok) return;
    const { commit, quando } = (await risposta.json()) as { commit: string; quando: string };
    const data = new Date(quando);
    const formato = new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" });
    dove.textContent = `${commit} · ${formato.format(data)}`;
    dove.title = "Commit del ramo d'anteprima che questa pagina mostra";
    dove.hidden = false;
  } catch {
    // Senza il server dell'anteprima la riga non serve.
  }
}

// ---------------------------------------------------------------------------
// Avvio

mostraStato();
void mostraVersione();
aggiorna(true);
if (ripristinati > 0) {
  annunci.textContent = `Riaperto il disegno di prima: ${quanti(ripristinati, "oggetto", "oggetti")}.`;
}
