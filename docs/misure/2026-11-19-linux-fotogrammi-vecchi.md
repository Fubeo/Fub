# I fotogrammi vecchi di WebKitGTK 2.54

Perché WebKitGTK 2.54.0 e 2.54.1, alla fine di un'animazione, rimettono per
un fotogramma lo strato com'era prima, e quale versione lo corregge.

> **Per chi:** chi lavora sulla WebView di Linux e sul Flatpak.
> **Risultato:** è il compositore Skia di WebKitGTK, corretto dalla 2.54.2.
> Sotto Xvfb, in 15 s, la 2.54.0 e la 2.54.1 hanno 20 fotogrammi fuori
> posto; la 2.54.3 del Flatpak nessuno.

Che cosa fa Fub, nella versione nativa e nel Flatpak, sta in
[La webview del desktop su Linux](../architecture/desktop-webview.md#i-fotogrammi-vecchi-dopo-unanimazione).

## Il difetto

Alla fine di una transizione o di un'animazione CSS accelerata (opacità,
trasformazione, filtro), WebKitGTK 2.54.0 e 2.54.1 mostrano per un
fotogramma lo strato com'era prima dell'animazione: un velo che sparisce e
torna, un menu che ricompare pieno mentre svanisce, la pagina che torna per
un istante alla luce di prima. Succede su ogni GPU e anche col disegno su
CPU, perché sta nel compositore del processo web, non nel trasporto dei
fotogrammi.

## La causa

Il compositore Skia è il default dalla 2.53 (prima era TextureMapper). In
`SkiaCompositingLayer` opacità, trasformazione e filtro prendono il valore
dell'animazione solo finché l'animazione corre: nel fotogramma fra la fine
dell'animazione e il commit che la toglie dallo strato, il compositore torna
al valore dello strato, che è ancora quello di prima. TextureMapper invece
tiene l'ultimo valore dell'animazione.

Lo corregge il commit
[4af7b773e279](https://github.com/WebKit/WebKit/commit/4af7b773e279f8908b804e342c74ffe11139c1f1)
(«Take the last animation value after animation ended»,
[bug 321993](https://bugs.webkit.org/show_bug.cgi?id=321993)), portato sul
ramo 2.54 come `2d883a0c1598` e quindi presente dalla **2.54.2**. Le
segnalazioni a monte sono i bug
[327524](https://bugs.webkit.org/show_bug.cgi?id=327524) e
[326841](https://bugs.webkit.org/show_bug.cgi?id=326841), ancora aperti; lì
chi lo vede usa `WEBKIT_USE_SKIA_FOR_COMPOSITION=0`, che torna a
TextureMapper.

## La misura

- 19 novembre 2026, misura di un agente sul PC fisso del maintainer, sotto
  Xvfb;
- macchina: Intel Core i5-13600KF, 20 thread, 31 GiB, NVIDIA RTX 4070;
  Debian 13; la finestra di prova sta sullo schermo virtuale di Xvfb, non su
  quelli veri;
- la 2.54.3 è costruita dal manifest del Flatpak con
  `webkitgtk-2.54.3.tar.xz` (sha256 `2779c1b4…7d0862`); la pagina di prova
  non usa codice di Fub, quindi nessun commit di Fub conta per la misura;
- una WebView GTK3 che legge tre pixel della finestra a ogni fotogramma, su
  una pagina di prova che ripete un suggerimento in dissolvenza e un velo da
  dialogo; Fub non c'entra.

| WebKitGTK | Durata | Fotogrammi fuori posto |
|---|---|---|
| 2.54.0 di Debian | 15 s | 20 |
| 2.54.1 del runtime GNOME 51 | 15 s | 20 |
| 2.54.1 con `WEBKIT_USE_SKIA_FOR_COMPOSITION=0` | 15 s | 0 |
| 2.54.3 costruita nel manifest del Flatpak | 15 s e 30 s | 0 |
