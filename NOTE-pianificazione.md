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
- 2026-11-05 tarda sera · **PLAN.md scritto** (testata, definizione, dentro e fuori, ordine A–D, backend, «Dal prototipo», D1–D12, «Come si implementa», differenze 1–13, PA T1–T24). DECISIONS: 8 righe in cima al registro. Simulatore copiato in `PLAN-ui/fub-pre-alpha/` (con `blocchi/`, `script/`, README; le catture, 243 MB, restano in `~/.cache/fub-prealpha/sim/catture/`).
  - **Pubblicato** 2026-11-05: artifact «Fub pre-alpha» https://claude.ai/artifact/RCUxmuv2dCqbwDRagbKHcK (v1). Ramo pushato su origin. La pagina si rifà con `node $S/tools/costruisci-hub.mjs PLAN.md PLAN-ui/fub-pre-alpha $A/fub-pre-alpha` (copia in `PLAN-ui/fub-pre-alpha/script/`), poi publish dello stesso file_path con i `files` (simulatore.html, sim-dati.js, solo-simulatore.js, piani/*).
  - (primo giro) Aspettavo l'utente: approvazione del simulatore, D1–D12.
  - Dopo la pubblicazione: iterare con l'utente sulle domande D1–D12. Se D3 o D4 = A: disegnare N6 T26–T28 e comporre le pagine dei piani nella cornice.
  - Non verificati (resoconto finale): i due punti sciolti di D10; macOS a mano (D11); #97 e #216 corretti ma aperti (le chiude l'utente).
