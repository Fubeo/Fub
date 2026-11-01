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
| [0199 — History nativa CodeMirror e gate conservativo sugli overlap](0199-history-nativa-e-gate-di-overlap.md) | accolta | frontend | — |
| [0200 — L'inventario installato è distinto dal runtime e dai dati plugin](0200-inventario-componenti-installati.md) | accolta | storage | 0187 |
| [0201 — Le superfici strutturate usano sessioni, finestre e patch coordinate](0201-superfici-strutturate-a-finestre.md) | accolta | contratto | — |
| [0202 — Snapshot globali offline recuperabili](0202-snapshot-globali-recuperabili.md) | accolta | storage | — |
| [0203 — Le superfici spaziali modificano sorgenti SVG con operazioni testuali](0203-superfici-spaziali.md) | accolta | frontend | — |
| [0204 — L'inchiostro è un componente di sistema, non di un prodotto](0204-nucleo-inchiostro.md) | proposta | frontend | 0203 |
| [0205 — La sessione live è un servizio dell'app con un canale verso la shell](0205-sessione-live.md) | proposta | host | — |
| [0206 — Un tema dichiara il proprio motore e, da `theme-2`, le proprie impostazioni](0206-motori-dei-temi-e-impostazioni.md) | accolta | contratto | — |
| [0207 — La domanda sì/no passa da una porta, e chi non risponde ha detto no](0207-conferma-presentata-dalla-shell.md) | accolta | frontend | — |
| [0208 — La finestra è lo Scrittoio, e la serie di serie è `theme-2`](0208-la-finestra-e-lo-scrittoio.md) | accolta | frontend | — |
| [0209 — I documenti di videoscrittura si modificano come proiezione](0209-videoscrittura-come-proiezione.md) | accolta | contratto | — |
| [0210 — Un OpenDocument si scrive con un codec di Fub che conserva l'XML](0210-opendocument-con-un-codec-di-fub.md) | accolta | storage | — |
| [0211 — HTML, testo, LaTeX e Word XML sono copie esportate, con la perdita misurata](0211-copie-esportate-con-la-perdita-misurata.md) | accolta | contratto | — |
| [0212 — La preservazione di un `.docx` si misura sul pacchetto, e la garanzia è di Fub](0212-preservazione-misurata-sul-pacchetto.md) | accolta | storage | — |
| [0213 — I motori esterni sono una copia derivata, con proprietari e aggiornamenti decisi](0213-provenienza-dei-motori-esterni.md) | accolta | sicurezza | — |
| [0214 — GridCraft è il motore del foglio di calcolo, e una cartella di Excel si apre in sola lettura](0214-gridcraft-motore-del-foglio-di-calcolo.md) | accolta | contratto | — |
| [0215 — Un salvataggio che tocca soltanto il corpo di un `.docx` è un innesto nel file com'era](0215-salvataggio-docx-per-innesto.md) | accolta | storage | — |
| [0216 — Il protocollo `grid` 2 apre una sorgente a byte nella custodia dell'host, e la modifica è un giornale di celle](0216-protocollo-grid-2-sorgente-a-byte.md) | accolta | contratto | 0214 (in parte) |
| [0218 — Il `.fubsheet` e la versione 1 di `grid` escono da Fub](0218-via-il-fubsheet-e-la-versione-1-di-grid.md) | accolta | contratto | 0201 (in parte) |
| [0219 — La cartella di Excel si modifica con i comandi di GridCraft, e il giornale diventa di comandi](0219-la-cartella-si-modifica-con-i-comandi-di-gridcraft.md) | proposta | contratto | 0216, 0214 (in parte) |
| [0220 — Gli oggetti dei fogli viaggiano con le finestre, e i grafici arrivano disegnati](0220-gli-oggetti-dei-fogli-viaggiano-con-le-finestre.md) | proposta | contratto | — |
| [0221 — I motori esterni si seguono da vicino: la loro toolchain, le patch a tre vie e un avviso pianificato](0221-i-motori-si-seguono-da-vicino.md) | proposta | sicurezza | — |
| [0222 — Tre strati in ogni superficie, e l'aspetto del contenuto lo dichiara la modalità](0222-tre-strati-e-l-aspetto-del-contenuto.md) | proposta | frontend | — |
| [0223 — L'editor dei disegni: strumenti a sinistra, proprietà nell'ispettore, fatti nella banda](0223-l-editor-dei-disegni-strumenti-ispettore-e-banda.md) | proposta | frontend | — |
| [0224 — Scrittura, il nucleo del testo ricco](0224-scrittura-il-nucleo-del-testo-ricco.md) | proposta | frontend | — |
| [0225 — Tabella, un componente per tutte le tabelle](0225-tabella-un-componente-per-tutte-le-tabelle.md) | proposta | frontend | — |
| [0226 — Inchiostro e disegni nei documenti](0226-inchiostro-e-disegni-nei-documenti.md) | proposta | contratto | — |
| [0227 — Le penne sono ricette del pennello, e la punta piatta è un pennello nuovo](0227-le-penne-e-la-punta-piatta.md) | proposta | contratto | — |
| [0228 — `~x~` è pedice, `~~x~~` barrato](0228-il-pedice-con-una-tilde.md) | proposta | contratto | — |
| [0229 — La pagina della cartella è `_index`](0229-pagina-della-cartella.md) | proposta | contratto | — |
| [0231 — La chiusura di FubDraw](0231-la-chiusura-di-fubdraw.md) | proposta | frontend | — |
| [0232 — Il server MCP di Fub sta in `fub-cli`, ed è scritto lì](0232-il-server-mcp-di-fub.md) | proposta | sicurezza | — |
| [0233 — I motori arrivano in edizioni, non in librerie a runtime](0233-i-motori-arrivano-in-edizioni.md) | accolta | host | — |
| [0234 — Il modello dei componenti](0234-il-modello-dei-componenti.md) | accolta | host | — |
| [0235 — Un record pubblicato non cresce](0235-un-record-pubblicato-non-cresce.md) | accolta | contratto | — |
