# Il ritmo dello schermo su NVIDIA

Perché la pagina di Fub non superava i 60 fotogrammi al secondo su uno
schermo a 180 Hz anche col vblank emulato, e che cosa cambia con l'orologio
di GTK allo schermo ([ADR 0249](../decisions/0249-orologio-gtk-allo-schermo.md)).

> **Per chi:** chi lavora sulla fluidità su Linux.
> **Risultato:** il tetto non era di WebKit né del compositore: è
> l'orologio dei fotogrammi di GTK3, che nel modo GL va a 60 fissi. Con
> l'intervallo dello schermo scritto da Fub e i fotogrammi sulla scheda,
> la pagina di Fub che anima passa da 34–53 a 167–177 fotogrammi al secondo
> nella versione nativa (WebKitGTK 2.54.0 di Debian) e da 60 a 156–161 nel
> Flatpak (2.54.3). Su uno schermo a 60 Hz resta a 60.

Il meccanismo sta in
[La webview del desktop su Linux](../architecture/desktop-webview.md#lorologio-di-gtk3-nel-modo-gl).

## Macchina e sistema

- 19 novembre 2026, misura di un agente, mentre il maintainer usava il PC;
- Intel Core i5-13600KF, 20 thread, 31 GiB, NVIDIA RTX 4070, modulo aperto
  595.112.07;
- LG ULTRAGEAR (DP-2), 2560 × 1440 a 179,96 Hz, scala 1,2 (GTK3 disegna a
  scala 2); BenQ ZOWIE (DP-3), 1920 × 1080 a 60 Hz, ruotato;
- Debian 13, niri su Wayland, GTK 3.24.49; WebKitGTK 2.54.0
  (2.54.0-1~deb13u3, con la patch NVIDIA di Debian) e 2.54.3 (costruita nel
  manifest del Flatpak, senza la patch), runtime GNOME 51;
- carico: altre build sulla macchina, carico medio a un minuto fra 4 e 42
  (colonna «carico»).

## Il metodo

- **La sonda**: una WebView GTK3 nuda, una finestra di 900 × 600 messa da
  niri in una colonna di 1049 × 1177. La pagina sposta un riquadro a ogni
  rAF (`transform`); si contano per 5 s i rAF della pagina e i disegni della
  WebView nel processo dell'app (`draw`), che coincidono entro uno.
  Nativa con la WebKitGTK di Debian, o dentro la sandbox del Flatpak di
  prova con la 2.54.3. Il vblank emulato viene dalla libreria della prova
  del 17 novembre in `LD_PRELOAD`, come Fub lo ha di serie. «Orologio» è la
  scrittura dell'intervallo, fatta nella sonda come la fa `orologio.rs`.
- **L'app**: Fub con vault, configurazione e cartelle XDG temporanei e
  l'ispettore remoto; la finestra si sposta su DP-2. Si misurano il rAF a
  vuoto (3 s) e il rAF che sposta un riquadro (5 s).
- I commit Wayland si contano con `WAYLAND_DEBUG=client` solo dove
  serve vedere la sequenza: il registro rallenta il processo.

## Dove si ferma, sulla sonda

Fotogrammi al secondo, un valore per giro, su DP-2.

| WebKitGTK | trasporto | orologio | fotogrammi/s | rAF mediano | carico |
|---|---|---|---|---|---|
| 2.54.0 | memoria condivisa (di serie su Debian) | GTK | 41,8 / 42,0 | 23 ms | 16 / 19 |
| 2.54.0 | memoria condivisa, composizione TextureMapper | GTK | 48,6 / 48,4 | 20 ms | 16 / 20 |
| 2.54.0 | scheda (`WEBKIT_FORCE_DMABUF_RENDERER=1`) | GTK | 60,0 / 60,0 | 17 ms | 18 / 24 |
| 2.54.0 | scheda | **allo schermo** | **178,1 / 178,2** | 6 ms | 18 / 25 |
| 2.54.0 | scheda, composizione TextureMapper | allo schermo | 178,2 / 150,5 | 5–6 ms | 18 / 26 |
| 2.54.3 | scheda (di serie nel Flatpak) | GTK | 60,0 / 60,0 | 17 ms | 19 / 42 |
| 2.54.3 | scheda | **allo schermo** | **171,8 / 106,8** | 6 ms | 18 / 42 |

Il secondo giro della 2.54.3 con l'orologio allo schermo aveva carico 42;
un giro a parte, a carico 18, ha dato 179,9. Su DP-3 (60 Hz)
ogni riga vale 60,0 (59,8 una volta), con e senza l'orologio.

Una finestra GTK3 senza WebKit, che ridisegna tutta la sua area col
processore a ogni giro, arriva a 88 fotogrammi al secondo: il frame
callback di niri arriva 4–5 ms dopo il commit, e il resto è il disegno di
4,9 milioni di pixel. Niri non è il tetto.

## Fub, prima e dopo

Il rAF che sposta un riquadro, in fotogrammi al secondo, due giri alternati
su DP-2. «Prima» nella versione nativa è il binario nuovo con
`FUB_OROLOGIO_GTK=0` e `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1`, cioè quello che
faceva `main`; nel Flatpak è il Fub del pacchetto di prova (WebKitGTK
2.54.3). Il rAF a vuoto vale 178–180 in ogni riga: il vblank emulato
c'era già.

| Fub | trasporto | orologio | fotogrammi/s | rAF mediano | carico |
|---|---|---|---|---|---|
| nativo, prima | memoria condivisa | GTK | 34,2 / 52,9 | 29 / 18 ms | 12 / 11 |
| nativo | scheda | GTK (`FUB_OROLOGIO_GTK=0`) | 60,3 / 60,4 | 17 ms | 25 / 7 |
| **nativo, dopo** | scheda | **allo schermo** | **177,4 / 166,7** | 6 ms | 19 / 4 |
| Flatpak, prima | scheda | GTK | 60,3 / 60,2 | 17 ms | 10 / 14 |
| Flatpak, binario nuovo | scheda | GTK (`FUB_OROLOGIO_GTK=0`) | 60,3 / 60,4 | 17 ms | 11 / 19 |
| **Flatpak, dopo** | scheda | **allo schermo** | **161,2 / 155,8** | 6 ms | 6 / 21 |

Il registro d'avvio della versione dopo dice `GTK frame clock at the
monitor rate: first frame mhz=179960 intervallo_us=5556` quando la finestra
nasce su DP-2, e `mhz=60000 intervallo_us=16666` quando nasce su DP-3 e poi
si sposta (l'intervallo si rilegge a ogni fotogramma).

Su DP-3 (60 Hz), un giro per riga: nativo prima 60,5, nativo dopo 60,3,
Flatpak prima 60,0, Flatpak dopo 60,0. Nessuna regressione.

Il binario nuovo nel Flatpak resta sotto la sonda (156–161 contro 172–180)
perché la pagina di Fub è più pesante della sonda; il tetto dei 60 non c'è
più.

## La superficie di GTK3

Dopo l'orologio, Fub nel Flatpak sembrava ancora lento a chi lo usa: il
thread principale dell'app stava al 55–80% di un core. Misurato la sera del
19 novembre sul Fub del Flatpak installato (WebKitGTK 2.54.3) e sul binario
con `GDK_RENDERING=recording`, nella stessa sandbox, finestra a tutto schermo
su DP-2 (2560 × 1440, GTK3 a scala 2), configurazione e vault temporanei.

- **Il metodo**: una libreria in `LD_PRELOAD` conta i `wl_surface.commit`
  dell'app e misura `gdk_cairo_draw_from_gl`; un campionatore sul tempo di
  processore del thread principale (`timer_create`, `backtrace`) dice in
  quale libreria va il tempo. La CPU dei thread e i page fault si leggono da
  `/proc`. I gesti si fanno dall'ispettore remoto, 5 s l'uno: «anima» sposta
  un riquadro a ogni rAF, «scorri» fa scorrere una nota di 5000 righe,
  «lavagna» sposta una lavagna di 300 schede, «fermo» è l'app senza gesti
  30 s dopo l'avvio, con e senza la nota aperta.
- **Dove va il tempo, prima**: nel campionatore il 54% del tempo proprio
  del thread principale è in pixman (riempire pixel) e il 22% in
  `memset`/`memcpy` di libc, sotto il disegno della finestra di gdk e cairo
  (77–90% inclusivo). `gdk_cairo_draw_from_gl` costa 0,06–0,12 ms: nessuna
  lettura dalla scheda.

Thread principale (CPU di un core e page fault al secondo) e fotogrammi al
secondo della pagina; un giro per colonna, carico medio fra 7 e 18:

| gesto | Flatpak prima | Flatpak dopo | nativo prima (`similar`) | nativo dopo |
|---|---|---|---|---|
| fermo | 29%, 213 000 fault/s | 1–6%, 0–24 fault/s | 26%, 161 000 fault/s | 3%, 0 fault/s |
| anima | 105,5 fps, 98% (kernel 79) | 172–174 fps, 17–18% | 103,5 fps, 97% | 175,5 fps, 11% |
| scorri | 133 fps, 78% | 131–151 fps, 12–14% | 104,7 fps, 74% | 154,6 fps, 11% |
| fermo, nota aperta | 46%, 185 000 fault/s | 5% | 29% | 7% |
| lavagna | 31 fps, 45% | 30–33 fps, 3–6% | 67,7 fps, 49% | 92,9 fps, 6% |

- **Il nostro orologio non c'entra**: con `FUB_OROLOGIO_GTK=0` e la
  superficie di prima il thread principale sta al 37% da fermo (227 000
  fault/s) e all'86% con la pagina che anima, a 60 fotogrammi; con la
  superficie che registra, 2% e 19%.
- **La lavagna dipende dal processo web**: 103–122% di CPU nel processo web
  in ogni variante, e il thread principale dell'app è libero dopo la
  correzione. È un costo della pagina, a parte.
- Le foto della nota e della lavagna con la superficie che registra sono
  uguali a quelle di prima.

### Fub fermo

Con Fub fermo GTK manda al compositore 17–21 finestre al secondo, 36–37 con
una nota aperta, mentre la pagina compone 2–4 volte al secondo (Timeline
dell'ispettore). Ogni ridisegno di GTK viene da WebKit (pila di
`gtk_widget_queue_draw`: un fotogramma nuovo dal processo web). Nel tempo
non sono continui: dopo ogni gesto, o il ridimensionamento all'avvio, c'è
una raffica a 60 al secondo lunga circa 3 s, poi solo il cursore (1,6 al
secondo, ogni 606 ms).

| prova, nota aperta e ferma | commit/s | thread principale |
|---|---|---|
| Flatpak prima | 35–37 | 28–51% |
| dopo, con o senza `FUB_OROLOGIO_GTK=0` o `FUB_VBLANK_EMULATO=0` | 35–37 | 5–8% |
| dopo, `GTK_OVERLAY_SCROLLING=0` | 1,6 | 0–1% |

- Né l'orologio né il vblank emulato tengono acceso l'orologio di GTK: le
  raffiche restano uguali senza.
- Nessuna animazione CSS sempre accesa e nessun rAF che si richiama: in 3 s
  di riposo nessuna mutazione del DOM e nessun evento di transizione o
  animazione. L'animazione `cm-blink` di zero ms del cursore fermo, tolta,
  non cambia i commit (37 al secondo).
- Le raffiche sono le barre di scorrimento sovrapposte di WebKitGTK che
  sfumano: senza (`GTK_OVERLAY_SCROLLING=0`) restano solo i giri del
  cursore. Senza barre sovrapposte la barra si vede sempre e la colonna
  della nota si sposta di circa 10 px: non è una scelta di questa misura.

### Il costo della pagina

Binario dopo, Timeline dell'ispettore durante il gesto (5 s), carico 13–14:

| gesto | fps | thread principale | processo web | ridisegni della pagina |
|---|---|---|---|---|
| scorri la nota | 162 | 31% | 33% (56% tutti i thread) | 160 `Paint`, 15 500 `InvalidateLayout` |
| scorri le impostazioni | 172 | 25% | 39% (53%) | 16 600 `Paint`, 14 500 su tutta la parte visibile (910 × 589) |
| trascina il grafo | 180 | 18% | 20% (29%) | nessuno: è un canvas |
| sposta la lavagna | 112 | 17% | 46% (89%) | 4 800 `Paint`, 560 `Layout` |

Lo scorrevole delle impostazioni (`.settings-scroll`) non è un contesto di
impilamento, e WebKitGTK lo ridipinge tutto a ogni passo invece di
spostarne i livelli. Con `isolation: isolate` sullo scorrevole (o
`transform: translateZ(0)`) i `Paint` scendono da 16 600 a 1 150 e l'area
ridipinta da 8,1 a 0,25 Gpx in 5 s, a 178 fps. La nota non ha questo costo.
Nessun `backdrop-filter`, `filter` o ombra grande compare nei ridisegni.

## Che cosa dicono

- **Il vblank emulato funziona e segue lo schermo.** Il registro d'avvio di
  Fub crea il monitor per il CRTC di DP-3 (60 Hz) quando la finestra si apre
  lì, e poi quello di DP-2 (179,96 Hz) quando la si sposta; il rAF a vuoto
  va a 178. Non aggancia il CRTC sbagliato.
- **Nel modo GL l'orologio di GTK3 va a 60.** Con i fotogrammi sulla
  scheda la finestra disegna con EGL. Il registro di Wayland mostra un
  commit ogni 16,6 ms, ognuno con il frame callback e la `wl_display.sync`
  di EGL, e nessun frame callback di GTK: i tempi dei fotogrammi restano
  senza intervallo, e GTK usa i suoi 16 667 µs. I due `wl_callback.done`
  per commit delle misure del 17 novembre sono questi due, letti insieme al
  commit successivo. Con l'intervallo dello schermo nei tempi la stessa
  finestra va a 178.
- **In memoria condivisa comanda la copia.** Ogni fotogramma è letto dalla
  scheda e ricopiato: 42–58 fotogrammi al secondo, con il rAF che aspetta
  il fotogramma prima. L'orologio lì è già giusto (GTK fa da sé il commit e
  il frame callback), e non cambia niente.
- **La composizione di TextureMapper non abbassa il ritmo.** Il ripiego per
  i fotogrammi vecchi della 2.54.0 e 2.54.1
  (`WEBKIT_USE_SKIA_FOR_COMPOSITION=0`) dà 48 invece di 42 in memoria
  condivisa e 178 sulla scheda.
