# Sigle di fase e di piano

> **Per chi:** chi legge `docs/project/status.md`, i rami `piano/*` o le
> misure e incontra sigle come K3, N6, P17, M5, S1, T17, D07, A1.
> **Risultato:** sapere che cosa è ogni sigla e dove vive il suo stato.
> **Fonte autorevole:** [status.md](../project/status.md) per le fasi,
> `piano_feature.md` in radice per i pacchetti del piano feature.

## Fasi K — l'ordine di lavoro principale

Definite nella tabella «L'ordine di lavoro» di
[status.md](../project/status.md) e nei rami `piano/k*`:

| Sigla | Fase | Stato in status.md |
|---|---|---|
| K0 | misure e prove dei sei motori | in corso |
| K1, K2 | modello a componenti e pagina Componenti | da fare |
| K3 | strato dei motori (`fub-motori`) | cancello misurato (2026-11-02/04), non passato per intero su R1 |
| K4 | la consegna (dati scaricabili, edizioni, librerie a runtime) | da fare |
| K5 | il disegno (VectorCraft come motore) | da fare |
| K6 | disegno completo | da fare |
| K7, K8 | foto e libreria foto | da fare |
| K9 | documenti e fogli completi | da fare |
| K10 | seguire i motori nel tempo (report settimanale) | continua |

## Fasi N — lavori paralleli (misura, chiusura, logica in Rust…)

| Sigla | Fase | Stato in status.md |
|---|---|---|
| N0 | sonda e banco nella WebView vera | in pila (#258) |
| N1 | chiudere FubDraw | in pila (#262–#267) |
| N2 | server MCP | in pila (#268) |
| N3, N4, N7 | logica in Rust, inchiostro, file Craft | da fare (misure di N3 già in `misure/`) |
| N5, N9 | strati nativi della penna, egui o Tauri | da fare |
| N6 | la lavagna | «Lavagna v1» in status.md: da fare (ramo `piano/n6-lavagna`) |
| N12, N13 | menu «/» e blocco vivo | in pila (#259, #261) |

## Fasi P — due serie con la stessa lettera

- **P0–P5**: fasi del PDF (P0 corpus PdfCraft, P1 motore dei PDF, P2 visore,
  P3 annotare, P4 parti dei PDF, P5 completo) — in
  [status.md](../project/status.md).
- **P00–P18**: pacchetti del piano feature (P00 baseline = issue #77, P01
  file, P02 editor, …, P16 sincronizzazione = #9, P17 pubblicazione, P18
  rilascio) — in `piano_feature.md` in radice e nelle issue #76–#93.

## Altre sigle

| Sigla | Che cos'è | Dove vive |
|---|---|---|
| M5 | milestone #5: il runtime WASM dei plugin, consegnato in `main` | `architecture/plugin-runtime.md` |
| G3 | certificazione G3/ARCH del runtime WASM, chiusa prima dello slice 1 di #8 (il suo handoff non è più nel repo) | citata in `architecture/wasm-providers.md`; non tracciata in status.md |
| S1–S3 | scenari del banco WebView (S1 battuta, S2 cambio nota, S3 pan/zoom lavagna) | `development/webview-measurements.md:35-37`, misure in `misure/` |
| T1, T17, T96… | task numerati in cui un piano spezza il lavoro (`PLAN.md` sul ramo `piano/<slug>`) | `.claude/skills/pianifica/PLAN.modello.md`; rami `wip/n6-t42`, `wip/n6-t57`, `wip/n6-t93` |
| D14, D-7 | decisioni: quelle del proprietario (D14 in `DECISIONS.md`) e quelle locali a un piano (D-7 nel piano K3) | `DECISIONS.md` in radice e i rami `piano/*`; le D01–D23 della vecchia lista di lavoro, tolta dalla radice, diventano issue GitHub |
| A1 | piano «base per AI», ramo `piano/a1-base-per-ai` | ramo `piano/a1-base-per-ai` |

Attenzione alle collisioni: «A1» è anche una cella Excel;
«S2» e «T1» sono anche nomi di schermate/scenari del banco; «P» vale per
entrambe le serie sopra.
