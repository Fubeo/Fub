# architecture/

Com'è fatto il sistema **adesso**. È la differenza con
[decisions/](../decisions/README.md), che dice perché, e con
[roadmap/](../roadmap/), che dice cosa manca: questi documenti descrivono ciò
che si trova aprendo i sorgenti oggi, e quando il codice cambia cambiano con
lui. Sono anche i documenti che i commenti in Rust e TypeScript citano più
spesso, quindi i loro path sono di fatto pubblici — vanno rinominati solo
sapendo che si riscrivono centoventidue riferimenti.

**Il colpo d'occhio**

- [mappa-visuale.md](mappa-visuale.md) — tutta l'architettura in tre disegni:
  quello disposto a mano (i sette crate, la shell, il disco, e — tratteggiato —
  ciò che non esiste ancora), il **grafo delle dipendenze**, che un test rilegge
  e confronta con `cargo metadata`, e **dove gira cosa** mentre l'app è accesa.
  Da qui si capisce dove stanno gli altri documenti.

Gli altri diagrammi non stanno qui: stanno nel documento che tratta la cosa che
disegnano — un flusso in mezzo alla prosa che lo spiega invecchia insieme a lei,
un flusso in un album di diagrammi non lo apre nessuno quando cambia il codice.
Chi cerca un percorso lo trova dove lo cercherebbe: l'apertura di un vault, il
ciclo di un job e la rete contro i panici in
[plugin-boundary.md](plugin-boundary.md); una scrittura esterna che arriva a un
pannello in [shell.md](shell.md); una query servita da due indici e le due pile
dell'undo in [traits.md](traits.md); la mappa dei tipi, ad albero e ad arena, in
[data-model.md](data-model.md).

**Il contratto**

- [traits.md](traits.md) — i trait del contratto, chi li implementa e a quale
  milestone, con la tabella di esprimibilità WIT.
- [data-model.md](data-model.md) — `DocumentModel`, `Block`/`Inline`, `Span`,
  `LinkTarget` e l'escape hatch `Custom`: il modello comune che nessun formato
  possiede.
- [wit.md](wit.md) — lo stesso contratto nella lingua dei componenti WASM,
  perché esiste e cosa presidia.
- [wit-congelato.md](wit-congelato.md) — la linea di base versione per versione,
  e la promessa su cui poggia il freeze di M4: post-freeze si cresce solo per
  aggiunta.

**I confini**

- [plugin-boundary.md](plugin-boundary.md) — `Plugin`, `HostApi`,
  `PluginManifest`: il confine di fiducia, il modello delle capacità, e cosa
  cambia fra un provider nativo e uno WASM (la risposta è: solo il come, non la
  firma).
- [ui-protocol.md](ui-protocol.md) — il protocollo `UiNode` con cui il core
  descrive un'interfaccia e la shell la disegna, e la regola dell'escape hatch.
- [shell.md](shell.md) — l'albero del frontend, la cucitura unica con l'host, i
  due bus. È il verbale operativo della
  [decisione 0015](../decisions/0015-la-forma-della-shell.md): lì c'è il perché,
  qui la mappa da consultare quando si scrive un file nuovo.

**Il disco**

- [on-disk-layout.md](on-disk-layout.md) — chi scrive dove dentro un vault e
  fuori: con quale classe (derivato o autorevole), quale versione di schema e
  quale disciplina di scrittura. Da consultare **prima** di far nascere un
  formato nuovo, che è l'unica alternativa a sceglierne il posto per imitazione
  dell'ultimo che si è guardato.
