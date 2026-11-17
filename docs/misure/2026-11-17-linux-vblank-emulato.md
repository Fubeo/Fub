# Il vblank emulato su NVIDIA

Il vblank emulato di Fub ([ADR 0246](../decisions/0246-vblank-emulato-per-webkitgtk.md))
nell'app vera, su uno schermo a 180 Hz con NVIDIA, con i gesti di ogni
giorno e con i tre modi di passare i fotogrammi di WebKitGTK.

> **Per chi:** chi lavora sulla fluidità su Linux e chi decide il percorso
> di disegno.
> **Risultato:** il vblank emulato porta il rAF della pagina da 62 a 180 Hz.
> I fotogrammi presentati crescono poco (da 46–51 a 47–54 al secondo nei
> gesti continui), perché a quel punto il limite è il trasporto in memoria
> condivisa della patch Debian. Con `WEBKIT_FORCE_DMABUF_RENDERER=1` il
> trasporto resta sulla scheda e i gesti continui vanno a 60 fotogrammi al
> secondo esatti, non oltre. Senza DMA-BUF i pannelli arrivano a 67–89, ma
> lo scorrimento e il binario peggiorano. Lo sfarfallio non si misura con
> gli strumenti di questa macchina: va guardato a occhio.

Il meccanismo sta in
[La webview del desktop su Linux](../architecture/desktop-webview.md#il-vblank-emulato).

## Macchina e sistema

- build di rilascio di `perf/vblank-emulato` (vblank emulato di serie),
  17 novembre 2026, misura di un agente;
- Intel Core i5-13600KF, 20 thread, 31 GiB, NVIDIA RTX 4070, modulo aperto
  595.112.07;
- LG ULTRAGEAR (DP-2), 2560 × 1440 a 179,96 Hz (modalità del CRTC 61:
  clock 768 500 kHz, 2720 × 1570), scala 1,2, devicePixelRatio 2 in GTK3;
  BenQ ZOWIE (DP-3), 1920 × 1080 a 60 Hz, ruotato;
- Debian 13, kernel 6.12, niri su Wayland; WebKitGTK 2.54.0 (pacchetto
  2.54.0-1~deb13u3);
- carico: un altro agente misurava a turno nella WebView vera; carico medio
  a un minuto fra 0,2 e 21 (colonna «carico»). Il secondo giro di `spento`
  nei gesti ha avuto carico 10–21.

## Il metodo

Due sonde, fuori dal repository
(`~/.cache/fub-prealpha/prestazioni-coder/vblank/`, con la ricetta
`RICETTA-MISURA.md`). Tutte e due avviano l'app con vault, configurazione e
cartelle XDG temporanei, l'ispettore remoto, `WAYLAND_DEBUG=client` e
`RUST_LOG=info`, e spostano la finestra su DP-2 prima di misurare (niri la
apre sullo schermo col fuoco, a 60 Hz).

- **Frequenze** (come in [Il tetto dei 60 Hz](2026-11-17-linux-webkitgtk-tetto-60hz.md)):
  rAF a vuoto, rAF che sposta un riquadro, animazione composta su
  `transform` e sul thread principale (`left`), con i `wl_surface.commit`
  della finestra al secondo.
- **Gesti**: scorrere la nota lunga (600 righe, editor Live), aprire e
  chiudere il cassetto (`pannello`), la barra, il lanciatore, il binario,
  cambiare nota dall'albero (`nota`) e cambiare scheda con Ctrl+PagGiù
  (`scheda`). Per ogni gesto: i fotogrammi presentati al secondo dentro le
  raffiche di commit (intervalli sotto 100 ms), i fotogrammi persi sullo
  schermo (per ogni intervallo oltre 1,5 periodi di 5,56 ms, i periodi
  saltati), la mediana del rAF e il blocco più lungo del thread principale.

Le varianti, alternate, due giri:

- `spento`: `FUB_VBLANK_EMULATO=0`, cioè com'è `main`;
- `a`: il vblank emulato;
- `a` + `nodmabuf`: con `WEBKIT_DISABLE_DMABUF_RENDERER=1`;
- `a` + `forcedmabuf`: con `WEBKIT_FORCE_DMABUF_RENDERER=1`, che salta la
  patch Debian e tiene i fotogrammi sulla scheda;
- `spento` + `forcedmabuf`, e `spento` + `nodmabuf` (solo frequenze).

Il log d'avvio di ogni giro di `a` dice `WebKitGTK emulated vblank
attiva=true avvio=Attiva` e `for CRTC pipe=0 crtc=Some(61)
letta_mhz=Some(179960) emulata_mhz=179960`; quello di `spento` dice
`attiva=false avvio=Spenta`. Nessun giro ha una riga per il CRTC di DP-3:
WebKit non trova il CRTC dello schermo ruotato e lì resta sul timer.

## Frequenze, su DP-2

Un valore per giro.

| variante | carico | rAF a vuoto, Hz | rAF che disegna, Hz | commit/s col rAF | commit/s, animazione composta | commit/s, `left` |
|---|---|---|---|---|---|---|
| `spento` | 4 / 3 | 62,0 / 61,9 | 58,6 / 48,7 | 58,2 / 48,2 | 61,0 / 47,8 | 54,9 / 46,2 |
| `a` | 2 / 11 | **179,9 / 180,0** | 53,7 / 53,9 | 53,5 / 53,6 | 55,4 / 54,6 | 55,2 / 50,6 |
| `a` + `nodmabuf` | 2 / 14 | 94,0 / 86,0 | **94,5 / 91,3** | **94,5 / 91,3** | **95,9 / 94,1** | **96,7 / 94,4** |
| `a` + `forcedmabuf` | 2 / 12 | **179,9 / 179,9** | 60,3 / 60,3 | 60,0 / 59,9 | 60,0 / 59,8 | 59,9 / 60,0 |
| `spento` + `forcedmabuf` | 1 / 5 | 61,9 / 61,8 | 60,4 / 60,3 | 60,0 / 59,9 | 60,0 / 59,9 | 60,0 / 59,9 |
| `spento` + `nodmabuf` | 1 / 2 | 62,2 / 62,1 | 62,1 / 62,2 | 62,0 / 62,2 | 62,0 / 62,1 | 62,0 / 62,2 |

## Gesti, su DP-2

Fotogrammi presentati al secondo dentro le raffiche e, fra parentesi,
fotogrammi persi sullo schermo nel gesto (a 180 Hz, dove ogni fotogramma a
60 Hz ne perde 2). Un valore per giro.

| gesto | `spento` | `a` | `a` + `nodmabuf` | `a` + `forcedmabuf` | `spento` + `forcedmabuf` |
|---|---|---|---|---|---|
| scorrere la nota lunga | 50,7 / 48,0 (629 / 586) | 53,1 / 54,1 (580 / 565) | 37,0 / 57,4 (712 / 658) | **60,0 / 59,6** (597 / 594) | 59,9 / 59,8 (602 / 601) |
| cassetto | 47,0 / 46,0 (279 / 268) | 52,0 / 51,4 (248 / 250) | **70,2 / 88,7** (482 / 562) | 59,8 / 59,6 (247 / 248) | 59,7 / 59,7 (241 / 245) |
| barra | 42,0 / 40,8 (184 / 186) | 43,3 / 44,4 (175 / 169) | **75,7 / 77,1** (386 / 392) | 59,8 / 61,0 (116 / 109) | 59,1 / 59,7 (116 / 114) |
| lanciatore | 19,3 / 17,9 (224 / 236) | 20,3 / 19,5 (188 / 214) | **79,1 / 75,9** (757 / 796) | 29,1 / 23,1 (192 / 228) | 24,0 / 22,9 (206 / 220) |
| binario | 48,3 / 49,2 (751 / 716) | 50,3 / 47,2 (689 / 758) | 31,6 / 30,6 (557 / 585) | **58,4 / 57,9** (669 / 655) | 58,3 / 58,8 (653 / 657) |
| cambio di nota | 32,4 / 33,7 (293 / 280) | 30,9 / 34,3 (263 / 245) | **73,1 / 72,4** (630 / 639) | 41,8 / 39,8 (203 / 241) | 40,2 / 38,5 (238 / 224) |
| cambio di scheda | 36,5 / 33,9 (149 / 145) | 33,6 / 30,3 (147 / 176) | **66,9 / 73,9** (497 / 426) | 48,6 / 47,5 (106 / 110) | 53,6 / 51,6 (113 / 87) |

Il blocco più lungo del thread principale non cambia fra `spento`, `a` e
`forcedmabuf` (cassetto circa 600 ms, lanciatore e cambio di nota circa
220–250 ms: è il lavoro della pagina, non del disegno). Con `nodmabuf`
cresce: cassetto fino a 1,4 s, lanciatore 510–580 ms, binario 320–330 ms,
e il rAF del binario ha mediana 59 ms. Nei gesti con `nodmabuf` i
fotogrammi persi sono di più perché i commit sono di più e gli intervalli
più irregolari.

## Che cosa dicono

- **Il vblank emulato fa il suo lavoro.** Il rAF a vuoto passa da 62 a
  180 Hz, come con lo shim della prova; il log dice per quale CRTC e a che
  frequenza. Dove la pagina non disegna (rAF della sonda, rAF mediano di
  6 ms nei gesti) la pagina segue lo schermo.
- **Poi comanda il trasporto.** Con la memoria condivisa ogni fotogramma
  viene letto dalla scheda, copiato e ricaricato: 53–54 fotogrammi al
  secondo al più. Il vblank emulato porta i gesti continui da 46–51 a
  47–54 e non cambia lanciatore, cambio di nota e di scheda, dove il costo è
  il lavoro della pagina.
- **`WEBKIT_FORCE_DMABUF_RENDERER=1` toglie la copia ma si ferma a 60.**
  Tutti i gesti continui vanno a 60 fotogrammi al secondo esatti, con
  intervalli mediani di 16,6 ms, con o senza il vblank emulato. I
  `wl_callback.done` sono 120 al secondo per 60 commit: due attese di
  fotogramma per fotogramma presentato.
- **Senza DMA-BUF i pannelli corrono, il resto no.** Il disegno in software
  arriva a 67–89 fotogrammi al secondo su cassetto, barra, lanciatore,
  cambio di nota e di scheda, ma lo scorrimento è irregolare (37 e 57) e il
  binario scende a 31, con blocchi più lunghi. Il renderer di serie resta
  quello DMA-BUF.

## Il tetto dei 60 con `forcedmabuf`

Un giro in più con `__GL_SYNC_TO_VBLANK=0` (la variabile del driver per lo
swap interval di GL) non cambia niente: `a` + `forcedmabuf` resta a 60,0
commit al secondo con 120 `wl_callback.done`, `a` a 52, `a` + `nodmabuf` a
95. Il log di Wayland di un giro con `forcedmabuf` mostra che la finestra
GTK disegna allora con EGL (coda `EGLSurface(42)` di egl-wayland2): a ogni
`eglSwapBuffers` chiede una sua attesa di fotogramma e un `wl_display.sync`,
oltre a quella dell'orologio dei fotogrammi di GTK. Due attese per
fotogramma e 60 fotogrammi al secondo esatti, tre periodi a 180 Hz, fanno
pensare allo swap interval del contesto GL di GTK sommato all'orologio di
GTK; non è dimostrato, e non è una leva di Fub.

## La proposta

Fub non scrive `WEBKIT_FORCE_DMABUF_RENDERER`: il renderer e il trasporto
restano quelli di WebKit. I numeri dicono che varrebbe la pena su NVIDIA:

- scorrimento, cassetto e binario da 47–54 a 58–60 fotogrammi al
  secondo, la barra da 43–44 a 60, regolari
  (intervallo mediano 16,6 ms);
- lanciatore, cambio di nota e di scheda da 20 / 31–34 / 30–34 a
  23–29 / 40–42 / 48–54;
- meno fotogrammi persi nella barra (circa 170 contro 110) e nel cambio di
  scheda.

Prima di accenderla da `disegno.rs` (solo NVIDIA con le librerie allineate,
mai sopra una variabile dell'utente, una riga nel log) servono: il controllo
a occhio dello sfarfallio con `forcedmabuf`, la prova sui driver che la
patch Debian voleva proteggere (è del 2023) e su X11. Il tetto dei 60
resterebbe; per passarlo bisogna capire l'attesa doppia di EGL in GTK.

## Lo sfarfallio

Lo sfarfallio di WebKitGTK 2.54 (un fotogramma vecchio per un istante) non
si vede con gli strumenti di questa macchina: `grim` cattura un fotogramma
ogni 55 ms circa, contro 5,6 ms di un fotogramma a 180 Hz, e la
registrazione dello schermo passa dal portale, che chiede un clic. Le
misure qui non dicono niente sullo sfarfallio; il controllo a occhio, una
finestra alla volta, è `sfarfallio.sh` accanto alla ricetta.

## Non provati

- X11 (Xwayland): WebKit prende la stessa via, ma la sonda non sposta la
  finestra su DP-2.
- AMD e Intel, dove il vero `drmWaitVBlank` risponde e il vblank emulato
  non entra.
- Lo sfarfallio, a occhio, con `forcedmabuf` e con `nodmabuf`.
