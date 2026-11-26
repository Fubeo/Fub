# La webview del desktop su Linux

> **Domanda:** come sceglie Fub il percorso di disegno di WebKitGTK, che cosa
> dice all'utente quando il driver è un problema e come la pagina supera i
> 60 Hz dove WebKit lo permette? Che cosa ripara Fub degli appunti di
> WebKitGTK?
> **Fonti autorevoli:** `crates/fub-app/src/disegno.rs`,
> `crates/fub-app/src/frame_rate.rs`, `crates/fub-app/src/vblank.rs`,
> `crates/fub-app/src/appunti_gtk.rs`,
> `crates/fub-app/src/orologio.rs`,
> `crates/fub-app/src/main.rs`, `crates/fub-app/build.rs`,
> `crates/fub-app/src/lib.rs` (`run`),
> `crates/fub-host/src/settings.rs` (`appearance.rendering`),
> `apps/client/src/ui/rendering-notice.ts`.

## Il percorso di disegno all'avvio

WebKitGTK legge alcune variabili d'ambiente solo quando crea il primo
contesto, cioè dopo che GTK è partito. Per questo `fub_app::run` fa tutto
**prima di ogni thread**, come primo passo dopo aver trovato la cartella di
configurazione:

1. legge `appearance.rendering` e `appearance.motion` dal file di macchina,
   senza montare l'host (`fub_host::settings::startup_machine_texts`);
2. compone la diagnosi della macchina (`disegno::leggi`) guardando solo
   `/proc`, `/sys`, le cartelle delle librerie e l'ambiente;
3. applica la tabella dei casi (`disegno::scegli`);
4. scrive le variabili scelte con `std::env::set_var`. È sicura solo finché il
   processo ha un thread solo, e lì è così: il log, Tauri, GTK e `tokio` non
   sono ancora partiti.

Il log scrive poi una riga `rendering path chosen before GTK` con modo,
diagnosi, variabili e avvisi.

### La diagnosi

