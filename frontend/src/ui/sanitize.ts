// **L'unico punto in cui dell'HTML entra nella webview.** (§3.6)
//
// Prima erano tre, e nessuno dei tre sapeva degli altri: `UiNode::Html` con un
// `innerHTML` diretto, l'anteprima del documento, il contenuto di un embed
// innestato nel suo segnaposto. Ognuno si fidava di chi lo aveva prodotto, e il
// ragionamento — «tanto il rendering è già escapato lato Rust» — è vero **oggi**
// e per **quel** produttore: non lo è per un tema, per un embed di terzi, per un
// blocco custom che un plugin rende come markup (§3.2), né per il giorno che
// qualcuno aggiunge il quarto punto d'ingresso senza sapere che quella frase era
// scritta da un'altra parte.
//
// La regola che questa seduta fissa è quella: **l'HTML che entra nella webview
// passa di qui, chiunque l'abbia prodotto.** Il valore non è
// nell'implementazione — è nel fatto che il varco sia uno, esattamente come per
// `UiNode::validate_untrusted` nel kernel.
//
// ## Perché un parser e non una regex
//
// Si parsa in un documento **inerte** (`DOMParser`: non esegue script e non
// carica risorse), si cammina l'albero e si tiene solo ciò che è in allowlist.
// Un parser non ha il problema che ha una regex — `<img src=x onerror=…>`
// scritto in dodici modi resta un `img` con un attributo `onerror`, e qui
// l'attributo semplicemente non è nell'elenco.
//
// ## Come è diviso, e perché
//
// La **politica** (cosa è ammesso) è un pugno di funzioni pure, in fondo al file
// e sotto test. Il **cammino sul DOM** non è testato: questa shell non ha un
// ambiente DOM nei test, che è il §17.2, e aggiungere una dipendenza per farlo
// qui sarebbe una decisione di un'altra seduta presa di straforo. È la stessa
// divisione con cui la decisione 0016 ha trattato il riconciliatore, e per la
// stessa ragione: la parte in cui si sbaglia in un modo che non si vede è la
// decisione, non l'`appendChild`.
//
// ## Cosa NON fa
//
// Non decide *cosa è lecito mostrare*: decide cosa è lecito **eseguire e
// caricare**. Il consenso esplicito per il contenuto remoto (5.3, 23.2) è una
// decisione di prodotto che non ha ancora dove essere espressa, e vive col §11.1
// insieme alle altre impostazioni; finché non c'è, il default è **no**.

/// Gli elementi che il rendering di un documento può produrre. Chiuso di
/// proposito: ciò che non è qui non si disegna, e aggiungerne uno è una riga che
/// si legge in review.
const TAG_AMMESSI = new Set([
  // struttura del testo
  "p", "div", "span", "br", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "blockquote", "pre", "code",
  "ul", "ol", "li", "dl", "dt", "dd",
  // enfasi e decorazioni
  "em", "strong", "del", "ins", "mark", "sub", "sup", "small", "abbr", "kbd", "samp", "var",
  // tabelle
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  // link e media (il `src` di un'immagine passa comunque da `risorsaConsentita`)
  "a", "img", "figure", "figcaption",
  // ripiegabili: `details`/`summary` è come si rende una sezione
  "details", "summary",
  // le caselle disabilitate delle task list
  "input",
]);

/// I tag il cui **contenuto è codice**: non perdono solo il tag, spariscono
/// interi. Per tutti gli altri, cadere fuori dall'allowlist significa perdere il
/// tag e tenere i figli — un `<section>` sconosciuto non deve far sparire il
/// paragrafo che contiene.
const TAG_DA_CANCELLARE = new Set(["script", "style", "template", "iframe", "object", "embed"]);

/// Gli attributi ammessi, per tag. `*` vale per tutti.
///
/// `class`, `id` e i `data-*` ci sono perché **sono il contratto** fra il
/// rendering e la shell: `data-wikilink-page` è come si naviga, `data-embed-page`
/// come si trascludono, `data-ui-slot` dove va una parte dichiarativa (§3.2),
/// `id` è l'ancora di blocco. Toglierli spegnerebbe metà dell'anteprima.
const ATTR_AMMESSI: Record<string, Set<string>> = {
  "*": new Set(["class", "id", "title", "dir", "lang"]),
  a: new Set(["href"]),
  img: new Set(["src", "alt", "width", "height"]),
  input: new Set(["type", "checked", "disabled"]),
  td: new Set(["style", "colspan", "rowspan"]),
  th: new Set(["style", "colspan", "rowspan", "scope"]),
  col: new Set(["style", "span"]),
  ol: new Set(["start"]),
};

/// Lo `style` è ammesso solo sulle celle e solo per l'allineamento: è ciò che il
/// provider markdown emette per le colonne di una tabella. Uno `style` libero è
/// un varco (`background: url(…)` che chiama casa, `position: fixed` sopra la
/// UI), ed è la differenza fra ammettere un attributo e ammettere *quel valore*.
const STYLE_AMMESSO = /^text-align:\s*(left|center|right);?$/;

/// Gli schemi che possono comparire in un link.
///
/// `javascript:` fuori perché è codice; `data:` fuori perché è un modo di
/// portarsi dietro un documento intero (`data:text/html,…`) e di aggirare
/// l'origine.
const SCHEMI_LINK = new Set(["http:", "https:", "mailto:"]);

