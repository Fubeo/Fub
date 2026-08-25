# Changelog

Le modifiche rilevanti per chi usa Fub o sviluppa contro il suo contratto vengono raccolte qui al momento del rilascio. Le modifiche interne restano nel log Git; le motivazioni nelle [`decisions`](decisions/README.md).

La numerazione segue [`versionamento.md`](versionamento.md).

## Non rilasciato

Non esiste ancora un tag o un binario pubblicato. La sezione seguente descrive la base destinata al primo rilascio.

### Aggiunto

- vault locali con provider Markdown e modello comune dei documenti;
- kernel indipendente da formato e UI;
- ricerca, versioning, backlink, tag, proprietà, query, dashboard, backup, statistiche, cestino, grafo, comandi e blocchi come bundle ufficiali;
- shell Tauri con editor CodeMirror, anteprima, esplora file, apertura rapida, ricerca, grafo, impostazioni e attività;
- apertura del vault a fasi, lavori lunghi con progresso e cancellazione;
- gestione di bozze, conflitti, mutazioni e formati persistenti versionati;
- contratto WIT vivo con baseline congelate e crescita additiva;
- runtime WASM separato e componenti di prova;
- CI multi-piattaforma, controlli supply-chain, SBOM, documentazione, resa visuale e accessibilità;
- documentazione riorganizzata per separare stato, uso, architettura, specifiche, piani e storia.

### Sicurezza

- Content-Security-Policy della webview senza script remoti, frame od oggetti;
- advisory, licenze e provenienza delle dipendenze verificati in CI;
- confini di capacità e accesso al vault verificati dal kernel e dal contratto.

Lo stato preciso della repository è in [`STATO.md`](STATO.md).