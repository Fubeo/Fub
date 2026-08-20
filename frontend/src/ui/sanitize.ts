// **L'unico punto in cui dell'HTML entra nella webview.** (§3.6)
//
// Prima erano tre, e nessuno dei tre sapeva degli altri: `UiNode::Html` con un
// `innerHTML` diretto, l'anteprima del documento, il contenuto di un embed
// innestato nel suo segnaposto. Ognuno si fidava di chi lo aveva prodotto, e il
// ragionamento — «tanto il rendering è già escapato lato Rust» — è vero **oggi**
// e per **quel** produttore: non lo è per un tema, per un embed di terzi, per un
// blocco custom che un plugin rende come markup (§3.2), né per il giorno che
// qualcuno aggiunge il quarto punto d'ingresso senza sapere che quella frase era
// scritto da un'altra parte.
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
// La **politica** (cosa è ammesso, e cosa si impone) è un pugno di funzioni pure
// e di tabelle, in fondo al file e sotto test. È la stessa divisione con cui la
// decisione 0016 ha trattato il riconciliatore, e per la stessa ragione: la
// parte in cui si sbaglia in un modo che non si vede è la decisione, non
// l'`appendChild`.
//
// Qui c'era scritto che il **cammino sul DOM** non è testato «perché questa
// shell non ha un ambiente DOM nei test, che è il §17.2». Era vero quando è
// stato scritto e ha smesso di esserlo: `happy-dom` c'è, ed è una delle tre
// righe che la [0112](../../../docs/decisions/0112-un-e2e-contro-un-host-finto.md)
// ha misurato false in tre posti. Il cammino ora si prova dove ha un cliente
// vero — l'anteprima, in `ridisegno.test.ts` — invece che a vuoto.
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
const ALLOWED_TAGS = new Set([
  // struttura del testo
  "p", "div", "span", "br", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "blockquote", "pre", "code",
  "ul", "ol", "li", "dl", "dt", "dd",
  // enfasi e decorazioni
  "em", "strong", "del", "ins", "mark", "sub", "sup", "small", "abbr", "kbd", "samp", "var",
  // tabelle
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  // legame e media (il `src` di un'immagine passa comunque da `isAllowedResource`)
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
const TAGS_TO_REMOVE = new Set(["script", "style", "template", "iframe", "object", "embed"]);

/// Gli attributi ammessi, per tag. `*` vale per tutti.
///
/// `class`, `id` e i `data-*` ci sono perché **sono il contratto** fra il
/// rendering e la shell: `data-wikilink-page` è come si naviga, `data-embed-page`
/// come si trascludono, `data-ui-slot` dove va una parte dichiarativa (§3.2),
/// `id` è l'ancora di blocco. Toglierli spegnerebbe metà dell'anteprima — per
/// questo l'`id` non si toglie ma si **trasloca**, vedi `SPAZIO_CONTENUTO`.
const ALLOWED_ATTRIBUTES: Record<string, Set<string>> = {
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
const ALLOWED_STYLE = /^text-align:\s*(left|center|right);?$/;

/// Gli schemi che possono comparire in un legame.
///
/// `javascript:` fuori perché è codice; `data:` fuori perché è un modo di
/// portarsi dietro un documento intero (`data:text/html,…`) e di aggirare
/// l'origine.
const LINK_SCHEMES = new Set(["http:", "https:", "mailto:"]);

// ---------------------------------------------------------------------------
// La politica: funzioni pure, e sono queste che i test guardano
// ---------------------------------------------------------------------------

export type ResultTag = "tieni" | "scarta-tag" | "cancella";

/// Cosa fare di un elemento. Tre esiti e non due: «non ammesso» non è una
/// risposta sola, perché perdere un `<section>` sconosciuto e perdere uno
/// `<script>` devono avere effetti opposti sul contenuto.
export function resultOfTag(tag: string): ResultTag {
  const t = tag.toLowerCase();
  if (TAGS_TO_REMOVE.has(t)) return "cancella";
  return ALLOWED_TAGS.has(t) ? "tieni" : "scarta-tag";
}

/// Questo attributo può stare su questo tag?
///
/// I `data-*` passano tutti: sono il canale fra rendering e shell e nessuno li
/// interpreta come markup. `on*` non è un `data-*` e non è in nessuna
/// allowlist — che è tutto ciò che serve perché non passi.
export function allowedAttribute(tag: string, attribute: string): boolean {
  const name = attribute.toLowerCase();
  if (name.startsWith("on")) return false;
  if (name.startsWith("data-")) return true;
  if (ALLOWED_ATTRIBUTES["*"].has(name)) return true;
  return ALLOWED_ATTRIBUTES[tag.toLowerCase()]?.has(name) ?? false;
}

// ---------------------------------------------------------------------------
// I due spazi di nomi (§5.3)
// ---------------------------------------------------------------------------
//
// Un `id` è **globale nel documento**, e finché il documento è uno solo per
// tutti gli inquilini della webview, la shell e il contenuto di una nota
// pescano dallo stesso sacchetto. La shell cerca i propri elementi per nome —
// `document.getElementById("save-state")`, `#context-menu`, `#activity-panel`,
// `#toast`, più tutti quelli che `identificatore()` genera per l'accessibilità
// — e `getElementById` restituisce il **primo** elemento in ordine di
// documento con quel nome: una nota che porti quel nome se lo prende, e la
// shell smette di trovare la propria barra di stato o ne rimuove un pezzo
// (`#toast` e `#context-menu` si tolgono per nome).
//
// Non è esecuzione di codice e non arriva da un estraneo: arriva da un vault.
// Ma un vault si scarica, e l'`id` del contenuto non è nemmeno HTML grezzo —
// basta un titolo. `## save-state` diventa uno slug, e lo slug diventa l'`id`
// dell'`<h2>`; `^save-state` in coda a un paragrafo fa lo stesso.
//
// **Il rimedio non è togliere l'attributo**: l'`id` è l'ancora di blocco, ed è
// ciò che rende un blocco indirizzabile. È tenere i due spazi di nomi
// **separati** — ogni nome che viene dal contenuto vive sotto un prefisso, e
// nessun nome della shell ce l'ha (lo tiene fermo un presidio che legge
// `index.html`).
//
// # Perché una funzione sola, e non una costante usata due volte
//
// Le metà sono due: l'`id` che si **scrive** e il `#frammento` che lo
// **cerca** — `[testo](#sezione)` è come un documento rimanda a se stesso, e lo
// risolve il browser confrontando la stringa dopo il `#` con gli `id` della
// pagina. Prefissare solo la prima rompe ogni legame interno; prefissare solo la
// seconda non ripara niente. Sono la classe di difetti in cui *si aggiorna il
// lato che si stava guardando*.
//
// Per questo il prefisso non è una costante che due rami si copiano: è
// `nelloSpazioDelContenuto`, e sopra ci sta **una** funzione —
// `valoreDellAttributo` — che prende il nome dell'attributo e decide. Il
// cammino sul DOM la chiama una volta sola, per ogni attributo, senza sapere
// quali riguardi: i due lati non possono divergere perché non sono due posti.

/// Il prefisso sotto cui vive ogni nome che viene dal contenuto.
///
/// Nessun `id` della shell comincia così, e non è una speranza: `sanitize.dom`
/// legge `index.html` e i nomi letterali dei moduli e lo verifica.
const CONTENT_SPACE = "fub-contenuto-";

/// L'unico posto in cui un nome che viene dal contenuto diventa un nome del DOM.
export function inContentSpace(name: string): string {
  return CONTENT_SPACE + name;
}

/// Il valore con cui un attributo ammesso entra davvero nel documento.
///
/// È l'identità per tutti tranne i due che **nominano un identificatore**, e le
/// due riscritture stanno qui accanto di proposito: si leggono insieme, e chi
/// ne cambiasse una vedrebbe l'altra.
///
/// Il `#` nudo non si tocca: è il segnaposto che il provider markdown mette sui
/// wikilink (`href="#"` con la navigazione presa da `data-wikilink-page`), e
/// prefissarlo lo trasformerebbe in un salto verso un blocco che non esiste.
export function attributeValue(name: string, value: string): string {
  if (name === "id") return inContentSpace(value);
  if (name === "href" && value.startsWith("#") && value.length > 1) {
    return `#${inContentSpace(value.slice(1))}`;
  }
  return value;
}

/// Gli attributi che questo varco **impone**, per tag, a prescindere da ciò che
/// il produttore aveva scritto (§2.9).
///
/// Un `<a>` che esce dall'app riceve già `rel`/`target` qui sotto per la stessa
/// ragione di forma: c'è una cosa che vale per **ogni** HTML che entra nella
/// webview, e il posto dove scriverla è il punto che tutti attraversano — non i
/// produttori, che sono il provider markdown di oggi più chiunque a M5.
///
/// Per un'immagine quella cosa è **quando si carica**. Un `<img>` senza
/// `loading` parte appena è nel documento: aprire in Lettura una nota con
/// duecento immagini apre duecento letture di file prima che se ne veda una, e
/// una galleria in fondo alla nota si paga per intero anche se non ci si arriva
/// mai. `loading="lazy"` sposta la decisione al browser, che è il solo a sapere
/// dove sta la finestra — ed è la ragione per cui questa metà della voce si
/// poteva fare **senza** layout: la shell non calcola cosa si vede, dichiara
/// che non lo vuole decidere lei. `decoding="async"` è la stessa frase per la
/// decodifica, che altrimenti blocca il thread che disegna.
///
/// Sono **imposti dopo** la copia degli attributi, quindi un documento che
/// scrivesse `loading="eager"` non vince — e non vincerebbe comunque, perché
/// `loading` non è in `ATTR_AMMESSI`: le due cose sono d'accordo di proposito,
/// e l'ordine dice quale delle due è la regola.
export const REQUIRED_ATTRS: Record<string, Record<string, string>> = {
  img: { loading: "lazy", decoding: "async" },
};

export function isAllowedStyle(value: string): boolean {
  return ALLOWED_STYLE.test(value.trim());
}

/// Un `href`: **navigazione**, non caricamento. Un link esterno è legittimo — è
/// l'utente che decide se seguirlo — quindi http/https passano.
export function isAllowedLink(value: string): boolean {
  const v = value.trim();
  if (v === "" || v.startsWith("#")) return true;
  if (!hasScheme(v)) return !v.startsWith("//"); // relativo sì, protocol-relative no
  try {
    return LINK_SCHEMES.has(new URL(v).protocol);
  } catch {
    return false;
  }
}

/// Un `src`: **caricamento**, e cambia tutto. Una risorsa remota parte da sola,
/// senza che nessuno clicchi, e dice a chi la serve che quella nota è aperta —
/// per questo il default è bloccarla (5.3, 23.2) e restano i riferimenti dentro
/// al vault, che sono relativi.
export function isAllowedResource(value: string, remoteAllowed = false): boolean {
  const v = value.trim();
  if (v === "") return false;
  if (!hasScheme(v)) return !v.startsWith("//");
  if (!remoteAllowed) return false;
  try {
    return LINK_SCHEMES.has(new URL(v).protocol);
  } catch {
    return false;
  }
}

/// Un link che esce dall'app va aperto senza dargli in mano la finestra che lo
/// ha aperto (`window.opener`) né il referrer.
export function external(href: string): boolean {
  return /^https?:/i.test(href.trim());
}

function hasScheme(v: string): boolean {
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
    const clean = sanitizeNode(child);
    if (clean) out.appendChild(clean);
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

function sanitizeNode(node: Node): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent ?? "");
  if (node.nodeType !== Node.ELEMENT_NODE) return null; // commenti, CDATA, tutto il resto

  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const result = resultOfTag(tag);
  if (result === "cancella") return null;
  if (result === "scarta-tag") return children(el, document.createDocumentFragment());

  const newItem = document.createElement(tag);
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    if (!allowedAttribute(tag, name)) continue;
    if (name === "style" && !isAllowedStyle(attr.value)) continue;
    if (name === "href" && !isAllowedLink(attr.value)) continue;
    if (name === "src" && !isAllowedResource(attr.value)) continue;
    // Il consenso si decide sul valore **come l'ha scritto il produttore**; la
    // traslazione nello spazio di nomi del contenuto viene dopo, ed è l'ultima
    // cosa che succede a un valore prima che sia nel documento.
    newItem.setAttribute(name, attributeValue(name, attr.value));
  }
  for (const [name, value] of Object.entries(REQUIRED_ATTRS[tag] ?? {})) {
    newItem.setAttribute(name, value);
  }
  if (tag === "a" && external(newItem.getAttribute("href") ?? "")) {
    newItem.setAttribute("rel", "noopener noreferrer");
    newItem.setAttribute("target", "_blank");
  }
  return children(el, newItem);
}

/// Ripulisce i figli di `el` e li mette dentro `inside`, che restituisce.
function children<T extends Node>(el: Element, inside: T): T {
  for (const child of Array.from(el.childNodes)) {
    const clean = sanitizeNode(child);
    if (clean) inside.appendChild(clean);
  }
  return inside;
}
