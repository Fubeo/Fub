# Note di pianificazione · Fub pre-alpha

Il registro di lavoro del pianificatore. Si rilegge dopo ogni compattazione.
Ramo `piano/fub-pre-alpha`, worktree `~/.cache/fub-prealpha/piano`, base
`origin/main` 638358da (2026-11-05).

## Punto a cui sono

- 2026-11-05 · passi 1–4 fatti (definizione confermata). Passo 5 (simulatore) in corso.
- Simulatore, come lo costruisco (2026-11-05 sera):
  - Lavoro in `~/.cache/fub-prealpha/sim/` (script/, blocchi/ = i blocchi CSS di Scrittoio 2, catture/).
  - Client di cattura `~/.cache/fub-prealpha/cattura-s2` = COPIA mia di `~/.cache/fub-k1/tmp/scrittoio2/anteprima-copia` (il client con cui è stato fotografato il prototipo approvato di S2: icone `fub:`, Benvenuto del mockup). node_modules = symlink a quello di `~/.cache/fub-k1/scrittoio2`. Per l'avvio (#308) uso `~/.cache/fub-prealpha/cattura` (5006937c).
  - `script/cattura.mjs` (porta 1468, strictPort) + `mods.mjs` di S2 + i miei `notaIn` (stessa nota in un'altra modalità) e `conflitto`.
  - Catture: s2/ (le 35 di S2, approvate), nuove/ (40), nuove2/ (modi sulla stessa nota + conflitto), nuove3/ (pezzi menu senza cornice + foglio-comandi), nuove4/ (varianti 700), avvio/.
  - Simulatore = pagina `simulatore.html` + `sim-dati.js` (pacco gzip+base64) + `solo-simulatore.js` (i passaggi fra stati, i pezzi sovrapposti: menu modalità, «/», tasto destro, avvio rapido, salvataggio, avvisi). Iframe stesso origine senza script.
  - Pagine dei piani scritte a mano (lavagna-schede, lavagna-penne, celle-griglia, menu-comandi-fogli, disegno-motore, ricette) entrano tali e quali come «Dai piani».
  - Precedenza delle catture: nuove6 > nuove5 > nuove2 > nuove4 > nuove3 > nuove > s2 > avvio. nuove5 = aspetto con la riga «Animazioni»; nuove6 = foglio-comandi(-cerca) col menu aperto DOPO la barra del kit (mod `apriComandi`), toast con `corniceConAvvisi`.
  - Si ricostruisce con `node script/costruisci-sim.mjs $PWD/out`; si prova con `script/prova-sim.mjs` (giro dei gesti, «errori: nessuno») e `script/foto-sim.mjs` (ogni stato × luce × larghezza).
- 2026-11-05 notte · **il simulatore è uguale al pixel al prototipo approvato di S2**: i 26 stati di S2 (due luci, 700, telefono) fotografati da `PLAN-ui/scrittoio-2.html` (foto-proto.mjs, FOTO_SOLO=1) e dal simulatore danno 0 pixel diversi; unica eccezione `impostazioni` (265 px): il simulatore scrive 18 nel corpo del testo (il valore di serie di S2 T11), il prototipo mostra il 17 del finto del banco.
  - La foto PNG di una cattura NON è un riferimento: i mod con `inserisci` (riga dei dati, cassetto, testata…) entrano solo nel JSON, quindi la PNG è «prima». Il riferimento giusto è il prototipo approvato (fatto dallo stesso JSON).
  - Gli stati nuovi (non in S2) guardati a occhio in fogli di contatto: piena, 700, telefono, due luci (prove/zona-*.png, z700-*.png, ztel.png).
  - Telefono: S2 ha disegnato 11 stati; per gli altri il simulatore mostra il telefono più vicino e lo dice sotto lo schermo (`#sim-vicino`).

## Regole che valgono per me (dal prompt)

- Solo pianificare. Niente subagent, workflow, SendMessage. Niente codice del prodotto.
- Non scrivere in `~/Progetti/Fub` né negli altri worktree di `~/.cache/`.
- Vault vero `~/.cache/fub-live/vault-tutti/` e porte 1431/1432/1437/1438 intoccabili; per provare: porta 1468.
- Commit `docs(piano): …` senza trailer.
- Disco: 25 G liberi il 2026-11-05; lavorare sotto `~/.cache/`.
- Chiedere la definizione di pre-alpha PRIMA di costruire il resto.

## Verificato in main (origin/main 638358da)

- #308 avvio: unito 2026-11-05 (`apps/client/src/avvio/`). ✓
- N2 MCP: `crates/fub-cli/src/mcp.rs` + `mcp/{access,tools}.rs`, 17 strumenti; `base` obbligatoria per fub_write e fub_canvas_apply; canvas_apply/invoke/components_* senza `apply` = prova (DryRun di serie); fub_write/fub_create scrivono subito ma solo sotto `--automation-write-root`; senza radici di scrittura sola lettura (access.rs). ADR 0232. Arrivato in main dentro la pila #256–#269 (le PR #261–#268 risultano CLOSED, il contenuto è entrato con #260/#269). ✓
- N12: `apps/client/src/panels/slash/` ✓. N13: `editors/text/profiles/markdown/blocks/motion.ts`, `shell.mode.blocks` ✓. Issue #281 (prova Blocchi 5 persone) e #283 (S7 su GPU) aperte.
- N1: ADR 0231, tag `fubdraw-completo` ✓; `Fubeo/FubDraw` NON archiviato (privato), issue #282.
- N7 #299 unito 2026-11-04 ✓. N3 #297 unito 2026-11-04 ✓ (+ #306, #307).
- K1 #285 unito 2026-11-01 ✓ (`crates/fub-componenti`).
- **K3-IPC T8 (#296) NON è in main**: è unito nel ramo `piano/k3-motori` (base della PR), il 2026-11-02. Differenza col prompt.
- PDF in main: visore pdf.js (`pdfjs-dist` 6.3.289, `editors/media/`). P1–P5 (PdfCraft) non hanno un piano.
- Crate in main: fub-abi app canvas-core canvas-wasm cli componenti features format-{base,canvas,craft,markdown,rich,svg,xlsx} host importers ink kernel live scene sdk services testkit wasm-host. `fub-motori` (K3) e `fub-disegno` (K5) solo sui rami.
- ADR in main fino a 0237 (mancano 0230 e 0236: sui rami?).
- `docs/project/status.md` fermo al 2026-10-31 (dice «in pila» per cose unite): lacuna di docs.
- Il tabellone «Decisioni per Fub» (GUJc…): 88 domande, tutte «Risposta data» (K3, N3, N4, N6, N7, K5): non si richiedono.

## Piani aperti: conto vero (origin, 2026-11-05)

Testi dei PLAN.md copiati in $T/PLAN-<ramo>.md (scratch, si rifà con git show).

| Piano | ramo @ | PR | task | fatti | aperti | avanti/dietro main |
|---|---|---|---|---|---|---|
| K2 | k2-pagina-componenti fcd30123 | #290 bozza | 7 | 7 | 0 | +31/-0 |
| K3 | k3-motori 6e6fc623 | #295 pronta | 19 | 17 + T18 [~] integrato | T17 (CI completa, revisione) | +83/-0 |
| K5 | k5-disegno 07d2f435 | #300 bozza | 30 | 10 (T1-5,8,10,12,25,26) | 20 | +31/-259 |
| N4 | n4-inchiostro e1949125 | #298 bozza | 25 | 14 (T1-11,18,19,20) | 11 | +44/-214 |
| N6 | n6-lavagna e1f4b38e | #302 bozza | 90 | 11 | 79 | ? |
| A1 | a1-base-per-ai 0623ccf8 | #305 bozza | 13 | 5 (T1,2,3,6,8) | 8 | +22/-259 |
| griglia | griglia-celle 62dc9530 | nessuna | 9 (T1-T9) | 0 | 9 | +64/-259 (base k3) |
| Scrittoio 2 | scrittoio-2 fe4d84c4 | #309 bozza | 27 | 3 (T1,T2,T16) | 24 | +12/-26 |
| K6 | k6-disegno-completo 718fd3c5 | #313 bozza | 30 | 0 | 30 | +2/-0 |
| lavagna in codice | lavagna-in-codice 30482916 | #311 bozza | 26 | 0 | 26 | +2/-0 |

Altre PR aperte: #304 docs/orchestra-auto (pronta). Rami senza PR: anteprima/tutto (locale).
Totale ≈ 276 task, ≈ 69 fatti sui rami, nessuno di questi piani è in main.

## Artifact letti

Scaricati tutti in $A (cartelle per id, mappa in $S/mappa.txt), testo in $T/<nome>.txt (htmltext.py) o $T/<nome>.r.txt (render Playwright per le pagine JS).
- Prossime fasi (4G2H9): N0–N13 con cancelli (righe 179–657 del testo), 9 «Decisioni che restano a te» (righe 703–721), rischi.
- Piani di Fub (ETLQ): indice + 24 file md (01-regole-e-decisioni, 03-rischi-e-domande, passi/*, riferimenti/{lavagna,pdfcraft,tasto-destro}.md). Ordine 24 passi; K4, P1–P5, K7–K9, N5, N9, N10, N11, K10, lavagna v2/v3 senza piano.
- Prova componenti (Bgae): protocollo 6 compiti, 3–5 persone, per chiudere K2.
- Prototipi dei rami copiati in $S/proto/. Scrittoio 2 = catture del client vero (anteprima/tutto, banco) compresse gzip+base64 in JSON {fonts, texts, caps{stato-luce:{a,ba,b,c,v,t}}}; 26 stati (computer, 700, telefono). Gli attrezzi del pianificatore di Scrittoio 2 sono in ~/.cache/fub-k1/tmp/scrittoio2/script/ (cattura.mjs, costruisci.mjs, mods.mjs): SOLO LETTURA, li copio nello scratch.
- K5 ha un artifact suo: https://claude.ai/artifact/9eQfYxTBbkBc9WzQ1eW8D4 (prototipo disegno-motore, approvato 2026-11-05).
- N6: 4 pagine di prototipo, approvata solo lavagna-schede (T25); impianto/modifica/estratti (T26–T28) da fare. T79 dipende dai tasselli di PdfCraft (nessun piano P1/P4!).

## Differenze fra piani e codice

1. K3-IPC T8 (#296) è nel ramo `piano/k3-motori`, non in main (il prompt lo dava in main).
2. Griglia (`piano/griglia-celle`): il prototipo `celle-griglia.html` non ha un'approvazione scritta nel piano → domanda.
3. N6: i prototipi di T26–T28 (impianto, modifica, estratti) non ci sono; approvata solo `lavagna-schede` (T25, 2026-11-04).
4. Il finto del banco (`bench/fake-ipc.ts`) non ha `appearance.motion`, che l'host ha (`crates/fub-host/src/settings.rs`, «Animazioni»): la foto approvata delle impostazioni di S2 non mostra la riga. Nella mia copia del client l'ho aggiunta (nuove5/aspetto). Task PA: il finto la deve avere.
5. S2 T11 porta corpo 18 e misura 58ch; il finto del banco dice 17 e 68: la foto approvata di S2 mostra 17.
6. Scrittoio 2 avanza: T1, T2 («il menu delle modalità, in un posto solo», e7630eef), T16 fatti su `piano/scrittoio-2` (fe4d84c4).
7. La cattura `foglio-comandi` di nuove3 non aveva il menu: il mod `kitRibbon` rimisura la finestra e il menu si chiude. Rifatta (nuove6).
8. `docs/project/status.md` è fermo al 2026-10-31; in main mancano le ADR 0230 e 0236 (sui rami).
9. In Notte la griglia del foglio lascia bianco a destra dell'ultima colonna (anche nella foto approvata di S2, `foglio-dark`); in main la griglia arriva al bordo. Da guardare in S2 T20/griglia: non è del simulatore.

## Domande per l'utente (parte 4 dell'artifact)

- Telefono/tablet: rifare la cornice (piano proprio) o tenere la provvisoria A di S2 per l'APK di prova.
- Le 5 domande di gusto aperte di S2 (ombra T27, vassoio, sezioni…): rileggerle dal PLAN di S2.
- Griglia: approvare il prototipo `celle-griglia`.
- N6 T26–T28: disegnarli ora nel simulatore o lasciarli al coder di N6 (consiglio: N6, + task PA che li aggiunge al simulatore).
- Contraddizioni: S2 T22 contro K5 (la colonna degli strumenti del disegno); S2 T23 contro N6 (la lavagna).
- Densità e accento non si simulano (serve ricompilare il tema): va bene così?
- `windows-sys`, firma degli installer, canale dei riscontri della pre-alpha.

## Risposte dell'utente (2026-11-05, AskUserQuestion)

1. «Fatto quando»: COSÌ (gli otto punti della bozza).
2. Dentro: TUTTI I PIANI TRANNE K6 (K2, K3, griglia, Scrittoio 2, K5, N4, N6 v1 senza T79, A1, lavagna in codice, punti sciolti).
3. Dispositivi: COMPUTER + ANDROID DI PROVA (APK dalla CI, segnato sperimentale). Quindi la cornice del telefono/tablet conta: domanda in parte 4 (rifarla o tenere la provvisoria A di Scrittoio 2).
4. Rilascio: PRE-RELEASE PUBBLICA `v0.2.0-prealpha.1`, release GitHub «pre-release», #289 dentro (congelare fub:abi@0.2.0).

## Bozza della definizione (2026-11-05, CONFERMATA)

Obiettivo: la prima versione che una persona scarica, installa sul suo computer
e usa per una settimana di studio e lavoro: vault di Markdown, note, Word, Excel,
SVG, PDF e lavagne nella stessa cornice (Scrittoio 2), la penna sopra, i
componenti accesi e spenti, un'AI che fa lo stesso via MCP, nessun dato perso.

Fatto quando (proposta): 1 installer 3 OS da tag `v0.2.0-prealpha.1`, CI release
verde; 2 i piani dentro in main con il loro cancello e CI completa; 3 il giro della
pre-alpha (~24 compiti) e2e nel banco e a mano sugli installer; 4 corpus per formato
byte per byte; 5 simulatore = app (foto banco due luci, piena e 700); 6 misure
WebView Linux nei budget + una a mano su Windows; 7 prova unica con 5 persone
(K2+N12+N13+lavagna); 8 status.md, pagina «Prova la pre-alpha», #289.

Fuori (proposta): K6; K4 K7 K8 K9 K10; PdfCraft P1–P5 e N6 T79; N5 N9 N10; app
telefono/tablet; lavagna v2/v3; A1 F2–F6; #9; installer firmati.
