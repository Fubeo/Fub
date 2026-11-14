# 2026-11-13, Linux, la lavagna con venti fogli vivi (S9)

Questa pagina conserva la prima misura di S9, il primo punto del cancello
di N6: la lavagna di S3 (300 schede, 20 note) con in più 20 fogli `.xlsx`
vivi, spostata e ingrandita come S3. Accanto, S3 sullo stesso albero e
sulla base, per vedere se le schede vive di N6 lo cambiano.

> **Per chi:** chi decide se N6 chiude il cancello, e chi tara le soglie
> della CI per S9.
> **Risultato:** S9 gira e vede **20 fogli vivi** a zoom 0,51, prima e dopo
> i gesti. Sotto Xvfb, senza la scheda grafica, il p95 fra fotogrammi è di
> 91–100 ms e il massimo di 128–346 ms, contro gli obiettivi di 16,7 e
> 50 ms: questi numeri non dicono se l'obiettivo è raggiunto con una GPU.
> S3 resta com'era (p95 44–47 ms, come sulla base).

## Chi, cosa, quando

- ramo `coder/n6-t20`, base `e1eb071ed` (`piano/n6-lavagna`). Il codice
  dell'app è quello di `e1eb071ed`, ed è il commit che il referto scrive; il
  banco (`fixtures.mjs`, `run.mjs`, `budgets.json`) è quello del commit
  `1a17ac2d8`, che aggiunge S9 e non cambia S3;
- lo scenario: S9 di `apps/client/bench/webview/run.mjs`, descritto in
  [Misure nella WebView](../development/webview-measurements.md);
- il comando, da `apps/client/`, dopo `npm run build` e
  `cargo build --release --locked -p fub-app --features tauri/custom-protocol`:

  ```bash
  env -u WAYLAND_DISPLAY GDK_BACKEND=x11 dbus-run-session -- \
    xvfb-run -a -s "-screen 0 1280x800x24 -maxclients 2048" \
    npm run bench:webview -- --only=S3,S9 --budgets=targets --port=4480 \
    --native-driver=/usr/bin/WebKitWebDriver
  ```

  `dbus-run-session` tiene l'app del banco lontana da un Fub aperto sullo
  stesso schermo (l'app ha un'istanza sola). Senza `env -u WAYLAND_DISPLAY
  GDK_BACKEND=x11` la finestra va sullo schermo Wayland vero e non dentro
  Xvfb: in quel giro S3 è fallito con «move target out of bounds», e quel
  giro non conta.

## La macchina

- `pc-debian-di-fub`: Intel Core i5-13600KF, 20 thread, 31 GiB;
- Debian 13, kernel 6.12.113; la finestra in X11 sotto Xvfb, 1280 × 800,
  fattore di scala 1 (il referto scrive `wayland`, dalla sessione di chi
  lancia, ma l'app era in X11);
- WebKitGTK 2.54.0 (pacchetto `2.54.0-1~deb13u3`), user agent
  `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/60.5 Safari/605.1.15`;
- la scheda grafica (RTX 4070) non entra: sotto Xvfb EGL non apre lo schermo
  DRI2 («failed to create dri2 screen») e WebKit disegna in software. I numeri
  dicono quanto pesa dipingere senza GPU, non quanto pesa con una GPU;
- la macchina era condivisa con altri lavori (carico medio fra 6 e 14 nei
  minuti delle misure): il massimo di un solo fotogramma è il numero più
  rumoroso.

## Come S9 arriva ai fogli

La lavagna `S9/Fogli vivi.canvas` ha le 300 schede di S3 negli stessi posti e
a sinistra della loro prima riga il blocco di 5 × 4 fogli (`Conti-01.xlsx` …
`Conti-20.xlsx`, 200 × 6 celle ciascuno). La vista intera è a zoom 0,09. Lo
scenario manda 18 scatti di Ctrl+rotella (1,1 ciascuno) tutti sullo stesso
punto, scelto perché il centro del blocco arrivi al centro della vista: zoom
0,51, il centro del blocco a 6, 2 px dal centro. Uno spostamento col pulsante
di mezzo non serve, e non va: WebKitWebDriver non consegna il rilascio del
pulsante di mezzo, la lavagna crede il gesto ancora in corso e non accende le
schede (in quel giro: zero fogli vivi dopo 60 s).

## I numeri

Obiettivi: i `targets` di `budgets.json`. Il ✓ e il ✗ sono rispetto a loro.

| Giro | Albero | S3 p95 | S3 max | S3 campioni | S9 fogli vivi | S9 p95 | S9 max | S9 campioni |
|---|---|---|---|---|---|---|---|---|
| 1 | `1a17ac2d8` | 45 ms ✗ | 124 ms ✗ | 155 | 20 ✓ | 100 ms ✗ | 173 ms ✗ | 230 |
| 2 | `1a17ac2d8` | 47 ms ✗ | 88 ms ✗ | 156 | 20 ✓ | 91 ms ✗ | 128 ms ✗ | 232 |
| 3 | `1a17ac2d8` | 44 ms ✗ | 54 ms ✗ | 168 | 20 ✓ | 99 ms ✗ | 346 ms ✗ | 180 |
| base 1 | `e1eb071ed` | 184 ms ✗ | 255 ms ✗ | 64 | — | — | — | — |
| base 2 | `e1eb071ed` | 45 ms ✗ | 76 ms ✗ | 159 | — | — | — | — |

Il primo giro sulla base è caduto mentre la macchina era più carica (64
campioni invece di 150–170) e non vale come confronto. S3 sull'albero di S9
sta dove sta sulla base: il p95 a 44–47 ms, il massimo fra 54 e 124 ms. Le
schede vive di N6 non cambiano S3, e S3 non ha fogli vivi.

In tutti i giri la rotella del driver c'è (`zoomed: true`), e dopo i gesti i
fogli vivi sono ancora 20.

## Che cosa resta

- S9 sotto Xvfb sta circa al doppio di S3 sul p95: i venti fogli vivi pesano
  sullo spostamento quando si dipinge in software. Se l'obiettivo è
  raggiunto con una GPU lo dirà una misura sullo schermo vero, non questa.
- Le soglie della CI per S9 non ci sono: si tarano sulla prima misura del
  runner, una volta e mezza il peggiore visto, col numero del giro in
  `budgets.json`. Il job `webview` della CI non fa ancora girare S9.
