# 0011 — Il lotto — il kernel muta **un documento alla volta**

|  |  |
|---|---|
| **Decisa** | 2026-07-26 |
| **Origine** | `todo.md` §1.12 (secondo giro) |
| **Commit** | `83cc306` |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[PIANO.md](../PIANO.md)

---

- [x] **`Workspace::batch(|ws| …)` con un evento terminale**: il caso reale c'è
  già. `rename_document` scriveva N sorgenti e ognuna emetteva `DocumentChanged`
  + `IndexUpdated` drenando la coda; sul confine una rinomina con 200 backlink
    erano ~400 eventi, e la shell reagiva a **ciascun** `index_updated` con un
    `list_documents` più il ridisegno di ogni view iscritta. Non è un problema
    di UI: è che il kernel non aveva modo di dire "queste N scritture sono una
    cosa sola".
- [x] **Semantica di annullamento**: decisa, ed è *nessuna* — a verbale, sotto.
- [x] **Variante di evento nel contratto**:
  `Event::BatchEnded { batch, changed }`
      + `EventKind::BatchEnded` (additivi, in coda), che `ViewSpec.refresh`
        dichiara come ogni altro.
- [x] **Un cliente vero nello stesso giro**: `rename_document` (che *è* un
  lotto), ogni `invoke_command(…, Apply)` — quindi `vault.replace` su N note — e
  la shell, che ridisegna una volta.

*Sblocca:* 7.2 (bulk fix, cleanup wizard, ~30 voci), 11.3 (editing bulk, undo
database), 16.3 (undo delle automazioni), 17.3 (rollback, resume), 24.1.

**Fatto insieme alla
[decisione 0012](../decisions/0012-origine-degli-eventi.md), con quattro
decisioni e un residuo dichiarato.**

*Un lotto è uno scope del kernel, non una capacità del confine.*
`Workspace::batch(|ws| …)` c'è; `HostApi::batch` no, e non per parsimonia: uno
scope a chiusura garantita **non attraversa il confine dei componenti**. Un
plugin che aprisse un lotto e non lo chiudesse — perché sbaglia, perché trappa,
perché a M5 la sua istanza muore — lo lascerebbe aperto per sempre, e con esso
ogni evento del vault sospeso in attesa di un terminale che non arriva. Il lotto
di un plugin è quindi la sua **invocazione di comando**, che l'host apre e
chiude per lui: è anche la risposta giusta nel merito, perché «una cosa che
qualcuno ha chiesto» è esattamente cosa significa invocare un comando. Chi lo
apre, oggi: il kernel per sé (`rename_document`) e `invoke_command` per ogni
`Apply`. Annidato, un lotto **entra** in quello che c'è invece di aprirne un
secondo — chiudere l'interno farebbe arrivare un `batch-ended` mentre
l'operazione esterna è ancora in corso.

*Il lotto coalizza `index-updated` e nient'altro.* È l'unico evento del
contratto **senza payload**, cioè l'unico di cui N copie dicono esattamente
quanto ne dice una; gli eventi per-documento continuano a passare tutti, quindi
**nessun handler esistente deve cambiare una riga**. La misura sul caso vero:
una rinomina con 200 backlink passa da ~401 eventi e **201 ridisegni completi**
a 201 eventi e **1 ridisegno**. Non è "400 eventi → 1", ed è giusto che non lo
sia: i 200 `document-changed` sono l'unica cosa che dice a chi tiene stato
per-documento *quale* documento; a costare erano i ridisegni, e quelli sono uno.

Il prezzo, ed è l'unico punto non additivo di tutta la voce: chi si era abbonato
al **solo** `index-updated`, dentro un lotto non riceve più niente — e il
sintomo sarebbe il peggiore possibile, un pannello che smette di aggiornarsi
*soltanto* dopo una rinomina con backlink o una sostituzione in blocco.
L'alternativa (emettere tutti e due) avrebbe fatto costare a ogni lotto due
ridisegni completi, cioè il costo che la voce esiste per togliere. Perciò la
regola è una sola — *chi dichiara `index-updated` dichiara anche `batch-ended`*
— e non è una nota nella prosa: è `EventMask::misses_batches()` nel contratto e
un test su ogni view ufficiale (`fub-features/tests/view_refresh_masks.rs`), con
la stessa funzione che un plugin chiama sulla propria maschera.

*Un lotto non è una transazione, e non si chiama come una.* Niente `tx`, niente
`rollback`: se una delle N scritture fallisce le altre restano fatte, e chi ha
aperto il lotto se ne accorge dal **proprio valore di ritorno**, che `batch` gli
passa intatto. La ragione non è che il tutto-o-niente non serva — serve a
import, bulk fix e migrazioni, e questa voce lo diceva — ma che **non è
promettibile senza il journal del §15.2**: un annullamento che non sopravvive
alla morte del processo non è un annullamento, e prometterlo con un nome
significherebbe farlo credere a chi legge solo la firma. Chi sceglie, quindi,
resta chi apre il lotto e conosce il proprio caso: `rename_document` applica
tutto e nomina i falliti (giusto per lui: abortire a metà lascia link misti
senza retry), e il giorno che l'importer vorrà l'opposto avrà il journal, non un
`bool` qui. Il materiale c'è già — `EditReport::inverse()` della
[decisione 0008](../decisions/0008-modifica-chirurgica.md) — e la decisione di
chi lo conservi è il §13.3.

*Il dispatch è rimandato alla chiusura, e questo ha cambiato un comportamento
esistente.* Dentro un lotto il vault è a metà di un'operazione, e un handler che
vi reagisse vedrebbe uno stato che non è mai esistito per nessuno. La
conseguenza si vede su un test della
[decisione 0008](../decisions/0008-modifica-chirurgica.md) che ora dice
l'opposto di prima (`apply_edit.rs`): un handler che scriveva in una sorgente
mentre la rinomina non l'aveva ancora riscritta ne rendeva stantia la `base`, e
la rinomina falliva *per quella sorgente*. Era il comportamento giusto per il
contratto di allora — la corsa esisteva davvero, e la
[decisione 0008](../decisions/0008-modifica-chirurgica.md) la rendeva visibile
invece di far sparire una riga in silenzio. Il lotto la toglie **a monte**: le
due scritture adesso riescono tutte e due invece di dover scegliere. La guardia
della `base` non è diventata inutile — copre chi scrive *fuori* dal giro
(un'altra app, un job che rientra) — e resta provata.

*Un lotto troncato dall'`Overflow` non ha una garanzia in più.* Il terminale sta
in coda come ogni altro evento, e se il budget del dispatch si esaurisce può
essere fra i persi. L'`Overflow` che arriva al suo posto dice «riconcilia da
zero», che è una richiesta **più forte** di «ridisegna questi documenti»: una
garanzia speciale per il solo `batch-ended` sarebbe una seconda promessa più
debole accanto a una che già copre il caso.

*Resta fuori, dichiarato:* l'**annullamento** e il **resume** (§15.2 + §13.3: il
journal è il meccanismo, e questa voce ne prepara la forma senza prenderne la
decisione); il **lotto aperto da un plugin** (vedi sopra: è la sua invocazione
di comando); il **lotto che attraversa il giro sincrono** (§9.1: un import gira
dentro una chiamata, e un lotto che durasse quanto un job terrebbe gli eventi
sospesi per minuti); lo **snapshot per lotto** del versioning (§13.3 — oggi il
versioning fa uno snapshot per `document-changed`, che dentro un lotto sono
ancora N: raggrupparli in una voce sola di cronologia vuole un campo nel formato
persistito, cioè una `SCHEMA_VERSION` nuova, e non è una firma).
