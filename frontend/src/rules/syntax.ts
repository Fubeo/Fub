// **La sintassi si riconosce in UN posto solo** (§4.4, decisione 0115).
//
// La §4.4 chiedeva chi, fra il parser Lezer del buffer e il modello del file,
// fosse la verità. La misura ha risposto che la domanda era mal posta e che i
// parser erano più di due: dentro `frontend/` la stessa sintassi era scritto
// **tredici** volte in sei costrutti, in tre moduli che non si parlavano —
// `livepreview.ts` per decorare, `editor-commands.ts` per i gesti,
// `completions.ts` per il popup — e le tre non erano d'accordo fra loro. Su
// `> - [ ] x` la vivi preview disegnava una casella e `Mod-Enter` non vedeva
// una todo; su `vedi.#tag` il popup si apriva e la decorazione non compariva.
//
// La verità non è nessuno dei due parser, ed è la **dichiarazione**:
//
// - con la 0104 la nostra vivi preview è *una* superficie di scrittura fra
//   quelle possibili — un terzo può portare la sua — quindi le sue regex non
//   possono essere la verità nemmeno per lei;
// - con la 0018 il modello non può esserlo per un buffer sporco, che al di qua
//   del confine non conosce nessuno.
//
// Ciò che resta, e che vale per tutte le superfici, è **ciò che il contratto
// dichiara**: il vocabolario di `options::syntax` e il trigger di chi ne ha uno.
// Questo modulo lo interpreta, e ogni altro modulo della shell è un suo cliente.
//
// # Le tre specie di regola qui dentro, e da dove viene ciascuna
//
// 1. **Generata**: i delimitatori inline vengono da `sintassi.generated.ts`,
//    emesso da un montaggio vero. `==` non è scritto qui: è il trigger di
//    `HighlightRule`. Una quarta sintassi inline registrata in Rust arriva alla
//    shell senza che nessuno scriva una riga — è il moltiplicatore del §4.4,
//    tolto per la famiglia in cui è scritto la maggioranza delle ~50 estensioni
//    del 5.2.
// 2. **Rispecchiata**: `scanTags` sta in `mirrored.ts` e ha la gemella Rust nel
//    contratto, legata da una fixture. Non si può cambiare da un lato solo.
// 3. **Scritta qui, una volta**: il wikilink e la voce di lista. Della prima il
//    contratto dichiara l'**interno** (`parseWikilinkInner`, gemella di
//    `parse_wikilink_inner`) e non i delimitatori; la seconda non ha gemella
//    affatto, perché è una regola di *gesto* — quale riga continua premendo
//    Invio — e nel modello non esiste. Il corpus (`corpus.test.ts`) è ciò che
//    tiene onesta la prima contro il modello.
//
// Ciò che NON sta qui: l'albero Lezer. Enfasi, heading, fence, citazioni e legame
// markdown li conosce `lang-markdown` e li legge `livepreview.ts` dal tree —
// questo modulo si occupa della sintassi che il parser **non** conosce, cioè
// esattamente quella che senza una dichiarazione andrebbe scritto due volte.
import { ALPHANUMERIC, TAG_CHARACTER, scanTags } from "./mirrored";
import { MARKDOWN_SYNTAX } from "./syntax.generated";

/// Un trigger dichiarato, nella forma serde che attraverserà l'IPC.
export type Trigger =
  | { readonly inline: { readonly open: string; readonly close: string } }
  | { readonly fence: { readonly info: readonly string[] } }
  | null;

/// Una sintassi dichiarata: il nome del vocabolario, e la forma quando è un
/// dato invece che una grammatica.
export interface SyntaxForm {
  readonly name: string;
  readonly trigger: Trigger;
}

/// I delimitatori inline **dichiarati**, in ordine di dichiarazione.
///
/// È l'elenco da cui la vivi preview genera le proprie decorazioni invece di
/// riscriverne la grammatica: `[{ nome: "fub:highlight", open: "==", close: "==" }]`
/// oggi, e domani ciò che qualcuno avrà registrato.
export function inlineDelimiters(
  forms: readonly SyntaxForm[] = MARKDOWN_SYNTAX,
): { name: string; open: string; close: string }[] {
  const out: { name: string; open: string; close: string }[] = [];
  for (const f of forms) {
    if (f.trigger && "inline" in f.trigger) {
      out.push({ name: f.name, open: f.trigger.inline.open, close: f.trigger.inline.close });
    }
  }
  return out;
}

/// Le info string dei recinti **dichiarati**: `mermaid`, `math`, …
///
/// La shell non le usa per decorare — un recinto lo riconosce già Lezer, e cosa
/// ci finisce dentro lo disegna il renderer di là dal confine — ma le usa il
/// completamento, che propone un'info string invece di indovinarla.
export function declaredFences(
  forms: readonly SyntaxForm[] = MARKDOWN_SYNTAX,
): string[] {
  const out: string[] = [];
  for (const f of forms) {
    if (f.trigger && "fence" in f.trigger) out.push(...f.trigger.fence.info);
  }
  return out;
}

