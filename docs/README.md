# La documentazione di FubMD

Tutto ciò che questo repo scrive in prosa sta qui dentro. Fuori da `docs/`
restano solo il [README della radice](../README.md) — la porta del repo, che
dice cos'è FubMD e come si avvia — e tre cartelli di poche righe, in
`frontend/`, `crates/fubmd-abi/wit/` e `crates/fubmd-abi/wit/frozen/`. I
cartelli non raccontano niente: dicono soltanto quale documento di qui riguarda
quella cartella.

La ragione della regola è la stessa che ha fatto nascere metà dei verbali qui
sotto: **un secondo posto in cui si racconta la stessa cosa è un secondo posto
che invecchia**, e invecchia in silenzio, perché niente lo compila. Era già
successo — `frontend/README.md` ha promesso `src/editor.ts`, `src/ui.ts` e
`src/api.ts` per tutto il tempo in cui quei file non esistevano più.

## Da dove si comincia

**Non conosco il progetto.** [PIANO.md](PIANO.md) — l'idea architetturale, le
decisioni con il perché, la struttura dei crate. Poi
[architecture/mappa-visuale.md](architecture/mappa-visuale.md), che è lo stesso
disegno in un colpo d'occhio.

**Devo scrivere codice.** [architecture/](architecture/) — il contratto, il
modello dei dati, il protocollo di UI, il confine dei plugin, la forma della
shell. Sono i documenti che i sorgenti citano dai commenti, e sono la
descrizione di com'è fatto **adesso**.

**Devo capire perché una cosa è così.** [decisions/](decisions/README.md) — un
verbale per decisione chiusa: il ragionamento, cosa si è scartato e perché, cosa
resta scoperto dopo. È «il perché, che fra sei mesi non si ricostruisce dal
diff».

**Devo sapere cosa manca.** [todo.md](todo.md) — l'indice del lavoro aperto,
organizzato in sedute; una seduta per file in [roadmap/](roadmap/).

**Devo sapere cosa dovrà saper fare l'app.** [FEATURES.md](FEATURES.md) — il
catalogo completo delle funzionalità di FubMD e della futura FubSuite. È un
elenco di destinazione, non di stato: lì dentro quasi tutto è ancora da fare.

## Le aree

| Cartella | Cosa contiene | Chi la mantiene aggiornata |
|---|---|---|
| [architecture/](architecture/) | com'è fatto il sistema **oggi**: contratto, modello dati, protocollo UI, confine dei plugin, shell, WIT, mappa visuale | chi cambia il codice che descrivono |
| [decisions/](decisions/README.md) | i verbali delle decisioni chiuse, numerati e immutabili | chi chiude una decisione, aggiungendo un file |
| [roadmap/](roadmap/) | il lavoro aperto, una seduta per file, più i tre allegati di metodo | chi chiude una voce, spuntandola in `todo.md` |
| [milestones/](milestones/) | M2…M5: cosa entra in ciascuna e cosa la dichiara finita | chi pianifica una milestone |
| [personas/](personas/) | le sei personas e le interviste da cui vengono | nessuno: sono materiale di ricerca, datato e congelato |
| [appendix/](appendix/) | ciò che è progettato ma fuori dai milestone numerati | chi ci aggiunge un progetto rimandato |

E i tre documenti di primo livello: [PIANO.md](PIANO.md) (il piano, con la mappa
dettagliata di tutti i documenti), [FEATURES.md](FEATURES.md) (il catalogo) e
[todo.md](todo.md) (l'indice del lavoro aperto).

## Le convenzioni

**Dove va un documento nuovo.** Se descrive com'è fatta una cosa adesso →
`architecture/`. Se racconta perché si è scelto così → `decisions/`, col numero
successivo, e la riga nella tabella di [decisions/README.md](decisions/README.md).
Se elenca lavoro da fare → una seduta in `roadmap/`, con la voce in `todo.md`.
Se è progettato ma non ha una milestone → `appendix/`. Se non rientra in nessuna
di queste, la domanda giusta non è «in quale cartella lo metto» ma «di che
genere è», e va risposta prima di scriverlo.

**I nomi dei file.** Minuscolo, parole separate da trattini, in italiano come il
resto della prosa. Le eccezioni sono tre e sono storiche — `PIANO.md`,
`FEATURES.md` e i file `M2`…`M5` — e restano maiuscole perché centoventidue
riferimenti nei sorgenti Rust e TypeScript le nominano così: il costo di
rinominarle è reale e il guadagno è estetico.

**I numeri che cambiano non stanno qui.** Quante voci sono aperte, quanti
verbali ci sono, a che punto è una milestone: sono in `todo.md` e in
`decisions/README.md`, che è dove si aggiornano insieme al fatto che descrivono.
Un indice che li ripete è un indice che mente, e nessuno se ne accorge finché
non è troppo tardi.

**I link fra documenti sono presidiati.** `node .github/scripts/check-doc-links.mjs`
verifica ogni link relativo del repo e fallisce se ne trova uno rotto. Esiste
perché `PIANO.md` ha continuato a linkare un file cancellato per venti commit
senza che nulla diventasse rosso. Lo script conta anche gli alberi che salta e i
file che controlla: se un giorno controllasse nove file invece di un centinaio,
lo direbbe invece di stampare «0 rotti» e sembrare contento.

**Quello che non è documentazione.** `docs/.fubmd-data/` non è testo di questo
repo: sono l'indice di ricerca e gli snapshot del versioning che FubMD scrive
quando si apre `docs/` come vault — cioè quando si fa il dogfooding che il
progetto chiede. È ignorato da git e non va modificato a mano: quegli snapshot
sono la memoria di com'erano i file, e riscriverli è riscrivere il passato.
