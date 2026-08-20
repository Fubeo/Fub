# La documentazione di Fub

Tutta la prosa del repo è in `docs/`. **Non si scrive la stessa cosa in due
posti**, perché il duplicato invecchia in silenzio senza farsi notare dai
compilatori.

Fuori da questa cartella trovi solo:
- [README della radice](../README.md): cos'è Fub e come si avvia.
- **tre** file brevi in `frontend/`, `crates/fub-abi/wit/` e
  `crates/fub-abi/wit/frozen/`. Rimandano ai documenti di questa cartella.
- [LICENSE-MIT](../LICENSE-MIT) e [LICENSE-APACHE](../LICENSE-APACHE). Stanno in
  radice per farsi trovare dai tool automatici. Non sono prosa nostra.

## Da dove si comincia

- **Non conosco il progetto.** Tre tappe, in quest'ordine:
  [leggimi-prima.md](leggimi-prima.md), **due** pagine su cos'è Fub, com'è
  diviso e le parole fondamentali; poi [PIANO.md](PIANO.md), per l'idea
  architetturale, le decisioni e la struttura dei crate; poi
  [architecture/mappa-visuale.md](architecture/mappa-visuale.md), per il disegno
  d'insieme.
- **Non capisco una parola.** Le parole del prodotto sono definite in una riga,
  dove si usano: **lotto** — un gruppo di modifiche che vanno insieme, e chi
  guarda ridisegna una volta sola; **porta** — il punto di passaggio unico
  verso l'host; **ponte** — il pezzo che porta gli eventi dal kernel a chi
  guarda; **anagrafe** — ciò che il kernel si ricorda di ogni file per non
  doverlo rileggere; **sidecar** — un file accanto al vault che tiene ciò che
  riguarda il vault ma non è contenuto di nessuna nota; **superficie** —
  l'insieme di ciò che il contratto espone e qualcuno di esterno può nominare;
  **revisione** — l'identità del testo su cui si calcola una modifica;
  **ricongiungimento** — riconoscere all'apertura una nota rinominata mentre
  Fub era chiuso. Ogni termine ha il tipo Rust, il file e il verbale accanto al
  suo primo uso in [PIANO.md](PIANO.md) e
  [mappa-visuale.md](architecture/mappa-visuale.md) (sezione *Le parole*). Le
  parole del **metodo** invece stanno in [leggimi-prima.md](leggimi-prima.md).
- **Devo scrivere codice.** [architecture/](architecture/): il contratto, il
  modello dati, il protocollo UI, il confine dei plugin, la shell. Dice com'è
  fatto **adesso**.
- **Devo capire perché una cosa è così.** [decisions/](decisions/README.md): un
  verbale per decisione chiusa, col ragionamento e le alternative scartate.
- **Devo sapere cosa manca.** [todo.md](todo.md): l'indice del lavoro aperto. Le
  sedute stanno una per file in [roadmap/](roadmap/).
- **Devo sapere cosa dovrà saper fare l'app.** [FEATURES.md](FEATURES.md): il
  catalogo di Fub e FubSuite. È la destinazione, non lo stato.
- **Devo contribuire, o segnalare qualcosa.**
  [CONTRIBUTING.md](CONTRIBUTING.md): le invarianti presidiate (cioè controllate
  da uno script), il ciclo locale, i commit. Le vulnerabilità vanno in
  [SECURITY.md](SECURITY.md); per il resto vale il
  [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Le aree

| Cartella | Cosa contiene | Chi la mantiene aggiornata |
|---|---|---|
| [architecture/](architecture/) | com'è fatto il sistema **oggi**: contratto, modello dati, protocollo UI, confine dei plugin, shell, WIT, mappa visuale | chi cambia il codice che descrivono |
| [decisions/](decisions/README.md) | i verbali delle decisioni chiuse, numerati; il contenuto è immutabile, la forma si può riscrivere ([0143](decisions/0143-i-verbali-si-possono-riscrivere.md)) | chi chiude una decisione, aggiungendo un file |
| [roadmap/](roadmap/) | il lavoro aperto, una seduta per file, più i **tre** allegati di metodo | chi chiude una voce, spuntandola in `todo.md` |
| [milestones/](milestones/) | `M2`…`M5`: cosa entra in ciascuna e cosa la dichiara finita | chi pianifica una milestone |
| [personas/](personas/) | le **sei** personas e le interviste da cui vengono | nessuno: materiale di ricerca, datato e congelato |
| [appendix/](appendix/) | ciò che è progettato ma fuori dai milestone numerati | chi ci aggiunge un progetto rimandato |

Poi ci sono i documenti di primo livello.

**Tre** raccontano il progetto: [PIANO.md](PIANO.md),
[FEATURES.md](FEATURES.md) e [todo.md](todo.md). Il lessico delle parole del
prodotto non ha un file suo: ogni termine è definito in una riga dove si usa
(vedi qui sopra), e [leggimi-prima.md](leggimi-prima.md) tiene il dizionario
del metodo.

**Sei** riguardano il repo come progetto pubblico, e stanno qui per non
disperderli:

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
- Racconta perché si è scelto così? → `decisions/`, con riga in
  [decisions/README.md](decisions/README.md).
- Elenca lavoro da fare? → `roadmap/` con voce in `todo.md`.
- È progettato ma senza milestone? → `appendix/`.
- Riguarda il repo come **progetto pubblico**? → primo livello di `docs/`.

**I nomi dei file.** Minuscoli, separati da trattini, in italiano. Due
eccezioni:
1. Nomi **storici**: `PIANO.md`, `FEATURES.md`, `M2`…`M5`. Restano maiuscoli
   perché **centoventidue** riferimenti nei sorgenti li scrivono così.
2. File per **GitHub**: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
   `CHANGELOG.md`, `LICENSE-MIT`, `LICENSE-APACHE`. GitHub mostra i suoi banner
   solo su questi nomi esatti: tradurre in `come-contribuire.md` li spegne.

**I numeri che cambiano non stanno qui.** Voci aperte, verbali, stato di una
milestone: solo in `todo.md` e in `decisions/README.md`. Ripeterli altrove crea
indici falsi.

**I link fra documenti sono presidiati.** Un presidio è un controllo automatico
che diventa rosso quando qualcosa si rompe. Questo è
`node .github/scripts/check-doc-links.mjs`: guarda ogni link relativo e
fallisce se ne trova uno rotto. Dice anche **quanti** file ha guardato —
se ne controllasse **nove** invece di **cento**, lo direbbe, invece di
stampare **0** rotti e sembrare a posto.

**Quello che non è documentazione.** `docs/.fub/` è la cartella di lavoro che
nasce quando apri `docs/` dentro Fub: sotto `data/` ci stanno l'indice di
ricerca e gli snapshot del versioning. Non toccarla a mano. Cosa contiene lo
dice [architecture/on-disk-layout.md](architecture/on-disk-layout.md).
