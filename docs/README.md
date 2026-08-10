# La documentazione di Fub

Tutta la prosa del repo è in `docs/`. **Non si scrive la stessa cosa in due posti**,
perché il duplicato invecchia in silenzio senza farsi notare dai compilatori.

Fuori da questa cartella trovi solo:
- [README della radice](../README.md): cos'è Fub e come si avvia.
- **tre** file brevi in `frontend/`, `crates/fub-abi/wit/` e `crates/fub-abi/wit/frozen/`. Rimandano ai documenti di questa cartella.
- [LICENSE-MIT](../LICENSE-MIT) e [LICENSE-APACHE](../LICENSE-APACHE). Stanno in radice per farsi trovare dai tool automatici. Non sono prosa nostra.

## Da dove si comincia

- **Non conosco il progetto.** [leggimi-prima.md](leggimi-prima.md): **due** pagine per capire cos'è Fub, com'è diviso e le parole fondamentali. Poi [PIANO.md](PIANO.md) per l'idea architetturale, le decisioni e la struttura dei crate. Infine [architecture/mappa-visuale.md](architecture/mappa-visuale.md) per il disegno d'insieme.
- **Non capisco una parola.** [glossario.md](glossario.md): lotto, porta, ponte, anagrafe, sidecar, superficie, revisione, ricongiungimento. Il lessico di questo repo è preciso e non è standard. Ha una voce per termine, con il tipo Rust, il file e il verbale. Per il vocabolario del metodo, la tabella è in [leggimi-prima.md](leggimi-prima.md).
- **Devo scrivere codice.** [architecture/](architecture/): il contratto, il modello dati, il protocollo UI, il confine dei plugin, la shell. Mostra com'è fatto **adesso**.
- **Devo capire perché una cosa è così.** [decisions/](decisions/README.md): un verbale per decisione chiusa. Spiega il ragionamento e le alternative.
- **Devo sapere cosa manca.** [todo.md](todo.md): l'indice del lavoro aperto. Usa una seduta per file in [roadmap/](roadmap/).
- **Devo sapere cosa dovrà saper fare l'app.** [FEATURES.md](FEATURES.md): il catalogo di Fub e FubSuite. È un elenco di destinazione.
- **Devo contribuire, o segnalare qualcosa.** [CONTRIBUTING.md](CONTRIBUTING.md): le invarianti presidiate (ovvero controllate da script), il ciclo locale, i commit. Le vulnerabilità si segnalano in [SECURITY.md](SECURITY.md). Per il resto vale il [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Le aree

| Cartella | Cosa contiene | Chi la mantiene aggiornata |
|---|---|---|
| [architecture/](architecture/) | com'è fatto il sistema **oggi**: contratto, modello dati, protocollo UI, confine dei plugin, shell, WIT, mappa visuale | chi cambia il codice che descrivono |
| [decisions/](decisions/README.md) | i verbali delle decisioni chiuse, numerati e immutabili | chi chiude una decisione, aggiungendo un file |
| [roadmap/](roadmap/) | il lavoro aperto, una seduta per file, più i **tre** allegati di metodo | chi chiude una voce, spuntandola in `todo.md` |
| [milestones/](milestones/) | `M2`…`M5`: cosa entra in ciascuna e cosa la dichiara finita | chi pianifica una milestone |
| [personas/](personas/) | le **sei** personas e le interviste da cui vengono | nessuno: materiale di ricerca, datato e congelato |
| [appendix/](appendix/) | ciò che è progettato ma fuori dai milestone numerati | chi ci aggiunge un progetto rimandato |

Più i documenti di primo livello. **Quattro** raccontano il progetto: [PIANO.md](PIANO.md), [FEATURES.md](FEATURES.md), [todo.md](todo.md) e [glossario.md](glossario.md).
**Sei** riguardano il repo come progetto pubblico. Stanno qui per evitare dispersioni:

| Documento | Cosa dice | Chi lo mantiene aggiornato |
|---|---|---|
| [leggimi-prima.md](leggimi-prima.md) | cos'è Fub in **cinque** righe, i crate in ordine di dipendenza, il dizionario del metodo | chi cambia la divisione in crate o il metodo |
| [CONTRIBUTING.md](CONTRIBUTING.md) | le invarianti presidiate, il ciclo locale, i commit, come si chiude una decisione | chi cambia un presidio o la CI |
| [SECURITY.md](SECURITY.md) | le vulnerabilità e il perimetro | chi sposta il perimetro (es. `M5` con WASM) |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | Contributor Covenant 2.1, traduzione ufficiale | nessuno: testo importato |
| [versionamento.md](versionamento.md) | i **tre** numeri di versione: crate, contratto, schemi su disco | chi alza `SCHEMA_VERSION` o tocca `ABI_VERSION` |
| [CHANGELOG.md](CHANGELOG.md) | cosa cambia per chi usa Fub in ogni versione | chi rilascia |

## Le convenzioni

**Dove va un documento nuovo.**
- Descrive com'è fatta una cosa adesso? → `architecture/`.
- Racconta perché si è scelto così? → `decisions/`, con riga in [decisions/README.md](decisions/README.md).
- Elenca lavoro da fare? → `roadmap/` con voce in `todo.md`.
- È progettato ma senza milestone? → `appendix/`.
- Riguarda il repo come **progetto pubblico**? → primo livello di `docs/`.

**I nomi dei file.** Sono minuscoli, separati da trattini, in italiano. Le eccezioni sono due:
1. Nomi **storici**: `PIANO.md`, `FEATURES.md`, `M2`…`M5`. Restano maiuscoli perché **centoventidue** riferimenti nei sorgenti li usano così.
2. File per **GitHub**: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, `LICENSE-MIT`, `LICENSE-APACHE`. GitHub usa questi nomi esatti per mostrare i banner. Tradurli in `come-contribuire.md` farebbe perdere l'integrazione.

**I numeri che cambiano non stanno qui.** Voci aperte, verbali, stato di una milestone vanno solo in `todo.md` e in `decisions/README.md`. Ripeterli crea indici falsi.

**I link fra documenti sono presidiati.** Un presidio — un controllo automatico che fallisce in caso di errore — è gestito da `node .github/scripts/check-doc-links.mjs`. Verifica ogni link relativo e fallisce se ne trova uno rotto. Se controllasse solo **nove** file invece di **cento**, lo direbbe invece di stampare **0** rotti.

**Quello che non è documentazione.** `docs/.fub/` è la cartella di lavoro quando apri `docs/` in Fub. Sotto `data/` contiene l'indice di ricerca e gli snapshot del versioning. Ignorala e non modificarla a mano. [architecture/on-disk-layout.md](architecture/on-disk-layout.md) ne descrive l'organizzazione.