- 2026-11-05 notte · **secondo giro** (richiesta in `~/.claude/jobs/7517738d/tmp/richiesta.txt`, §1 simulatore, §2 correzioni, §3 chiusura). Scelte dell'utente: D3 = A, D4 = A, D5 = A e B composte, D12 = B; restano D1, D2, D6–D11 e le nuove D13, D14.
  - §2 fatto in PLAN.md: T1 dopo K3, K3 18/19, T4 (R01 prima un test), T5 col file, T14 diviso in T14 + T26–T30, T22 (sei posti, `wix.version` 0.2.0.N, rischio MSI), T23 (MCP che c'è; proposta MCP in A1 F5), telefono in Fatto quando 5/T15/T23/T31, un coder alla volta e stima 7–9 settimane, D13, N2, T25 (pre-release negli aggiornamenti), T31 (emulatore Android in CI), T32 (solo la pagina del PDF), T33 + D14 (FubDraw visibile in ~40 frasi). Differenze 22–27. DECISIONS: riga 19 e sette righe di registro.
  - Prossimo: §1, il simulatore nuovo (stati S1… con provenienza, scenari 1–16, telefono per ogni stato, niente clic morti, pixel e sanitizer), poi hub, README, ripubblicazione allo stesso indirizzo.
- 2026-11-05/06 · **§1 fatto: il simulatore v2.** 286 stati (168 cattura, 67 composta, 51 nuova; 118 da approvare), 17 scenari, 632 catture (316 schermi × 2 luci), ogni stato anche a 700 e sul telefono, tre livelli di movimento, densità/contrasto/accento veri (D12 B).
  - Lavoro in `~/.cache/fub-prealpha/sim/`: `script/` (costruisci-sim, prova-sim, foto-sim, ricattura, stati-*.json, scenari, pezzi, eccezioni), `blocchi/` (32 css: 18 di S2 uguali alla fonte, 92-prealpha-*, 93-tema-*), `toppe/` (8 html), `catture/` (560 MB, ricatturate tutte il 2026-11-06 con `script/ricattura-tutto.sh`), `out/` (la costruzione; `temi.json` è un ingresso).
  - Client delle catture: `~/.cache/fub-prealpha/cattura-s2` (0c2a7e91 + `finto/cattura.patch`, NON è un repo git) e `~/.cache/fub-prealpha/cattura` (5006937c + `finto/avvio.patch`, per l'avvio). `FUB_CLIENT` = cattura-s2/apps/client (Playwright, pngjs, pixelmatch, happy-dom, caratteri); nessun percorso della macchina negli script del ramo.
  - Sul ramo va tutto tranne catture e prove (`.gitignore`); `DATI=PLAN-ui/fub-pre-alpha node …/costruisci-sim.mjs PLAN-ui/fub-pre-alpha` riscrive gli stessi byte (provato).
  - L'hub (`script/costruisci-hub.mjs`) prende stati e scenari da `sim-stati.js`, le fasi dei task dalle tabelle di «L'ordine» e le domande decise dalla riga «**Decisa dall'utente…**».
  - Domande: decise D3 A, D4 A, D12 B; D5 aperta (l'utente vede A e B composte); aperte D1, D2, D5–D11, D13–D18.
  - 2026-11-06 · committato e pushato: 420c0d7a (simulatore v2), 1a729554 (hub). Confronto dei pixel: `foto-sim.mjs` toglie la zona che spiega (S2 T3 bottone della modalità sul telefono, anello del fuoco) e scrive quanto resta; S2 T9 ispettore compatto 216 nel simulatore; caratteri Google delle pagine dei piani → `@fontsource` del client; `cattura.mjs` aspetta il menu fermo (slash rifatte). Foto in `sim/prove/foto-v4`, prove in `sim/prove/prova-v4`.
  - 2026-11-06 · le toppe `comp-*` (S204–S208) copiano la scheda vera (`renderInstalledComponent`) e la richiesta vera del consenso (`confirm` → `kit/dialog.ts`): «Abilitato», «Rimuovi», «Concedere i permessi»; il primo giro aveva inventato «Disinstalla» e «Installare …?». Le parole di oggi contraddicono il lessico K2 → D18 (A consigliata), PA T46, Differenze 46. Nei livelli della lavagna i `canvas` diventano `img` (un documento senza script non dà misura al canvas: la pagina del PDF era bianca); verificato a occhio. Costruzione nuova in `sim/out-v5`, foto in `sim/prove/foto-v5`, prove in `sim/prove/prova-v5`.
  - 2026-11-07 · `foto-sim.mjs` misura lo spazio del DOM nuovo (scorrimento riallineato, quadretti di 16 px ritrovati spostati) e toglie gli elementi col testo cambiato da una toppa (`vista-sim.js`, `__simCambiati`, niente nel DOM). Giro finale in `sim/prove/foto-v6` (1.384 confronti, 1.124 misurati, 134 sopra lo 0,5 %, 128 scendono sotto con le zone, restano le 6 di «carta» chiara) e `sim/prove/prova-v6`. Differenze 6 corretta: S233 coincide con la sua foto (il finto delle catture dice già 18).
  - 2026-11-07 · guardando i componenti al telefono: in `shells/mobile/mobile.css` la regola dei 44 px fa dell'interruttore un cerchio e tronca le schede delle impostazioni (anche in `origin/main` 638358da e nelle catture vere) → Differenze 47, PA T47 (Fase A, S), blocco `92-prealpha-telefono.css`, zona 4 di `foto-sim.mjs`. Provato nel simulatore: 32 × 18, il tocco 10 px sopra/sotto e 5 px a sinistra arriva all'interruttore, schede intere (riga 588/364 px, scorre). Le schede fermate hanno di nuovo `data-state="stopped"` (stato in rosso). Costruzione `sim/out-v6`, telefono rifatto in `sim/prove/foto-v7` (`unito.tsv` = v6 senza telefono + v7): 158 sopra lo 0,5 %, restano 6 «carta» chiara e 2 `g2-comp-spegni` (spostamenti frazionari di 4,31 px per scheda). Prove: `sim/prove/prova-v6` (piena e 700, errori nessuno) e `sim/prove/prova-v7` (telefono su out-v6: 7.271 controlli, 401 clic, 17 scenari, errori nessuno; −72 schede che ora scorrono fuori dalla riga).
  - 2026-11-07 · criterio dell'utente: solo qualità, il tempo non conta. Pagina «Le scelte di Fub pre-alpha» (`scelte.html`, artifact Q5Lydynyn4DV8xwFDLZt18 v1), con 21 domande, «Il via» e 14 gruppi di stati, risposte nel db (`risposte`, `stati`). Provato: il proprietario scrive, una scrittura da `interact` è rifiutata, la prova è cancellata; Playwright a 1280 chiaro e 390 scuro senza errori né scorrimento orizzontale. PLAN.md: consigli nuovi D1 B, D6 C, D8 B, D9 B, D11 B, D17 C; domande nuove D19–D24, rimandate dalla tabella «Fuori scope». Hub rifatto (v4, 21 aperte su 24) con `costruisci-hub.mjs` aggiornato.
- 2026-11-07 pomeriggio · **terzo giro: le risposte.** Nel db della pagina delle scelte (`risposte`, `stati`) e incollate in chat: D1 B, D2 A, D5 A, D6 C, D7 A, D8 B, D9 B, D10 B (non il consiglio A), D11 B, D13 A, D14 A, D15 A, D16 A, D17 C, D18 A, D19 A, D20 A, D21 A, D22 A, D23 B, D24 B, VIA A; i 14 gruppi di stati «approvo», senza note. Poi, a metà turno: «vorrei che il tema base di FUB fosse il verde» → D25–D28 nella pagina (v3, immagini in `PLAN-ui/fub-pre-alpha/verde/`), risposte in chat: D25 = il verde del logo, tinta 159 (prima aveva detto Foglia 145, poi ha visto il logo); D26 B (il suo logo ridisegnato in vettoriale, il foglio davanti diventa una pagina con righe e un angolo a quadretti); D27 A («Salvia» diventa «Mare»); D28 A (logo fatto con un'AI, strumento non detto). Logo: `tmp/logo-44987.webp` (dal transcript), senza sfondo `tmp/logo-senza-sfondo.png`; colori misurati: nastro 157,6–161 (#14c77d, #0cbb79, luce #74e5ac), foglio scuro #1f4b36 160,6, salvia #6e8b64 137,8 e #7ea189 154,8.
  - Da fare (VIA A: piano e simulatore aggiornati, controllo D19, stati cambiati mostrati, poi l'approvazione):
    1. PLAN.md: «Decisa dall'utente il 2026-11-07: X.» su ogni domanda; D25–D28 nuove; stati approvati; task nuovi o riscritti (D1 B piano del telefono prima di PA T22; D6 C PA T11; D8 B Flatpak; D9 B; D10 B PA T10; D11 B PA T23; D17 C + D27 PA T42; D19 guardia nel banco; D20 firma; D21 #237; D22 pelle di CodeMirror; D25 verde 159 + regola dei 30° per i colori di stato; D26 logo e icone; D28 condizioni dello strumento AI).
    2. Simulatore: verde 159 di serie (client di cattura `cattura-s2` con la ricetta cambiata, poi ricattura); D5 A (forma A per tutti i casi del disegno); D6 C (preferenza delle barre); temi Carta, Officina, Mare (D17 C, D27 A) e l'editor di testo vestito (D22 A); il logo (D26 B) nel segno della finestra, nell'avvio e nelle Informazioni, più una pagina del logo in `PLAN-ui/`.
    3. Controllo D19 su tutte le viste, difetti in «Differenze», falsi allarmi in un elenco.
    4. Hub (CONSIGLIO/ASPETTA D25–D28), DECISIONS, commit, push, hub e pagina delle scelte ripubblicati, memoria.
  - Fatti 1 e 2 (risposte nel piano, verde 160, D5 A, D6 C, temi, logo provvisorio: commit fino a bc4b4eb7). Logo: l'utente porta il definitivo più avanti («intanto lascia il logo che avevi fatto prima»).
- 2026-11-07 sera · **il controllo D19.** `script/sonda-viste.mjs` su `sim/out-v7`: 1.724 viste (282 stati × 3 larghezze × 2 luci, 16 del telefono × 2 luci). Regole affinate in cinque giri (`sonda-fix*.py`): l'anello si giudica sui quattro lati, gli antenati con `pointer-events: none` tornano nella pila del colore, i livelli (menu, dialogo, strato fisso) non si sovrappongono, i `details` chiusi non contano, il testo colorato dal file sulla carta si conta a parte (contrasto-file), un «…» col testo intero nel `title` o nell'etichetta va bene, il bersaglio si misura dove il clic arriva (`elementFromPoint`, anche un `::after`). Difetti veri → Differenze 48–54, PA T47 (due punti), PA T56, PA T57, blocco `92-prealpha-viste.css`, zona t56 di `foto-sim.mjs`. Telefono → `prompt-piano-telefono.md`; strati → i piani che li possiedono. Giro finale: `sim/prove/viste-v5` (ultima regola della distanza: contano solo i vicini che il clic raggiunge), `foto-v8`, `v9` (la prova dopo i sette passi nuovi dello scenario «cambiato»; `v8` interrotta perché girava sulla costruzione di prima). Numeri in PLAN.md, «Il controllo di tutte le viste», «I pixel contro la fonte», «Si usa come il prodotto».
  - Fatti 3 e 4 (salvo il sì dell'utente): PA T56, T57 nell'ordine (Fase B, dopo S2 in `main`), 57 task, hub e simulatore ripubblicati.

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

La lista vera, 1–13, sta in `PLAN.md` («Differenze fra piani e codice»). In
più rispetto alla prima stesura: N6 senza T79–T85 e T88 (dipendenze); #216 e
#97 corretti in main ma aperti; il blocco di scrittura in sola lettura è in
`FubSession::invoke_command` (`write_turn()` per ogni comando); i sei errori
di tipo riprodotti su `anteprima/tutto` (tre in N4, tre in K5); l'ADR 0230
non esiste da nessuna parte, la 0236 è su `piano/k3-motori`; il vassoio
della fila e della colonna è già sul ramo di S2 (T16, 68f48788).

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
