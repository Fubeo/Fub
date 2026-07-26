# 0001 — Supply chain e compliance — la sola parte che non si recupera dopo

|  |  |
|---|---|
| **Decisa** | 2026-07-26 |
| **Origine** | `todo.md` §4.9 (quarto giro) |
| **Commit** | `0a4ee40` |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [PIANO.md](../PIANO.md)

---

- [x] **La CI è buona e non copre questo**: invarianti abi↔WIT e grafo delle
      dipendenze in un minuto, build e test su tre OS, toolchain pinnata
      all'MSRV, frontend con type-check + test + build. Il §4 aggiunge fuzzing,
      corpus, benchmark, e2e e tracing. Nessuno dei due tocca il 23.3: **SBOM,
      identificatori SPDX, license compliance, dependency audit e advisory
      CVE** — né il 20.3 (reproducible builds, firma, dependency audit).
- [x] **`cargo-deny`** (licenze, advisory, duplicati, sorgenti consentite) e la
      **generazione dell'SBOM** in CI costano mezz'ora adesso. È l'unico punto
      di quel capitolo che non si recupera a posteriori: le licenze delle
      dipendenze entrate nel frattempo si riesaminano una per una, e una
      incompatibile scoperta a valle si toglie riscrivendo ciò che ci stava
      sopra. Vale doppio con l'albero che sta per arrivare (tantivy c'è già;
      §16.3 ne prevede uno per bundle).

**Fatto.** `deny.toml` alla radice (politica e motivazioni ci stanno dentro) e il
job `supply-chain` in CI, che gira anche **a settimana**, perché un advisory
nuovo non aspetta il prossimo push. Le quattro verifiche sono verdi oggi:
licenze da elenco chiuso (`MPL-2.0` ammessa consapevolmente — copyleft per file,
entra con `cssparser`/`selectors` via tauri), advisory e crate yanked rossi,
duplicati come avviso (con tauri nell'albero non dipendono da noi), sorgenti
limitate a crates.io. L'SBOM è **SPDX 2.3** (`cargo-sbom`), caricato come
artefatto: 510 pacchetti con identificatore SPDX e `purl`.

Un difetto latente emerso strada facendo, e chiuso: le dipendenze interne erano
`{ path = … }` **senza versione**, cioè dipendenze `*` — build non riproducibile
per chi non ha questo albero, e nessuno dei crate pubblicabile. Il che avrebbe
reso irraggiungibile proprio ciò che deve esserlo da fuori (`fubmd-abi` e
`fubmd-sdk`, §16.1). Ora portano `version = "0.1.0"` accanto al path: la
risoluzione locale non cambia (il path vince sempre).

*Sblocca:* 23.3 per intero, 20.3 (SBOM plugin, dependency audit, advisory), e
il capitolo 1.2 di FEATURES — la «licenza chiara» promessa dai principi fondanti
è verificabile solo se lo è quella delle dipendenze.
