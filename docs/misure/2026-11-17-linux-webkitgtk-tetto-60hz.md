# Il tetto dei 60 Hz su NVIDIA

La frequenza dei fotogrammi di WebKitGTK 2.54 nell'app vera, su uno schermo
a 180 Hz con NVIDIA, e la prova che il tetto viene dalla sorgente del vblank
di WebKit e non da Fub.

> **Per chi:** chi lavora sulla fluidità su Linux e chi segue la correzione
> in WebKit.
> **Risultato:** il rAF va a 62 Hz per il timer di ripiego di WebKit; con una
> sorgente di vblank alla frequenza dello schermo va a 180 Hz. Dove la pagina
> disegna, il percorso DMA-BUF di questa macchina non arriva a 60 fotogrammi
> al secondo.

La spiegazione del meccanismo, con le righe del sorgente, sta in
[La webview del desktop su Linux](../architecture/desktop-webview.md#il-tetto-dei-60-hz-di-webkitgtk).

## Macchina e sistema

- build di rilascio di `cff98cb8f` (`origin/main`, con la preferenza
  `PreferPageRenderingUpdatesNear60FPS` spenta di serie), 17 novembre 2026,
  misura di un agente;
- Intel Core i5-13600KF, 20 thread, 31 GiB, NVIDIA RTX 4070, modulo aperto
  595.112.07 allineato alle librerie: il renderer GL è la scheda, non
  llvmpipe;
- due schermi: LG ULTRAGEAR (DP-2), 2560 × 1440 a 179,96 Hz, scala 1,2
  (devicePixelRatio 2 in GTK3); BenQ ZOWIE (DP-3), 1920 × 1080 a 60 Hz,
  ruotato;
- Debian 13, kernel 6.12, niri su Wayland;
- WebKitGTK 2.54.0 (pacchetto Debian 2.54.0-1~deb13u3); `webkit://gpu`:
  «VBlank type: Timer, 60Hz», «Renderer: DMABuf (Supported buffers: Shared
  Memory)»;
- carico: altri agenti al lavoro, carico medio a un minuto fra 3 e 86
  (colonna «carico»). I giri con il carico alto hanno intervalli massimi
  lunghi; le mediane del rAF a vuoto non cambiano.

## Il metodo

La sonda (fuori dal repository) avvia l'app con vault, configurazione e
cartelle XDG temporanei, l'ispettore remoto e `WAYLAND_DEBUG=client`, e
sposta la sua finestra su DP-2 (niri apre le finestre sullo schermo col
fuoco, che era quello a 60 Hz). Poi misura, nella pagina vera:

- **rAF a vuoto**: 3 s di `requestAnimationFrame` che non disegna niente;
- **rAF che disegna**: 5 s di rAF che sposta un riquadro con `transform`;
- **animazione composta**: 5 s di Web Animations su `transform`, senza rAF;
- **animazione sul thread principale**: 5 s su `left`.

In ogni finestra conta i `wl_surface.commit` della superficie della
finestra: sono i fotogrammi che il processo dell'app consegna al compositor.
Le frequenze del rAF sono medie (numero di intervalli diviso il tempo),
perché WebKit arrotonda i tempi al millisecondo. Due giri alternati per
variante.

Le varianti:

- `default`: l'app com'è;
- `pref60`: `appearance.frame-rate` = 60, che lascia accesa la preferenza;
- `nodmabuf`, `nocomp`: `WEBKIT_DISABLE_DMABUF_RENDERER=1`,
  `WEBKIT_DISABLE_COMPOSITING_MODE=1`;
- `rdev`: `WEBKIT_WEB_RENDER_DEVICE_FILE=/dev/dri/renderD128`;
- `shim`: **solo prova, mai nel prodotto.** Una libreria in `LD_PRELOAD`
  sostituisce `drmWaitVBlank` quando `nvidia-drm` risponde `EOPNOTSUPP`, con
  un'attesa a scadenza assoluta su una griglia a 179,96 Hz. WebKit crea
  allora il monitor DRM («VBlank type: DRM, 179Hz» in `webkit://gpu`). È ciò
  che farebbe la PR 78603 di WebKit.

## Su DP-2, a 179,96 Hz

| variante | carico | rAF a vuoto, Hz | rAF che disegna, Hz | commit/s col rAF | commit/s, animazione composta |
|---|---|---|---|---|---|
| `default` | 5 / 71 | 62,2 / 62,1 | 52,3 / 52,4 | 51,9 / 52,0 | 53,5 / 53,2 |
| `pref60` | 8 / 13 | 61,7 / 61,9 | 31,1 / 53,4 | 30,8 / 53,1 | 30,8 / 54,6 |
| `rdev` | 11 / 14 | 61,9 / 61,9 | 49,7 / 52,1 | 49,3 / 51,7 | 54,3 / 53,8 |
| `nodmabuf` | 3 / 6 | 38,5 / 62,0 | 49,0 / 62,1 | 49,3 / 62,1 | 25,8 / 62,4 |
| `nocomp` | 20 / 8 | non provato | 62,5 / 62,5 (mediana) | 61,7 / 61,9 | 62,0 / 62,3 |
| `shim` | 4 / 30 | **180,0 / 180,0** | 54,2 / 53,4 | 54,0 / 53,1 | 51,8 / 55,2 |
| `shim` + `pref60` | 23 / 6 | **180,0 / 175,9** | 52,7 / 26,3 | 52,5 / 26,0 | 51,8 / 26,6 |
| `shim` + `rdev` | 6 / 13 | **179,9 / 179,9** | 54,5 / 52,1 | 54,3 / 51,9 | 55,1 / 45,8 |
| `shim` + `nodmabuf` | 25 / 4 | 29,5 / 96,1 | 0,5 / **99,1** | 0,5 / **99,1** | 61,2 / **99,3** |

`nocomp` viene dal primo giro di misure, senza il rAF a vuoto. I primi giri
di `nodmabuf` e di `shim` + `nodmabuf` hanno avuto blocchi di secondi sotto
carico; i secondi sono quelli a PC scarico.

La distribuzione degli intervalli, `default` (giro 1): rAF a vuoto 186
intervalli su 186 fra 15,5 e 17,5 ms (p10, mediana e p90 di 16 ms); rAF che
disegna p10 17, mediana 18, p90 23 ms, 20 intervalli oltre 25 ms; commit
mediana 18,3 ms, p90 24,3. Con `shim` il rAF a vuoto ha 540 intervalli su
540 sotto 6,5 ms (mediana 6 ms, arrotondata).

## Su DP-3, a 60 Hz

Il primo giro di misure è finito, per errore, sullo schermo a 60 Hz. Vale
come controllo: in tutte le varianti il rAF che disegna ha mediana 16 ms
(62,5 Hz) e i commit sono 60 al secondo. `shim` lì non cambia niente: il
connettore dichiara 530 × 300 mm e lo schermo è ruotato, e con ogni
probabilità WebKit, che cerca il CRTC confrontando la misura fisica con
quella di GTK, non lo trova e resta sul timer (non verificato nel log).

## Che cosa dicono

- **Il tetto è il timer di WebKit.** Senza `shim` il rAF a vuoto sta a 62 Hz
  in ogni variante: è il sonno di 16 ms del timer di ripiego. Con `shim`, e
  nient'altro di diverso, va a 180 Hz. `drmWaitVBlank` su `/dev/dri/card0`
  risponde `EOPNOTSUPP` su tutti e quattro i CRTC, anche col modulo 595.
- **La preferenza non conta qui.** Con il timer la pagina vede 60 Hz
  nominali e la preferenza non entra nel calcolo. Con `shim` WebKit legge
  179 Hz (179 960 mHz diviso 1000, troncato): la preferenza sceglie 59 fps,
  179 / 59 non è intero e `DisplayUpdate::relevantForUpdateFrequency`
  (`Source/WebCore/platform/graphics/DisplayUpdate.cpp`, righe 38–39) lascia
  passare ogni tick. Accesa o spenta, il rAF a vuoto va a 180 Hz.
- **Dove la pagina disegna c'è un secondo limite.** Col renderer DMA-BUF il
  fotogramma costa circa 18 ms a devicePixelRatio 2, quindi 52–54
  fotogrammi al secondo, sotto i 60 anche col timer. Su questa macchina
  WebKit passa i fotogrammi in memoria condivisa («Supported buffers: Shared
  Memory»), e `WEBKIT_WEB_RENDER_DEVICE_FILE` non lo cambia. Senza DMA-BUF
  il fotogramma costa circa 10 ms: 62 Hz col timer, 99 Hz con `shim`.
  `nocomp` consegna 62 fotogrammi al secondo. Qui la pagina sposta solo un
  riquadro: prima di cambiare il percorso di disegno (che esclude
  `nodmabuf` e `nocomp` perché peggiori nei gesti misurati) le varianti
  vanno rimisurate sui gesti di Fub, con la scheda e sullo schermo veloce.
- **62,5 contro 60.** Sullo schermo a 60 Hz il timer produce 62,5 rAF al
  secondo e lo schermo ne mostra 60: circa 2,5 fotogrammi al secondo
  vengono buttati, e il moto ha un piccolo scatto regolare.

## Non provati

- Fub vero con i suoi gesti (barra, cartelle, scrittura) con `shim`: qui
  la pagina disegna solo un riquadro.
- X11 (Xwayland): la sonda non trova la finestra in niri per PID e non la
  può spostare su DP-2.
- AMD e Intel, dove il vblank DRM funziona e la preferenza conta con le
  frequenze intere (144 → 72, 165 → 55).
