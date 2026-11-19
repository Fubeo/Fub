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
