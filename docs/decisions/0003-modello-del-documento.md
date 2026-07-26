# 0003 — Modello del documento — le lacune che si vedono solo a valle

|  |  |
|---|---|
| **Decisa** | 2026-07-26 |
| **Origine** | `todo.md` §1.5 (primo giro) |
| **Commit** | `0a4ee40` |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [PIANO.md](../PIANO.md)

---

- [x] **Task come cittadini di prima classe**: `Block::List` deve portare
      `checked: Option<bool>` per voce (e lo `Span` del marcatore). Oggi una
      task list è una lista di paragrafi: tutto il capitolo 10 (~90 voci)
      ricomincerebbe dal parsing.
- [x] **Ancore stabili**: `^block-id` e id di heading nel modello
      (`Block::anchor: Option<String>`), con la regola di generazione nel
      contratto come `canonical_tag`. Servono a 7.1 (link a blocco), 5.2 (embed
      di blocchi), 13.3 (deep link ad annotazione), 18.3 (diff a blocchi).
- [x] **Footnote, definition list, tabella** promosse da `Custom` a varianti (o
      decidere esplicitamente che restano `Custom` con `custom_kind` registrati
      e documentati — la decisione manca, non la variante).
- [x] **`LinkTarget` per gli allegati**: oggi un'immagine è `Path`/`Url` e nulla
      distingue "risorsa del vault" da "url esterno" — 13.1 (riferimenti su
      rinomina, orfani, dedup) parte da qui.
- [x] **Proprietà tipizzate**: il frontmatter è `serde_json::Map` piatto. 8.2
      chiede tipi (data, rating, relazione, formula): serve almeno un
      `PropertyValue` normalizzato nel contratto, o ogni consumatore
      reinventerà il parsing delle date.

**Fatto, e con una decisione a verbale per ciascuna.** Il dettaglio sta in
`docs/architecture/data-model.md`; qui il perché, che è ciò che fra sei mesi non
si ricostruisce dal diff.

*La task porta il simbolo, non un booleano.* `ListItem { blocks, task, span }`
con `TaskMarker { symbol: Option<char>, span }` e `checked()` per la lettura
binaria (`x`/`X`, regola di Obsidian). Gli stati personalizzati — `[/]` in
corso, `[-]` cancellato, `[>]` rimandato — sono una richiesta esplicita di 10.1,
e un `bool` avrebbe chiuso quella famiglia al primo parse; comrak li vede solo
con `relaxed_tasklist_matching`, quindi il modello li apriva e il parser li
buttava. Lo `span` è quello del **simbolo** e non delle parentesi: spuntare
diventa la sostituzione di un carattere, che è la patch più piccola scrivibile
per il gesto più frequente che ci sia.

*L'ancora è indirizzo, non contenuto.* Ogni blocco porta `anchor`, con due
sintassi e due spazi di nomi: per un heading è lo slug generato (`heading_slug`,
salito nel contratto da funzione privata del provider — due provider potevano
dare due id allo stesso titolo), per gli altri l'id esplicito `^abc`
(`canonical_anchor` + `valid_anchor`, e il `^` va preceduto da spazio o `2^10`
diventa un'ancora). La tabella piatta `anchors` porta **due** span, blocco e
marcatore, perché servono a due mestieri (ritagliare un embed / riscrivere l'id).
Il marcatore sparisce da testo indicizzato e resa, e diventa un `id=` in HTML.
La forma su riga propria (`^abc` da solo) non è un blocco: appartiene a quello
che la precede, ed è l'unico modo di indirizzare una lista o una tabella.

*Solo la tabella diventa variante.* Il criterio, dichiarato: serve (a) un
consumatore trasversale al formato che ne interroghi la struttura e (b) una
forma che `Custom` non regga. La tabella ha entrambi — 11, 11.4, 17, 6.3, 22.1
vogliono righe/celle/allineamento come tipo, e `Custom { blocks }` porta solo
blocchi mentre una cella porta inline. Non era "rappresentata alla grossa": era
**persa**, `Custom("table")` di `Custom("block")` senza allineamento né celle.
Footnote e definition list non hanno né l'uno né l'altro e restano `Custom`, con
i `custom_kind` registrati come costanti nel contratto (`custom_kind::*`) e
documentati; il parser ora le produce davvero, che è la parte senza la quale la
decisione sarebbe stata a vuoto. Promuoverle resta additivo; per la tabella no,
perché lì era già un bug.

*L'embed è del riferimento, non del bersaglio.* `embed` esce da
`LinkTarget::Wiki` e sale su `Link`/`Inline::Link`: la stessa nota si linka e si
incorpora nella stessa pagina, e finché il flag stava nella variante wiki
`![](immagine.png)` non aveva modo di dirlo — infatti **le immagini non entravano
affatto in `links`**, e la [decisione 0004](../decisions/0004-il-grafo-e-i-link-non-wiki.md) lasciava 13.1 fuori portata non perché il path
non fosse un arco ma perché quell'arco non veniva raccolto. Ora ci entrano. E la
specie del bersaglio la decide il contratto (`LinkTarget::classify`), non
`url.contains("://")` dentro un provider: `mailto:` non ha `//`, `C:\foto\a.png`
sembra avere uno schema, e un secondo provider poteva rispondere un'altra cosa
sulla stessa stringa.

*Le proprietà non indovinano.* `PropertyValue` (+ `PropertyScalar` per le voci
di elenco, perché il confine non ammette tipi ricorsivi e per le proprietà
l'arena sarebbe sproporzionata) normalizza il frontmatter senza sostituirlo: la
verità grezza resta il JSON. Solo l'ISO-8601 a larghezza fissa è una data
(`2026-7-5` no: un parser tollerante trasformerebbe in date le stringhe
dell'utente), la data è scomposta perché 10.4 raggruppa per giorno, il fuso è
quello scritto — convertirlo vuole una capacità dell'host ([decisione 0013](../decisions/0013-elenco-delle-capacita.md)) — e l'unica
stringa che cambia specie è il wikilink, che è la "proprietà relazione" di 8.2.
Un URL resta `Text`: 8.2 ha sia "proprietà URL" sia "proprietà testo", e
sceglierle è lo schema per tipo nota, non un indovinello del parser.

*Il presidio.* `wit_conformance` non compila su divergenza (i match sono
esaustivi e i tipi attesi li deduce il compilatore) e confronta abi↔WIT nelle
due direzioni; il round-trip dell'arena copre le forme nuove; venti casi sul
parser vero misurano span e simboli sulla sorgente. `wit_additivity` è diventato
rosso — come deve, perché questo commit **cambia la forma di cose già
pubblicate** (l'ancora dentro ogni record di blocco, `items` della lista,
`thematic-break` da payload nudo a record, `embed` fuori da `link-target-wiki`)
— e la linea di base `wit/frozen/0.1.0.wit` è ritagliata qui dentro, che
pre-freeze è la procedura dichiarata: la rottura si vede in review invece di non
vedersi affatto. Dopo M4 questa stessa voce sarebbe stata una major.

*Resta fuori, dichiarato:* il kernel non risolve ancora `[[Nota#^ancora]]`
contro `anchors` (è [decisione 0005](../decisions/0005-canale-dati-verso-le-view.md)/§2.x: qui c'è il dato, non la query), l'HTML grezzo
entra nel modello come dato ma nessuno lo disegna (5.3), e l'anteprima di un
allegato resta un segnaposto finché non c'è il modello degli asset (§14.1).