// ---------------------------------------------------------------------------
// La politica: funzioni pure, e sono queste che i test guardano
// ---------------------------------------------------------------------------

export type EsitoTag = "tieni" | "scarta-tag" | "cancella";

/// Cosa fare di un elemento. Tre esiti e non due: «non ammesso» non è una
/// risposta sola, perché perdere un `<section>` sconosciuto e perdere uno
/// `<script>` devono avere effetti opposti sul contenuto.
export function esitoDelTag(tag: string): EsitoTag {
  const t = tag.toLowerCase();
  if (TAG_DA_CANCELLARE.has(t)) return "cancella";
  return TAG_AMMESSI.has(t) ? "tieni" : "scarta-tag";
}

/// Questo attributo può stare su questo tag?
///
/// I `data-*` passano tutti: sono il canale fra rendering e shell e nessuno li
/// interpreta come markup. `on*` non è un `data-*` e non è in nessuna
/// allowlist — che è tutto ciò che serve perché non passi.
export function attributoConsentito(tag: string, attributo: string): boolean {
  const nome = attributo.toLowerCase();
  if (nome.startsWith("on")) return false;
  if (nome.startsWith("data-")) return true;
  if (ATTR_AMMESSI["*"].has(nome)) return true;
  return ATTR_AMMESSI[tag.toLowerCase()]?.has(nome) ?? false;
}

export function styleConsentito(valore: string): boolean {
  return STYLE_AMMESSO.test(valore.trim());
}

/// Un `href`: **navigazione**, non caricamento. Un link esterno è legittimo — è
/// l'utente che decide se seguirlo — quindi http/https passano.
export function linkConsentito(valore: string): boolean {
  const v = valore.trim();
  if (v === "" || v.startsWith("#")) return true;
  if (!haSchema(v)) return !v.startsWith("//"); // relativo sì, protocol-relative no
  try {
    return SCHEMI_LINK.has(new URL(v).protocol);
  } catch {
    return false;
  }
}

/// Un `src`: **caricamento**, e cambia tutto. Una risorsa remota parte da sola,
/// senza che nessuno clicchi, e dice a chi la serve che quella nota è aperta —
/// per questo il default è bloccarla (5.3, 23.2) e restano i riferimenti dentro
/// al vault, che sono relativi.
export function risorsaConsentita(valore: string, remotaAmmessa = false): boolean {
  const v = valore.trim();
  if (v === "") return false;
  if (!haSchema(v)) return !v.startsWith("//");
  if (!remotaAmmessa) return false;
  try {
    return SCHEMI_LINK.has(new URL(v).protocol);
  } catch {
    return false;
  }
}

/// Un link che esce dall'app va aperto senza dargli in mano la finestra che lo
/// ha aperto (`window.opener`) né il referrer.
export function esterno(href: string): boolean {
  return /^https?:/i.test(href.trim());
}

function haSchema(v: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(v);
}

// ---------------------------------------------------------------------------
// Il cammino sul DOM
// ---------------------------------------------------------------------------

/// Ripulisce un frammento HTML e restituisce i nodi da innestare.
///
/// Restituisce un `DocumentFragment` e non una stringa **di proposito**: una
/// stringa ripulita che il chiamante rimettesse in `innerHTML` verrebbe parsata
/// una seconda volta, e la doppia parsatura è la classe di difetti che i
/// sanitizer pagano più cara. Chi chiama fa `append`, e non c'è nessuna seconda
/// occasione di interpretare.
export function sanitizeFragment(html: string): DocumentFragment {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out = document.createDocumentFragment();
  for (const child of Array.from(doc.body.childNodes)) {
    const pulito = pulisci(child);
    if (pulito) out.appendChild(pulito);
  }
  return out;
}

/// Innesta un frammento in un contenitore, sostituendo ciò che c'era.
///
/// È la funzione che i chiamanti usano davvero: `innerHTML = html` diventa
/// `setSanitizedHtml(el, html)`, e la differenza si vede nel diff.
export function setSanitizedHtml(container: HTMLElement, html: string): void {
  container.replaceChildren(sanitizeFragment(html));
}

function pulisci(node: Node): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent ?? "");
  if (node.nodeType !== Node.ELEMENT_NODE) return null; // commenti, CDATA, tutto il resto

  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const esito = esitoDelTag(tag);
  if (esito === "cancella") return null;
  if (esito === "scarta-tag") return figli(el, document.createDocumentFragment());

  const nuovo = document.createElement(tag);
  for (const attr of Array.from(el.attributes)) {
    const nome = attr.name.toLowerCase();
    if (!attributoConsentito(tag, nome)) continue;
    if (nome === "style" && !styleConsentito(attr.value)) continue;
    if (nome === "href" && !linkConsentito(attr.value)) continue;
    if (nome === "src" && !risorsaConsentita(attr.value)) continue;
    nuovo.setAttribute(nome, attr.value);
  }
  if (tag === "a" && esterno(nuovo.getAttribute("href") ?? "")) {
    nuovo.setAttribute("rel", "noopener noreferrer");
    nuovo.setAttribute("target", "_blank");
  }
  return figli(el, nuovo);
}

/// Ripulisce i figli di `el` e li mette dentro `dentro`, che restituisce.
function figli<T extends Node>(el: Element, dentro: T): T {
  for (const child of Array.from(el.childNodes)) {
    const pulito = pulisci(child);
    if (pulito) dentro.appendChild(pulito);
  }
  return dentro;
}
