# 0246 — Fub emula il vblank che il driver non dà a WebKitGTK

- **Stato:** accolta
- **Data:** 2026-11-17
- **Ambito:** host
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

In WebKitGTK il ritmo della pagina (rAF, aggiornamenti di rendering,
animazioni composte) lo dà un *display link* nel processo dell'app. Su GTK
ha due sorgenti: `drmWaitVBlank` sul nodo primario della scheda, o un timer
fisso a 60 Hz se il DRM fallisce
([desktop-webview](../architecture/desktop-webview.md#il-tetto-dei-60-hz-di-webkitgtk)).
`nvidia-drm` risponde `EOPNOTSUPP` a `drmWaitVBlank` su ogni CRTC (550 e
595 provati), quindi su ogni NVIDIA la pagina va a 62,5 Hz anche su uno
schermo a 180 Hz, non agganciata allo schermo. La modalità del CRTC invece
si legge (`drmModeGetCrtc`): il driver sa la frequenza, non dà l'attesa.

La correzione vera sta in WebKit (PR 78603: il timer alla frequenza del
monitor GTK, con scadenze assolute), aperta e non in una release. Il
maintainer vuole Fub alla frequenza piena dello schermo su ogni distro
Linux, adesso. Una prova con una libreria in `LD_PRELOAD` che emula
`drmWaitVBlank` ha portato il rAF a 180 Hz sullo schermo veloce
([misure](../misure/2026-11-17-linux-webkitgtk-tetto-60hz.md)).

## Decisione

L'eseguibile `fub`, solo su Linux, esporta un suo `drmWaitVBlank`
(`crates/fub-app/src/main.rs`, `src/vblank.rs`), e il linker dinamico lo dà
a WebKit al posto di quello di libdrm. Nella tabella dei simboli dinamici lo
mette GNU ld, perché `libwebkit2gtk-4.1` è collegata e lo usa, e il build
script lo chiede in modo esplicito (`-Wl,--export-dynamic-symbol`) per i
linker dove non succede. Le regole:

- chiama sempre prima il vero (`dlsym(RTLD_NEXT)`); emula solo se fallisce
  con `EOPNOTSUPP`, e lo ricorda per (scheda, CRTC);
- emula solo le richieste che WebKitGTK fa (relative o assolute, con i bit
  del CRTC); evento, segnale, flip e `NEXTONMISS` passano al vero;
- la frequenza è quella della modalità del CRTC, riletta ogni secondo; le
  scadenze sono assolute su `CLOCK_MONOTONIC`; la risposta ha contatore e
  tempo come quella del kernel;
- fuori da 24–500 Hz, con il CRTC spento o con un'attesa oltre 3 s risponde
  come il driver: il comportamento di prima;
- `FUB_VBLANK_EMULATO=0` la spegne; è accesa solo per le WebKitGTK
  dell'intervallo di `vblank::WEBKITGTK_DA` / `WEBKITGTK_FINO_A` (dalla
  2.54.0, aperto in alto), letto dalla libreria caricata;
- il log d'avvio dice se è attiva e perché (`WebKitGTK emulated vblank`), e
  per ogni CRTC la frequenza emulata (`WebKitGTK emulated vblank for
  CRTC`).

Si toglie quando una WebKitGTK con la PR 78603 è in una release verificata
su NVIDIA: si scrive quella versione in `WEBKITGTK_FINO_A`, e quando nessuna
distro supportata ha più una WebKitGTK precedente si cancellano il modulo, la
funzione in `main.rs` e la riga del build script.

## Conseguenze

### Positive

- Su NVIDIA la pagina segue lo schermo veloce: rAF, scorrimento e
  animazioni non hanno più il tetto dei 62,5 Hz.
- Dove il DRM funziona (AMD, Intel) non cambia niente: il vero risponde e la
  risposta passa com'è.
- Spegnerla è una variabile, toglierla è un limite di versione.

### Negative

- Ogni libreria del processo dell'app che chiama `drmWaitVBlank` riceve
  quella di Fub, non solo WebKit. Il vero viene chiamato sempre prima, quindi
  cambia qualcosa solo dove il driver non supporta l'attesa: lì chi chiama
  riceve un vblank emulato invece di un errore.
- Il vblank emulato non è in fase con quello vero: il rAF ha la frequenza
  dello schermo, non il suo istante. Lo stesso vale per il timer della PR
  78603.
- Dipende dalla disposizione in memoria di `drmVBlank`, `drmModeRes`,
  `drmModeCrtc` e `drmModeModeInfo` di libdrm, stabile da anni; un test la
  tiene contro i `sizeof` misurati in C.
- Su X11 la via di WebKit è la stessa (stessa funzione, stesso monitor GTK)
  ma non è misurata.

## Alternative scartate

### Aspettare la PR 78603

È la correzione giusta, ma è aperta, e dopo il merge arriva alle distro
stabili con mesi o anni di ritardo: Debian 13 resterà sulla 2.54 per tutto
il suo ciclo, salvo aggiornamenti di sicurezza.

### Una libreria in `LD_PRELOAD`

È la prova delle misure. Nel prodotto vorrebbe un lanciatore che scrive
l'ambiente e un file in più da installare per ogni pacchetto (deb, rpm,
AppImage, Flatpak), e si trascinerebbe nei processi figli. Il simbolo
esportato dall'eseguibile vale solo per il processo dell'app.

### Le variabili di WebKit

`WEBKIT_FORCE_VBLANK_TIMER` forza il timer, `WEBKIT_DISPLAY_REFRESH_THROTTLE_FPS`
può solo abbassare la frequenza: nessuna alza il tetto.

### Un `drmWaitVBlank` che emula sempre

Più semplice, ma toglierebbe il vblank vero (in fase) dove il driver lo dà.

## Verifica

- `crates/fub-app/src/vblank.rs`: test della scelta emula/passa, delle
  richieste coperte, della frequenza della modalità, dei limiti, della
  griglia senza deriva, del contatore a 32 bit, della risposta, delle
  versioni e dell'interruttore.
- `crates/fub-app/tests/vblank_esportato.rs`: l'eseguibile esporta
  `drmWaitVBlank` e nessun'altra funzione. Guarda il risultato, non la
  riga del build script: con GNU ld resta verde anche senza.
- Dal vivo: `webkit://gpu` o il log d'avvio; le misure in
  [Il vblank emulato su NVIDIA](../misure/2026-11-17-linux-vblank-emulato.md).