// ── I tratti fra due delimitatori ────────────────────────────────────────────

/// Un tratto agganciato da un trigger inline, con i confini del **contenuto**
/// dentro quelli del match.
export interface SyntaxSpan {
  /// La sintassi che ha agganciato (`fub:highlight`).
  name: string;
  /// Il match intero, delimitatori compresi.
  from: number;
  to: number;
  /// Il contenuto, delimitatori esclusi.
  contentFrom: number;
  contentTo: number;
}

/// I tratti `open…close` di una riga, per ogni delimitatore dichiarato.
///
/// Le due regole non negoziabili, che sono quelle della `SyntaxRule` di là:
/// il contenuto non è vuoto (un delimitatore vuoto è una regola inerte, e il
/// registro la rifiuta), e non contiene il delimitatore d'apertura — altrimenti
/// `==a== e ==b==` sarebbe **un** tratto lungo invece di due.
///
/// I tratti si cercano riga per riga perché un delimitatore inline non
/// attraversa un fine riga: è la stessa regola per cui i replace della vivi
/// preview non lo attraversano mai.
function isEscaped(row: string, at: number): boolean {
  let backslashes = 0;
  for (let j = at - 1; j >= 0 && row[j] === "\\"; j -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

export function spans(row: string, declared = inlineDelimiters()): SyntaxSpan[] {
  const out: SyntaxSpan[] = [];
  for (const d of declared) {
    if (d.open === "" || d.close === "") continue;
    let i = 0;
    while (i < row.length) {
      const opens = row.indexOf(d.open, i);
      if (opens === -1) break;
      if (isEscaped(row, opens)) {
        i = opens + d.open.length;
        continue;
      }
      const from = opens + d.open.length;
      let closes = row.indexOf(d.close, from);
      while (closes !== -1 && isEscaped(row, closes)) {
        closes = row.indexOf(d.close, closes + d.close.length);
      }
      if (closes === -1) break;
      if (closes === from) {
        // Contenuto vuoto: si riparte **dopo** l'apertura, non dopo il match,
        // o `====testo====` perderebbe il tratto vero che gli sta dentro.
        i = from;
        continue;
      }
      out.push({
        name: d.name,
        from: opens,
        to: closes + d.close.length,
        contentFrom: from,
        contentTo: closes,
      });
      i = closes + d.close.length;
    }
  }
  out.sort((a, b) => a.from - b.from || a.to - b.to);
  return out;
}

// ── I wikilink ───────────────────────────────────────────────────────────────

/// L'interno di un wikilink: `Page#Heading^block|Alias`.
///
/// Gemella di `fub_abi::model::parse_wikilink_inner`, e sta qui e non in
/// `mirrored.ts` per una ragione sola: nella shell serve **con** i confini del
/// match, che di là non esistono (il `!` dell'embed sta fuori dalle parentesi, e
/// il modello lo porta come campo del riferimento). La grammatica dei tre campi
/// è la stessa, riga per riga.
///
/// Prima la shell faceva `interno.split("#")[0].trim()` e buttava via il resto:
/// `Mod-click` su `[[Nota#Sezione]]` apriva la nota **in cima**, mentre lo
/// stesso legame cliccato in Lettura arrivava alla sezione — due risposte per lo
/// stesso legame, che è la §4.4 nella sua forma più piccola.
export interface InternalWikilink {
  page: string;
  heading: string | null;
  block: string | null;
  alias: string | null;
}

export function parseWikilinkInner(inner: string): InternalWikilink {
  const bar = inner.indexOf("|");
  const part = bar === -1 ? inner : inner.slice(0, bar);
  const alias = bar === -1 ? null : inner.slice(bar + 1).trim();

  const anchor = part.indexOf("^");
  const withoutBlock = anchor === -1 ? part : part.slice(0, anchor);
  const block = anchor === -1 ? null : part.slice(anchor + 1).trim();

  const hash = withoutBlock.indexOf("#");
  const page = (hash === -1 ? withoutBlock : withoutBlock.slice(0, hash)).trim();
  const heading = hash === -1 ? null : withoutBlock.slice(hash + 1).trim() || null;

  return { page, heading, block, alias: alias === "" ? null : alias };
}

export interface FoundWikilink extends InternalWikilink {
  /// Il match intero, `!` compreso se è un embed.
  from: number;
  to: number;
  /// L'interno, `[[`/`]]` esclusi.
  innerFrom: number;
  innerA: number;
  /// `![[…]]` invece di `[[…]]`.
  embed: boolean;
  /// L'interno **prima** dell'eventuale `|`, come sta scritto nella sorgente.
  ///
  /// È ciò che viaggia nel DOM come data-attribute: chi rilegge l'attributo lo
  /// ripassa da `parseWikilinkInner` e ottiene gli stessi tre campi, senza che
  /// nessuno debba ri-serializzare `page#heading^block` — una
  /// ri-serializzazione è una seconda grammatica, ed è esattamente ciò che
  /// questo modulo esiste per non avere.
  target: string;
}

const RE_WIKILINK = /(!?)\[\[([^[\]\n]+)\]\]/g;

/// I wikilink (e gli embed) di una riga.
export function wikilink(row: string): FoundWikilink[] {
  const out: FoundWikilink[] = [];
  RE_WIKILINK.lastIndex = 0;
  for (let m; (m = RE_WIKILINK.exec(row)); ) {
    const from = m.index;
    const to = from + m[0].length;
    const bar = m[2].indexOf("|");
    out.push({
      ...parseWikilinkInner(m[2]),
      from,
      to,
      innerFrom: from + m[1].length + 2,
      innerA: to - 2,
      embed: m[1] === "!",
      target: bar === -1 ? m[2] : m[2].slice(0, bar),
    });
  }
  return out;
}

// ── I tag ────────────────────────────────────────────────────────────────────

/// I `#tag` di una riga. È `scanTags`, e passa di qui perché il posto in cui la
/// shell chiede «cos'è sintassi» dev'essere uno: chi importa direttamente la
/// gemella si porta via anche la libertà di sbagliare il contorno.
export { scanTags };

/// Il `#tag` che si sta scrivendo **adesso**, cioè in coda a questo testo.
///
/// Non è `scanTags` — un tag a metà non è ancora un tag, e `#` da solo non lo
/// sarà mai — ma usa le **stesse** due classi di caratteri, che è ciò che
/// impedisce al popup di aprirsi su un token che, finito di scrivere, non
/// verrebbe decorato. Prima erano due classi diverse scritte in due file, e su
/// `vedi.#tag` il popup si apriva e la decorazione non compariva.
///
/// `from` è dove sta il `#`, `query` è ciò che è già stato digitato dopo.
export function tagInProgress(first: string): { from: number; query: string } | null {
  const rowStart = first.lastIndexOf("\n") + 1;
  let i = first.length;
  while (i > rowStart) {
    const lowSurrogate = first.charCodeAt(i - 1);
    const start =
      lowSurrogate >= 0xdc00 && lowSurrogate <= 0xdfff && i - 2 >= rowStart ? i - 2 : i - 1;
    if (!TAG_CHARACTER.test(first.slice(start, i))) break;
    i = start;
  }
  if (i === rowStart || first[i - 1] !== "#") return null;
  const hash = i - 1;
  if (hash > rowStart) {
    const beforeLowSurrogate = first.charCodeAt(hash - 1);
    const previousIndex =
      beforeLowSurrogate >= 0xdc00 && beforeLowSurrogate <= 0xdfff && hash >= rowStart + 2
        ? hash - 2
        : hash - 1;
    if (first[hash - 1] === "#" || ALPHANUMERIC.test(first.slice(previousIndex, hash))) return null;
  }
  return { from: hash, query: first.slice(i) };
}

// ── Le voci di lista ─────────────────────────────────────────────────────────

/// Una riga letta come voce di lista, todo o citazione.
///
/// `markerEnd` è dove comincia il contenuto, in code unit dall'inizio riga: è
/// l'unica coordinata che i comandi usano per tagliare o sostituire il
/// marcatore.
export interface ListEntry {
  /// Il prefisso di citazione (`"> "`, `"> > "`), `""` se non c'è.
  ///
  /// Esiste perché una todo dentro una citazione **è** una todo: la vivi
  /// preview lo sapeva da sempre (`(?:\s*>\s*)*` nella sua regex) e i comandi
  /// no, quindi su `> - [ ] x` si vedeva una casella che `Mod-Enter` non
  /// riconosceva.
  quote: string;
  indent: string;
  kind: "bullet" | "ordered" | "quote";
  /// Il pallino (`-`/`*`/`+`), il delimitatore (`.`/`)`) per le numerate,
  /// oppure `>` per le citazioni.
  bullet: string;
  /// Solo per le numerate.
  number: number | null;
  /// Il simbolo dentro le parentesi (`" "`, `"x"`, `"/"`, …), `null` se la voce
  /// non ha una casella. Il **simbolo** e non un booleano, perché gli stati
  /// personalizzati esistono nel modello (`relaxed_tasklist_matching`) e un
  /// booleano li appiattirebbe proprio dove il §10.1 li apre.
  symbol: string | null;
  /// Dove finisce il marcatore, cioè dove comincia il contenuto.
  markerEnd: number;
  /// Dove sta la casella, se c'è: `[` … `]` compresi.
  boxFrom: number;
  boxTo: number;
  content: string;
}

// Il prefisso di citazione, la voce, la casella. Tre pezzi e non una regex
// sola: le tre condizioni sono indipendenti (una todo può stare in una
// citazione, una citazione può non avere voci), e una regex che le impastasse
// sarebbe di nuovo l'oggetto che tre moduli riscrivono diverso.
const RE_QUOTE = /^((?:\s*>)+\s?)/;
// Fino a tre spazi di rientro prima del pallino sono ancora la stessa voce
// (CommonMark), e dopo il pallino ne bastano da uno a quattro. La versione dei
// comandi ne pretendeva **esattamente uno**, quindi `-  [ ] x` era un bullet e
// non una todo: due letture della stessa riga.
const RE_BULLET = /^(\s*)([-*+])( {1,4}|\t)/;
const RE_ORDERED = /^(\s*)(\d{1,9})([.)])( {1,4}|\t)/;
// Un solo carattere fra parentesi, seguito da spazio o fine riga. Non `[ xX]`:
// il simbolo lo interpreta `taskChecked`, che è la regola del contratto, e
// restringerlo qui vorrebbe dire che `- [/] in corso` è una task nel modello e
// non lo è nell'editor.
const RE_BOX = /^\[([^\]\r\n])\](?=[ \t]|$)/u;

