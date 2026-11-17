# La webview del desktop su Linux

> **Domanda:** come sceglie Fub il percorso di disegno di WebKitGTK, che cosa
> dice all'utente quando il driver è un problema e come la pagina supera i
> 60 Hz dove WebKit lo permette?
> **Fonti autorevoli:** `crates/fub-app/src/disegno.rs`,
> `crates/fub-app/src/frame_rate.rs`, `crates/fub-app/src/lib.rs` (`run`),
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
| `auto` | ogni altro caso | nessuna | nessuno |
| `gpu` | qualunque | nessuna | solo quello del driver disallineato |
| `cpu` | qualunque | `WEBKIT_SKIA_ENABLE_CPU_RENDERING=1` | solo quello del driver disallineato |

`auto` non scrive mai variabili, e la ragione sono le misure fatte su
Debian 13, niri, RTX 4070 e WebKitGTK 2.54:

- col disegno software Skia CPU è pari al default a PC scarico e peggiore
  sotto carico;
- sotto NVIDIA < 555 su Wayland Skia CPU dà più fotogrammi, ma lo
  sfarfallio resta: per questo Fub lo propone e non lo fa da solo;
- per NVIDIA ≥ 555 senza sincronizzazione esplicita del compositor
  (`__NV_DISABLE_EXPLICIT_SYNC`) e per le VM senza 3D non ci sono misure, e
  senza misure non si cambia il percorso.

Fub **non scrive mai** `WEBKIT_DISABLE_DMABUF_RENDERER` né
`WEBKIT_DISABLE_COMPOSITING_MODE`: sono le varianti peggiori in ogni gesto
misurato. Le variabili che l'utente ha già messo vincono sempre: con
`WEBKIT_DISABLE_DMABUF_RENDERER`, `WEBKIT_SKIA_ENABLE_CPU_RENDERING`,
`WEBKIT_DISABLE_COMPOSITING_MODE`, `WEBKIT_DMABUF_RENDERER_FORCE_SHM`,
`__NV_DISABLE_EXPLICIT_SYNC` o `GDK_BACKEND` nell'ambiente Fub non propone
niente, e `cpu` non tocca una `WEBKIT_SKIA_ENABLE_CPU_RENDERING` già messa.

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

Fub non ha una leva sicura per alzare il tetto:

- `WEBKIT_FORCE_VBLANK_TIMER` può solo forzare il timer;
- `WEBKIT_DISPLAY_REFRESH_THROTTLE_FPS` può solo abbassare la frequenza, e
  deve esserne un divisore;
- fra le 538 feature di `webkit_settings_get_all_features` nessun'altra
  tocca il display link;
- `WEBKIT_DISABLE_DMABUF_RENDERER`, `WEBKIT_DISABLE_COMPOSITING_MODE` e X11
  non cambiano la sorgente.

La correzione sta in WebKit: la
[PR 78603](https://github.com/WebKit/WebKit/pull/78603) fa andare il timer
alla frequenza del monitor GTK, con scadenze assolute. Le misure e la prova
con una sorgente di vblank emulata stanno in
[Il tetto dei 60 Hz su NVIDIA](../misure/2026-11-17-linux-webkitgtk-tetto-60hz.md).

## Come si verifica

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
