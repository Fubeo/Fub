# 2026-10-31, PhotoCraft: gli strumenti dentro l'interfaccia

Questa pagina conserva l'inventario di K0 su PhotoCraft: quanta parte degli
strumenti vive nell'interfaccia egui (`crates/ui-egui`) e non nel motore.
Serve a K7, che senza la separazione dovrebbe riscrivere gli strumenti.

> **Per chi:** chi prepara la proposta a PhotoCraft e chi stima K7.
> **Risultato:** sapere che cosa va spostato fuori da `ui-egui`, quanto pesa e
> dove andrebbe secondo il loro piano.

## Chi, cosa, quando

- PhotoCraft `b1cfff9` (`storytold/photocraft`, v0.17.0), 2026-10-31;
- righe contate con `wc -l` sui file `.rs` di `crates/ui-egui/src`, senza i
  file di test (`*test*.rs`);
- la classificazione è fatta file per file, dal commento `//!` di ogni modulo
  e dai crate del motore che importa.

## Il quadro

`ui-egui` ha 158.660 righe senza i test (265.422 con). Di queste, gli
strumenti, la tela e l'ingresso sono 55.764: `tools/` 31.885, `canvas/`
19.887, `input/` 3.992. I test di queste tre cartelle sono altre 39.892
righe. Il piano dei componenti stima «circa 37.000» righe per `tools/` e
«circa 60.000» con la tela: le cifre comprendono parte dei test.

Il loro piano dice già dove andrebbe questo codice. `docs/architecture.md`
§2 prevede due crate, `photocraft-tools` (le macchine a stati degli
strumenti, con un trait `Tool`, `PointerEvent` in ingresso, comandi e
`OverlayPrim` in uscita, §4.3) e `photocraft-viewport` (la camera e il
disegno del documento in una texture wgpu o su processore, §4.4). Ma la
stessa pagina dice: «`viewport` and `tools` live inside `ui-egui` and
`engine`».

## Come sono legati, a `b1cfff9`

- 73 dei 83 file di `tools/` prendono `&mut PhotocraftApp`, lo stato
  dell'applicazione egui; 77 nominano tipi di `egui`
  (`egui::Modifiers`, `Pos2`, `Rect`, `Painter`).
- L'evento di un gesto è `canvas::ToolEvent` (`Down`, `Move`, `Up` con
  posizione e pressione): non porta inclinazione, rotazione né i modificatori,
  che arrivano a parte come `egui::Modifiers`.
- Un gesto finisce in un comando del motore (`paint.stroke`, `select.lasso`,
  `edit.transform`, `path.set`, `type.edit`…), che è già senza interfaccia.
  Gli algoritmi pesanti stanno già sotto: il lazo magnetico usa
  `photocraft_algo::magnetic`, l'aggancio `photocraft_engine::snap`, il testo
  `photocraft_text`.
- Anche il loro server MCP (`crates/automation`) muove gli strumenti
  attraverso l'interfaccia: `ui_pointer` diventa il comando `ui.pointer`,
  servito da `ui-egui/src/control/dispatch.rs`.

## Che cosa c'è, per destinazione

| Gruppo | Righe | Che cosa | Dove andrebbe |
|---|---|---|---|
| Gesti e geometria degli strumenti | 23.101 | taglierina (anche prospettica, raddrizza, misure), trasformazione libera e le sue modalità, scala e spostamento consapevoli del contenuto, selezione diretta, punti d'ancoraggio, penne e forme, lazo e lazo magnetico, sposta e i suoi modificatori, vincolo di ⇧, tavole, cornici, sezioni, marionetta, prospettiva, sfumatura, ritocco, gomme, analisi, simmetria, raggio degli angoli, ricerca degli oggetti, ridimensiona pennello, zoom, testo (puntatore, modifica, tasti, IME, impaginazione); più `canvas/tool_input`, `strokes`, `drag`, `snap_ui`, `guide_select`, `quick_pick` | `photocraft-tools` |
| Sovrapposti e cursori | 6.290 | guide della taglierina e scudo, riquadro della trasformazione, tracciati e maniglie, cornice del testo, contorno del pennello, scia del ritocco, formiche in marcia, righelli, griglia dei pixel, cursori degli strumenti, griglia delle tessere, tavole sulla tela | `OverlayPrim` in `photocraft-tools`; il disegno resta all'interfaccia |
| Vista e anteprime | 10.147 | tela GPU (`gpu_canvas/`, shader WGSL), texture, ridisegno sul processore, trasformazione della vista, scala di zoom, canali, anteprime dei filtri, dello spostamento, della toppa, della trasformazione e del testo, Seleziona e maschera | `photocraft-viewport` |
| Barre delle opzioni e pannelli | 7.017 | barre della trasformazione e del testo, pannello e font del testo, opzioni dei tracciati, preimpostazioni della taglierina, campioni di riempimento e contorno, editor della sfumatura, scelta del pennello, contagocce, ripristina strumento, allinea | restano in `ui-egui`; il loro piano le genera da `options_schema()` |
| Ingresso e cornice della tela | 9.209 | scorciatoie, tasti tenuti e a molla, opacità e metodi di fusione da tastiera, penna (pressione, inclinazione), mouse, rotella, zoom tenuto, scorrimento automatico, barre di scorrimento, menu della tela, schede, schermata iniziale | restano in `ui-egui` |
| **Totale** | **55.764** | | |

Le radici dei moduli (`src/canvas.rs`, 2.687 righe, e `src/tools.rs`, 54)
non sono contate sopra: `canvas.rs` è la vista egui della tela, che resta
all'interfaccia dopo aver delegato a `viewport`.

## Che cosa ne segue per Fub

- K7 ha bisogno dei primi tre gruppi senza egui: circa 39.500 righe. Le
  barre delle opzioni (7.017) Fub le rifà con i suoi componenti; l'ingresso
  (9.209) è già di Fub (`fub-ink`, le scorciatoie della shell).
- Il punto di taglio è stretto: lo stato di `PhotocraftApp` che uno strumento
  legge (documento, preferenze, strumento attivo, trascinamento in corso) e
  `egui::Modifiers`. Un `ToolCx` come nel loro §4.3 lo sostituisce.
- La proposta a PhotoCraft (domanda 5 del piano: la prepara l'agente, la manda
  l'utente) segue il loro §4.3 e §4.4, un passo alla volta, cominciando dagli
  strumenti con meno legami: lazo, lazo magnetico, vincolo di ⇧, zoom.
- `PointerEvent` del loro §4.3 ha già `tilt` e `twist`: la proposta della
  penna (inclinazione nel `PointerEvent` di VectorCraft) è la stessa forma.
