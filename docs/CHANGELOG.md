# Changelog

Le modifiche degne di nota, versione per versione. Il formato è
[Keep a Changelog](https://keepachangelog.com/it-IT/1.1.0/) e la numerazione
segue [versionamento.md](versionamento.md).

**Cosa ci va e cosa no.** Qui sta ciò che cambia per **chi usa Fub o ci scrive
sopra**: una funzionalità che compare, un comportamento che cambia, una firma
del contratto che si muove. Non ci va il lavoro interno — quello sta nel `git
log`, e il *perché* di ogni scelta sta nei [verbali](decisions/README.md), che
sono l'unico posto in cui è scritto per esteso. Un changelog che riassume i
verbali diventa il secondo posto che invecchia.

**Le voci si scrivono al rilascio**, non a ogni commit: fino ad allora la
sezione «Non rilasciato» resta alla grana della milestone, e lo stato preciso di
cosa è aperto sta in [todo.md](todo.md), che è l'unico posto dove si aggiorna.

## [Non rilasciato]

Niente è ancora stato rilasciato: non esiste un tag, non esiste un binario
pubblicato. Quello che segue diventerà il contenuto di `0.1.0`.

### Aggiunto

- **Vault compatibile Obsidian** — `.md` con frontmatter YAML, `[[wikilink]]`,
  `#tag`, callout, embed `![[...]]`. Il grafo dei link risolve nome, alias e
  path con la regola dello shortest-path fra omonimi.
- **Core agnostico rispetto al formato** — il modello comune del documento e il
  contratto dei trait, di cui il markdown (comrak) è il primo provider e non un
  caso speciale. Vedi [06-contratto/02-il-modello-dati.md](06-contratto/02-il-modello-dati.md) e
  [06-contratto/01-i-trait-in-rust.md](06-contratto/01-i-trait-in-rust.md).
- **Ricerca full-text** incrementale e persistente su tantivy, dichiarata *la*
  ricerca dell'applicazione dalla
  [decisione 0025](decisions/0025-la-ricerca-predefinita.md).
- **CRUD del vault con rete di sicurezza** — creazione, «crea nota» da un link
  non risolto, rename, cestino e versioning con snapshot.
- **Organizzazione della sidebar** — albero, icone, folder notes, spazi, note
  appuntate, ordinamento drag & drop, cartella come radice.
- **Shell** — file explorer, editor CodeMirror 6, anteprima live, navigazione
  dei `[[wikilink]]`, graph view su Canvas, e i pannelli resi attraverso il
  protocollo di [UI dichiarativa](07-ui/02-il-protocollo-ui-node.md).
- **Registro dei comandi** con palette, impostazioni dichiarate nel manifest,
  localizzazione dei testi e degli errori, job lunghi con progresso e
  cancellazione.
- **Apertura del vault a fasi** — aprire un vault torna appena si sa *cosa c'è*:
  l'albero c'è, una nota si apre e si scrive mentre l'indicizzazione va avanti
  per conto suo, con una barra di avanzamento e un pulsante per fermarla come
  qualunque altro lavoro lungo. Finché non ha finito, la ricerca lo dice invece
  di rispondere «nessun risultato». Un documento che non si legge o che non
  parsa non fa più fallire l'apertura: il vault si apre e dichiara cosa non ha
  letto.
- **Contratto WIT** vivo accanto al crate che rispecchia, con le linee di base
  congelate [`0.1.0`](06-contratto/03-il-contratto-wit.md) e `0.1.1`.
- **Presidi in CI** — invarianti di dipendenza, conformità `abi` ↔ WIT,
  additività del contratto, supply chain con SBOM, link interni dei documenti.
  L'elenco per esteso sta in [CONTRIBUTING.md](CONTRIBUTING.md).
- **Governance del repo** — licenza doppia MIT / Apache-2.0, questo changelog,
  [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md),
  [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) e
  [versionamento.md](versionamento.md).

Milestones 1–4 sono completate; Milestone 5 (runtime WASM) è in corso.
Cosa entra in ciascuna sta in [milestones/](milestones/README.md).

### Sicurezza

- Content-Security-Policy della webview senza script remoti, iframe od oggetti.
- Advisory delle dipendenze e licenze verificati in CI, anche settimanalmente,
  secondo [`deny.toml`](../deny.toml).

<!-- Nessun link di confronto fra versioni: non esistendo ancora un tag, ogni
     link `compare/` punterebbe a una revisione che GitHub non ha. Il primo
     rilascio li porta con sé. -->
