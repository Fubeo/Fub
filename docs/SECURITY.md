# Sicurezza

## Segnalare una vulnerabilità

Non aprire una issue pubblica.

Usa, in ordine di preferenza:

1. [GitHub Security Advisories](https://github.com/Fubeo/Fub/security/advisories/new);
2. `fabio99marchetti@gmail.com`.

Indica il commit o la versione, il sistema operativo, i passaggi per riprodurre e l'impatto. Un proof-of-concept è utile, ma non pubblicarlo prima della correzione.

## Versioni supportate

| Versione | Stato |
|---|---|
| `0.1.0` su `main` | in sviluppo, non rilasciata |

Non esistono ancora versioni pubblicate da mantenere in parallelo.

## Nel perimetro

- file e metadati del vault trattati come input non fidato;
- path traversal, symlink e scritture fuori dalla radice;
- perdita silenziosa di documenti, bozze, versioni o dati di recupero;
- contenuto della nota che aggira la CSP della webview;
- comandi IPC che saltano validazione o capacità;
- confine WIT e runtime dei componenti;
- dipendenze compromesse o non conformi alla politica del repository.

## Fuori dal perimetro

- un attaccante che possiede già accesso di scrittura completo alla macchina;
- codice sorgente modificato e compilato volontariamente;
- funzioni descritte soltanto nelle specifiche o nella roadmap e non presenti nella build corrente.

## Presidi presenti

- CSP in `crates/fub-app/tauri.conf.json`;
- validazione dei percorsi e accesso mediato dal kernel;
- modello a capacità per provider e componenti;
- conformità Rust ↔ WIT e additività del contratto;
- advisory, licenze, provenienza e SBOM in CI;
- test su Linux, Windows e macOS;
- bozze, journal, cestino e versioning come reti distinte contro la perdita di dati.

## Limiti dichiarati

Il percorso pubblico completo per plugin di terzi è ancora in sviluppo. Una threat model strutturata del confine dei plugin deve accompagnare la stabilizzazione del runtime e della distribuzione; il solo elenco delle capacità non la sostituisce.

L'architettura del confine è in [`architecture/plugin-boundary.md`](architecture/plugin-boundary.md). Le regole sui dati persistenti sono in [`versionamento.md`](versionamento.md).