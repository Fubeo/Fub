# 2026-11-09, Linux, la penna sulla lavagna (S8)

Questa pagina conserva la **prima delle due misure** del cancello di N4:
mentre si scrive sopra una scheda grossa della lavagna, con 2000 tratti già
scritti, quanto dura il fotogramma più lungo. È il caso simile di D-7 (c)
del piano N4: sotto la penna c'è una tabella di testo di 10.000 celle, non
il foglio vivo, che le schede della lavagna ancora non mostrano. La seconda
misura, sul foglio vero dentro la lavagna, è T23 del piano, ed è quella che
chiude la voce.

> **Per chi:** chi decide se serve un lavoro sulla lavagna prima della
> seconda misura, e chi la rifà.
> **Risultato:** sapere quanto costa un tratto e lo spostamento di una scheda
> sulla lavagna di S8 nella WebView di Linux, e dove va il tempo.

## Chi, cosa, quando

- ramo `coder/n4-t15`, file del banco di `bd77320d` (base `0107412c`,
  `piano/n4-inchiostro`), 2026-11-09. Il referto scrive `882e6324`: i giri
  sono partiti con la correzione di `bd77320d` ancora da committare.
  `42228ea5` cambia solo come si scrivono le quote dei tratti, coi dati
  uguali byte per byte;
- lo scenario: S8 di `apps/client/bench/webview/run.mjs`, dati da
  `fixtures.mjs`, descritto in [Misure nella WebView](../development/webview-measurements.md);
- comandi, da `apps/client/`, dopo `npm run build` e
  `cargo build --release --locked -p fub-app --features tauri/custom-protocol`:
  `xvfb-run -a -s "-screen 0 1280x800x24" npm run bench:webview -- --only=S8 --budgets=targets --native-driver=/usr/bin/WebKitWebDriver`.

## La macchina

- server-di-fub: AMD Ryzen 7 7730U, 16 nuclei logici, 15 GiB di memoria,
  nessuna scheda grafica leggibile;
- Debian GNU/Linux 13, kernel 6.12.115, X11 sotto Xvfb (1280 × 800, 24 bit);
- WebKitGTK 2.54.0 (`libwebkit2gtk-4.1-0` 2.54.0-1~deb13u3), user agent
  `AppleWebKit/605.1.15 … Version/60.5 Safari/605.1.15`.

**Xvfb disegna in software**: WebKit non ha la GPU e dipinge ogni
fotogramma col processore. I numeri valgono come tetto per questa macchina,
non come promessa per una macchina con la scheda grafica o per un tablet.

## I dati

- `S8/Lezione.canvas`, 1,6 MB: la scheda `tabella` (1200 × 800, testo con
  una tabella Markdown di 100 righe, l'intestazione compresa, per 100
  colonne), la scheda `voti` (640 × 420, il file `S8/voti.xlsx`) e 2000
  tratti `fub:ink` di 24 campioni ciascuno: 1000 sulla tabella, 500 sul
  foglio e 500 liberi sotto le schede;
- `S8/voti.xlsx`: un foglio di 100 × 100 celle; la sua scheda è un
  segnaposto (`XLSX · S8/voti.xlsx`), quindi non si apre niente sotto Xvfb.

## Come si misura

1. La lavagna aperta, si aspettano i 2000 tratti asciutti disegnati.
2. Dieci tratti da 300 ms sopra la tabella. **WebKitWebDriver non manda una
   penna che scrive**: della penna arriva solo il `pointerdown` (la sonda
   vede un campione `pen`), poi niente. I dieci tratti misurati sono quindi
   del mouse con D tenuto, dopo un `blur` della finestra che annulla il
   tratto di penna rimasto giù. Tutti e dieci scrivono.
3. Lo spostamento della scheda della tabella dalla testata, avanti e
   indietro per 2 s, posata 60 px più in basso.
4. Lo sha256 di `voti.xlsx` letto dal disco prima della penna e 3 s dopo lo
   spostamento.

`S8.penFrameGap.max` è il fotogramma più lungo mentre la sonda è accesa per
i dieci tratti, pause del driver fra un tratto e l'altro comprese. La meta è
33 ms (`budgets.json`, solo `targets`).

## I tre giri

Millisecondi; il carico è quello di `uptime` a un minuto, prima e dopo.

