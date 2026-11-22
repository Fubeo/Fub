# Disegni, tasti del motore

> **Per chi:** chi disegna nello spazio Completo e usa i comandi del motore
> con la tastiera.
> **Risultato:** sapere quale tasto fa partire un comando, chi vince quando due
> tasti coincidono, e quando un tasto non parte.

Col Completo aperto, ogni comando del motore che ha un tasto lo fa partire con
quel tasto. Vale questo ordine:

- **Vincono i tasti di Fub**: quelli della shell (come `Ctrl+P`, `Ctrl+K`,
  `Ctrl+W`, `Ctrl+Tab`) e quelli dell'editor (`Ctrl+Z`, `Ctrl+C`, `Ctrl+D`,
  `Ctrl+G` e gli altri che si leggono in «?»). Il comando del motore che ne
  avrebbe uno resta senza tasto.
- **Due comandi del motore con lo stesso tasto**: vince l'ultimo assegnato, e
  l'altro resta senza tasto.
- **Un comando con parametri** apre la sua finestra; **gli altri girano
  subito**. Se la parte del disegno che li fa non è ancora arrivata, il comando
  aspetta e lo dice, e parte appena è pronta.

Un tasto **non parte** mentre si scrive: in un campo di testo, mentre un IME
compone, e con una lettera, una cifra o un segno quando lo strumento vuole il
testo. Un tasto con `Ctrl`, `⌘` o `Alt` parte anche allora.

Un tasto con `Maiusc` su un segno o una cifra non si assegna, perché su
un'altra tastiera è un altro tasto. Su macOS `Ctrl` e `⌘` restano quelli di
sempre: `⌘` è il tasto di Fub, `Ctrl` è Control.

Il menu ≡ e «Ctrl+/» mostrano il tasto che fa partire il comando, cioè lo
stesso di questa regola: un comando il cui tasto è di Fub, o che ha perso un
conflitto, non ne mostra nessuno. Finché l'indice dei comandi non è arrivato,
nessun tasto è mostrato. «Impostazioni › Scorciatoie» non cambia ancora questi
tasti.
