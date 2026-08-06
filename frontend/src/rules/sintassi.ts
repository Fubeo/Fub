// **La sintassi si riconosce in UN posto solo** (§4.4, decisione 0115).
//
// La §4.4 chiedeva chi, fra il parser Lezer del buffer e il modello del file,
// fosse la verità. La misura ha risposto che la domanda era mal posta e che i
// parser erano più di due: dentro `frontend/` la stessa sintassi era scritta
// **tredici** volte in sei costrutti, in tre moduli che non si parlavano —
// `livepreview.ts` per decorare, `editor-commands.ts` per i gesti,
// `completions.ts` per il popup — e le tre non erano d'accordo fra loro. Su
// `> - [ ] x` la live preview disegnava una casella e `Mod-Enter` non vedeva
// una todo; su `vedi.#tag` il popup si apriva e la decorazione non compariva.
//
// La verità non è nessuno dei due parser, ed è la **dichiarazione**:
//
// - con la 0104 la nostra live preview è *una* superficie di scrittura fra
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
//    tolto per la famiglia in cui è scritta la maggioranza delle ~50 estensioni
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
// Ciò che NON sta qui: l'albero Lezer. Enfasi, heading, fence, citazioni e link
// markdown li conosce `lang-markdown` e li legge `livepreview.ts` dal tree —
// questo modulo si occupa della sintassi che il parser **non** conosce, cioè
// esattamente quella che senza una dichiarazione andrebbe scritta due volte.
import { ALFANUMERICO, CARATTERE_DI_TAG, scanTags } from "./mirrored";
import { SINTASSI_MARKDOWN } from "./sintassi.generated";

/// Un trigger dichiarato, nella forma serde che attraverserà l'IPC.
export type Trigger =
  | { readonly inline: { readonly open: string; readonly close: string } }
  | { readonly fence: { readonly info: readonly string[] } }
  | null;

/// Una sintassi dichiarata: il nome del vocabolario, e la forma quando è un
/// dato invece che una grammatica.
export interface FormaDiSintassi {
  readonly name: string;
  readonly trigger: Trigger;
}

/// I delimitatori inline **dichiarati**, in ordine di dichiarazione.
///
/// È l'elenco da cui la live preview genera le proprie decorazioni invece di
/// riscriverne la grammatica: `[{ nome: "fub:highlight", open: "==", close: "==" }]`
/// oggi, e domani ciò che qualcuno avrà registrato.
export function delimitatoriInline(
  forme: readonly FormaDiSintassi[] = SINTASSI_MARKDOWN,
): { nome: string; open: string; close: string }[] {
  const out: { nome: string; open: string; close: string }[] = [];
  for (const f of forme) {
    if (f.trigger && "inline" in f.trigger) {
      out.push({ nome: f.name, open: f.trigger.inline.open, close: f.trigger.inline.close });
    }
  }
  return out;
}

/// Le info string dei recinti **dichiarati**: `mermaid`, `math`, …
///
/// La shell non le usa per decorare — un recinto lo riconosce già Lezer, e cosa
/// ci finisce dentro lo disegna il renderer di là dal confine — ma le usa il
/// completamento, che propone un'info string invece di indovinarla.
export function recintiDichiarati(
  forme: readonly FormaDiSintassi[] = SINTASSI_MARKDOWN,
): string[] {
  const out: string[] = [];
  for (const f of forme) {
    if (f.trigger && "fence" in f.trigger) out.push(...f.trigger.fence.info);
  }
  return out;
}

// ── I tratti fra due delimitatori ────────────────────────────────────────────

/// Un tratto agganciato da un trigger inline, con i confini del **contenuto**
/// dentro quelli del match.
export interface Tratto {
  /// La sintassi che ha agganciato (`fub:highlight`).
  nome: string;
  /// Il match intero, delimitatori compresi.
  from: number;
  to: number;
  /// Il contenuto, delimitatori esclusi.
  contenutoDa: number;
  contenutoA: number;
}

