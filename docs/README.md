# La documentazione di FubMD

Tutta la prosa del repo sta qui dentro. Fuori da `docs/` restano solo il
[README della radice](../README.md) — cos'è FubMD e come si avvia — e tre
cartelli di poche righe in `frontend/`, `crates/fubmd-abi/wit/` e
`crates/fubmd-abi/wit/frozen/`, che dicono soltanto quale documento di qui
riguarda quella cartella. Più [LICENSE-MIT](../LICENSE-MIT) e
[LICENSE-APACHE](../LICENSE-APACHE), che stanno in radice perché è lì che li
cercano gli strumenti che rilevano una licenza, e che non sono prosa di questo
repo: sono due testi standard ripresi parola per parola.

La regola ha una ragione sola: **un secondo posto in cui si racconta la stessa
cosa è un secondo posto che invecchia**, in silenzio, perché niente lo compila.

## Da dove si comincia

**Non conosco il progetto.** [PIANO.md](PIANO.md) — l'idea architetturale, le
decisioni col perché, la struttura dei crate. Poi
[architecture/mappa-visuale.md](architecture/mappa-visuale.md), lo stesso
disegno in un colpo d'occhio.

**Devo scrivere codice.** [architecture/](architecture/) — il contratto, il
modello dei dati, il protocollo di UI, il confine dei plugin, la forma della
shell: com'è fatto **adesso**.

**Devo capire perché una cosa è così.** [decisions/](decisions/README.md) — un
verbale per decisione chiusa: il ragionamento, cosa si è scartato, cosa resta
scoperto.

**Devo sapere cosa manca.** [todo.md](todo.md) — l'indice del lavoro aperto,
organizzato in sedute; una seduta per file in [roadmap/](roadmap/).

**Devo sapere cosa dovrà saper fare l'app.** [FEATURES.md](FEATURES.md) — il
catalogo di FubMD e della futura FubSuite. È un elenco di destinazione, non di
stato.

**Devo contribuire, o segnalare qualcosa.**
[CONTRIBUTING.md](CONTRIBUTING.md) — le invarianti che non si negoziano, il
ciclo locale, la forma dei commit. Per una vulnerabilità il canale è privato ed
è [SECURITY.md](SECURITY.md); per il resto vale il
[codice di condotta](CODE_OF_CONDUCT.md).

## Le aree

| Cartella | Cosa contiene | Chi la mantiene aggiornata |
|---|---|---|
| [architecture/](architecture/) | com'è fatto il sistema **oggi**: contratto, modello dati, protocollo UI, confine dei plugin, shell, WIT, mappa visuale | chi cambia il codice che descrivono |
| [decisions/](decisions/README.md) | i verbali delle decisioni chiuse, numerati e immutabili | chi chiude una decisione, aggiungendo un file |
| [roadmap/](roadmap/) | il lavoro aperto, una seduta per file, più i tre allegati di metodo | chi chiude una voce, spuntandola in `todo.md` |
| [milestones/](milestones/) | M2…M5: cosa entra in ciascuna e cosa la dichiara finita | chi pianifica una milestone |
| [personas/](personas/) | le sei personas e le interviste da cui vengono | nessuno: materiale di ricerca, datato e congelato |
| [appendix/](appendix/) | ciò che è progettato ma fuori dai milestone numerati | chi ci aggiunge un progetto rimandato |

Più i documenti di primo livello. Tre raccontano il progetto:
[PIANO.md](PIANO.md) (il piano, con la mappa dettagliata di tutti i documenti),
[FEATURES.md](FEATURES.md) (il catalogo) e [todo.md](todo.md) (l'indice del
lavoro aperto). Cinque riguardano il repo come progetto pubblico, e stanno qui e
non in radice per la stessa regola di tutto il resto:

| Documento | Cosa dice | Chi lo mantiene aggiornato |
|---|---|---|
| [CONTRIBUTING.md](CONTRIBUTING.md) | le invarianti presidiate, il ciclo locale, la forma dei commit, come si chiude una decisione | chi cambia un presidio o la CI |
| [SECURITY.md](SECURITY.md) | dove si segnala una vulnerabilità, cos'è dentro il perimetro, cosa è già presidiato | chi sposta il perimetro — a M5 lo sposta il sandbox WASM |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | Contributor Covenant 2.1, traduzione ufficiale, ripreso e non riscritto | nessuno: è testo importato |
| [versionamento.md](versionamento.md) | i tre numeri di versione — crate, contratto, schemi su disco — e cosa promette ciascuno | chi alza uno `SCHEMA_VERSION` o tocca `ABI_VERSION` |
| [CHANGELOG.md](CHANGELOG.md) | cosa cambia per chi usa FubMD, versione per versione | chi rilascia |

## Le convenzioni

**Dove va un documento nuovo.** Descrive com'è fatta una cosa adesso →
`architecture/`. Racconta perché si è scelto così → `decisions/`, col numero
successivo e la riga in [decisions/README.md](decisions/README.md). Elenca
lavoro da fare → una seduta in `roadmap/`, con la voce in `todo.md`. È
progettato ma senza milestone → `appendix/`. Riguarda il repo come **progetto
pubblico** — chi contribuisce, chi segnala, cosa promette un numero di versione —
→ primo livello di `docs/`, accanto agli altri cinque. Se non rientra in nessuna,
la domanda giusta non è «in quale cartella» ma «di che genere è».

**I nomi dei file.** Minuscolo, parole separate da trattini, in italiano. Le
eccezioni sono due, e sono di natura diversa.

Le prime sono **storiche** — `PIANO.md`, `FEATURES.md`, `M2`…`M5` — e restano
maiuscole perché centoventidue riferimenti nei sorgenti le nominano così.

Le seconde sono **i file che GitHub cerca per nome**: `CONTRIBUTING.md`,
`SECURITY.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, e in radice `LICENSE-MIT` e
`LICENSE-APACHE`. Qui il nome non è una convenzione ma un'interfaccia: è la
stringa esatta su cui GitHub attacca il bottone «Report a vulnerability», il
banner del codice di condotta e l'avviso che compare aprendo una pull request.
Tradurli in `come-contribuire.md` costerebbe esattamente quei comportamenti, e
li costerebbe **in silenzio** — nessun link si romperebbe, nessun check
diventerebbe rosso, semplicemente il bottone non ci sarebbe. Una regola di
nomenclatura non vale il prezzo di disattivare la piattaforma su cui il repo
vive. Il **contenuto** resta italiano come tutto il resto, e i file stanno in
`docs/`, che è l'altra cartella in cui GitHub li cerca: così la regola grossa —
tutta la prosa in un posto solo — resta vera.

**I numeri che cambiano non stanno qui.** Voci aperte, verbali, stato di una
milestone: sono in `todo.md` e in `decisions/README.md`, dove si aggiornano
insieme al fatto che descrivono. Un indice che li ripete è un indice che mente.

**I link fra documenti sono presidiati.** `node .github/scripts/check-doc-links.mjs`
verifica ogni link relativo del repo e fallisce se ne trova uno rotto. Conta
anche gli alberi che salta e i file che controlla: se un giorno ne controllasse
nove invece di un centinaio, lo direbbe invece di stampare «0 rotti».

**Quello che non è documentazione.** `docs/.fubmd-data/` è l'indice di ricerca e
gli snapshot del versioning che FubMD scrive quando si apre `docs/` come vault.
È ignorato da git e non va modificato a mano: quegli snapshot sono la memoria di
com'erano i file.
