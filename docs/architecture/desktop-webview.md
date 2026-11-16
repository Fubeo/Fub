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

Conta solo dove WebKit si aggancia al vblank DRM del kernel. Dove il vblank
non risponde (`nvidia-drm` 550, e sotto Xvfb) WebKit ripiega su un timer
fisso a 60 Hz e il tetto resta quello.

## Come si verifica

- La riga del log `rendering path chosen before GTK` dice che cosa è stato
  scelto.
- La riga `WebKitGTK 60 fps preference` dice se la feature è stata trovata e
  applicata.
- `webkit://gpu` in una finestra di WebKitGTK mostra renderer, DMABuf e
  vblank. Con il driver disallineato il renderer è llvmpipe.
- I test unitari di `disegno.rs` coprono la tabella con `/proc` e `/sys`
  finti: driver disallineato, 550, 555, 560, nessuna GPU, VM, portatile
  ibrido e variabili dell'utente.
