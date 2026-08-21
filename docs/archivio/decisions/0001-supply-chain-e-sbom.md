# 0001 — Supply chain e compliance — la sola parte che non si recupera dopo

**In breve:** configurati i controlli su licenze e vulnerabilità in CI, più la
generazione della distinta base software (SBOM).

|  |  |
|---|---|
| **Decisa** | 2026-07-26 |
| **Origine** | `todo.md` §4.9 (quarto giro) |
| **Commit** | `0a4ee40` |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[PIANO.md](../PIANO.md)

---

## La motivazione

- **La CI esistente non basta:** i controlli c'erano già (invarianti abi↔WIT,
  grafo dipendenze in un minuto, build su tre OS, frontend) e il §4 ne aggiunge
  altri, ma nessuno dei due copre il 23.3: SBOM, identificatori SPDX, license
  compliance, dependency audit e advisory CVE. Nemmeno il 20.3 (reproducible
  builds, firma, audit).
- **Recuperare le licenze dopo costa troppo:** è l'unico aspetto che non si
  recupera a posteriori. Le licenze entrate nel frattempo andrebbero riesaminate
  una per una.
- **Riscrivere l'albero è caro:** una dipendenza incompatibile va tolta,
  riscrivendo tutto il codice che ci si appoggia. E l'albero crescerà (tantivy è
  già presente, il §16.3 ne prevede uno per bundle).
- **Meglio farlo subito:** l'uso di `cargo-deny` e la generazione SBOM in CI
  costano solo mezz'ora.

## Le decisioni prese, da NON ridiscutere senza motivo

- **Configurato `deny.toml`:** il file alla radice stabilisce la politica e
  contiene le motivazioni.
- **Creato il job `supply-chain`:** gira in CI e anche **a settimana**, per
  intercettare i nuovi advisory prima del push successivo.
- **Licenze limitate:** si usa un elenco chiuso. La licenza `MPL-2.0` è ammessa
  consapevolmente (arriva con `cssparser` e `selectors` via `tauri`).
- **Verifiche di sicurezza:** le quattro verifiche (advisory e crate yanked)
  causano il blocco (rosso) della CI.
- **Duplicati permessi:** producono solo un avviso. Con `tauri` nell'albero, non
  dipendono da noi.
- **Sorgenti ristrette:** si usano solo dipendenze da `crates.io`.
- **Generazione SBOM:** si usa `cargo-sbom` per produrre SPDX 2.3. L'artefatto è
  stato caricato e contiene 510 pacchetti con identificatore SPDX e `purl`.

## Trovato per strada

- **Un difetto latente chiuso:** le dipendenze interne usavano `{ path = … }`
  senza versione (cioè `*`). Questo rompeva la build riproducibile e impediva di
  pubblicare i crate necessari, come `fub-abi` e `fub-sdk` (previsti dal §16.1).
- **La correzione:** aggiunto `version = "0.1.0"` accanto al path. La
  risoluzione locale continua a privilegiare il path.

## Cosa sblocca
- L'intero 23.3.
- Il 20.3 (SBOM plugin, dependency audit, advisory).
- Il capitolo 1.2 di FEATURES: la promessa di una licenza chiara si mantiene
  solo verificando le dipendenze.
