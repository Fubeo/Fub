# 2026-11-14, Linux, la lavagna con venti fogli vivi e il tasto in una scheda

Questa pagina conserva le misure di T46 del piano N6: S3 e S9 rifatti dopo le
schede vive (T40–T44), con in più il tempo dal tasto al fotogramma scrivendo in
una scheda di nota della lavagna (`S9.keyToPaint`). Accanto, il riquadro (S1)
dello stesso giro.

> **Per chi:** chi decide se N6 chiude il cancello, e chi legge `S9.keyToPaint`.
> **Risultato:** S3 e S9 girano, S9 vede **20 fogli vivi**, e il tasto in una
> scheda si misura (61–78 ms di p95 in tre giri). Tutti i numeri stanno sopra
> gli obiettivi di 16,7 ms e 50 ms. Sotto Xvfb, senza GPU, su una macchina
> condivisa con altri lavori (carico da 5 a 16 nei giri che contano): questi
> numeri non dicono se l'obiettivo è raggiunto con una GPU.

## Chi, cosa, quando

- Misurato dal coder del task T46 di N6, su incarico dell'orchestratore, nel
  ramo `coder/n6-t46`, base `386b3349b` (`piano/n6-lavagna`). L'app di release
  è costruita da `386b3349b`: T46 non cambia il prodotto.
- Il referto scrive il commit `d37eb702e`; il codice misurato è quello più il
  commit `093f466d5` (la correzione del clic di S1). Il banco è in
  [Misure nella WebView](../development/webview-measurements.md).
- Il comando, da `apps/client/`, dopo `npm run build` e
  `cargo build --release --locked -p fub-app --features tauri/custom-protocol`:

  ```bash
  env -u WAYLAND_DISPLAY GDK_BACKEND=x11 dbus-run-session -- \
    xvfb-run -a -s "-screen 0 1280x800x24 -maxclients 2048" \
    npm run bench:webview -- --only=S1,S3,S9 --budgets=targets \
    --port=4482 --native-driver=/usr/bin/WebKitWebDriver --x11
  ```

  Sulla sessione Wayland di questa macchina, senza `env -u WAYLAND_DISPLAY` e
  senza `--x11`, il banco ora si ferma (la guardia è in
  [Misure nella WebView](../development/webview-measurements.md)): prima la
  finestra andava sullo schermo vero, non in Xvfb. La guardia non cambia nulla
  quando `WAYLAND_DISPLAY` non c'è, né con `--x11`.

## La macchina

- `pc-debian-di-fub`: Intel Core i5-13600KF, 20 thread, 31 GiB.
- Debian 13, kernel 6.12.113; Xvfb 1280 × 800 con la finestra di 1280 × 840
  (`tauri.conf.json`), fattore di scala 1, sessione X11 (`--x11`).
- WebKitGTK 2.54, user agent `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/60.5 Safari/605.1.15`.
- Nessuna scheda grafica sotto Xvfb: WebKit disegna in software.
- Il carico è quello di `uptime` all'inizio e alla fine di ogni giro. Altri
  lavori giravano sulla macchina, e il carico sale da 5 a 30 nei giri: il
  massimo di un solo fotogramma è il numero più rumoroso.

## Perché S3 non partiva qui

La geometria, con la finestra in X11 sotto Xvfb: finestra 1280 × 840
(`innerWidth`, `innerHeight`), viewport della lavagna a (365, 194) di 651 × 612
px, centro a (691, 500). Il gesto di `moveAndZoom` va da x 291 a x 1091 a y 500,
tutto dentro la finestra: il puntatore a x 1091 è accettato, a x 1285 il driver
risponde «move target out of bounds». La geometria non è la causa.

La causa è `WAYLAND_DISPLAY`. Su una sessione Wayland GTK apre la finestra in
Wayland, cioè sullo schermo di chi misura, e il driver non la vede nel display di
Xvfb. Il 13 novembre S3 falliva così nei giri senza `env -u WAYLAND_DISPLAY` e
passava con la variabile tolta (vedi
[la misura del 13 novembre](2026-11-13-lavagna-fogli-vivi-s9.md)). Qui non
l'abbiamo riprodotta, perché sarebbe una finestra sullo schermo vero. Con
`--x11` S3 gira, e i giri sotto sono nel display isolato.

## I numeri

Obiettivi: i `targets` di `budgets.json` (S3 e S9: p95 16,7 ms, massimo 50 ms;
`S9.keyToPaint.p95` 16,7 ms). Il ✗ è rispetto a loro. Tra parentesi i campioni:
fotogrammi per S3 e S9, tasti per S1 e per `S9.keyToPaint`.