| fatto | da dove |
|---|---|
| sessione | `GDK_BACKEND`, poi `WAYLAND_DISPLAY`, `XDG_SESSION_TYPE`, `DISPLAY` (l'ordine di GTK3) |
| scheda primaria | `/sys/class/drm/card*/device/{vendor,boot_vga,uevent}` |
| GPU utilizzabile | un nodo `renderD*` |
| modulo NVIDIA | `/proc/driver/nvidia/version` |
| librerie NVIDIA | `libEGL_nvidia.so.<versione>` e `libnvidia-glcore.so.<versione>` nelle cartelle delle distro e del Flatpak |
| disegno software probabile | driver disallineato, nessun `renderD*`, driver senza 3D (`simpledrm`, `bochs-drm`, `cirrus`, `qxl`), `LIBGL_ALWAYS_SOFTWARE` |

Il driver è **disallineato** quando la scheda primaria è NVIDIA e nessuna
libreria ha la versione del modulo: il driver è stato aggiornato e il
computer non è stato riavviato. WebKit allora ripiega su llvmpipe, cioè
disegna col processore.

### La tabella dei casi

| modo | caso | variabili | avviso |
|---|---|---|---|
| qualunque | driver NVIDIA disallineato | nessuna | «riavvia il computer» |
| `auto` | NVIDIA < 555 primaria, Wayland, driver allineato, nessuna variabile dell'utente | nessuna | proposta: disegno col processore, movimento calmo, lascia così |
| `auto`, `gpu` | NVIDIA ≥ 555 primaria, Wayland, driver allineato, nessuna variabile dell'utente | `WEBKIT_FORCE_DMABUF_RENDERER=1`, e `GDK_RENDERING=recording` se l'utente non l'ha messa | nessuno |
| `auto`, `gpu` | WebKitGTK dalla 2.53.0 alla 2.54.1, nessuna variabile dell'utente | `WEBKIT_USE_SKIA_FOR_COMPOSITION=0` | nessuno |
| `auto` | ogni altro caso | nessuna | nessuno |
| `gpu` | ogni altro caso | nessuna | solo quello del driver disallineato |
| `cpu` | qualunque | `WEBKIT_SKIA_ENABLE_CPU_RENDERING=1` | solo quello del driver disallineato |

`auto` non sceglie il renderer, e la ragione sono le misure fatte su
Debian 13, niri, RTX 4070 e WebKitGTK 2.54:

- col disegno software Skia CPU è pari al default a PC scarico e peggiore
  sotto carico;
- sotto NVIDIA < 555 su Wayland Skia CPU dà più fotogrammi, ma lo
  sfarfallio resta: per questo Fub lo propone e non lo fa da solo;
- per le VM senza 3D non ci sono misure, e senza misure non si cambia il
  percorso.

Le variabili che `auto` e `gpu` scrivono non cambiano il renderer:
correggono difetti misurati.

- `WEBKIT_FORCE_DMABUF_RENDERER=1` toglie la copia in memoria condivisa
  della patch NVIDIA di Debian
  ([Il trasporto dei fotogrammi su Debian](#il-trasporto-dei-fotogrammi-su-debian)):
  con l'orologio di GTK allo schermo la pagina passa da 42–58 a 178
  fotogrammi al secondo su uno schermo a 180 Hz. Dove la patch non c'è la
  variabile non esiste. Solo dal 555, il primo driver con la
  sincronizzazione esplicita.
- `GDK_RENDERING=recording`, insieme alla precedente, toglie a GTK3
  l'immagine grande quanto la finestra che rifà a ogni fotogramma nel modo
  GL ([La superficie di GTK3 nel modo GL](#la-superficie-di-gtk3-nel-modo-gl)).
  Una `GDK_RENDERING` dell'utente, con qualunque valore, vince.
- `WEBKIT_USE_SKIA_FOR_COMPOSITION=0` toglie i fotogrammi vecchi che la
  composizione di Skia rimette sullo schermo dopo un'animazione, nelle
  WebKitGTK dalla 2.53.0 alla 2.54.1 (corretto a monte nella 2.54.2, commit
  WebKit `4af7b773e279`). L'intervallo sta in
  `disegno::SKIA_DIFETTOSA_DA` / `SKIA_DIFETTOSA_FINO_A`, la versione è
  quella della libreria caricata. La composizione di TextureMapper non
  abbassa il ritmo (misure in
  [Il ritmo dello schermo su NVIDIA](../misure/2026-11-19-linux-ritmo-schermo.md)).

Fub **non scrive mai** `WEBKIT_DISABLE_DMABUF_RENDERER` né
`WEBKIT_DISABLE_COMPOSITING_MODE`: sono le varianti peggiori in ogni gesto
misurato. Le variabili che l'utente ha già messo vincono sempre: con
`WEBKIT_DISABLE_DMABUF_RENDERER`, `WEBKIT_SKIA_ENABLE_CPU_RENDERING`,
`WEBKIT_DISABLE_COMPOSITING_MODE`, `WEBKIT_DMABUF_RENDERER_FORCE_SHM`,
`WEBKIT_FORCE_DMABUF_RENDERER`, `WEBKIT_USE_SKIA_FOR_COMPOSITION`,
`__NV_DISABLE_EXPLICIT_SYNC` o `GDK_BACKEND` nell'ambiente, con qualunque
valore, Fub non propone niente e non scrive le sue, e `cpu` non tocca
una `WEBKIT_SKIA_ENABLE_CPU_RENDERING` già messa.

### L'impostazione

`appearance.rendering` è un'impostazione di macchina (`auto`, `gpu`, `cpu`;
di serie `auto`), nel gruppo Aspetto, dichiarata solo su Linux. Un file di
prima senza la chiave, o con un valore sconosciuto, vale `auto`: non serve
una migrazione e il file non si riscrive (`settings.json` resta quello di
[on-disk-layout](../reference/on-disk-layout.md)). Cambiarla vale dal
prossimo avvio.

### Gli avvisi

Gli avvisi nascono prima che esista la shell. L'host li mette in coda
(`Host::with_startup_notice`) dopo la diagnosi del log, e la shell li tira con
la stessa porta di quella, `session_notice`, una chiamata per avviso finché
la risposta è `null`. Ognuno è un `Event::Custom` col topic `rendering` e un
payload tipizzato:

| `kind` | campi | la shell |
|---|---|---|
| `driver_mismatch` | `kernel`, `library` | notifica «Il driver della scheda grafica è stato aggiornato: riavvia il computer», tono guasto |
| `nvidia_flicker` | `driver`, `offer_motion` | notifica con i gesti «Disegna col processore» (`appearance.rendering` = `cpu`), «Movimento calmo» (`appearance.motion` = `calm`, solo se il valore effettivo, default compreso, non è già `calm` o `reduced`) e «Lascia così» (`gpu`) |

La proposta torna a ogni avvio finché l'utente non sceglie: `cpu` o `gpu` la
spengono, perché valgono solo in `auto`. I testi stanno nel catalogo della
shell (`rendering.*`).

## Oltre i 60 Hz

WebKit ha la preferenza `PreferPageRenderingUpdatesNear60FPSEnabled`, accesa
di serie anche in WebKitGTK: avvicina gli aggiornamenti della pagina a 60 al
secondo e porta uno schermo a 144 Hz a 72 Hz (WebKit PR 78603).
`frame_rate.rs` la spegne su ogni webview, all'inizio di ogni caricamento e
quando cambia `appearance.frame-rate`, salvo un tetto fino a 60, come su
macOS.

Su Linux passa da `with_webview` e dall'API delle feature di WebKitGTK
(`webkit_settings_get_all_features`, `webkit_settings_set_feature_enabled`,
dalla 2.42). Lì l'identificatore è `PreferPageRenderingUpdatesNear60FPS`,
senza il suffisso `Enabled` (WebKitGTK 2.54: stato «stable», acceso di
serie). I simboli si cercano a runtime con `dlsym`: un WebKitGTK più
vecchio fa partire l'app lo stesso, e il log lo dice (`SenzaApi`). Il tipo
della webview viene dal crate `webkit2gtk` nella versione che wry già porta.

### Il tetto dei 60 Hz di WebKitGTK

In WebKitGTK il ritmo della pagina lo dà un *display link* nel processo
dell'app: i `requestAnimationFrame`, gli aggiornamenti di rendering e la
composizione delle animazioni CSS partono tutti dai suoi tick. Su GTK il
display link ha solo due sorgenti (WebKitGTK 2.54,
`Source/WebKit/UIProcess/glib/DisplayVBlankMonitor.cpp`, righe 65–70):

- **DRM**: `drmWaitVBlank` sul nodo primario della scheda
  (`/dev/dri/card*`), con la frequenza del monitor GTK
  (`DisplayVBlankMonitorDRM.cpp`, righe 92 e 236–242);
- **timer**, se il DRM fallisce: `FullSpeedFramesPerSecond`, cioè 60, e un
  sonno intero di `1000 / 60` = 16 ms (`DisplayVBlankMonitorTimer.cpp`,
  righe 41 e 47). Il rAF va quindi a 62,5 Hz e non è agganciato allo
  schermo.

Nessuna sorgente legge i frame callback di Wayland né `wp_presentation`.
`nvidia-drm` (550 e 595) risponde `EOPNOTSUPP` a `drmWaitVBlank` su ogni
CRTC, e sotto Xvfb non c'è una scheda: lì WebKit usa sempre il timer. Il
journal dice «drmWaitVBlank failed: Operation not permitted», ma il testo è
sbagliato: WebKit stampa `strerror(-ret)` e libdrm restituisce sempre -1.

Con il timer la frequenza nominale dello schermo per la pagina vale 60
(`DisplayLinkGLib.cpp`, righe 47–48), e con 60
`preferredFramesPerSecond` restituisce 60 senza guardare la preferenza
(`Source/WebCore/platform/graphics/AnimationFrameRate.cpp`, righe 52–57).
Quindi, su NVIDIA e sotto Xvfb, spegnere `PreferPageRenderingUpdatesNear60FPS`
non cambia niente. Conta dove il DRM risponde (AMD e Intel col modesetting
del kernel), e solo se la frequenza intera dello schermo è un multiplo della
scelta: accesa, porta 180 Hz a 60 e 144 Hz a 72. WebKit tronca i millihertz
di GTK, quindi uno schermo a 179,96 Hz vale 179; la preferenza sceglie 59 e
179 / 59 non è intero, così `DisplayUpdate::relevantForUpdateFrequency`
(`Source/WebCore/platform/graphics/DisplayUpdate.cpp`, righe 35–43) lascia
passare ogni tick e la pagina va a 179 Hz anche con la preferenza accesa.

WebKit non offre una leva per alzare il tetto:
`WEBKIT_FORCE_VBLANK_TIMER` può solo forzare il timer,
`WEBKIT_DISPLAY_REFRESH_THROTTLE_FPS` può solo abbassare la frequenza (e
deve esserne un divisore), fra le 538 feature di
`webkit_settings_get_all_features` nessun'altra tocca il display link, e
`WEBKIT_DISABLE_DMABUF_RENDERER`, `WEBKIT_DISABLE_COMPOSITING_MODE` e X11
non cambiano la sorgente. La correzione vera sta in WebKit: la
[PR 78603](https://github.com/WebKit/WebKit/pull/78603) fa andare il timer
alla frequenza del monitor GTK, con scadenze assolute. Finché non è in una
release, Fub emula il vblank.

### Il vblank emulato

L'eseguibile `fub`, solo su Linux, esporta un suo `drmWaitVBlank`
(`main.rs`), e il linker dinamico lo dà a WebKit al posto di quello di
libdrm. Nella tabella dei simboli dinamici lo mette già GNU ld, perché
`libwebkit2gtk-4.1` è collegata e lo usa; il build script lo chiede anche in
modo esplicito (`-Wl,--export-dynamic-symbol=drmWaitVBlank`), solo lui. Vale solo per il processo
dell'app, che è quello del display link; il processo web non è toccato. La
logica sta in `vblank.rs` ([ADR 0246](../decisions/0246-vblank-emulato-per-webkitgtk.md)):

- chiama sempre prima il `drmWaitVBlank` di libdrm (`dlsym(RTLD_NEXT)`) ed
  emula solo se risponde `EOPNOTSUPP`; il fallimento si ricorda per
  (scheda, CRTC), e dopo il primo non lo si richiama;
- emula le richieste che WebKitGTK 2.54 fa
  (`DisplayVBlankMonitorDRM.cpp`): relative, con `sequence` 0 per provare e
  1 per aspettare, e i bit del CRTC (`DRM_VBLANK_SECONDARY`,
  `DRM_VBLANK_HIGH_CRTC_MASK`); anche le assolute, col confronto a 32 bit
  del kernel. Evento, segnale, flip e `NEXTONMISS` passano a libdrm come
  sono;
- la frequenza è quella della modalità del CRTC (`drmModeGetResources`,
  `drmModeGetCrtc`, cercate nel processo con `dlsym`), arrotondata come la dà
  GTK e riletta ogni secondo, con l'ioctl fuori dal lock dello stato (costa
  0,3 µs, ma può aspettare il driver durante un cambio di modalità). Le
  scadenze sono assolute su `CLOCK_MONOTONIC` (`clock_nanosleep` con
  `TIMER_ABSTIME`), quindi il ritmo non deriva; il thread che dorme ha il
  margine dei timer a 1 ns (`PR_SET_TIMERSLACK`: il ritardo mediano al
  risveglio scende da 65 a 14 µs a 180 Hz). La risposta ha il contatore a 32
  bit e il tempo del vblank, come quella del kernel;
- fuori da 24–500 Hz, con il CRTC spento o con un'attesa oltre 3 s risponde
  come il driver (`-1`, `EOPNOTSUPP`): WebKit resta sul timer, come prima;
- `FUB_VBLANK_EMULATO=0` la spegne, e fuori dall'intervallo di WebKitGTK
  scritto in `vblank::WEBKITGTK_DA` / `WEBKITGTK_FINO_A` (dalla 2.54.0,
  aperto in alto) è spenta. La versione è quella della libreria caricata
  (`tauri::webview_version`), letta prima che parta GTK.

Il vblank emulato ha la frequenza dello schermo ma non la sua fase, come il
timer della PR 78603. WebKit trova il CRTC confrontando la misura fisica
del connettore con quella del monitor GTK: dove non coincide (lo schermo
ruotato di questa macchina) resta sul timer, emulazione o no.

Su X11 WebKit prende la stessa via (`findCrtc` con il monitor GDK), ma non è
misurata. Windows e macOS non hanno niente di tutto questo.

### Il trasporto dei fotogrammi su Debian

Col renderer DMA-BUF il processo web disegna in buffer della scheda e li
passa al processo dell'app. WebKitGTK sceglie il modo in
`AcceleratedBackingStore::rendererBufferTransportMode`: «Hardware» se trova
il dispositivo DRM principale e l'EGL di GTK importa i dma-buf, altrimenti
«Shared Memory», dove ogni fotogramma viene letto dalla scheda, copiato in
memoria condivisa e ricaricato nel processo dell'app.

Su NVIDIA le condizioni ci sono tutte (EGL `EXT_image_dma_buf_import`,
render node e nodo primario dal dispositivo EGL), ma il pacchetto Debian
applica `debian/patches/disable-nvidia-dmabuf.patch` (WebKit bug 262607,
Debian #1039720): se il `GL_VENDOR` contiene «NVIDIA» il modo resta «Shared
Memory», salvo `WEBKIT_FORCE_DMABUF_RENDERER=1`. Il sorgente di WebKit non
ha né questo controllo né la variabile; le distro che prendono il pacchetto
da Debian probabilmente lo ereditano (non verificato). `webkit://gpu` lo mostra come
«DMABuf (Supported buffers: Shared Memory)» e «Buffer format: Shared
Memory».

Con NVIDIA dal 555 sotto Wayland Fub scrive `WEBKIT_FORCE_DMABUF_RENDERER=1`
([La tabella dei casi](#la-tabella-dei-casi)): i fotogrammi restano sulla
scheda e la finestra GTK li disegna con GL. Da sola la variabile porta la
pagina da 42–58 a 60 fotogrammi al secondo esatti, perché nel modo GL
l'orologio di GTK3 va a 60 ([qui sotto](#lorologio-di-gtk3-nel-modo-gl));
con l'orologio allo schermo arriva a 178.

### L'orologio di GTK3 nel modo GL

Il processo dell'app ridisegna la webview a ogni giro dell'orologio dei
fotogrammi di GTK (`GdkFrameClock`). GTK3 fa il giro successivo dopo
l'intervallo di refresh scritto nei tempi del fotogramma precedente
(`gdk_frame_clock_paint_idle`, `gdk/gdkframeclockidle.c` di GTK 3.24), e
quell'intervallo lo scrive solo il frame callback di Wayland
(`frame_callback`, `gdk/wayland/gdkwindow-wayland.c`), dalla frequenza
dello schermo della finestra. Quando la finestra disegna con GL (i
fotogrammi DMA-BUF di WebKit sulla scheda: il Flatpak, o Debian con
`WEBKIT_FORCE_DMABUF_RENDERER=1`) il commit lo fa `eglSwapBuffers` e GTK
non chiede più il suo frame callback: l'intervallo resta 0 e GTK ripiega su
`FRAME_INTERVAL`, 16 667 µs. La pagina va a 60 fotogrammi al secondo esatti
anche su uno schermo a 180 Hz, con il rAF del vblank emulato a 180: i due
`wl_callback.done` per commit delle misure del 17 novembre sono il frame
callback di EGL e la sua `wl_display.sync`, letti insieme al commit
successivo. Non frenano: GTK3 mette lo swap interval a 0 e egl-wayland2
allora non li aspetta
([La doppia attesa di EGL](../misure/2026-11-20-linux-egl-doppia-attesa.md)).

`src/orologio.rs` scrive quell'intervallo al posto del frame callback: su
ogni finestra, dopo ogni disegno (`after-paint`), se il campo è ancora 0 ci
mette il periodo dello schermo dove sta la finestra
(`gdk_monitor_get_refresh_rate`, 24–500 Hz). Il campo è privato
(`struct _GdkFrameTimings`, `gdk/gdkframeclockprivate.h`), con la
disposizione della 3.24.21 e seguenti; per non scrivere mai nel campo
sbagliato si scrive solo se il getter pubblico
(`gdk_frame_timings_get_refresh_interval`) e il campo dicono 0 tutti e due,
e dopo la scrittura il getter deve leggere il valore scritto: se no il
campo torna 0 e l'orologio non si tocca più. Vale solo per GTK 3 dalla
3.24.21, sotto Wayland; `FUB_OROLOGIO_GTK=0` la spegne. Dove GTK disegna da
sé (memoria condivisa) il frame callback arriva dopo e riscrive lo stesso
valore. Su uno schermo a 60 Hz l'intervallo è quello di prima. Numeri in
[Il ritmo dello schermo su NVIDIA](../misure/2026-11-19-linux-ritmo-schermo.md).

### La superficie di GTK3 nel modo GL

Nel modo GL GTK3 disegna ogni giro della finestra così
(`gdk_window_begin_paint_internal` e `gdk_window_end_paint_internal`,
`gdk/gdkwindow.c`): crea una superficie cairo grande quanto la parte da
ridisegnare (`gdk_window_create_similar_surface`), la pulisce
(`gdk_window_clear_backing_region`), ci lascia dipingere i widget, e alla
fine carica come texture solo ciò che GL non ha già coperto. La webview
copre tutta la finestra con GL (`gdk_cairo_draw_from_gl`, che costa 0,1 ms
e non legge pixel dalla scheda), ma la superficie si crea, si pulisce e si
butta lo stesso. WebKit chiede di ridisegnare tutta la webview a ogni
fotogramma, anche senza gesti: dopo ogni scorrimento, ridimensionamento o
passaggio del puntatore le barre di scorrimento sovrapposte di WebKitGTK
sfumano a 60 fotogrammi al secondo per circa 3 s (20–40 al secondo di
media con Fub fermo e una nota aperta). A tutto schermo a scala 2 sono
4266 × 2400 × 4 = 41 MB a fotogramma. È sopra i 32 MB oltre cui glibc
chiede la memoria al kernel ogni volta (`mmap`), e il thread principale
passa il tempo nei page fault della memoria nuova.

Con `GDK_RENDERING=recording` (letta in `gdk_init`, `gdk/gdk.c`) la
superficie registra i comandi invece di riempire pixel: pulirla e
dipingerci lo sfondo costa niente, e si rasterizza solo la parte che GL non
copre, quando la carica come texture (`cairo_surface_map_to_image`). La
variabile cambia la superficie solo dove GTK ne chiede una simile: le
finestre disegnate con GL e le cache dei widget che scorrono
(`GtkPixelCache`, che Fub non usa); le finestre senza GL sotto Wayland
disegnano direttamente nel loro buffer. Fub la scrive solo con NVIDIA dal
555 sotto Wayland, dove scrive anche `WEBKIT_FORCE_DMABUF_RENDERER=1` e dove
c'è la misura; il meccanismo è di GTK3 e vale per ogni scheda che disegna
con GL. Si eredita nei programmi che Fub avvia, dove non cambia il
risultato. Numeri in
[Il ritmo dello schermo su NVIDIA](../misure/2026-11-19-linux-ritmo-schermo.md#la-superficie-di-gtk3).

### Le barre di scorrimento fisse

Le barre sovrapposte di WebKitGTK sfumano per circa 3 s dopo ogni gesto, e
in quei secondi la finestra si ridisegna a 60 fotogrammi al secondo anche
con Fub fermo. Su Linux Fub scrive `GTK_OVERLAY_SCROLLING=0` in ogni modo e
su ogni scheda, se l'utente non l'ha già messa (`disegno::barre_fisse`): le
barre restano sempre visibili, prendono la loro larghezza alla colonna che
scorre, e con una nota aperta e ferma la finestra passa da 35–37 a 1,6
ridisegni al secondo (solo il cursore). È una scelta del maintainer del
20-11-2026; Windows e macOS non leggono la variabile.

### I fotogrammi vecchi dopo un'animazione

WebKitGTK 2.54.0 e 2.54.1 rimettono per un fotogramma lo strato di prima alla fine di
un'animazione (compositore Skia, corretto dalla 2.54.2: [misura](../misure/2026-11-19-linux-fotogrammi-vecchi.md)). Il
Flatpak usa la 2.54.3 del [suo manifest](../development/versioning-and-releases.md#flatpak), in `/app`, senza la patch NVIDIA di Debian.

## Gli scorrevoli

WebKitGTK 2.54 non sempre compone lo scorrimento di un contenitore con
`overflow: auto`: per alcuni, che non sono un contesto di impilamento, a ogni
passo ridipinge la parte visibile, e lo scorrimento perde la frequenza dello
schermo appena la pagina pesa. Non dipende dal solo numero di discendenti
posizionati: l'indice della finestra di comando ne ha più di 500 e scorre
senza ridisegni, le impostazioni ne hanno meno e ridisegnavano tutto. Per
questo la correzione si dà contenitore per contenitore, misurata.

La correzione è `isolation: isolate` sullo scorrevole: lo fa diventare un
piano a sé senza cambiare l'aspetto. Non crea un blocco contenitore per i
discendenti `position: fixed` (lo farebbero `transform`, `contain: paint` o
`will-change: transform`, che li taglierebbero), e i livelli `z-index` di
dentro restano gli stessi fra loro. `will-change: scroll-position` e uno
sfondo opaco non bastano.

| Scorrevole | Dove | Ridisegni in 5 s, prima → dopo |
|---|---|---|
| Impostazioni (`.settings-scroll`) | pelle, `settings.css` | 16 544 → 1 037 |
| Albero dei file (`#sidebar`) | struttura | 1 465 → 34 |
| Risultati della ricerca (`#sidebar`) | struttura | 563 → 52 |

Gli altri scorrevoli misurati non hanno il difetto e restano come sono:
l'editor (`.cm-scroller`, già un piano per CodeMirror), la lettura
(`.pane-preview`), la Struttura e gli altri pannelli dell'ispettore,
l'indice delle impostazioni, il PDF e le sue miniature, la finestra di
comando (già isolata). Il foglio e la lavagna ridipingono per un'altra
ragione, che `isolation` non tocca: il foglio riscrive righe e stili a ogni
passo verticale, la lavagna sposta centinaia di schede con `transform`.

La misura: l'app vera, con vault, configurazione e cartelle XDG temporanei,
l'ispettore remoto di WebKit (`WEBKIT_INSPECTOR_HTTP_SERVER`) e la
`Timeline` per contare gli eventi `Paint`, mentre un `requestAnimationFrame`
sposta `scrollTop` per 5 s; la proprietà si prova sullo stesso elemento con
`style.setProperty`, prima e dopo nella stessa finestra. Chromium compone
ogni scorrevole e non vede il difetto: il banco visivo controlla l'aspetto,
non i ridisegni. Uno scorrevole nuovo e grande (un pannello, un elenco lungo)
si misura così prima di dargli la proprietà; il presidio
`src/theme/scrittoio/scorrevoli.test.ts` tiene quelli già corretti.

## Gli appunti senza proprietario

Quando la pagina legge i tipi degli appunti (`clipboardData.types` di un
`paste` nativo, cioè Ctrl+V in qualsiasi campo, CodeMirror compreso)
WebKitGTK li chiede nel processo dell'app con
`gtk_clipboard_request_targets`. Se la richiesta fallisce, per esempio su
X11 quando nessun programma possiede gli appunti (una sessione appena
aperta, o il programma che aveva copiato è stato chiuso), GTK 3 risponde
con i tipi `NULL` e il loro numero `-1`. WebKitGTK 2.54 non controlla il
segno e il processo dell'app muore di SIGSEGV: la finestra sparisce e il
log non scrive niente. Il processo web non c'entra, e nessun controllo in
JavaScript lo evita: il `paste` arriva, e muore il primo che ne legge i
tipi.

Come per il vblank, l'eseguibile `fub` esporta un suo
`gtk_clipboard_request_targets` (`main.rs`, `build.rs`), e la logica sta in
`appunti_gtk.rs`: chiama sempre quello di GTK (`dlsym(RTLD_NEXT)`), e della
risposta cambia solo il numero, che diventa 0 quando GTK dice che non ci
sono tipi. Per WebKit sono appunti vuoti: Ctrl+V non incolla niente e Fub
resta aperta. I tipi che ci sono passano come sono. Vale per ogni appunto
GTK del processo, selezione primaria compresa, e non ha interruttore né
intervallo di versioni, perché «0 tipi» è per ogni chiamante la stessa cosa
del fallimento.

La sonda: su uno schermo virtuale senza nessun proprietario degli appunti
(`xvfb-run`, `GDK_BACKEND=x11`), Ctrl+V in una nota, o in un `textarea`
qualsiasi della pagina, faceva morire la sessione WebDriver («Session
terminated without a reply», uscita 139); con la correzione la pagina
risponde e il `paste` vede `types` vuoto. Quando WebKitGTK controllerà il
numero negativo in una release, la sonda dirà se la correzione si può
togliere.

## Come si verifica

- La riga `WebKitGTK emulated vblank` dice se l'emulazione è attiva o
  perché no (`Spenta`, `VersioneFuori`, `VersioneIgnota`, `NonInterposta`);
  `WebKitGTK emulated vblank for CRTC` dice, quando WebKit crea il monitor,
  per quale CRTC e a che frequenza (`emulata_mhz`, 0 se resta il driver).
- La riga `GTK clipboard targets guard` dice con `interposta` se WebKit
  chiamerà il `gtk_clipboard_request_targets` di Fub.
- La riga `GTK frame clock at the monitor rate` dice se l'orologio di GTK
  allo schermo è acceso (`Attiva`, `Spenta`); `…: first frame` dice, per
  ogni finestra, il primo intervallo scritto (`mhz`, `intervallo_us`), cioè
  che la finestra disegna con GL; `…: not needed here` che GTK o il backend
  non sono quelli coperti, `…: unknown GdkFrameTimings layout, off` che la
  verifica col getter non è passata.

- La riga del log `rendering path chosen before GTK` dice che cosa è stato
  scelto.
- La riga `WebKitGTK 60 fps preference` dice se la feature è stata trovata e
  applicata.
- `webkit://gpu` in una finestra di WebKitGTK mostra renderer, DMABuf e
  vblank. Con il driver disallineato il renderer è llvmpipe. «VBlank type:
  Timer» e «60Hz» vogliono dire il tetto dei 60 Hz; «DRM» con la frequenza
  del monitor vuol dire che la pagina può seguire lo schermo. La pagina
  descrive il monitor dove sta la finestra di prova: con più schermi va
  spostata su quello veloce.
- I test unitari di `disegno.rs` coprono la tabella con `/proc` e `/sys`
  finti: driver disallineato, 550, 555, 560, nessuna GPU, VM, portatile
  ibrido e variabili dell'utente.
