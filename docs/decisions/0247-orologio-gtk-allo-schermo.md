# 0247 — Fub porta l'orologio di GTK3 alla frequenza dello schermo nel modo GL

- **Stato:** accolta
- **Data:** 2026-11-19
- **Ambito:** host
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

Con il vblank emulato ([ADR 0246](0246-vblank-emulato-per-webkitgtk.md)) il
rAF della pagina arriva a 180 Hz su NVIDIA, ma i fotogrammi presentati no:
60 al secondo esatti nel Flatpak, 42–58 nella versione di Debian. Il
maintainer sente l'app lenta sempre, e su Windows (WebView2, stesso client)
è fluida.

La causa sta in GTK3. Il processo dell'app ridisegna la webview a ogni giro
dell'orologio dei fotogrammi (`GdkFrameClock`), e GTK3 fa il giro successivo
dopo l'intervallo di refresh scritto nei tempi del fotogramma precedente.
Sotto Wayland quell'intervallo lo scrive solo il frame callback che GTK
chiede quando fa lui il commit. Quando la finestra disegna con GL (i
fotogrammi DMA-BUF di WebKit restano sulla scheda) il commit lo fa
`eglSwapBuffers`: GTK non chiede il frame callback, l'intervallo resta 0 e
GTK usa il suo valore di riserva, 16 667 µs. La sonda (una WebView GTK3
nuda) lo mostra: 60,0 fotogrammi al secondo con WebKitGTK 2.54.0 e 2.54.3,
e 172–180 appena l'intervallo vale quello dello schermo
([misure](../misure/2026-11-19-linux-ritmo-schermo.md)).

GTK3 non ha un'API per scrivere l'intervallo, e il campo è privato
(`struct _GdkFrameTimings`). GTK3 è in manutenzione: una correzione a monte
arriverebbe, se arriva, solo nelle distro future.

## Decisione

Dopo ogni disegno di una finestra (`after-paint` del suo orologio) Fub
scrive nel campo `refresh_interval` dei tempi del fotogramma corrente il
periodo dello schermo dove sta la finestra, se il campo è ancora 0
(`crates/fub-app/src/orologio.rs`). Le regole:

- solo GTK 3 dalla 3.24.21, la prima con la disposizione che il codice
  rispecchia (`TempiGtk3`), e solo sotto Wayland;
- si scrive solo se il getter pubblico
  (`gdk_frame_timings_get_refresh_interval`) e il campo dicono 0 tutti e due;
  dopo la scrittura il getter deve leggere il valore scritto, se no il campo
  torna 0 e la correzione si spegne per tutto il processo, con una riga nel
  log;
- il periodo è `10^9 / gdk_monitor_get_refresh_rate` come lo calcola GTK,
  solo fra 24 e 500 Hz, riletto a ogni fotogramma: una finestra spostata
  sullo schermo a 60 Hz torna a 60;
- `FUB_OROLOGIO_GTK=0` la spegne; il log d'avvio dice se è accesa, e ogni
  finestra scrive il primo intervallo.

Perché la versione di Debian prenda il modo GL, con NVIDIA dal 555 sotto
Wayland `disegno.rs` scrive `WEBKIT_FORCE_DMABUF_RENDERER=1`, che salta la
patch NVIDIA di Debian
([desktop-webview](../architecture/desktop-webview.md#la-tabella-dei-casi)).

Si toglie quando nessuna distro supportata ha più una GTK3 senza la
correzione a monte, o quando Fub passa a GTK4, che non ha il problema.

## Conseguenze

### Positive

- Una pagina che anima va vicino alla frequenza dello schermo: in Fub
  167–177 fotogrammi al secondo con la WebKitGTK di Debian, 156–161 con
  quella del Flatpak, su uno schermo a 180 Hz.
- Dove GTK disegna da sé (memoria condivisa, altri driver) il frame callback
  arriva dopo e riscrive lo stesso valore: niente cambia.
- Spegnerla è una variabile; la verifica col getter la spegne da sola su una
  GTK con un'altra disposizione.

### Negative

- Fub scrive un campo privato di GTK. La disposizione è stabile dalla
  3.24.21 (2020) e un test la confronta con il getter della GTK della
  macchina, ma una GTK3 futura potrebbe cambiarla: allora la verifica la
  spegne e il ritmo torna a 60.
- Nel modo GL l'orologio di GTK non è in fase con lo schermo: va a tempo,
  non sul frame callback. Un fotogramma ogni tanto può arrivare tardi di un
  periodo; a 180 Hz è 5,6 ms.
- La pagina che anima disegna tre volte più spesso: più lavoro della scheda
  e del processore mentre anima, niente a riposo (l'orologio gira solo
  quando c'è da disegnare).

## Alternative scartate

### Interporre una funzione di GTK

Come per `drmWaitVBlank`: ma `libgdk-3` chiama
`gdk_frame_clock_get_refresh_info` e le sue funzioni interne senza passare
dalla PLT (nessuna rilocazione), quindi un simbolo esportato da `fub` non le
sostituisce.

### Una GTK3 corretta nel Flatpak

Correggerebbe solo il Flatpak, con una GTK da mantenere; la versione nativa
resterebbe a 60.

### Restare in memoria condivisa

Sulla versione di Debian il modo GL arriva solo con
`WEBKIT_FORCE_DMABUF_RENDERER`; senza, ogni fotogramma è letto dalla scheda
e copiato (4266 × 2400 pixel per una finestra a tutto schermo a scala 2), e
la pagina resta a 42–58 fotogrammi al secondo anche con un orologio giusto.

## Verifica

- `crates/fub-app/src/orologio.rs`: la posizione del campo, il getter vero
  di GTK sulla struttura che il codice rispecchia, nessuna riscrittura di un
  campo già pieno, il ritorno a 0 con un'altra disposizione, il periodo, le
  versioni e l'interruttore.
- `crates/fub-app/src/disegno.rs`: quando si scrive
  `WEBKIT_FORCE_DMABUF_RENDERER=1` e quando no.
- Dal vivo: il log (`GTK frame clock at the monitor rate`) e le misure in
  [Il ritmo dello schermo su NVIDIA](../misure/2026-11-19-linux-ritmo-schermo.md).
