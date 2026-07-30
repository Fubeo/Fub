# 0051 — L'alimentazione risponde, e risponde a lotti

|  |  |
|---|---|
| **Decisa** | 2026-07-29 |
| **Origine** | `todo.md` §20.1 (seduta 20) — l'ultima **P0** del piano |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/20-quando-qualcosa-va-storto.md) · [la gemella, che dice dove va a finire un esito](0052-cio-che-va-storto-e-un-evento.md)

---

Tre metodi su cinque di `IndexProvider` restituivano `()`, e cadevano
esattamente sui tre da cui passa **tutto il dato**: `activate` e `flush` — il
ciclo di vita — potevano fallire e dirlo, l'alimentazione no.

> `SearchIndex::on_document_indexed` (`features/src/search.rs`) scriveva:
> *«Il writer è andato: l'indice non è più affidabile, e mentire è peggio che
> perdere il documento»* — e poi non aveva nessuno a cui dirlo.

## La decisione

I tre metodi diventano **a lotto** e restituiscono **cosa non hanno preso**.

```rust
// crates/fub-abi/src/traits.rs
pub struct IndexLoss { pub id: DocId, pub why: PluginError }   // NUOVO

fn on_documents_indexed(&mut self, docs: &[DocumentModel]) -> Vec<IndexLoss>;  // era per documento, -> ()
fn on_documents_removed(&mut self, ids: &[DocId]) -> Vec<IndexLoss>;           // era per documento, -> ()
fn reconcile(&mut self, ids: &[DocId]) -> Vec<IndexLoss>;                      // era -> ()
```

È un **ritaglio** della linea di base, dichiarato in
[wit-congelato.md](../architecture/wit-congelato.md) e visibile in
`wit/frozen/0.1.0.wit`: `cargo test -p fub-abi --test wit_additivity` è
diventato rosso su tutte e tre le firme prima di tornare verde.

## Le decisioni prese, da NON ridiscutere senza motivo

### Le due domande hanno una risposta sola — verificata, non creduta

La voce affermava che *forma* dell'esito e *grana* della chiamata si
rispondessero con lo stesso campo. L'affermazione regge, e la verifica è questa:

| | esito cumulativo sul `flush` | `Result` su ognuno dei tre | **esito per lotto** |
|---|---|---|---|
| dice *quale* documento | **no** | sì | sì |
| attraversamenti a M5 | 1 per flush, ma non nomina | **1 per documento** | 1 per lotto |
| dice *quanti* ne mancano | no | uno alla volta | sì |

L'esito cumulativo non sa nominare il perduto, che è l'unica cosa su cui
qualcuno possa agire; il `Result` per documento lo nomina e lascia in piedi
l'aritmetica del confine. Il lotto risponde a tutte e due **con lo stesso
campo**, e questa è la ragione per cui le due domande non potevano essere decise
separate: se la firma fosse rimasta per documento il costo del confine si
sarebbe corretto con una **major**; se l'esito fosse rimasto cumulativo il
documento perso sarebbe rimasto senza nome.

### Ciò che il lotto NON compra, e va detto

**Non riduce il volume.** A M5 quei modelli attraversano il confine comunque, e
per intero: un `reindex` da 100k note serializza 100k modelli con la firma
vecchia e con la nuova. Ciò che cambia è il **numero di attraversamenti** —
100k per indice contro 100k/512 — cioè la sola metà del costo su cui una firma
possa qualcosa. Scrivere che «il lotto rende economico il reindex» sarebbe stato
comodo e falso.

### Un lotto non è una transazione

La stessa frase della [0011](0011-il-lotto.md), e nello stesso senso: **accettato
a metà è la norma**. Ciò che si elenca è perduto, ciò che non si elenca è preso,
non c'è niente da annullare e il kernel non ritenta. Una lista vuota vuol dire
che è andato tutto bene, ed è ciò che restituisce chi non ha niente da dire —
compreso l'indice del kernel, che tiene i propri metadati in una `BTreeMap` e
non ha un modo di rifiutare una chiave.

Chi fallisce **in blocco** elenca tutto ciò che gli è stato dato. Costa una riga
e dice la verità: quei documenti, in quell'indice, adesso non ci sono.

### A tagliare il lotto è il kernel, ed è l'unico che possa