| Giro | Carico (inizio → fine) | S1, riquadro, tasto p95 | S3 p95 / max | S3 apertura | S9 fogli vivi | S9 p95 / max | S9.keyToPaint p95 |
|---|---|---|---|---|---|---|---|
| fin-1 | 5,0 → 16,4 | 109 ms ✗ (95) | 260 / 320 ms ✗ (55) | 577 ms | 20 ✓ | 128 / 173 ms ✗ (223) | 78 ms ✗ (63) |
| fin-2 | 16,4 → 12,1 | non misurato: attesa scaduta | 63 / 91 ms ✗ (135) | 254 ms | 20 ✓ | 103 / 143 ms ✗ (224) | 61 ms ✗ (70) |
| fin-3 | 12,1 → 14,0 | 515 ms ✗ (55) | 57 / 70 ms ✗ (137) | 290 ms | 20 ✓ | 105 / 141 ms ✗ (229) | 70 ms ✗ (61) |
| controllo 1, solo S1 | 9,0 → 6,6 | 104 ms ✗ (96) | — | — | — | — | — |
| controllo 2, solo S1 | 6,6 → 4,5 | 108 ms ✗ (94) | — | — | — | — | — |

Accanto, le misure del 13 novembre con l'app di `e1eb071ed` (T20, [la pagina](2026-11-13-lavagna-fogli-vivi-s9.md)):
S3 p95 44–47 ms (base 45 ms), S9 p95 91–100 ms e massimo 128–346 ms, con
carico fra 6 e 14.

Come leggere i giri:

- **S3** (spostamento e zoom della lavagna di 300 schede, con venti note vive):
  57–63 ms di p95 in due giri a carico 12–16, più del 13 novembre (44–47 ms).
  Il giro fin-1, a carico 16–25, dà 260 ms. Non è un confronto pulito: l'app è
  un'altra (`e1eb071ed` allora, `386b3349b` ora, con T20a–T20f in mezzo) e il
  carico è un altro. Nessuna soglia della CI è cambiata.
- **S9** (la stessa lavagna con venti fogli `.xlsx` vivi): venti fogli vivi in
  tutti e tre i giri, a zoom 0,51. Il p95 fra fotogrammi sta a 103–128 ms, come il
  13 novembre (91–100 ms).
- **`S9.keyToPaint`**: 61–78 ms di p95 su 61–70 tasti, nei tre giri. Il tasto è
  verificato: il testo dei 200 caratteri è nell'editor della scheda. Il primo
  carattere si scrive a parte, come chiede il piano.
- **Riquadro (S1)**: 109 ms a carico 5–16, 104 e 108 ms nei controlli a carico
  4–9, e 515 ms nel giro fin-3 a carico 12–14 (lì i fotogrammi di S1 stavano a
  388 ms di p95). In ciascun giro la scheda sta sotto il riquadro (fin-1: 78
  contro 109; fin-3: 70 contro 515). Il confronto non è pari: il riquadro scrive
  in una nota di 5.000 righe, la scheda in una nota piccola dentro la lavagna.

Non entrano nella tabella tre giri. Il primo (08:22, carico 18 → 11) dà S1 128 ms
e S3 60 / 92 ms, ma S9 non parte: la sessione non si apre entro cinque minuti.
Il secondo (08:29, carico fino a 130) dà S3 169 / 5.344 ms e un tasto non
misurato. Tre giri (08:45, 08:48 e 08:56) hanno usato il driver di una prova
ancora in ascolto sulla stessa porta: scartati.

## Il cancello di N6

Le righe del cancello di N6 che dipendono da queste misure:

- *S3 resta com'è*: S3 è nei numeri sopra. Il confronto con il 13 novembre non
  dice un peggioramento né un miglioramento, per le ragioni scritte sopra.
- *S9, 20 schede di foglio vive: p95 entro 16,7 ms e massimo entro 50 ms*: **non
  raggiunto qui**, p95 103–128 ms e massimo 141–173 ms.
- *Dal tasto al fotogramma entro 16,7 ms (`S9.keyToPaint`, p95)*: **non
  raggiunto qui**, 61–78 ms.
- *Le stesse misure su Windows e macOS*: le fa chi le misura su quei sistemi,
  non sono in questa pagina.

Il cancello ha i numeri. Con questi, le righe di S9 e del tasto non passano su
questa macchina; una misura con GPU o sullo schermo vero dirà l'altra parte.

## Che cosa resta

- WebKitWebDriver non consegna il rilascio del pulsante di mezzo: dopo il pan di
  S3 il clic e i tasti non arrivano più alla lavagna (già in T20). Per questo il
  tasto si misura in un'app nuova (`noteTyping`), dopo quella di S9.
- Due difetti del banco sono stati corretti in questo ramo. Il clic di S1 finiva
  sotto la barra della nota («element click intercepted», in due giri prima della
  correzione). Un'app che parte mentre quella precedente è ancora viva ha
  lasciato il driver in attesa cinque minuti («UND_ERR_HEADERS_TIMEOUT», S9 dopo
  S3: due volte su sei). Ora c'è una pausa tra le sessioni: è l'ipotesi per
  l'istanza unica di Fub, non dimostrata, e il banco la scrive come tale.
- Sotto carico l'apertura di una nota dal selettore rapido può scadere (fin-2:
  riscaldamento e S1, «attesa scaduta»). Il banco lo scrive nel referto e non lo
  corregge: l'apertura è condivisa da tutti gli scenari.
- `misura.sh` non usa Xvfb su una sessione Wayland: la misura va sullo schermo.
  Non è cambiato, perché `misura.sh` sta fuori dal perimetro di T46.
- Le soglie della CI per S9 e per il tasto non ci sono: si tarano sulla prima
  misura del runner, come per S9 (T20).
