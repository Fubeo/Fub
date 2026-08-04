# `crates/fub-abi/wit/frozen/` — il contratto com'era

Una copia del contratto per ogni versione **pubblicata**, col nome del file
uguale alla versione (`0.1.0.wit` ↔ `package fub:abi@0.1.0`).

Non è un archivio: è la linea di base contro cui
[`crates/fub-abi/tests/wit_additivity.rs`](../../crates/fub-abi/tests/wit_additivity.rs)
verifica la promessa su cui poggia il freeze di M4 — **post-freeze il contratto
cresce solo per aggiunta**.

## Perché non bastava ciò che c'era

Due presidi esistevano già, e nessuno dei due copre questa promessa:

- [`wit_conformance.rs`](../../crates/fub-abi/tests/wit_conformance.rs)
  confronta `fub-abi` e `crates/fub-abi/wit/fub/abi.wit` — **oggi**, fra di loro. Si può
  rinominare un campo in tutti e due, restare conformi, e aver rotto ogni plugin
  già compilato.
- `abi_compatible` applica la regola a runtime (major diversa → rifiuto, minor
  del plugin ≤ minor dell'host → accetto). Nel caso che conta dice **sì**: una
  variante rimossa o un campo rinominato non cambiano la minor, quindi il plugin
  viene accettato e il confine si rompe a valle. La rete di sicurezza dice sì
  proprio nel caso che dovrebbe fermare.

Il costo di scoprirlo tardi è asimmetrico: la build del repo resta verde, a
rompersi sono i plugin di terzi, dopo il rilascio.

## Cosa conta come aggiunta

Non "il file è cresciuto". La forma di ogni cosa già pubblicata deve essere
intatta **e nella stessa posizione**; il nuovo può stare solo in coda.

| costrutto | additivo | rotto |
|---|---|---|
| `record` | un campo **in fondo** | rinominare, ritipare, riordinare, togliere |
| `variant` / `enum` / `flags` | un caso **in fondo** | idem — l'ordine è il discriminante |
| `type x = …` | — | qualunque cambio di destinazione |
| funzione | una funzione **nuova** | cambiare parametri o risultato di una esistente |
| interfaccia | un'interfaccia **nuova** | toglierne una, o spostarci dentro un tipo esistente |
| `world` | un import/export in più | toglierne uno |

Un tipo spostato da un'interfaccia a un'altra è una **rinomina** del suo nome
qualificato, quindi è rotto anche se il nome nudo non cambia.

L'"in fondo" è severo di proposito: nel component model aggiungere un caso a un
`variant` non è nemmeno additivo davvero. La regola che questo progetto ha scelto
dice che lo è, e allora il minimo è che il discriminante di ciò che c'era non si
muova.

## Come si aggiorna

**Prima del freeze di M4** la superficie è ancora libera di evolvere, e il test
non lo impedisce: lo rende visibile. Una rottura deliberata si fa ritagliando la
linea di base — cioè con un commit che **tocca `0.1.0.wit`** e dice perché. In
review si vede; è tutta la differenza con oggi, dove non si vedrebbe affatto.

C'è un caso in cui il test resta **verde e ha ragione**, ed è quello a cui fare
più attenzione: ciò che è nato *dopo* che la linea di base è stata tagliata non è
mai stato pubblicato, quindi cambiarlo non rompe nessuna promessa e lo snapshot
non si tocca — scriverci dentro un tipo che non c'era falsificherebbe cosa è
stato pubblicato. La rottura è comunque reale per chi compila contro l'`abi.wit`
di oggi, e per questo la tabella qui sotto la elenca lo stesso: il presidio
copre *ciò che è uscito*, non *ciò che è cambiato*, e leggere il suo silenzio
come «è additivo» è l'errore che questa pagina esiste per evitare.

**I ritagli fatti finora**, in ordine, così che l'elenco delle rotture
deliberate stia in un posto solo e non solo nei commenti dei singoli punti:

| Decisione | Cosa è stato ritagliato |
|---|---|
| [decisione 0003](../decisions/0003-modello-del-documento.md) | `anchor` dentro ogni record di blocco, `items` della lista, `thematic-break` da payload nudo a record, `embed` fuori da `link-target-wiki` |
| [decisione 0012](../decisions/0012-origine-degli-eventi.md) | `event-handler.handle` prende un `notice` e non più un `event` nudo |
| [decisione 0013](../decisions/0013-elenco-delle-capacita.md) | `host-api.storage-get` / `storage-set` **tolte** (lo stato volatile a chiave→valore non ha più casi d'uso: vedi il commento in `0.1.0.wit` e il verbale) |
| [decisione 0016](../decisions/0016-cosa-e-una-view.md) | `ui-node` da `variant` a `record { key, kind }` (la chiave, §2.8); l'azione dei nodi da `action-id` a `action-ref` (il payload, §2.7); `view-placement` → `view-surface` e `view-spec.placement` → `surface` (le dieci superfici, §2.2); primo parametro di `render-view`/`on-action` da `string` a `view-instance` (le istanze, §2.3) |
| [decisione 0017](../decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md) | i quattro tipi che erano N booleani passano a una mappa con namespace: `format-capabilities` (5), `parse-context` (2), `render-options` (1), `plugin-permissions` (3) — ciò che scade col freeze non è la loro larghezza ma la **forma** (§3.5); e `format.parse` prende un `document-source` invece di una `string`, o i documenti non-testo non entrano affatto (§3.4) |
| [decisione 0021](../decisions/0021-il-confine.md) | **`host-api` divisa in dieci interfacce** (§7.1): ventiquattro funzioni cambiano nome qualificato (`host-api.read-document` → `host-vault-read.read-document`) e il record `trash-entry` si sposta. È il ritaglio più largo fatto finora, e l'ultimo che riguarda l'`host-api`: dopo il freeze una funzione non si sposta più da un'interfaccia all'altra. Ciò che compra non è ordine — è che il permesso di scrivere possa **non essere importato**, cioè che a M5 il rifiuto sia l'assenza della funzione invece di una risposta a runtime. Il `plugin-world` importa le dieci famiglie una per una |
| [decisione 0019](../decisions/0019-il-canale-dati.md) | il canale dati: `index-query`/`index-result` perdono `full-text`/`properties` in favore di `documents` (erano la stessa domanda in due lingue che non si potevano comporre); via `search-scope`, `search-hit`, `document-properties` e le loro pagine; `index-query-tags`/`-neighbors`/`-property-values` cambiano il primo campo (un'espressione al posto di un documento o di una lista di filtri); `index` guadagna `routes`, senza cui il dispatch resta per tentativi; `host-api.list-documents` prende una finestra |
| [decisione 0040](../decisions/0040-chi-localizza.md) | **chi localizza le stringhe** (§12.1): ogni campo che una persona legge passa da `string` a `text`, il tipo che porta la propria provenienza — ventidue record di `ui`, `command-spec`/`param-spec`/`choice`/`command-plan`/`command-outcome`, `setting-spec`, `view-spec`. Non è un'aggiunta e non poteva esserlo: una `string` in più accanto a ogni etichetta avrebbe raddoppiato la superficie e lasciato in piedi la domanda «quale delle due vince». `plugin-manifest` guadagna invece `strings` e `default-locale` **in coda**, che è additivo, perché il catalogo è dato nuovo e non un ritipo |
| [decisione 0041](../decisions/0041-un-errore-e-testo-che-qualcuno-legge.md) | **anche un errore è testo che qualcuno legge** (§12.2): i nove payload di `plugin-error` passano da `string` a `text`, per la stessa ragione della 0040 e con lo stesso costo — un errore era l'ultima cosa che arrivava a uno schermo senza poter essere tradotta, e affiancargli una seconda `string` avrebbe riproposto la domanda «quale delle due vince». Le tre varianti nuove — `not-found`, `already-exists`, `io` — sono invece **in coda**, cioè additive: distinguono ciò che prima passava tutto come `internal`, e non spostano il discriminante di nessuna delle nove che c'erano |
| [decisione 0049](../decisions/0049-una-posizione-dentro-un-documento.md) | `index-result.resolved` passa da `option<doc-id>` a `option<resolved-ref>` (§21.10): un `[[Nota#^blocco]]` porta un punto e la risposta sapeva dire solo *quale documento*, quindi chi risolve lo scartava. Il ripiego additivo — una variante `resolved-at` in coda — è stato scartato a verbale: lascerebbe per sempre due casi che rispondono alla stessa `index-query.resolve`. **Questo ritaglio NON tocca `0.1.0.wit`, e non è una svista**: `resolved` è nata con la [0043](../decisions/0043-il-path-e-la-chiave.md), cioè dopo che la linea di base è stata tagliata — nello snapshot l'`index-result` finisce a `organization`. Ritipare una variante mai pubblicata non rompe nessuna promessa, quindi `wit_additivity` resta verde **con ragione**, e scrivere nel file della linea di base un caso che non c'era falsificherebbe cosa è stato pubblicato. La rottura resta reale per chi compila contro l'`abi.wit` di oggi: è qui perché il presidio, correttamente, non la vede |

| [decisione 0051](../decisions/0051-l-alimentazione-risponde.md) | **i tre metodi dell'alimentazione di `index`** (§20.1): `on-document-indexed` e `on-document-removed` diventano `on-documents-indexed`/`on-documents-removed` — a **lotto** — e tutti e tre restituiscono `list<index-loss>` invece di niente. Non poteva essere additivo in nessuna delle due metà: un esito si aggiunge solo cambiando il tipo di ritorno, e la grana è il tipo del parametro. Le due domande — che forma ha l'esito, e quanti documenti per chiamata — hanno una risposta sola, ed è la ragione per cui il ritaglio è **uno** e non due: un esito per lotto dice *quale* documento (cosa che un esito cumulativo raccolto dal `flush` non sa fare) e costa un attraversamento del confine per lotto invece che per documento. Il tipo `index-loss` entra con loro. `up-to-date` **non** è toccata |
| [decisione 0089](../decisions/0089-da-cosa-e-partita-una-scrittura.md) | **`host-vault-write.write-document` prende una `base: option<revision>` e restituisce la `revision` prodotta** (§18.1). La guardia della [0008](../decisions/0008-modifica-chirurgica.md) — dire da cosa si è partiti, e ricevere `conflict` invece di sovrascrivere in silenzio — valeva per `apply-edit`, cioè per i *provider*, e non per l'editor, che salva il buffer intero: il salvataggio **copriva** una scrittura altrui che il watcher non aveva visto. Nessuna delle due metà è additiva, e non poteva esserlo: una guardia si aggiunge solo cambiando l'**arità**, un esito prodotto solo cambiando il **tipo di ritorno**. Il ripiego — una `write-document-based` in coda all'interfaccia — è stato scartato a verbale per la ragione della [0049](../decisions/0049-una-posizione-dentro-un-documento.md): lascerebbe per sempre **due modi di scrivere un documento intero, di cui uno cieco**, e chi scrive un plugin sceglierebbe il più corto, che è quello che copre il lavoro degli altri. `option` sul parametro e non obbligatorio come in `apply-edit`, perché un edit non **esiste** senza la revisione su cui è calcolato mentre una riscrittura totale è compiuta da sé — un importer non corregge un testo che ha letto, lo **detta**, e una base inventata è una guardia che dice sempre di sì |
| [decisione 0092](../decisions/0092-una-base-si-dichiara.md) | **`base` di `host-vault-write.write-document` passa da `option<revision>` a `write-base`** (§23.11), un `variant` a due casi nominati — `descends-from(revision)` e `dictated` — più il tipo nuovo nell'interfaccia `edit`. È il **secondo ritaglio sulla stessa firma**, tre commit dopo la [0089](../decisions/0089-da-cosa-e-partita-una-scrittura.md), e la riga sopra dice esattamente cosa la 0089 aveva concluso: `option` perché una riscrittura totale può essere compiuta da sé. Quella premessa regge ancora — è la ragione per cui il caso `dictated` **esiste** invece di sparire. Ciò che non reggeva era la *forma*: un `option` non fa scegliere fra due mestieri, fa **omettere** uno dei due, e la guardia si perdeva senza che nessuna riga di diff lo dicesse. La 0089 si è chiesta se la guardia esistesse; non si è chiesta come si sbaglia a non usarla. Fra i due ritagli non c'è stato nessun rilascio: chi paga è questo repo, non chi ha compilato un plugin — e dopo M4 lo stesso cambio costerebbe una major |
| [decisione 0093](../decisions/0093-le-selezioni-sono-n-e-il-buffer-e-uno.md) | **`view-context.selection` diventa `selections`, e il tipo passa da `option<selection>` a `option<selection-set>`** (§23.4): il record `selection` sparisce e al suo posto entrano cinque tipi — `floating-selection`, `anchored-selection`, le due liste con la **primaria nominata** e il `variant selection-set { anchored, floating }`. È un **campo di record ritipato**, cioè la prima delle venti rotture che `wit_additivity` elenca: un provider che riceve un campo nuovo lo ignora e compila, uno che riceve un tipo diverso non compila. La [0007](../decisions/0007-contesto-di-sessione.md) questo ritaglio lo aveva **previsto** — «la seconda selezione sarebbe `list<selection>`, cioè additiva solo cambiando il tipo del campo» — e lo aveva previsto **più piccolo di com'è**: una lista sola non basta, perché da uno a molti cambiano anche quale sia la primaria (che «la prima» non sa dire senza perderla: CodeMirror la tiene in un indice a parte, e di norma è l'ultima aggiunta) e dove sta la regola dello span (la condizione è del **buffer**, uno per pannello, quindi sopra l'insieme e non dentro le voci). Una rinuncia dichiarata non è una rinuncia dimensionata. Ciò che non è mai stato fuori, intanto, è il multi-cursore stesso: l'editor della shell lo porta acceso da sempre, e per tutto questo tempo la shell ha pubblicato la primaria buttando via le altre |

La [decisione 0069](../decisions/0069-cosa-sa-dire-un-abbonamento.md) **non è in
questa tabella**, e vale dirlo perché tocca il punto delicato di questa pagina:
aggiunge un caso in coda al `variant event` (`timer-fired`) e uno in coda
all'`enum event-kind`, più cinque tipi nuovi e tre campi in fondo ad altrettanti
record. Per la regola che questo progetto ha scelto è **tutto additivo**, il
discriminante di ciò che c'era non si muove, `wit_additivity` è verde e
`frozen/0.1.0.wit` non è stato toccato. Il precedente del caso in coda a un
`variant` è la [0041](../decisions/0041-un-errore-e-testo-che-qualcuno-legge.md),
che ne aveva aggiunti tre a `plugin-error`. Resta vero ciò che questa pagina
scrive sopra — nel component model un caso in più non è additivo davvero — e resta
il motivo per cui la regola scelta chiede *almeno* che l'ordine non si muova.

**Dopo il freeze** un file già qui non si tocca più. Alla pubblicazione di una
versione nuova:

```sh
cp crates/fub-abi/wit/fub/abi.wit crates/fub-abi/wit/frozen/<nuova-versione>.wit
```

e si lascia il precedente a fare da presidio. Gli snapshot con una major diversa
da quella corrente vengono ignorati dal confronto: quella rottura è dichiarata, e
`abi_compatible` rifiuta comunque quei plugin.

Svuotare questa cartella spegne il presidio senza rendere rosso niente — per
questo il test fallisce anche solo se non trova una linea di base con la major
corrente.
