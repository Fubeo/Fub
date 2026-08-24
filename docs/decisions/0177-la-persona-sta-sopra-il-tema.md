# 0177 — La persona sta sopra il tema

**Stato**: accolta
**Data**: 2026-08-24
**Chiude**: [§31.6](../roadmap/31-da-dove-viene-cio-che-si-vede.md#316-cosa-è-del-tema-e-cosa-della-persona)

---

## Cambiare tema non deve cancellare il modo in cui una persona legge

Densità, corpo, interlinea, larghezza della colonna, carattere e accento non
sono una variante del tema. Se vivessero nel foglio, ogni sostituzione li
perderebbe; se diventassero CSS libero, potrebbero riscrivere anche la scocca.
Serve uno strato separato, più alto del fascio e con un vocabolario chiuso.

## Deciso

Le preferenze di aspetto sono chiavi macchina dichiarate da `fub-host` e lette
dalla shell attraverso il canale impostazioni esistente. Il frontend le
normalizza in `theme/theme.ts`, deriva soltanto i token ammessi e li monta nello
strato `preferenze` di `theme/loader.ts`.

Il caricatore accetta in quello strato solo la lista dichiarata. Tema,
contrasto e accento partecipano alla derivazione, ma una sostituzione di foglio
o pelle non rimuove lo strato personale. Valori assenti o fuori intervallo
tornano ai default dichiarati; non attraversano il DOM come testo CSS.

Lo zoom resta della webview e non entra nella ricetta: ridimensionare il
contenuto non autorizza il tema a cambiare le metriche della scocca.

## Presidi

`frontend/src/theme/preferences.test.ts` prova normalizzazione, limiti e token
derivati. I test delle impostazioni coprono dichiarazione delle chiavi,
selezione e persistenza; i test del caricatore impediscono chiavi arbitrarie
nello strato personale.

## Scartate

| Via | Scartata perché |
| --- | --- |
| Varianti del tema | La preferenza sparirebbe al cambio di fascio. |
| Un foglio CSS libero della persona | Aprirebbe selettori e proprietà oltre la lista decisa. |
| Copia locale nel pannello Impostazioni | Il pannello non possiede né persistenza né applicazione globale. |
| Zoom ricavato dai token | Sposterebbe la scocca per simulare una capacità già posseduta dalla webview. |
