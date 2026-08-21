# 0049 — Una posizione dentro un documento

|  |  |
|---|---|
| **Decisa** | 2026-07-29 |
| **Origine** | `todo.md` §21.3 + §21.10 (seduta 21) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[la seduta](../roadmap/21-la-ricerca-predefinita.md) ·
[la gemella, che decide cosa si chiede a una ricerca](0050-cosa-si-chiede-a-una-ricerca.md)

---

Due voci facevano la stessa domanda a due firme diverse.

> La §21.3: un risultato di ricerca non sa dire **a che punto** del documento
> sta. La §21.10: un riferimento a un blocco non sa dire **a che punto** del
> documento punta.

Deciderle separate voleva dire inventare due modi di dire *dove*, e accorgersene
quando il primo era già congelato. È l'errore che la
[0012](0012-origine-degli-eventi.md) ha dichiarato di voler evitare decidendosi
insieme alla [0011](0011-il-lotto.md), e la ragione per cui la seduta 21 esiste.

## La decisione

**Una posizione dentro un documento è un tipo solo**, e i tre clienti che
bussavano lo condividono: il salto all'occorrenza di un risultato, il
riferimento a un blocco o a un heading, e (quando arriverà) la citazione di una
lavagna verso un punto di una nota.

```rust
// crates/fub-abi/src/traits.rs
pub struct DocPosition {
    pub span: Span,              // byte del SORGENTE, non dentro `snippet`
    pub anchor: Option<String>,  // l'ancora del blocco che lo ospita, se c'è
    pub revision: Revision,      // di QUANDO
}

pub struct DocumentMatch { /* … */ pub occurrences: Vec<DocPosition> }

pub struct ResolvedRef { pub doc: DocId, pub at: Option<DocPosition> }
pub enum IndexResult { /* … */ Resolved(Option<ResolvedRef>) }
```

`Span` e `Revision` esistevano già (`abi/model.rs`, `abi/edit.rs`) e si
**riusano**: coniare una coordinata nuova accanto a quella che ogni altro pezzo
del modello porta sarebbe stato il secondo modo di dire *dove* con un nome
diverso.

## Le decisioni prese, da NON ridiscutere senza motivo

### La revisione non è opzionale

È la domanda che le due voci si facevano separatamente — *«una posizione porta
la propria revisione?»* — e la risposta doveva essere **una**, o sarebbero
diventate due discipline. Uno span invecchia appena il documento cambia sotto:
senza il campo, la shell porterebbe il cursore nel punto sbagliato **senza
accorgersene**, che è la categoria di guasto che il §20 esiste per togliere di
mezzo. Il contratto sapeva già dirlo altrove — `EditRequest` porta la revisione
su cui è stato calcolato ([0008](0008-modifica-chirurgica.md)) — e qui è la
stessa idea allo stesso posto.

Da questo segue il degrado: **chi non sa dire di quando non produce una
posizione affatto**. Un `at: None` è un documento che si apre in cima; una
posizione senza revisione sarebbe una coordinata che chi la usa deve indovinare.

### `occurrences` accanto a `highlights`, non al posto suo

Non sono due nomi per la stessa cosa, e tenerli separati è il punto:
`highlights` sono intervalli **dentro `snippet`** e servono a **disegnare** una
riga — chi disegna li avvolge, e nessun provider può iniettare markup;
`occurrences` sono coordinate **nel sorgente** e servono a **tornare** al testo.
Fondere le due avrebbe rotto la prima per servire la seconda.

### La regola di `absorb` diventa dipendente da chi chiede

`DocumentMatch::absorb` teneva **un estratto per documento**, con la ragione
scritta: «due estratti dello stesso documento sono due finestre sullo stesso
testo, e mostrarne due sarebbe rumore». È vero della riga di una **collezione**,
che di righe ne disegna una; è falso della **ricerca**, che di occorrenze ne
mostra N e lascia saltare all'una o all'altra.