/// La riga è una voce di lista, una todo o una citazione?
///
/// È il cancello di ogni comando di lista e della checkbox della vivi preview:
/// dove risponde `null`, il comando restituisce `false` e la battuta cade sul
/// binding di default.
export function listItem(row: string): ListEntry | null {
  const mq = RE_QUOTE.exec(row);
  const quote = mq ? mq[1] : "";
  const rest = row.slice(quote.length);

  const readBox = (from: number): { symbol: string | null; end: number } => {
    const mb = RE_BOX.exec(rest.slice(from));
    if (!mb) return { symbol: null, end: from };
    return { symbol: mb[1], end: from + mb[0].length };
  };

  const mb = RE_BULLET.exec(rest);
  if (mb) {
    const afterMarker = mb[0].length;
    const box = readBox(afterMarker);
    // Dopo la casella si mangia **uno** spazio: è il separatore fra marcatore e
    // contenuto, e senza toglierlo `content` comincerebbe con uno spazio che i
    // comandi poi riscrivono.
    const end = box.symbol === null ? afterMarker : box.end + (rest[box.end] ? 1 : 0);
    return {
      quote,
      indent: mb[1],
      kind: "bullet",
      bullet: mb[2],
      number: null,
      symbol: box.symbol,
      markerEnd: quote.length + end,
      boxFrom: box.symbol === null ? -1 : quote.length + box.end - 3,
      boxTo: box.symbol === null ? -1 : quote.length + box.end,
      content: rest.slice(end),
    };
  }

  const mo = RE_ORDERED.exec(rest);
  if (mo) {
    const afterMarker = mo[0].length;
    const box = readBox(afterMarker);
    const end = box.symbol === null ? afterMarker : box.end + (rest[box.end] ? 1 : 0);
    return {
      quote,
      indent: mo[1],
      kind: "ordered",
      bullet: mo[3],
      number: Number(mo[2]),
      symbol: box.symbol,
      markerEnd: quote.length + end,
      boxFrom: box.symbol === null ? -1 : quote.length + box.end - 3,
      boxTo: box.symbol === null ? -1 : quote.length + box.end,
      content: rest.slice(end),
    };
  }

  if (quote !== "") {
    // Una citazione nuda: il marcatore **è** il prefisso, e `indent` resta
    // vuoto. Continuandola si riscrive `quote` per intero, quindi `> > ` resta
    // annidata invece di appiattirsi su un `> ` — che è ciò che faceva la
    // versione con `indent` più un `>` cablato.
    return {
      quote,
      indent: "",
      kind: "quote",
      bullet: ">",
      number: null,
      symbol: null,
      markerEnd: quote.length,
      boxFrom: -1,
      boxTo: -1,
      content: rest,
    };
  }
  return null;
}

/// Il marcatore della voce **successiva** a `voce`, per l'Invio.
///
/// Stesso tipo, stessa citazione e stesso rientro; le numerate prendono il
/// numero dopo, e le todo nascono non spuntate anche se la voce corrente era
/// `[x]` — spuntata è la cosa fatta, non quella che si sta per scrivere.
export function nextMarker(entry: ListEntry): string {
  if (entry.kind === "quote") return entry.quote;
  const box = entry.symbol !== null ? "[ ] " : "";
  const prefix = `${entry.quote}${entry.indent}`;
  if (entry.kind === "ordered") return `${prefix}${entry.number! + 1}${entry.bullet} ${box}`;
  return `${prefix}${entry.bullet} ${box}`;
}
