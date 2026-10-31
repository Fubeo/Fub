# Misure

Questa cartella conserva le misure dei tempi di Fub nella WebView vera, una
pagina per macchina e commit.

> **Per chi:** chi confronta i tempi fra versioni, sistemi e WebView, e chi
> tara le soglie della CI.
> **Risultato:** sapere quanto ha misurato quale macchina, su quale commit.

Come si prendono le misure lo dice [Misure nella WebView](../development/webview-measurements.md).
Gli obiettivi stanno in `apps/client/bench/webview/budgets.json`.

## Il formato

Un file per misura, chiamato `AAAA-MM-GG-sistema-webview.md`, con:

- commit, data e chi ha misurato;
- macchina: processore, nuclei, memoria, scheda grafica, schermo, fattore di
  scala e frequenza di aggiornamento;
- sistema: nome, versione e, su Linux, sessione Wayland o X11;
- WebView e versione, dallo user agent del referto;
- una tabella con scenario, valore, obiettivo, campioni ed esito;
- gli scenari saltati, col motivo, e quelli non provati.

Un numero si scrive soltanto se è stato misurato. Uno scenario non provato
resta **non provato**.

## Le misure

| Data | Sistema | WebView | Pagina |
|---|---|---|---|
| 2026-10-30 | Linux 7.0 (Azure), X11 sotto Xvfb | WebKitGTK, Safari 605.1.15 | [Runner della CI](2026-10-30-linux-webkitgtk-runner.md) |

## I motori

Le misure di K0 dei motori Craft, collegati a Fub da soli
([`tools/motori-prova`](../../tools/motori-prova/README.md)): una pagina
`motori-AAAA-MM-GG-sistema-macchina.md` per misura, con peso, memoria, tempi
e librerie.

| Data | Sistema | Macchina | Pagina |
|---|---|---|---|
| 2026-10-31 | Debian 13, kernel 6.12 | AMD Ryzen 7 7730U, senza scheda grafica | [I sei motori da soli](motori-2026-10-31-linux-ryzen.md) |

## Gli inventari

Gli inventari di K0 sul codice dei motori: che cosa vive dove, con righe
contate e revisione.

| Data | Motore | Pagina |
|---|---|---|
| 2026-10-31 | PhotoCraft `b1cfff9` | [Gli strumenti dentro l'interfaccia](photocraft-strumenti-2026-10-31.md) |
