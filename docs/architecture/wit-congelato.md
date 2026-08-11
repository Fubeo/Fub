# `crates/fub-abi/wit/frozen/` — il contratto com'era

Qui dentro c'è una copia del contratto per ogni versione **pubblicata**. Il nome
del file è la versione (`0.1.0.wit` ↔ `package fub:abi@0.1.0`).

È la linea di base. Il test
[`crates/fub-abi/tests/wit_additivity.rs`](../../crates/fub-abi/tests/wit_additivity.rs)
legge questi file per tenere in piedi la promessa del freeze di M4: **dopo il
freeze il contratto cresce solo per aggiunta**.

## Perché non bastava ciò che c'era

Nessuno dei due presidi che c'erano già copre quella promessa.

- [`wit_conformance.rs`](../../crates/fub-abi/tests/wit_conformance.rs)
  confronta `fub-abi` e `crates/fub-abi/wit/fub/abi.wit` così come sono
  **oggi**. Se un campo si rinomina in tutti e due, resta verde — e ogni plugin
  già compilato si rompe.
- `abi_compatible` decide a runtime, e guarda solo i numeri di versione: major
  diversa, rifiuto; minor del plugin ≤ minor dell'host, si passa. Ma togliere
  una variante o rinominare un campo la minor non la muove. Il plugin entra, e
  il confine si rompe più tardi. La rete cede proprio dove serviva.

Il costo di accorgersene tardi non è distribuito in parti uguali: nel repo la
build resta verde, e a rompersi sono i plugin di terzi, dopo il rilascio.

## Cosa conta come aggiunta

Perché sia un'aggiunta, ogni elemento già pubblicato deve restare intatto **e
nella stessa posizione**. Il nuovo va solo in coda.

| costrutto | additivo | rotto |
|---|---|---|
| `record` | un campo **in fondo** | rinominare, ritipare, riordinare, togliere |
| `variant` / `enum` / `flags` | un caso **in fondo** | rinominare, ritipare, riordinare, togliere (l'ordine è il discriminante) |
| `type x = …` | — | qualunque cambio di destinazione |
| funzione su un'interfaccia **importata** dal plugin | una funzione **nuova** | cambiare parametri o risultato di una funzione esistente |
| funzione su un'interfaccia **esportata** dal plugin | — | una funzione **nuova** è un'**obbligazione** (un requisito forzato), vedi sotto; cambiare parametri o risultato di una funzione esistente |
| interfaccia | un'interfaccia **nuova** | toglierne una, o spostarci dentro un tipo esistente |
| `world` | un import/export in più | toglierne uno |

Spostare un tipo da un'interfaccia a un'altra **è** una rinomina: cambia il suo
nome qualificato, e rompe. Che il nome nudo resti uguale non salva niente.

La riga «funzione nuova» vale in due modi opposti, e dipende da chi la
implementa.

- Sulle interfacce che il plugin **importa**, una funzione in più non rompe: un
  componente già compilato la ignora e continua a girare. È il caso della
  [decisione 0013](../decisions/0013-elenco-delle-capacita.md).
- Sulle interfacce che il plugin **esporta** — quelle elencate nel `world` e
  scritte dal plugin — una funzione in più è un **obbligo**. Il componente
  compilato contro `fub:abi@0.1.0` esporta solo le vecchie, e un `world` che ne
  chiede una nuova non lo lascia nemmeno istanziare. È una major travestita da
  riga in coda. L'ha vista la [decisione
  0102](../decisions/0102-i-byte-non-stanno-nel-record.md), dopo che era già
  successo due volte (`index::up-to-date` e `view::interests`); quei due stanno
  in `OBBLIGAZIONI_NOTE` dentro `wit_additivity.rs`, ciascuno con la sua
  ragione.

Perché «in fondo» e non «da qualche parte»: nel component model aggiungere un
caso a un `variant` cambia comunque il binario. Qui l'aggiunta si accetta lo
stesso, a una condizione — il discriminante di ciò che c'era già non si muove.

## Come si aggiorna