La regola non è stata rovesciata: l'estratto resta il primo che c'è, e le
occorrenze si **sommano** (senza duplicati, in ordine di posizione). Le due cose
stanno nello stesso record perché il record è uno, e ognuna segue la regola del
proprio cliente.

### Il ritaglio di `Resolved`, e perché non è un ripiego additivo

`IndexResult::Resolved(Option<DocId>)` sapeva dire *quale documento* e non *dove
dentro*. Il ripiego additivo — una variante `ResolvedAt` in coda — è stato
**scartato**: lascerebbe per sempre due casi che rispondono alla stessa
`IndexQuery::Resolve`, su ogni mirror, con chi legge a doversi ricordare quale
guardare. Si è ritagliato il payload, e la riga sta nella tabella dei ritagli di
[wit-congelato.md](../architecture/wit-congelato.md).

**E qui c'è un fatto che vale scritto, perché contraddice il modo in cui il
ritaglio era stato immaginato.** Ci si aspettava che
`cargo test -p fub-abi --test wit_additivity` diventasse rosso, e che a
rimetterlo verde fosse un `frozen/0.1.0.wit` toccato nello stesso commit — è la
procedura delle [0040](0040-chi-localizza.md) e
[0041](0041-un-errore-e-testo-che-qualcuno-legge.md). **Non è successo, e il
presidio ha ragione**: la variante `resolved` è nata con la
[0043](0043-il-path-e-la-chiave.md), cioè **dopo** che la linea di base è stata
tagliata. Nel `frozen/0.1.0.wit` l'`index-result` finisce a `organization`;
`resolved`, `entries` e `folders` non ci sono. Ritipare il payload di una
variante che non è mai stata pubblicata non rompe nessuna promessa, quindi il
file della linea di base **non si tocca**: scriverci dentro un `resolved` che
non c'era vorrebbe dire falsificare cosa è stato pubblicato per far apparire un
ritaglio che non c'è stato.

La riga nella tabella dei ritagli resta lo stesso, e dice questo: la rottura è
reale per chi compila contro l'`abi.wit` di oggi, ed è invisibile al presidio
perché il presidio guarda un'altra cosa — ciò che è stato **pubblicato**. Le due
frasi sono entrambe vere, e la seconda è facile da leggere come «è additivo».
Non lo è.

### Chi produce le occorrenze: il kernel, non chi indicizza

Il piano di questa seduta assegnava il lavoro a `SearchIndex`. **Il codice dice
di no**, e ha vinto il codice.

`SearchIndex` riceve un `DocumentModel` e indicizza la sua **proiezione a testo
piano** (`DocumentModel::text`): niente frontmatter, niente marcatori, i
wikilink ridotti alla loro etichetta, tutto rifilato. Gli offset che quel motore
sa produrre sono offset dentro un estratto di quella proiezione — che è
esattamente perché `highlights` è documentato come «byte dentro `snippet`» — e
fra la proiezione e il sorgente **non esiste nessuna mappa**. Farla esistere
vorrebbe dire far portare a ogni indice una seconda copia di ogni documento, o
un dizionario di corrispondenze per nota.

Il sorgente ce l'ha il vault, cioè il kernel. Quindi la coordinata la produce
chi ha la coordinata: `Workspace::query_index` apre i sorgenti della **pagina**
che sta per restituire e ci trova dentro i testi cercati
(`crates/fub-kernel/src/occurrences.rs`). Sta lì e non nel pianificatore per una
ragione in più: è l'unico punto in cui passa **ogni** risposta, compresa quella
di un motore di terzi che rivendicasse `QueryKind::Documents`. E chi ha già
riempito `occurrences` non viene toccato — un indice che sappia dire *dove*
resta la fonte, e questo passaggio è il ripiego di chi non lo sa dire.

