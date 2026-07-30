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
  caso speciale. Vedi [architecture/data-model.md](architecture/data-model.md) e
  [architecture/traits.md](architecture/traits.md).
- **Ricerca full-text** incrementale e persistente su tantivy, dichiarata *la*
  ricerca dell'applicazione dalla
  [decisione 0025](decisions/0025-la-ricerca-predefinita.md).
- **CRUD del vault con rete di sicurezza** — creazione, «crea nota» da un link
  non risolto, rename, cestino e versioning con snapshot.
- **Organizzazione della sidebar** — albero, icone, folder notes, spazi, note
  appuntate, ordinamento drag & drop, cartella come radice.
- **Shell** — file explorer, editor CodeMirror 6, anteprima live, navigazione
  dei `[[wikilink]]`, graph view su Canvas, e i pannelli resi attraverso il
  protocollo di [UI dichiarativa](architecture/ui-protocol.md).
- **Registro dei comandi** con palette, impostazioni dichiarate nel manifest,
  localizzazione dei testi e degli errori, job lunghi con progresso e
  cancellazione.
- **Contratto WIT** vivo accanto al crate che rispecchia, con la linea di base
  congelata di [`0.1.0`](architecture/wit-congelato.md).
- **Presidi in CI** — invarianti di dipendenza, conformità `abi` ↔ WIT,
  additività del contratto, supply chain con SBOM, link interni dei documenti.
  L'elenco per esteso sta in [CONTRIBUTING.md](CONTRIBUTING.md).
- **Governance del repo** — licenza doppia MIT / Apache-2.0, questo changelog,
  [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md),
  [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) e
  [versionamento.md](versionamento.md).

Milestone 1 è chiusa dal **2026-07-24**; M2 è quasi finita. Cosa entra in
ciascuna sta in [milestones/](milestones/M2-search-graph.md).

### Sicurezza

- Content-Security-Policy della webview senza script remoti, iframe od oggetti.
- Advisory delle dipendenze e licenze verificati in CI, anche settimanalmente,
  secondo [`deny.toml`](../deny.toml).

<!-- Nessun link di confronto fra versioni: non esistendo ancora un tag, ogni
     link `compare/` punterebbe a una revisione che GitHub non ha. Il primo
     rilascio li porta con sé. -->