| Misura | Giro 1 | Giro 2 | Giro 3 |
|---|---|---|---|
| carico prima → dopo | 1,38 → 1,59 | 1,35 → 1,61 | 1,61 → 1,07 |
| input | mouse con D | mouse con D | mouse con D |
| fotogramma più lungo a penna | 200 | 199 | 205 |
| p95 dei fotogrammi a penna | 141 | 145 | 141 |
| fotogrammi a penna oltre 33 ms | 54 su 269 | 55 su 245 | 56 su 267 |
| fotogramma più lungo allo spostamento | 859 | 879 | 870 |
| path asciutti: prima → dopo i tratti → dopo lo spostamento | 2000 → 2010 → 2010 | 2000 → 2010 → 2010 | 2000 → 2010 → 2010 |
| sha256 di `voti.xlsx` prima e dopo | uguale | uguale | uguale |

Lo sha256 è `b75d51082070f0be9f677e2c5f9ddce7cb37e1aa1841a636a8401877f1162f08`
prima e dopo in tutti e tre i giri. Un quarto giro identico, fatto come
controllo, ha dato 207 ms a penna e 865 ms allo spostamento.

**Il peggiore: 205 ms a penna, 879 ms allo spostamento.** La meta di 33 ms
non è raggiunta su questa macchina: è oltre di sei volte.

## Dove va il tempo

Per ogni fotogramma oltre 33 ms lo scenario guarda l'ultimo evento del
puntatore arrivato prima: il movimento (`pointermove`, la scia del tratto),
il rilascio (`pointerup`, il tratto che si scrive nel modello e diventa
asciutto) o nessuno. Due controlli, non committati, cambiano un dato alla
volta: la tabella sostituita da una riga di testo con i 2000 tratti, e la
tabella senza tratti.

| Fotogrammi oltre 33 ms, a penna | S8, giro 2 | senza tabella | senza tratti |
|---|---|---|---|
| durante il movimento | 26, max 205 | 4, max 139 | 13, max 111 |
| al rilascio | 10, max 104 | 10, max 183 | 9, max 54 |
| senza eventi | 20, max 146 | 3, max 114 | 20, max 142 |
| p95 di tutti i fotogrammi | 145 | 57 | 109 |
| più lungo allo spostamento (la posa) | 879 | 252 | 607 |

Che cosa dicono:

- **Mentre il tratto si muove pesa la tabella.** Senza la tabella i
  fotogrammi lunghi durante il movimento scendono da 26 a 4. La scia è un
  SVG sopra le schede: a ogni movimento WebKit ridipinge in software la
  zona sopra le 10.000 celle. I fotogrammi lunghi senza nessun evento, 20
  con la tabella e 3 senza, fanno pensare che il costo stia nel disegno più
  che negli ascoltatori; il profilo non lo dice ancora.
- **Al rilascio pesano i tratti.** Con i 2000 tratti il rilascio arriva a
  104–183 ms; senza tratti a 54 ms. È il commit del tratto in un livello che
  ne ha già 1000 e l'asciutto aggiunto alla scheda.
- **La posa della scheda pesa più di tutto**, sempre un fotogramma solo:
  879 ms con tabella e tratti, 607 senza tratti, 252 senza tabella. Durante
  il trascinamento i fotogrammi restano vicini ai 16 ms; il costo arriva
  quando la scheda si posa, e cresce sia con la tabella sia coi tratti. È
  quello che il piano nota fra le differenze dal passo 12b: dopo un cambio
  la lavagna rifà le schede (`#render`), quindi la tabella da rifare in
  Markdown e i path asciutti da ridisegnare. Il profilo dentro la funzione
  non è misurato qui.

Il carico della macchina era fra 0,85 e 1,61 in tutti i giri: il rumore non
spiega la distanza dalla meta.

## Che cosa non è misurato

- la penna vera: WebKitWebDriver non la manda, i tratti sono del mouse con
  D; il percorso del tratto è lo stesso, gli eventi della penna (pressione,
  coalescenti) no;
- il foglio vivo sotto la penna: è T23, quando la scheda del foglio mostra
  le celle;
- una macchina con la scheda grafica, WebView2, WKWebView e Android;
- il profilo di `#render` e del commit del tratto, funzione per funzione.