**Localizzare non è cercare una seconda volta.** *Se* un documento combacia lo
ha già deciso chi indicizza, con la propria tokenizzazione; qui si risponde a
una domanda più piccola e puramente testuale: dove compaiono, nei byte di questo
file, le stringhe che sono state scritte nella query. Le due possono non
combaciare, e il verso in cui non combaciano è quello innocuo — un documento
trovato per stemming non contiene la stringa digitata, quindi non produce
occorrenze, e `occurrences` vuoto significa già «nessuno le ha calcolate».
L'inverso — un'occorrenza dove non c'è testo — non può succedere: si cercano
byte in un file.

I due tetti sono dichiarati e non impliciti: **64 occorrenze per documento** e
**64 documenti aperti per domanda**. Il secondo è quello che conta: non ogni
chiamante di una ricerca è una casella di ricerca, e `vault.replace`, una
collezione o un'automazione chiedono documenti a centinaia senza sapere che
farsene delle coordinate. Chi ha chiesto una finestra riceve la sua finestra
localizzata; oltre, le righe restano senza punto.

### Le ancore salgono nella cache dei metadati, e nell'anagrafe su disco

`[[Nota#^blocco]]` si risolve cercando l'ancora, e le ancore stavano solo nel
modello — che la cache del kernel non tiene (è lo split metadata/body di M2).
`DocMeta` guadagna `anchors: Vec<Anchor>`: costano quanto l'outline e sono la
stessa specie di dato — *dove sta un punto nominabile*, per heading là e per
blocco qui.

E salgono anche in `StoredMeta` (`entries.json`), con un **bump di schema a v2**
invece di un `#[serde(default)]`. Un campo con default avrebbe letto i file di
prima senza rompersi, ed è precisamente il motivo per cui non basta: un vault
riaperto da una tabella v1 avrebbe zero ancore e nessun modo di dirlo, quindi
`[[Nota#^blocco]]` sarebbe tornato ad aprire la nota in cima — la §21.10
riaperta dalla cache dopo essere stata chiusa nella firma. Un derivato di una
versione che non si conosce si rifà, e il costo è una riapertura lenta sola.

## I clienti, nello stesso giro

Perché una firma senza qualcuno che la usi è la
[0013](0013-elenco-delle-capacita.md) che si rimprovera da sola:

- **La ricerca salta all'occorrenza.** Il pannello disegna una riga per la nota
  e una riga per ogni occorrenza successiva (`search.occurrence`), e ognuna
  porta il cursore al proprio punto con `revealByteOffset` — la stessa
  conversione byte UTF-8 → posizione editor che usano l'outline e
  `ViewUpdate::Reveal`. La ricerca era l'unico cliente naturale di quel giro e
  non aveva le coordinate da passargli.
- **Il wikilink a un punto arriva a destinazione.** Il renderer markdown emette
  `data-wikilink-block` accanto a `data-wikilink-heading` (non lo scriveva: il
  campo si perdeva lì, un centimetro prima della shell), l'anteprima li legge, e
  `openWikilink` chiede `resolve` e rivela `at.span.start`. Sono i cinque punti
  che scartavano `heading` e `block` con un `..`, ed è la riga di
  [strozzature.md](../roadmap/strozzature.md) che diceva «nessun `^block-id`».

## Cosa NON è stato deciso qui

- **Coniare un'ancora.** Nessun percorso del repo *genera* un `^abc`: il parser
  le legge, il renderer le stampa, il kernel le trasporta. «Copia il link a
  questo blocco» è una **scrittura**, quindi passa dall'arbitro che esiste già
  (`write_document`/`apply_edit`, [0008](0008-modifica-chirurgica.md)), e non
  scade col freeze. Resta scritto nella §21.10 e adesso vale ancora di più: la
  risposta di questo verbale rende **risolvibile** un riferimento che l'utente
  non ha ancora modo di **creare**.
- **La ricerca dentro la nota aperta** (§21.4) e il quick switcher (§21.5):
  restano superfici, e adesso hanno le coordinate su cui poggiare.
