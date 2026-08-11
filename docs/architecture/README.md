# architecture/

Com'è fatto il sistema **adesso**. Tre cartelle, tre domande diverse:

- `architecture/` — com'è fatto oggi. Cambia quando cambia il codice.
- [decisions/](../decisions/README.md) — perché è fatto così.
- [roadmap/](../roadmap/) — cosa manca.

Questi sono anche i documenti che i commenti in Rust e TypeScript citano più
spesso: i loro path sono di fatto pubblici. Rinominarne uno vuol dire riscrivere
centoventidue riferimenti.

**Il colpo d'occhio**

- [mappa-visuale.md](mappa-visuale.md) — tutta l'architettura in quattro
  disegni, dal macro al micro: i quattro riquadri che si guardano in un minuto,
  quello disposto a mano (gli otto crate, la shell, il disco, e — tratteggiato —
  ciò che non esiste ancora), il **grafo delle dipendenze**, che un test rilegge
  e confronta con `cargo metadata`, e **dove gira cosa** mentre l'app è accesa.
  Sotto i disegni, un livello per volta: cosa c'è in ogni riquadro, due giri
  completi dal tasto premuto al pixel, le scelte che hanno formato tutto col
  loro prezzo scritto, e i buchi. Da qui si capisce dove stanno gli altri
  documenti.

Gli altri diagrammi non stanno qui. Stanno nel documento che spiega la cosa che
disegnano, perché un flusso in mezzo alla sua prosa invecchia insieme a lei,
mentre un flusso dentro un album di diagrammi non lo riapre nessuno quando il
codice cambia. Quindi un percorso si cerca dove uno lo cercherebbe:

- L'apertura di un vault, il ciclo di un job e la rete contro i panici →
  [plugin-boundary.md](plugin-boundary.md).
- Una scrittura esterna che arriva fino a un pannello → [shell.md](shell.md).
- Una query servita da due indici, e le due pile dell'undo →
  [traits.md](traits.md).
- La mappa dei tipi, ad albero e ad arena → [data-model.md](data-model.md).

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
  due bus. È il verbale operativo della [decisione
  0015](../decisions/0015-la-forma-della-shell.md): lì c'è il perché, qui la
  mappa da consultare quando si scrive un file nuovo.

**Il disco**

- [on-disk-layout.md](on-disk-layout.md) — chi scrive dove, dentro un vault e
  fuori: con quale classe (derivato o autorevole), quale versione di schema e
  quale disciplina di scrittura. Si legge **prima** di far nascere un formato
  nuovo. L'alternativa è scegliergli il posto imitando l'ultimo file che si è
  guardato.
