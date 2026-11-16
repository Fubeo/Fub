# 0245 — macOS e iOS sono in pausa

- **Stato:** accolta
- **Data:** 2026-11-16
- **Ambito:** host
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

Fub era costruito e provato su Linux, Windows e macOS, e compilato per Android
e iOS. Due costi pesavano su macOS e iOS:

- Apple chiede l'iscrizione a pagamento al programma per sviluppatori per
  firmare e notarizzare un `.dmg` o un `.ipa`; senza, un installer per Mac non
  si apre senza avvisi, e un'app iOS non esce dal simulatore.
- I runner macOS di GitHub sono il collo di bottiglia della CI: al più cinque
  job insieme, anche con GitHub Pro, e circa 39 minuti l'uno. Ogni PR pronta
  aspettava un runner macOS per il job dei test e per quello delle librerie a
  runtime.

Il maintainer ha deciso di concentrarsi su Linux, Windows e Android.

## Decisione

macOS e iOS sono in pausa: Fub si sviluppa e si rilascia per Linux, Windows e
Android.

- La CI delle PR e di `main` (`ci.yml`) non ha più `macos-latest` nelle
  matrici; `mobile.yml` non ha più il job iOS.
- Il rilascio (`release.yml`) non costruisce un `.dmg` e il cancello non chiede
  i segreti di firma Apple: il canale stabile promette soltanto la firma di
  Windows.
- Il codice `cfg(target_os = "macos")` e `cfg(target_os = "ios")` resta nei
  crate, con la documentazione che lo descrive. Non si cancella.
- `macos-in-pausa.yml` prova ogni settimana, e a mano, i test del workspace su
  macOS e `cargo check -p fub-app --target aarch64-apple-ios`. Non è un
  controllo richiesto, e il cancello del rilascio non lo legge.

## Conseguenze

### Positive

- Una PR pronta non aspetta più un runner macOS: la CI completa finisce prima,
  e più PR girano insieme.
- Un rilascio stabile non dipende da un'iscrizione a pagamento.

### Negative

- Il codice per macOS e iOS può derivare: un cambio che rompe solo il Mac si
  vede fino a una settimana dopo, non nella PR che lo introduce. Il controllo
  settimanale lo limita; un job rosso si corregge con una PR normale.
- Chi usa un Mac non ha un installer, e costruisce Fub da sé.

## Alternative scartate

### macOS soltanto su `main`

Toglierlo dalle PR e tenerlo sui push in `main` avrebbe trovato la deriva al
merge, ma il cancello del rilascio lo avrebbe chiesto verde, e i runner macOS
sarebbero rimasti la coda di ogni merge.

### Cancellare il codice per macOS e iOS

Avrebbe tolto la deriva, ma il ritorno sarebbe costato una riscrittura invece
di qualche correzione.

## Ritorno

Per riprendere macOS e iOS servono l'iscrizione al programma per sviluppatori
Apple, i segreti di firma e notarizzazione (`APPLE_*`), e poi:

- `macos-latest` di nuovo nelle matrici di `ci.yml` (job `test` e
  `librerie-runtime`) e di `release.yml`, con il passo della firma Apple;
- il job `ios` di nuovo in `mobile.yml`;
- `build + test (macos-latest)` fra i job richiesti di
  `.github/scripts/check-release-gate.mjs`, i segreti Apple in `SIGNING`, e il
  sistema in `TEST` di `.github/scripts/baseline-dal-runner.mjs`;
- via `macos-in-pausa.yml`, e una ADR che sostituisce questa.

Lo stato di prima è nel commit che ha creato `macos-in-pausa.yml`.

## Verifica

Le autoprove di `check-release-gate.mjs` e di `baseline-dal-runner.mjs`
provano le liste dei job e dei segreti senza macOS, e la seconda controlla che
la matrice di `ci.yml` sia proprio Linux e Windows. `macos-in-pausa.yml` gira
ogni domenica.
