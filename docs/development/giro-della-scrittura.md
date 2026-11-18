# Il giro della scrittura

Questa pagina elenca i compiti del gruppo `scrittura` del
[giro](bench-giro.md): che cosa fa ciascuno e che cosa vale come riuscita.
Il corridore, le opzioni e i limiti comuni sono nella pagina del giro.

> **Per chi:** chi lancia il gruppo, ne legge una foto o gli aggiunge un compito.
> **Risultato:** sa che cosa prova ogni compito, quali sono saltati e perché.

```bash
cd apps/client
FUB_BENCH_PORT=1460 npm run bench:giro -- --solo=scrittura --out=$TMPDIR/giro
```

Il file è `apps/client/bench/giro/scrittura.mjs`. I compiti vengono dai flussi
E1–E18 del piano dell'editor e sono fatti a capitoli: il primo di ogni capitolo
ricarica la pagina con la query del finto host che gli serve, e il vault del
banco riparte da capo, in memoria. Niente tocca un vault vero. Ogni compito
guarda il risultato: il Markdown che il finto host ha ricevuto, una chiamata
(`invokeCommand`, `setSetting`) o il DOM, non solo l'assenza di errori.

## I compiti

Scrivere e dare forma, in una nota nuova (`?formatbar=1&slash=1`):

- `nuova-nota`: «Nuova nota», una frase → la frase è in `Senza titolo.md`.
- `slash-titolo`: «/h2» e Invio → `## Tappe` nel file, la barra dice «Titolo 2».
- `slash-attivita`: «/attività» → `- [ ] …`, la barra sul blocco «task», la banda dice «Ctrl+Enter spunta».
- `spunta`: Ctrl+Enter → `- [x] …`.
- `slash-data`: «/venerdì» → `[[Daily/2026-08-21|21 agosto 2026]]`.
- `slash-nessuno`: «/qwzx» → «Nessun blocco per «qwzx»», Esc lascia `/qwzx` nel testo.
- `grassetto-e-annulla`: doppio clic, la banda dice Ctrl+B, Ctrl+B → `**treno**`; Ctrl+Z lo toglie.
- `mini-barra-corsivo`: il corsivo della mini-barra → `*parte*`.
- `inserisci-riquadro`: «+ Inserisci», «Riquadro» → `> [!note]` col testo dentro.
- `link-a-nota`: «[[Benv» e la voce scelta → `[[Benvenuto]]`.
- `data-con-chiocciola`: «@ven» e la data scelta → un link a venerdì, senza `@ven`.
- `incolla-su-scelta`: un indirizzo incollato su una parola → `[mostra](https://…)`.
- `incolla-scheda`: un indirizzo su una riga vuota → «Link | Scheda»; Scheda lo lascia solo sulla riga.
- `slash-tabella`: «/tab 3x4» → una tabella di quattro colonne.
- `tabella-riga`: «+ Riga» della barra → una riga in più nel file.
- `titolo-rinomina`: il titolo in cima, Invio → `note.rename` in `Viaggio a Lisbona.md`, il fuoco nel testo.

I blocchi e le modalità, su «Benvenuto»:

- `maniglia-menu`: la maniglia al passaggio, il suo menu → Trasforma in, Duplica, Sposta in, Elimina.
- `sposta-da-tastiera`: Esc sceglie il blocco, Ctrl+Shift+↓ → la voce scende nel file.
- `duplica`: Ctrl+D → la voce è due volte.
- `blocchi-spenti`: «Blocchi» spento dal menu del foglio → `setSetting editor.blocks false`, niente maniglie, Ctrl+A sceglie tutto.
- `modalita-lettura`: Lettura → la banda dice «Lettura», il testo non è scrivibile.
- `modalita-sorgente`: Sorgente → si vede `# Benvenuto in Fub`.

La testata e le proprietà, su `Guida/Live.md` (`?live=proprieta`, poi `?live=opzioni&tipi=1`):

- `proprieta-testo`: il valore di «stato» → `stato: Rimandata` nel frontmatter.
- `proprieta-data-a-parole`: «venerdì» nella scadenza → `scadenza: 2026-08-21`.
- `stato-scelta`: l'opzione «Arrivata» dei gruppi dello Stato → `stato: Arrivata`.
- `aggiungi-proprieta`: «Aggiungi una proprietà» apre il frontmatter → la riga scritta lì resta nel file.

I commenti, su `Guida/Live.md` (`?live=commenti`):

- `commenta`: Ctrl+Alt+M chiede il nome, Ctrl+Enter → `{==inaugurazione==}{>>@Sara Neri …<<}`.
- `rispondi`: il segno della discussione, una risposta → la risposta è nel file.
- `risolvi`: «Risolvi» → un segno in meno nella nota, la discussione resta nel file.

La Base, `Opere.base` (`?base=1`):

- `base-apri`: Ctrl O, «Opere.base» → otto righe.
- `base-filtro`: il valore del filtro, «Applica» → `value: 16000` nel file, meno righe.
- `base-ordina`: «Decrescente» → `descending: true` nel file.
- `base-bacheca-trascina`: una scheda da «Prenotata» ad «Arrivata» → `stato: "Arrivata"` nella nota.
- `base-schede`: la vista Schede → le schede delle opere.

La sbirciata, Ctrl O e la concentrazione, da «Benvenuto»:

- `sbirciata`: Alt+clic su un link, una frase, chiusa → la frase è nella nota sbirciata.
- `ctrl-o-nota`: Ctrl O, «Frammenti», Invio → la linguetta «Frammenti di codice».
- `ctrl-o-sbircia`: Alt+Invio su un risultato → la sbirciata di quella nota.
- `ctrl-o-etichette`: «#» → la tessera «Etichette», righe con «N note».
- `concentrazione`: «>concentrazione» → `#app[data-focus-mode]`, «Esci dalla concentrazione» nella banda.
- `concentrazione-esc`: Esc → fuori, col fuoco nel testo.

In inglese (`localStorage["fub.locale.language"] = "en"`, come Impostazioni):

- `inglese`: la banda, la modalità «Writing» e il «/» («Heading 2», «Search all commands») in inglese.
- `inglese-torna`: tolta la lingua, la banda dice di nuovo «Scrittura».

## I compiti saltati

Il corridore non ha un «rosso atteso». Un compito che oggi fallisce per un
difetto di Fub sta in `SALTATI`, nello stesso file, col motivo e i passi; il
primo compito ne stampa i nomi. Corretto il difetto, il compito torna fra gli
altri. Oggi: `slash-dopo-rinomina` (il «/» non si apre in una nota
rinominata), `slash-compito` («/compito» non trova il compito),
`sbirciata-un-esc` (servono due Esc per chiudere la sbirciata) ed
`esci-dall-elenco` (la riga dopo un elenco chiuso con Invio resta attaccata
alla sua ultima voce).

## Che cosa il gruppo non prova

- **La tastiera dei completamenti.** L'orologio del palco è fermo, e
  CodeMirror accetta un completamento dalla tastiera solo dopo un attimo
  misurato con l'orologio: le voci di «[[» e «@» si scelgono col mouse.
- **La firma delle risposte.** Il finto host non dichiara `profile.name`: il
  nome scelto al primo commento non si salva, e il compito guarda la
  risposta senza la firma.
- **La Base del core.** Righe, filtri e Bacheca li dà la scenografia
  `bench/base-fixture.ts`: il compito guarda i file, non le colonne
  ricalcolate. La Base si apre da Ctrl O.
- **Gli appunti del sistema.** L'incolla è un evento `paste` col testo.