È l'unico a sapere quanti modelli ha in mano. La fetta è `FEED_BATCH = 512` in
`kernel/workspace.rs`, **non** nel contratto, per la stessa ragione per cui il
tetto della coda eventi sta con chi ritira ([0034](0034-il-freno-e-il-raggruppamento.md)):
è una politica dell'host, e un guest che la leggesse dalla firma comincerebbe a
dipenderne.

Un indice non può quindi dedurre niente dalla **dimensione** di ciò che riceve:
un lotto di uno non vuol dire «una scrittura singola», un lotto pieno non vuol
dire «apertura del vault». Ciò che si deduce è una cosa sola e basta: questi
documenti sono arrivati insieme, quindi si possono scrivere insieme.

Non è un'impostazione, e per adesso è giusto così: lo diventerà quando ci sarà un
guest da misurare (M5). Chiedere oggi a un utente un numero che nessuno sa
ancora se conta è il modo di ottenere una configurazione che nessuno sa mettere.

### `IndexLoss` è un dato, non un errore

Non dice «la chiamata è fallita», dice **quale documento è rimasto fuori** — e
il significato è uno solo letto dai tre versi: dopo un `on_documents_indexed`
quel documento non c'è e chi cerca non lo troverà; dopo un
`on_documents_removed` c'è ancora e chi cerca lo troverà pur essendo sparito;
dopo un `reconcile` è morto ad app chiusa e l'indice non è riuscito a
dimenticarlo. In tutti e tre i casi: **su questa identità l'indice adesso
mente**.

Per questo non è un `Result<(), Vec<IndexLoss>>`: un `Err` avrebbe promesso il
tutto-o-niente che non c'è, e avrebbe reso il caso normale — «tutto preso» —
qualcosa da srotolare invece che una lista vuota.

`why` è un `PluginError`, quindi porta un `Text` traducibile
([0041](0041-un-errore-e-testo-che-qualcuno-legge.md)) e non una frase già
composta.

### Il `reconcile` nomina identità che il chiamante non ha mandato

Ciò che un indice non è riuscito a cancellare è per definizione **fuori** da
`ids`: sono i morti che si tiene. Il tipo resta lo stesso perché il significato
è lo stesso, ed è la ragione per cui non serve un secondo record.

### Un panico alimentando è una perdita, e adesso ha un nome

`Indexes::on_documents_indexed` chiama i provider registrati dentro la rete
contro i panici (§9.3). Prima quel panico si fermava e finiva su `stderr`;
adesso chi pania **non ha preso niente** di ciò che gli era stato dato, quindi
il lotto intero torna indietro a suo nome. Ciò che il provider aveva raccolto
prima di paniare non si usa: dopo un panico il suo stato è ignoto, e un elenco
parziale direbbe «solo questi» proprio nel caso in cui non lo si può sapere.

L'indice del kernel resta **fuori** dalla rete: se pania lui è un difetto del
kernel, e nasconderlo vorrebbe dire cercarlo poi in un vault che risponde a metà.

## Il cliente vero, che era già scritto

`SearchIndex` aveva **tre** uscite silenziose, e il verbale le nomina perché due
non erano nella voce:

1. `on_document_indexed` col writer andato → il documento non entra;
2. `on_document_indexed` con `add_document` fallito → idem;
3. **`on_document_removed` col writer andato** → il termine non si cancella, e
   il documento resta cercabile pur essendo sparito dal vault. È la bugia
   opposta, ed è la più visibile delle due: chi cerca lo trova e lo apre;
4. **`reconcile` col writer andato** → i morti restano, e `forget` toglieva anche
   l'unica traccia con cui riprovare.

Tutte e quattro adesso restituiscono un `IndexLoss` che nomina il documento.

## Cosa resta fuori, dichiarato

- **Dove va a finire un `IndexLoss`** è la [0052](0052-cio-che-va-storto-e-un-evento.md):
  qui c'è il canale, lì la destinazione. Deciderne uno solo dà un esito che
  nessuno legge o un posto vuoto dove metterlo.
- **`up_to_date` non è toccata.** È nata dopo il taglio della linea di base
  ([0046](0046-l-anagrafe-del-vault.md)) e non ha un esito da dare: la sua
  risposta *è* il dato, e un elenco vuoto significa già «mandami tutto», che è il
  verso sicuro dello sbaglio.
- **`ingest_model` non fallisce** per una perdita d'indice, e `reindex` nemmeno:
  un indice è un derivato, il vault è la verità. Ciò che cambia è che adesso
  qualcuno lo sa.