**Prima del freeze di M4** la superficie si muove ancora, e il test serve a
rendere il movimento visibile. Una rottura voluta si fa in un commit che **tocca
`0.1.0.wit`** e dice perché: in review si vede. Prima, cambiamenti così
passavano senza lasciare traccia.

C'è un caso in cui il test è **verde ed è giusto che lo sia**: un elemento nato
*dopo* il taglio della linea di base non è mai stato pubblicato, quindi
cambiarlo non rompe nessuna promessa e lo snapshot resta com'è. Metterlo dentro
a posteriori falsificherebbe lo storico. La rottura però esiste per chi compila
contro l'`abi.wit` di oggi, e per questo la tabella la elenca lo stesso: il test
copre *ciò che è uscito*, non *ciò che è cambiato*. Verde non vuol dire
additivo.

La tabella raccoglie **tutti i ritagli fatti finora**, in ordine cronologico, in
un posto solo.

| Decisione | Cosa è stato ritagliato |
|---|---|
| [decisione 0003](../decisions/0003-modello-del-documento.md) | - `anchor` aggiunto dentro ogni record di blocco. <br> - `items` aggiunto alla lista. <br> - `thematic-break` trasformato da payload (dati utili) nudo a record. <br> - `embed` rimosso da `link-target-wiki`. |
| [decisione 0012](../decisions/0012-origine-degli-eventi.md) | - `event-handler.handle` accetta ora un `notice` invece di un `event` nudo. |
| [decisione 0013](../decisions/0013-elenco-delle-capacita.md) | - `host-api.storage-get` e `storage-set` **rimosse**. <br> - Lo stato volatile chiave-valore perde utilità (vedi `0.1.0.wit` e il verbale). |
| [decisione 0016](../decisions/0016-cosa-e-una-view.md) | - `ui-node` trasformato da `variant` a `record { key, kind }` (la chiave, §2.8). <br> - L'azione dei nodi passa da `action-id` a `action-ref` (il payload, §2.7). <br> - `view-placement` diventa `view-surface`. <br> - `view-spec.placement` diventa `surface` (le dieci superfici, §2.2). <br> - Il primo parametro di `render-view` e `on-action` passa da `string` a `view-instance` (le istanze, §2.3). |
| [decisione 0017](../decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md) | - I quattro tipi basati su N booleani diventano una mappa con namespace (spazio dei nomi). <br> - Tipi coinvolti: `format-capabilities` (5), `parse-context` (2), `render-options` (1), `plugin-permissions` (3). <br> - Il freeze blocca la **forma**, non la larghezza (§3.5). <br> - `format.parse` accetta un `document-source` invece di una `string` (§3.4). Questo permette l'uso di documenti non-testuali. |
| [decisione 0021](../decisions/0021-il-confine.md) | - L'interfaccia **`host-api` si divide in dieci interfacce** (§7.1). <br> - Ventiquattro funzioni cambiano nome qualificato (esempio: `host-api.read-document` diventa `host-vault-read.read-document`). <br> - Il record `trash-entry` cambia posizione. <br> - Questo ritaglio risulta il più esteso e l'ultimo per `host-api`. <br> - Il post-freeze impedisce lo spostamento di funzioni tra interfacce. <br> - Permette di **non importare** i permessi di scrittura. In M5, il rifiuto deriva dall'assenza della funzione e non da un blocco a runtime. <br> - Il `plugin-world` importa le dieci famiglie singolarmente. |
| [decisione 0019](../decisions/0019-il-canale-dati.md) | - Modifiche al canale dati. <br> - `index-query` e `index-result` rimuovono `full-text` e `properties`. Aggiungono `documents`. Prima rappresentavano la stessa domanda in due lingue incompatibili. <br> - Rimossi `search-scope`, `search-hit`, `document-properties` e le loro pagine. <br> - Il primo campo di `index-query-tags`, `-neighbors`, `-property-values` cambia. Ora usa un'espressione invece di un documento o lista di filtri. <br> - `index` aggiunge `routes`. Questo evita il dispatch (smistamento) per tentativi. <br> - `host-api.list-documents` riceve ora una finestra di risultati. |
| [decisione 0040](../decisions/0040-chi-localizza.md) | - Risolve **chi localizza le stringhe** (§12.1). <br> - I campi leggibili dagli utenti passano da `string` a `text`. Il tipo `text` include l'origine della stringa. <br> - Colpisce ventidue record di `ui`, `command-spec`, `param-spec`, `choice`, `command-plan`, `command-outcome`, `setting-spec`, `view-spec`. <br> - Questa operazione sostituisce il tipo. Aggiungere una `string` avrebbe raddoppiato la superficie. Avrebbe anche generato conflitti su quale delle due variabili usare. <br> - `plugin-manifest` aggiunge `strings` e `default-locale` **in coda**. Questa è un'aggiunta additiva (un catalogo nuovo e non un ritipo). |
| [decisione 0041](../decisions/0041-un-errore-e-testo-che-qualcuno-legge.md) | - Stabilisce che **anche un errore è testo che qualcuno legge** (§12.2). <br> - I nove payload di `plugin-error` passano da `string` a `text` (stessa logica della 0040). <br> - Precedentemente un errore arrivava allo schermo senza possibilità di traduzione. <br> - Affiancare una seconda `string` avrebbe causato conflitti su quale delle due usare. <br> - Aggiunge tre varianti nuove **in coda**: `not-found`, `already-exists`, `io`. <br> - Queste varianti sono additive. Specificano errori precedentemente uniti in `internal`. <br> - Questa modifica mantiene intatto il discriminante delle nove varianti esistenti. |
| [decisione 0049](../decisions/0049-una-posizione-dentro-un-documento.md) | - `index-result.resolved` passa da `option<doc-id>` a `option<resolved-ref>` (§21.10). <br> - Il riferimento `[[Nota#^blocco]]` include una posizione esatta. La precedente risposta indicava solo il documento. Il risolutore scartava quindi l'informazione. <br> - La soluzione additiva (variante `resolved-at` in coda) è stata rifiutata a verbale. Avrebbe generato due risposte per la stessa richiesta `index-query.resolve`. <br> - **Questa modifica NON tocca `0.1.0.wit`. Non è una svista.** <br> - Il campo `resolved` è stato introdotto dalla [0043](../decisions/0043-il-path-e-la-chiave.md) dopo il taglio della linea di base. <br> - Nello snapshot l'oggetto `index-result` termina con `organization`. <br> - Modificare un elemento mai pubblicato mantiene le promesse. Il test `wit_additivity` è verde **con ragione**. <br> - Inserire un caso inesistente nello snapshot creerebbe un falso storico. <br> - La rottura avviene per chi compila contro l'`abi.wit` odierno. Viene inclusa qui perché il test non la rileva giustamente. |
| [decisione 0051](../decisions/0051-l-alimentazione-risponde.md) | - Modifica **i tre metodi dell'alimentazione di `index`** (§20.1). <br> - `on-document-indexed` e `on-document-removed` diventano elaborazioni a **lotto**: `on-documents-indexed` e `on-documents-removed`. <br> - Tutti e tre i metodi restituiscono ora `list<index-loss>`. <br> - Nessuna delle due modifiche poteva essere additiva. Aggiungere un esito richiede un nuovo tipo di ritorno. Cambiare la grana (quantità) richiede un nuovo parametro. <br> - Forma dell'esito e quantità di documenti condividono una singola soluzione. Per questo il ritaglio è **uno** e non due. <br> - L'esito per lotto identifica il singolo documento (impossibile con il `flush`, salvataggio cumulativo). Richiede un attraversamento del confine per lotto. <br> - Aggiunge il tipo `index-loss`. <br> - La funzione `up-to-date` rimane **intatta**. |
| [decisione 0089](../decisions/0089-da-cosa-e-partita-una-scrittura.md) | - **`host-vault-write.write-document` aggiunge un parametro `base: option<revision>` e restituisce la `revision` creata** (§18.1). <br> - La guardia (protezione) della [0008](../decisions/0008-modifica-chirurgica.md) previene sovrascritture restituendo `conflict`. Questa si applicava solo a `apply-edit` (per i *provider*, fornitori di dati) e non all'editor. L'editor salva il buffer (memoria temporanea) intero. Il salvataggio distruggeva le scritture invisibili al watcher (osservatore). <br> - Nessuna delle due modifiche è additiva. Una guardia altera l'**arità** (numero di parametri). Un esito altera il **tipo di ritorno**. <br> - L'aggiunta in coda di `write-document-based` è stata rifiutata (come nella [0049](../decisions/0049-una-posizione-dentro-un-documento.md)). Avrebbe lasciato **due modi di scrivere un documento intero, di cui uno cieco** (senza controlli). I plugin avrebbero preferito il metodo più corto e distruttivo. <br> - Il parametro usa `option` e non è obbligatorio come in `apply-edit`. Una modifica richiede sempre la revisione base. Una riscrittura totale è autonoma. Un importer (modulo di importazione) **detta** il testo nuovo e non corregge quello vecchio. Una base inventata invaliderebbe la guardia. |
| [decisione 0092](../decisions/0092-una-base-si-dichiara.md) | - **Il parametro `base` di `host-vault-write.write-document` passa da `option<revision>` a `write-base`** (§23.11). <br> - Aggiunge un `variant` con due casi: `descends-from(revision)` e `dictated`. <br> - Aggiunge un nuovo tipo all'interfaccia `edit`. <br> - Rappresenta il **secondo ritaglio sulla stessa firma**, a tre commit dalla [0089](../decisions/0089-da-cosa-e-partita-una-scrittura.md). <br> - La 0089 usava `option` per permettere riscritture totali autonome. Questa logica mantiene in vita il caso `dictated`. <br> - La *forma* precedente era errata. L'oggetto `option` permette l'**omissione** di un compito invece di forzare una scelta fra due. Questo eludeva la guardia in modo silenzioso nei diff (differenze di codice). <br> - La 0089 garantiva l'esistenza della guardia ma non preveniva gli errori di utilizzo. <br> - Nessun rilascio divide i due ritagli. Il problema resta isolato in questo repository e non colpisce i plugin già compilati. <br> - Dopo M4, questo aggiornamento richiederebbe una modifica major. |
| [decisione 0093](../decisions/0093-le-selezioni-sono-n-e-il-buffer-e-uno.md) | - **Il campo `view-context.selection` diventa `selections`. Il tipo diventa `option<selection-set>`** invece di `option<selection>` (§23.4). <br> - Rimuove il record `selection` e inserisce cinque tipi: `floating-selection`, `anchored-selection`, due liste con **selezione primaria esplicita**, e il `variant selection-set { anchored, floating }`. <br> - Questa operazione rappresenta un **campo di record ritipato**. È la prima delle venti rotture rilevate da `wit_additivity`. Un provider tollera campi nuovi ma fallisce la compilazione con tipi alterati. <br> - La [0007](../decisions/0007-contesto-di-sessione.md) aveva **previsto** questo aggiornamento. Notava che la seconda selezione (`list<selection>`) avrebbe richiesto un ritipo non additivo. <br> - L'impatto reale supera le previsioni della 0007. Una singola lista risulta insufficiente. Passare da uno a molti elementi complica l'individuazione della selezione primaria. Usare semplicemente «la prima» impedisce di mantenere la selezione corretta (CodeMirror usa un indice separato e spesso è l'ultima inserita). La regola dello span (intervallo di testo) appartiene al **buffer** (uno per pannello). Si posiziona sopra l'insieme e non all'interno delle voci. <br> - Il sistema ha sempre utilizzato il multi-cursore. L'editor della shell (interfaccia a linea di comando) l'ha sempre supportato. Finora la shell trasmetteva solo la selezione primaria. |
| [decisione 0094](../decisions/0094-un-tetto-che-si-fa-sentire.md) | - **Il ritorno di `host-env.random-bytes` passa da `list<u8>` a `result<list<u8>, plugin-error>`** (§23.12). <br> - Questo **tipo di ritorno cambiato** rappresenta la rottura più semplice fra le venti tracciate da `wit_additivity`. <br> - È il ritaglio più piccolo fra i tre della seduta. Non introduce nuovi tipi. Utilizza le opzioni `bad-args` e `permission-denied` già esistenti (le due frasi corrette). <br> - In precedenza la lista esprimeva **tre** concetti ambiguamente: byte richiesti, limite dell'host, e assenza della capacità `env`. <br> - La [0039](../decisions/0039-il-locale-e-il-caso.md) offuscava le prime due («chi chiede di più riceve mille byte e **non** un errore»). <br> - La terza omissione (assenza della capacità) risultava la più critica. Mascherava una politica di accesso (simile alla [0013](../decisions/0013-elenco-delle-capacita.md) e alla [0021](../decisions/0021-il-confine.md)) dietro un semplice limite di dati. <br> - Il confine **non** accetta l'inclusione del tetto massimo. I numeri fissati diventano promesse congelate. <br> - Il contratto deve invece garantire la notifica di un superamento del limite. Usa il modello `overflow` della [0034](../decisions/0034-il-freno-e-il-raggruppamento.md) (si dichiara la perdita, non la soglia). <br> - L'opzione additiva (`max-random-bytes: func() -> u32`) è stata scartata. Chi ignora i controlli di lunghezza ignorerebbe anche la richiesta del massimo. |
| [decisione 0101](../decisions/0101-una-voce-non-e-un-passo.md) | - **Il ritorno di `host-commands.undo-last` passa da `result<option<text>, plugin-error>` a `result<option<undone>, plugin-error>`** (§23.14). <br> - Questo **tipo di ritorno cambiato** equivale alla rottura della [0094](../decisions/0094-un-tetto-che-si-fa-sentire.md). <br> - Il tipo `text` trasmetteva solo l'etichetta. Diceva **una** cosa ignorandone tre. Una voce di undo (annullamento) rappresenta una **lista** e non un singolo passo. <br> - L'operazione nascondeva i casi in cui l'annullamento riusciva a metà. Nascondeva l'interruzione di un annullamento (passi precedenti applicati, successivi non tentati). <br> - Le risposte salgono da due a quattro. La terza (*niente è cambiato*) rimane un `err`. Questo rispetta la promessa originale («un annullamento può fallire come qualunque scrittura»). <br> - **Questo aggiornamento NON modifica `0.1.0.wit` e non è una svista.** <br> - L'introduzione di `undo-last` risale alla [0045](../decisions/0045-l-undo-ha-due-pile.md), successiva alla creazione della linea di base. Nello snapshot l'interfaccia `host-commands` manca di `undo`, così come `command-outcome`. <br> - Condivide la logica della [0049](../decisions/0049-una-posizione-dentro-un-documento.md). Alterare una funzione inedita non viola le promesse. Il test `wit_additivity` rimane giustamente verde. Inserire funzioni fittizie falsificherebbe lo storico. <br> - La rottura persiste per gli utenti attuali di `abi.wit`. <br> - L'aggiunta di `command-outcome.partial` è additiva **davvero** (in coda a un record con due soli campi), insieme ai tipi `partial` e `failure`. |
| [decisione 0102](../decisions/0102-i-byte-non-stanno-nel-record.md) | - **Il campo `import-source.bytes` diventa `content: source-content`. Il campo `export-artifact.bytes` diventa `content: artifact-content`** (§23.6). <br> - Sono due campi di record ritipati (la prima delle venti rotture di `wit_additivity`). <br> - Aggiunge i tipi `source-handle`, `artifact-handle`, `streamed-source`, `source-content`, `artifact-content` e le due interfacce `host-transfer-read`, `host-transfer-write`. <br> - A differenza della [0049](../decisions/0049-una-posizione-dentro-un-documento.md) e della [0101](../decisions/0101-una-voce-non-e-un-passo.md), **questa operazione modifica `0.1.0.wit` davvero**. <br> - I due campi esistevano nella linea di base originale. Questa alterazione tocca elementi pubblicati. Per questo si esegue prima del freeze M4. <br> - Benefici: i byte del trasferimento non risiedono **dentro** il record. Viaggiano tramite una chiave validata dall'host nei due versi. <br> - Assenza di costi: nessuna richiesta di permessi filesystem (sistema di file) in nessuno dei due versi. La regola della [0006](../decisions/0006-import-export-come-trait.md) rimane valida. <br> - Il mantenimento in memoria è consentito e frequente (`source-content.bytes` rimane disponibile). Adesso richiede una scelta esplicita invece di essere l'unica. <br> - Il `read-chunk` di 256 KiB **non** viene incluso nel confine. Come indicato nella [0094](../decisions/0094-un-tetto-che-si-fa-sentire.md), un numero pubblicato diventa una promessa congelata. |
| [decisione 0132](../decisions/0132-un-rifiuto-non-e-una-frase.md) | - **Il caso `format-error.unsupported` passa da `string` al record `format-error-unsupported { format, got }`** (§24.3). <br> - Questo `variant` **ritipato** rappresenta la seconda delle venti rotture rilevate da `wit_additivity`. Include un nuovo tipo nella medesima interfaccia. <br> - Come per la [0102](../decisions/0102-i-byte-non-stanno-nel-record.md), e diversamente dalle [0049](../decisions/0049-una-posizione-dentro-un-documento.md) e [0101](../decisions/0101-una-voce-non-e-un-passo.md), **questa modifica tocca `0.1.0.wit`**. Il caso esisteva nella linea di base. <br> - L'impatto è significativo. Il tipo `format-error` gestisce gli errori di cinque funzioni **esportate** dal plugin (`format.parse`, `format.render-html`, `format.serialize`, `syntax.apply`, `custom-render.render`). <br> - Questa modifica è un'obbligazione. Il vecchio plugin non può ignorarla. Deve rispondere in questa forma. <br> - La `string` precedente era prosa libera scritta dal provider. Era l'unico errore che arrivava allo schermo senza permettere la composizione della frase a chi lo mostra. <br> - Il nuovo record fornisce i **due dati** grezzi. Chi mostra l'errore si occupa di comporre la frase. <br> - L'approccio additivo (caso in coda con il vecchio `unsupported(string)`) è stato respinto. Similmente alle [0049](../decisions/0049-una-posizione-dentro-un-documento.md) e [0089](../decisions/0089-da-cosa-e-partita-una-scrittura.md), avrebbe mantenuto **due modi di rifiutare una sorgente, di cui uno intraducibile**. I provider avrebbero preferito l'opzione più breve. |

La [decisione 0069](../decisions/0069-cosa-sa-dire-un-abbonamento.md) **non è in
tabella**, e vale la pena dire perché. Aggiunge un caso in coda
al `variant event` (`timer-fired`), uno in coda all'`enum event-kind`,
cinque tipi nuovi e tre campi in fondo a tre record. Qui questo conta
come **completamente additivo**: il discriminante dei vecchi non si muove, `wit_additivity` è verde e
`frozen/0.1.0.wit` non si tocca. Il precedente è la
[0041](../decisions/0041-un-errore-e-testo-che-qualcuno-legge.md), che aveva
messo tre casi in coda a `plugin-error`.

La regola resta imperfetta, e si sa: nel component model un caso in più cambia
il binario, quindi additivo del tutto non lo è. Quello che pretende è *almeno*
che l'ordine di prima resti quello.

## Dopo il freeze

Un file messo qui **dopo il freeze** non si tocca più. Per pubblicare una
versione nuova:

```sh
cp crates/fub-abi/wit/fub/abi.wit crates/fub-abi/wit/frozen/<nuova-versione>.wit
```

Quella di prima resta dov'è, e continua a presidiare.

Il confronto salta gli snapshot con una major diversa da quella corrente: una
rottura di major si dichiara, e `abi_compatible` rifiuta quei plugin da sé.

Svuotare la cartella spegnerebbe il presidio senza far diventare rosso niente.
Per questo il test fallisce apposta se non trova una linea di base con la major
corrente.
