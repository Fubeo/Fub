# 2026-10-30, Linux, WebKitGTK, runner della CI

Questa pagina conserva la prima misura della WebView vera sul runner della CI,
quella da cui vengono le soglie `ci` di `apps/client/bench/webview/budgets.json`.

> **Per chi:** chi tara le soglie della CI o confronta un'altra misura con
> questa.
> **Risultato:** sapere quanto misura il runner senza scheda grafica, e perché
> non dice nulla di una macchina vera.

## Chi, cosa, quando

- commit `97b32f7e`, ramo `fase/n0-misure`, 2026-10-30;
- misurato dal job «la WebView vera (WebKitGTK, S1–S3)» della CI, run
  40999650702; S1 anche dal run 40988538177;
- budget scelto: `ci`.

## La macchina

- processore AMD EPYC 7763, 4 nuclei virtuali, 16 GiB di memoria;
- **nessuna scheda grafica**: WebKitGTK disegna in software;
- schermo virtuale di Xvfb; fattore di scala e frequenza di aggiornamento non
  riportati dal referto.

## Il sistema e la WebView

- Linux 7.0.0-1017-azure, sessione X11 sotto Xvfb;
- WebKitGTK, user agent `AppleWebKit/605.1.15 … Version/60.5 Safari/605.1.15`.

## I numeri

I tempi sono in millisecondi. L'obiettivo è quello di N0 (`targets`); la
soglia è quella del runner (`ci`), una volta e mezza la misura peggiore vista.

| Scenario | Valore | Campioni | Obiettivo | Soglia `ci` | Esito sull'obiettivo |
|---|---|---|---|---|---|
| S1, battuta → disegno, p95 | 205 (220 nel run 40988538177) | 101 | 16,7 | 330 | fuori |
| S2, cambio di nota, p95 | 517 (p50 477, max 1147) | 20 | 100 | 780 | fuori |
| S3, intervallo fra fotogrammi, p95 | 238 (224 e 235 nei run precedenti) | 82 | 16,7 | 360 | fuori |
| S3, intervallo fra fotogrammi, max | 638 (411 e 315 nei run precedenti) | 82 | 50 | 1600 | fuori |
| S7, intervallo fra fotogrammi nel blocco vivo, p95 | 228 (run 41073706787; fra 143 e 228 in cinque giri) | 215 | — | 340 | — |
| S7, intervallo fra fotogrammi nel blocco vivo, max | 770 (stesso giro; fra 543 e 770 in cinque giri) | 215 | 33 | 1150 | fuori |

Il massimo di S3 è il numero più rumoroso: è un solo fotogramma, e in nove
giri dei rami di N1 è andato da 229 a 1062 ms senza che cambiasse niente della
nota che scorre. La soglia segue la regola, una volta e mezza il peggiore
visto (1062 ms, run 41073706787), e così quella di S7, che il job misura dal
blocco vivo di N13.

Avvio a freddo letto di passaggio: 15 221 ms al primo scenario, con la cache
del sistema vuota; non è S6, che qui non gira.

## Cosa non dice

Il runner disegna senza GPU sotto Xvfb: ogni numero è di un ordine di grandezza
sopra gli obiettivi, che valgono per una macchina vera. Queste misure servono
soltanto a vedere un peggioramento da un commit all'altro sulla stessa
macchina.

## Non provati

- S4, S5 e S6: il job della CI esegue soltanto S1–S3 e S7;
- macOS (WKWebView), Windows (WebView2), tablet e telefoni: servono le
  macchine vere.
