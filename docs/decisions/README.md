# Decisioni architetturali

Gli ADR spiegano perché esiste una scelta costosa da invertire. Lo stato
corrente vive nelle pagine di architettura e riferimento.

Gli ID storici non vengono rinumerati. Gli ADR consolidati iniziano da `0179` e
indicano gli ID principali che sostituiscono. Le decisioni eliminate restano
recuperabili nella cronologia Git.

Nuove decisioni usano il [template](template.md).

| ID e titolo | Stato | Ambito | Sostituisce |
|---|---|---|---|
| [0179 — La supply chain viene verificata prima del rilascio](0179-supply-chain-verificata.md) | accolta | sicurezza | 0001 |
| [0180 — Il WIT congelato cresce soltanto per aggiunta](0180-compatibilita-wit-additiva.md) | accolta | contratto | 0002, 0059, 0060, 0102 |
| [0181 — Il modello comune conserva sorgente, span e struttura](0181-modello-documento-e-arene.md) | accolta | contratto | 0003, 0049, 0121 |
| [0182 — Comandi, query e view attraversano registri generici](0182-provider-e-porte-generiche.md) | accolta | contratto | 0005, 0016–0019, 0025–0026, 0082–0083 |
| [0183 — L'host compone, il kernel applica le regole](0183-composizione-host-kernel.md) | accolta | host | 0023, 0027–0032, 0070 |
| [0184 — Gli eventi sono accodati e il lavoro lungo usa job](0184-eventi-accodati-e-job.md) | accolta | kernel | 0012, 0033–0035, 0052, 0062–0063, 0080, 0103, 0126, 0161 |
| [0185 — Un solo Guard applica capability e scope](0185-capability-un-solo-guard.md) | accolta | sicurezza | 0013, 0021, 0064, 0071, 0081, 0097–0098, 0116, 0149, 0156, 0168 |
| [0186 — Provider nativi e WASM implementano lo stesso trait](0186-un-trait-due-backend.md) | accolta | contratto | 0146, 0165 |
| [0187 — Ogni formato su disco dichiara autorità e schema](0187-autorita-e-schemi-su-disco.md) | accolta | storage | 0038, 0058, 0065–0068, 0085–0089, 0092, 0099, 0127, 0154–0155 |
| [0188 — DocId è il path canonico e rename è un'operazione di dominio](0188-identita-path-e-rename.md) | accolta | storage | 0043–0048, 0122–0124, 0135–0136 |
| [0189 — L'IPC è un adattatore sottile e tipizzato](0189-ipc-sottile-e-tipizzato.md) | accolta | frontend | 0037, 0057, 0090, 0093–0095, 0118 |
| [0190 — Un documento condivide il buffer, ogni superficie conserva il proprio undo](0190-sessioni-documento-e-undo.md) | accolta | frontend | 0015, 0044–0045, 0075, 0078–0079, 0150, 0153, 0170–0173 |
| [0191 — Le view producono UI dichiarativa e la shell possiede i renderer](0191-ui-dichiarativa-e-renderer.md) | accolta | frontend | 0050, 0104–0106, 0163–0164 |
| [0192 — Impostazioni, locale e temi hanno proprietari e livelli espliciti](0192-impostazioni-locale-e-temi.md) | accolta | frontend | 0036, 0039–0042, 0076, 0084, 0091, 0107–0110, 0131, 0167, 0174–0178 |
| [0193 — Ogni registrazione ha un owner e un teardown](0193-ownership-lifecycle-e-teardown.md) | accolta | host | 0133–0134, 0139, 0141 |
| [0194 — Ogni proiezione del contratto ha una sorgente dichiarata](0194-sorgenti-e-proiezioni-del-contratto.md) | accolta | contratto | 0053, 0128, 0130, 0147, 0159–0160 |
| [0195 — Prodotto, ABI e schemi hanno versioni indipendenti](0195-versioni-indipendenti.md) | accolta | contratto | 0066, 0096 |
| [0196 — I guard verificano proprietà e gli artefatti derivano da una sorgente](0196-test-e-artefatti-generati.md) | accolta | contratto | 0054–0056, 0072, 0112–0115, 0145, 0166 |
| [0197 — La documentazione descrive il presente e Git conserva la storia](0197-documentazione-presente-git-storia.md) | accolta | contratto | 0014, 0142–0144 |
| [0198 — Le feature ufficiali restano moduli indipendenti](0198-feature-ufficiali-modulari.md) | accolta | host | 0073, 0129 |
