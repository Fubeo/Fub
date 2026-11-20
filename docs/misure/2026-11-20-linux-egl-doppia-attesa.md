# La doppia attesa di EGL su NVIDIA

Chi chiede le due attese di fotogramma per ogni commit quando la finestra
GTK3 di Fub disegna con EGL, e se fermano la pagina a 60 fotogrammi al
secondo.

> **Per chi:** chi lavora sulla fluidità su Linux.
> **Risultato:** le due attese sono il frame callback e la
> `wl_display.sync` che egl-wayland2 chiede a ogni `eglSwapBuffers`, ma
> nessuno le aspetta: GTK3 mette lo swap interval a 0 e lo swap dura
> 0,2–2 ms. Il tetto dei 60 era l'orologio di GTK3, che `orologio.rs`
> corregge già. Dentro il processo di Fub non resta una leva da accendere.

Il meccanismo dell'orologio sta in
[La webview del desktop su Linux](../architecture/desktop-webview.md#lorologio-di-gtk3-nel-modo-gl);
le misure che lo hanno trovato in
[Il ritmo dello schermo su NVIDIA](2026-11-19-linux-ritmo-schermo.md).

## Macchina e sistema

- build di rilascio di `d9a78e54c` (`integra/editor-3`), 20 novembre 2026,
  misura di un agente;
- Intel Core i5-13600KF, 20 thread, 31 GiB, NVIDIA RTX 4070, modulo aperto
  595.112.07;
- LG ULTRAGEAR (DP-2), 2560 × 1440 a 179,96 Hz, scala 1,2 (GTK3 disegna a
  scala 2, la pagina vede 2133 × 1200 e devicePixelRatio 2);
- Debian 13, niri 26.04 su Wayland, GTK 3.24.49, WebKitGTK 2.54.0
  (pacchetto Debian), egl-wayland2 1.0.2 (`libnvidia-egl-wayland2`);
- Fub scrive di serie `WEBKIT_FORCE_DMABUF_RENDERER=1` e
  `GDK_RENDERING=recording` (NVIDIA ≥ 555), l'orologio di GTK allo schermo
  e il vblank emulato sono accesi;
- carico: altri agenti e tester sulla macchina, carico medio a un minuto
  fra 7 e 137 (colonna «carico»). Le sonde girano sui core P (`taskset -c
  0-11`), dalla coda dei controlli.

## Il metodo

- **Le sonde** sono quelle del 17 novembre (`hz.mjs` e `gesti.mjs`,
  [Il vblank emulato su NVIDIA](2026-11-17-linux-vblank-emulato.md#il-metodo)),
  con vault, configurazione e cartelle XDG temporanei e
  `WAYLAND_DEBUG=client`. Questa volta non spostano la finestra: resta dove
  la apre niri, e lo schermo si legge dalla pagina (DP-2 in ogni giro).
- **La libreria di prova** (fuori dal repository, solo in `LD_PRELOAD`,
  mai nel prodotto) sostituisce `dlsym`, perché GTK3 prende le funzioni EGL
  da libepoxy con `dlsym` su libEGL. Registra `eglSwapInterval` e
  `EGL_MIN_SWAP_INTERVAL`, misura la durata di ogni `eglSwapBuffers` e, con
  `EGLSHIM_FORZA=1`, cambia lo swap interval chiesto da GTK in 1.
- **La visibilità.** Niri manda i frame callback solo alle finestre che
  mostra: a una finestra nascosta ne manda uno al secondo. Un giro con un
  `wl_callback.done` per commit nel modo EGL (solo le `sync`), o con un
  commit al secondo, aveva la finestra nascosta e non vale come misura di
  ritmo. Succede a 5 giri su 12; nelle tabelle sono segnati.
- Le varianti: `base` (l'app com'è); `orologio0` (`FUB_OROLOGIO_GTK=0`);
  `forza1` (swap interval 1 al posto dello 0 di GTK);
  `shm` (`WEBKIT_DMABUF_RENDERER_FORCE_SHM=1`, cioè la memoria condivisa
  della patch Debian); `scala1` e `shm_scala1` (le stesse con
  `GDK_SCALE=1`).

## Chi chiede le due attese

Il registro di Wayland di un giro `base`, durante il rAF che disegna, mostra
la stessa sequenza a ogni fotogramma, tutta nella coda di EGL
(`EGLSurface(42)`):

```text
[3550168.140] {EGLSurface(42)}  -> wl_surface#42.damage(0, 0, 2147483647, 2147483647)
[3550168.142] {EGLSurface(42)}  -> wl_surface#42.attach(wl_buffer#4278190084, 0, 0)
[3550168.144] {EGLSurface(42)}  -> wl_surface#42.frame(new id wl_callback#48)
[3550168.146] {EGLSurface(42)}  -> wl_surface#42.commit()
[3550168.147] {EGLSurface(42)}  -> wl_display#1.sync(new id wl_callback#47)
[3550168.456] {Display Queue} wl_display#1.delete_id(47)
[3550168.457] {Display Queue} wl_display#1.delete_id(48)
[3550172.981] {EGLSurface(42)} wl_callback#47.done(0)
[3550172.984] {EGLSurface(42)} wl_callback#48.done(350406719)
[3550173.740] {EGLSurface(42)}  -> wl_surface#42.damage(...)
```

- **Chi le chiede.** È `eplWlSwapBuffers` di egl-wayland2
  (`src/wayland/wayland-surface.c`, 1.0.2): senza `wp_fifo_v1` e
  `wp_presentation` insieme chiede un frame callback prima del commit, e
  dopo il commit sempre una `wl_display.sync`. Niri 26.04 annuncia
  `wp_presentation` ma non `wp_fifo_v1` né `wp_commit_timer_v1`, quindi
  ogni swap chiede tutte e due.
- **Nessuno le aspetta.** Le aspetta solo `WaitForPreviousFrames`, e solo
  con swap interval maggiore di 0; con 0 egl-wayland2 distrugge le
  richieste ancora aperte e consegna subito. GTK3 legge
  `EGL_MIN_SWAP_INTERVAL` (vale 0 qui) e, se è 0, chiama
  `eglSwapInterval(display, 0)` a ogni `make_current`
  (`gdk_wayland_display_make_gl_context_current`,
  `gdk/wayland/gdkglcontext-wayland.c` di GTK 3.24.49). La libreria di
  prova lo conferma: `EGL_MIN_SWAP_INTERVAL = 0`, `eglSwapInterval(0)` due
  volte per fotogramma (circa 360 al secondo), mai un altro valore.
- **Il registro lo mostra.** Il compositore chiude le due callback 0,3 ms
  dopo il commit (`delete_id`), ma i due `done` si leggono solo 4,5 ms
  dopo, subito prima dello swap successivo, quando egl-wayland2 svuota la
  sua coda senza bloccarsi. Lo swap dura 0,2–1,4 ms di media (massimo
  2–8 ms) a 178–180 swap al secondo.
- **E GTK.** Nel modo GL GTK3 non chiede il suo frame callback
  (`on_frame_clock_after_paint`, `gdk/wayland/gdkwindow-wayland.c`: esce se
  non c'è un commit suo da fare) e l'orologio non riceve l'intervallo dello
  schermo. Senza `orologio.rs` va a `FRAME_INTERVAL`, 16 667 µs
  (`gdk/gdkframeclockidle.c`): sono i 60 fotogrammi esatti del 17
  novembre, con 120 `done` al secondo che non c'entrano.

## Frequenze, su DP-2

Commit della finestra al secondo col rAF che disegna e, fra parentesi,
`wl_callback.done` al secondo; rAF a vuoto in Hz. Un valore per giro;
«nascosta» è un giro con la finestra non mostrata da niri.

| variante | carico | rAF a vuoto, Hz | commit/s col rAF (done/s) | commit/s, animazione composta |
|---|---|---|---|---|
| `base` | 97 / 101 | 179,8 / 178,3 | **178,7 (352) / 175,6 (310)** | 179,6 / 179,9 |
| `orologio0` | 38 / 91 | 176,8 / 180,0 | nascosta: 60,1 (61) / **60,0 (120)** | 60,0 / 60,0 |
| `forza1` | 66 / 49 | 2,0 / 178,0 | nascosta: 1,0 (2) / **172,2 (344)** | 1,0 / 173,3 |
| `shm` | 96 / 33 | 176,0 / 179,0 | nascosta: 0 / **51,4 (51)** | 1,0 / 56,4 |
| `scala1` | 113 / 72 | 175,8 / 159,3 | nascosta: 169,1 (166) / **172,4 (333)** | 168,5 / 64,9 |
| `shm_scala1` | 103 / 137 | 174,0 / 77,5 | nascosta: 1,1 / **51,7 (52)** | 16,8 / 54,6 |

L'animazione composta del secondo giro di `scala1` e il rAF a vuoto del
secondo giro di `shm_scala1` sono caduti sotto un carico di 72 e 137.

## Gesti, su DP-2

Fotogrammi presentati al secondo dentro le raffiche e, fra parentesi,
fotogrammi persi sullo schermo. `scala1` è `base` ripetuta (vedi sotto).

| gesto | `base` | `forza1` | `scala1` | `shm` |
|---|---|---|---|---|
| scorrere la nota lunga | 57,1 / 154,1 (593 / 126) | 140,3 / 159,5 (96 / 103) | 153,5 / 158,1 (97 / 108) | 49,0 / 49,8 (384 / 612) |
| cassetto | 89,4 / 115,0 (101 / 17) | 79,9 / 114,2 (29 / 18) | 97,0 / 108,6 (22 / 20) | 35,2 / 37,5 (50 / 44) |
| barra | 120,1 / 125,5 (129 / 32) | 99,5 / 127,7 (27 / 31) | 126,4 / 103,4 (28 / 49) | 45,7 / 43,2 (172 / 183) |
| binario | 104,5 / 138,1 (139 / 48) | 108,1 / 122,6 (96 / 76) | 130,9 / 87,7 (60 / 140) | 42,6 / 46,1 (278 / 240) |

Carico medio fra 5 e 100 durante i gesti; il primo giro di `base` nello
scorrimento (57 fotogrammi, rAF di 16 ms) è caduto con un carico di 33 e
non si ripete negli altri cinque giri di EGL.

## Che cosa dicono

- **La seconda attesa non ferma niente.** Con l'orologio allo schermo la
  finestra va a 176–180 commit al secondo con due `done` per commit, cioè
  con le stesse due attese del 17 novembre. Togliendo solo l'orologio
  (`orologio0`) torna a 60,0 con 120 `done` al secondo: il tetto è
  l'orologio, non EGL.
- **Lo swap interval a 0 è già quello di GTK.** Forzarlo a 0 da Fub non
  cambia niente. Forzarlo a 1 non abbassa il ritmo di una finestra
  mostrata (172: lo swap aspetta il frame callback, che niri chiude
  subito dopo il commit), ma blocca ogni swap per un secondo quando niri nasconde la
  finestra (giro 1 di `forza1`: 1 commit al secondo, swap di 1 000 ms): lo
  0 di GTK è quello giusto e va lasciato.
- **La memoria condivisa resta a 51–56** con il rAF che aspetta il
  fotogramma prima, come il 17 e il 19 novembre.
- **`GDK_SCALE=1` sotto Wayland non fa niente.** In GTK3 la legge solo il
  backend X11 (`gdk/x11/gdkscreen-x11.c`, riga 1110); sotto Wayland la
  scala viene dai `wl_output` (`window_update_scale`,
  `gdk/wayland/gdkwindow-wayland.c`). In tutti i giri `scala1` e
  `shm_scala1` la pagina ha devicePixelRatio 2. Una scala 1 vera chiede di
  cambiare la scala dello schermo in niri, che questa misura non tocca.
  Quanto pesi la copia in memoria condivisa a scala 2 rispetto a 1 resta
  **non misurato**.
- **Lo sfarfallio** non entra: nessuna leva nuova passa da DMA-BUF e
  niente cambia di serie. Il controllo a occhio con `sfarfallio.sh` resta
  quello da fare per `WEBKIT_FORCE_DMABUF_RENDERER=1`, che Fub scrive già.

## Una finestra nascosta disegna a pieno ritmo

Nel modo EGL, con lo swap interval a 0 e l'orologio allo schermo, nessuno
aspetta il compositore: una finestra che niri non mostra continua a
consegnare fotogrammi alla frequenza dello schermo finché la pagina anima
(primo giro di `scala1`: 169 commit al secondo con un solo `done` per
commit, cioè senza frame callback). In memoria condivisa GTK aspetta il suo
frame callback e la finestra nascosta scende a un fotogramma al secondo.
È lavoro buttato, non un errore visibile; prima di cambiarlo serve la
misura del consumo con Fub nascosto.

## GTK4 e WebKitGTK 6.0

In GTK4 `gdk_wayland_gl_context_end_frame`
(`gdk/wayland/gdkglcontext-wayland.c`, GTK 4.18) chiama
`gdk_wayland_surface_request_frame` prima dello swap e mette lo swap
interval a 0: l'orologio riceve l'intervallo dal suo frame callback e
aspetta il compositore anche con la finestra nascosta. È ciò che
`orologio.rs` fa a mano in GTK3, più l'attesa. Per averlo servirebbe
WebKitGTK 6.0 (GTK4), cioè un wry e un Tauri su GTK4: wry usa
`webkit2gtk-4.1` su GTK3.

## Non provati

- La scala 1 vera (scala dello schermo in niri).
- Un compositore con `wp_fifo_v1` (Mutter, KWin recenti): lì egl-wayland2
  con swap interval 0 non chiede il frame callback, solo la `sync`.
- X11 (Xwayland), AMD e Intel.
