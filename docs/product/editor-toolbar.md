# La barra di formato

> **Per chi:** chi scrive nelle note e chi aggiunge un comando o un gruppo
> alla barra di formato.
> **Risultato:** sapere che cosa mostra la barra sopra il foglio, come segue
> il blocco del cursore e come si sceglie la sua forma.

## La barra che segue il blocco

Sopra il foglio, in Scrittura e in Sorgente, la barra di formato dice dove
sta il cursore. Nella forma compatta, di serie, tiene poche cose fisse:
annulla e ripeti; lo stile del blocco, che lo dice a parole («Testo»,
«Titolo 2», «Compito») e apre «Trasforma in» (Testo, Titolo 2 e 3,
Citazione, Elenco puntato, Elenco di attività, e «Altri titoli ▸»);
grassetto, corsivo, link, elenco e compito; i comandi che un plugin mette
nella barra. A destra «+ Inserisci» apre gli stessi blocchi del «/», coi
nomi scritti e divisi per sezione, con un campo per cercarli: si inseriscono
sotto il blocco del cursore.

Accanto ai pulsanti fissi compare il gruppo del blocco del cursore, col suo
nome sul velo d'accento:

| Blocco | Gesti |
| --- | --- |
| Compito | Scadenza (la `@` della data in fondo alla riga) |
| Riquadro | il tipo, Ripiegabile (scrive o toglie il `+` dopo il tipo) |
| Base | A tutta pagina |
| Trasclusione | Apri l'origine (la nota, al titolo o al blocco) |
| Tabella | Riga, Colonna, Ordina |
| Codice | il linguaggio, Copia |
| Immagine | Larghezza, Testo alternativo |

Il gruppo lo dichiara la superficie, con i comandi e i gesti che già ha: chi
non scrive (sola lettura) vede soltanto quelli che non scrivono. Fra due
blocchi, in un paragrafo e con una selezione su più blocchi il gruppo non
c'è. Cambia soltanto quando il cursore cambia blocco, dopo una pausa breve:
chi scrive di fila non fa lavoro per battuta. Mentre il fuoco è nella barra o
in un suo menu il gruppo resta quello da cui si è partiti; un gruppo nuovo
si annuncia una volta a chi usa un lettore di schermo. La barra ha un solo
punto di tabulazione, e le frecce vi si muovono dentro. Nella finestra
stretta ciò che non entra scende in «…», per ultimo il gruppo del blocco; al
telefono la barra sta sopra la tastiera e i gesti si dicono con la figura.
Al tocco (nessun puntatore che passi sopra le cose; un tablet col mouse segue
il mouse, anche collegato a nota aperta) il gruppo del blocco del
cursore è il secondo livello di presenza: sta nella barra sopra la tastiera
su un velo d'accento, e quando la riga non basta scendono in «…» prima i
fissi, annulla e ripeti compresi; la scena `mobile-tocco-02-cursore` del
banco lo fotografa.

## Le forme della barra

L'impostazione `editor.toolbar` sceglie la forma: `compatta` (di serie),
`completa` (tutti i pulsanti, la fila della pre-alpha) o `nascosta` (resta
la mini-barra sul testo scelto, che di serie compare anche con la barra
compatta e non con quella completa). Il comando «Mostra o nascondi la barra di
formato», nel menu Vista, alterna `nascosta` e l'ultima forma visibile. Una
sola fonte: `chrome.formatbar.visible` spento da un Fub di prima vale
`nascosta` finché `editor.toolbar` non c'è, e non si riscrive mai. La
bolla della selezione e la mini-barra restano intere in ogni forma. Le scene
`barra-blocco-*` del banco la fotografano, e `mobile-keyboard` al telefono.

I menu sul testo scelto (la mini-barra) e il «/» sono in
[Tasto destro, mini-barra e «/»](editor-menus.md); le modalità della nota in
[Scrittura](editor-writing.md).

## Dove sta nel codice

- `apps/client/src/panels/format-bar.ts`: la barra che segue il blocco (lo
  stile, il gruppo del blocco, «+ Inserisci», le forme e `toolbarFormOf`);
  `apps/client/src/editors/core/registry.ts`: la porta `blockGroup`;
  `apps/client/src/editors/text/profiles/markdown/block-groups.ts`: i gruppi della nota;
  `apps/client/src/desktop-shell.ts`: `data-toolbar` e `shell.toolbar.toggle`;
  `crates/fub-host/src/settings.rs`: `editor.toolbar`;
  `apps/client/src/theme/scrittoio/skin/menus.css`: la sua veste;
- `apps/client/bench/scene.mjs`: le scene `barra-blocco-*` e
  `mobile-keyboard`.
