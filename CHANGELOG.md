# Changelog

Le modifiche rilevanti per chi usa Fub o sviluppa estensioni sono registrate secondo [Keep a Changelog](https://keepachangelog.com/it-IT/1.1.0/).

## [Non rilasciato]

Fub non ha ancora una release pubblica. Il contenuto seguente formerà la prima versione.

### Aggiunto

- vault locale compatibile con note Markdown, frontmatter YAML, wikilink, tag, callout ed embed;
- modello comune del documento e core indipendente dal formato;
- ricerca full-text incrementale basata su Tantivy;
- grafo dei link, backlink, outline, tag, cestino e cronologia;
- editor CodeMirror 6 con anteprima live e navigazione tra note;
- protocollo UI dichiarativo per pannelli e azioni;
- contratti Rust e WIT verificati reciprocamente;
- runtime WASM parziale per il ciclo di vita del plugin e i primi provider;
- controlli CI per dipendenze, contratto, documentazione, frontend e supply chain;
- doppia licenza MIT oppure Apache-2.0.

### Cambiato

- la documentazione è stata ridotta a un corpus canonico organizzato per compito;
- attività, soak test e prove mancanti sono tracciati nelle issue, non in checklist Markdown;
- le proposte non implementate vivono nelle RFC e non nelle guide correnti.

### Sicurezza

- Content-Security-Policy della webview senza script remoti, iframe od oggetti;
- advisory, licenze e SBOM verificati dalla CI;
- segnalazioni private secondo [SECURITY.md](SECURITY.md).