/// I tratti `open…close` di una riga, per ogni delimitatore dichiarato.
///
/// Le due regole non negoziabili, che sono quelle della `SyntaxRule` di là:
/// il contenuto non è vuoto (un delimitatore vuoto è una regola inerte, e il
/// registro la rifiuta), e non contiene il delimitatore d'apertura — altrimenti
/// `==a== e ==b==` sarebbe **un** tratto lungo invece di due.
///
/// I tratti si cercano riga per riga perché un delimitatore inline non
/// attraversa un fine riga: è la stessa regola per cui i replace della live
/// preview non lo attraversano mai.
export function tratti(riga: string, dichiarati = delimitatoriInline()): Tratto[] {
  const out: Tratto[] = [];
  for (const d of dichiarati) {
    if (d.open === "" || d.close === "") continue;
    let i = 0;
    while (i < riga.length) {
      const apre = riga.indexOf(d.open, i);
      if (apre === -1) break;
      const da = apre + d.open.length;
      const chiude = riga.indexOf(d.close, da);
      if (chiude === -1) break;
      if (chiude === da) {
        // Contenuto vuoto: si riparte **dopo** l'apertura, non dopo il match,
        // o `====testo====` perderebbe il tratto vero che gli sta dentro.
        i = da;
        continue;
      }
      out.push({
        nome: d.nome,
        from: apre,
        to: chiude + d.close.length,
        contenutoDa: da,
        contenutoA: chiude,
      });
      i = chiude + d.close.length;
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
/// stesso link cliccato in Lettura arrivava alla sezione — due risposte per lo
/// stesso link, che è la §4.4 nella sua forma più piccola.
export interface WikilinkInterno {
  page: string;
  heading: string | null;
  block: string | null;
  alias: string | null;
}

export function parseWikilinkInner(inner: string): WikilinkInterno {
  const barra = inner.indexOf("|");
  const parte = barra === -1 ? inner : inner.slice(0, barra);
  const alias = barra === -1 ? null : inner.slice(barra + 1).trim();

  const accento = parte.indexOf("^");
  const senzaBlocco = accento === -1 ? parte : parte.slice(0, accento);
  const block = accento === -1 ? null : parte.slice(accento + 1).trim();

  const cancelletto = senzaBlocco.indexOf("#");
  const page = (cancelletto === -1 ? senzaBlocco : senzaBlocco.slice(0, cancelletto)).trim();
  const heading = cancelletto === -1 ? null : senzaBlocco.slice(cancelletto + 1).trim();

  return { page, heading, block, alias: alias === "" ? null : alias };
}

export interface WikilinkTrovato extends WikilinkInterno {
  /// Il match intero, `!` compreso se è un embed.
  from: number;
  to: number;
  /// L'interno, `[[`/`]]` esclusi.
  internoDa: number;
  internoA: number;
  /// `![[…]]` invece di `[[…]]`.
  embed: boolean;
  /// L'interno **prima** dell'eventuale `|`, come sta scritto nella sorgente.
  ///
  /// È ciò che viaggia nel DOM come data-attribute: chi rilegge l'attributo lo
  /// ripassa da `parseWikilinkInner` e ottiene gli stessi tre campi, senza che
  /// nessuno debba ri-serializzare `page#heading^block` — una
  /// ri-serializzazione è una seconda grammatica, ed è esattamente ciò che
  /// questo modulo esiste per non avere.
  bersaglio: string;
}

const RE_WIKILINK = /(!?)\[\[([^[\]\n]+)\]\]/g;

/// I wikilink (e gli embed) di una riga.
export function wikilink(riga: string): WikilinkTrovato[] {
  const out: WikilinkTrovato[] = [];
  RE_WIKILINK.lastIndex = 0;
  for (let m; (m = RE_WIKILINK.exec(riga)); ) {
    const from = m.index;
    const to = from + m[0].length;
    const barra = m[2].indexOf("|");
    out.push({
      ...parseWikilinkInner(m[2]),
      from,
      to,
      internoDa: from + m[1].length + 2,
      internoA: to - 2,
      embed: m[1] === "!",
      bersaglio: barra === -1 ? m[2] : m[2].slice(0, barra),
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
export function tagInCorso(prima: string): { from: number; query: string } | null {
  const inizioRiga = prima.lastIndexOf("\n") + 1;
  let i = prima.length;
  while (i > inizioRiga && CARATTERE_DI_TAG.test(prima[i - 1])) i -= 1;
  if (i === inizioRiga || prima[i - 1] !== "#") return null;
  const cancelletto = i - 1;
  if (cancelletto > inizioRiga && ALFANUMERICO.test(prima[cancelletto - 1])) return null;
  return { from: cancelletto, query: prima.slice(i) };
}

// ── Le voci di lista ─────────────────────────────────────────────────────────

/// Una riga letta come voce di lista, todo o citazione.
///
/// `markerEnd` è dove comincia il contenuto, in code unit dall'inizio riga: è
/// l'unica coordinata che i comandi usano per tagliare o sostituire il
/// marcatore.
export interface VoceDiLista {
  /// Il prefisso di citazione (`"> "`, `"> > "`), `""` se non c'è.
  ///
  /// Esiste perché una todo dentro una citazione **è** una todo: la live
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
const RE_BOX = /^\[([^\]\n])\](?=[ \t]|$)/;

/// La riga è una voce di lista, una todo o una citazione?
///
/// È il cancello di ogni comando di lista e della checkbox della live preview:
/// dove risponde `null`, il comando restituisce `false` e la battuta cade sul
/// binding di default.
export function voceDiLista(riga: string): VoceDiLista | null {
  const mq = RE_QUOTE.exec(riga);
  const quote = mq ? mq[1] : "";
  const resto = riga.slice(quote.length);

  const leggiBox = (da: number): { symbol: string | null; fine: number } => {
    const mb = RE_BOX.exec(resto.slice(da));
    if (!mb) return { symbol: null, fine: da };
    return { symbol: mb[1], fine: da + mb[0].length };
  };

  const mb = RE_BULLET.exec(resto);
  if (mb) {
    const dopoMarcatore = mb[0].length;
    const box = leggiBox(dopoMarcatore);
    // Dopo la casella si mangia **uno** spazio: è il separatore fra marcatore e
    // contenuto, e senza toglierlo `content` comincerebbe con uno spazio che i
    // comandi poi riscrivono.
    const fine = box.symbol === null ? dopoMarcatore : box.fine + (resto[box.fine] ? 1 : 0);
    return {
      quote,
      indent: mb[1],
      kind: "bullet",
      bullet: mb[2],
      number: null,
      symbol: box.symbol,
      markerEnd: quote.length + fine,
      boxFrom: quote.length + box.fine - 3,
      boxTo: quote.length + box.fine,
      content: resto.slice(fine),
    };
  }

  const mo = RE_ORDERED.exec(resto);
  if (mo) {
    const dopoMarcatore = mo[0].length;
    const box = leggiBox(dopoMarcatore);
    const fine = box.symbol === null ? dopoMarcatore : box.fine + (resto[box.fine] ? 1 : 0);
    return {
      quote,
      indent: mo[1],
      kind: "ordered",
      bullet: mo[3],
      number: Number(mo[2]),
      symbol: box.symbol,
      markerEnd: quote.length + fine,
      boxFrom: quote.length + box.fine - 3,
      boxTo: quote.length + box.fine,
      content: resto.slice(fine),
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
      content: resto,
    };
  }
  return null;
}

/// Il marcatore della voce **successiva** a `voce`, per l'Invio.
///
/// Stesso tipo, stessa citazione e stesso rientro; le numerate prendono il
/// numero dopo, e le todo nascono non spuntate anche se la voce corrente era
/// `[x]` — spuntata è la cosa fatta, non quella che si sta per scrivere.
export function marcatoreSuccessivo(voce: VoceDiLista): string {
  if (voce.kind === "quote") return voce.quote;
  const box = voce.symbol !== null ? "[ ] " : "";
  const testa = `${voce.quote}${voce.indent}`;
  if (voce.kind === "ordered") return `${testa}${voce.number! + 1}${voce.bullet} ${box}`;
  return `${testa}${voce.bullet} ${box}`;
}
