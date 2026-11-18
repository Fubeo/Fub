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
- `slash-data`: Invio sulla voce vuota, «/venerdì» → `[[Daily/2026-08-21|21 agosto 2026]]`, un paragrafo staccato dall'elenco da una riga vuota.
- `slash-nessuno`: «/qwzx» → «Nessun blocco per «qwzx»», Esc lascia `/qwzx` nel testo.
- `grassetto-e-annulla`: doppio clic, la banda dice Ctrl+B, Ctrl+B → `**treno**`; Ctrl+Z lo toglie.
- `mini-barra-corsivo`: il corsivo della mini-barra → `*parte*`.
- `inserisci-riquadro`: «+ Inserisci», «Riquadro» → `> [!note]` col testo dentro.
- `link-a-nota`: Invio sulla riga vuota del riquadro, «[[Benv» e la voce scelta → `[[Benvenuto]]`, un paragrafo fuori dal riquadro.
- `data-con-chiocciola`: «@ven» e la data scelta → un link a venerdì, senza `@ven`.
- `incolla-su-scelta`: un indirizzo incollato su una parola → `[mostra](https://…)`.
- `incolla-scheda`: un indirizzo su una riga vuota → «Link | Scheda»; Scheda lo lascia solo sulla riga.
- `slash-tabella`: «/tab 3x4» → una tabella di quattro colonne.
- `tabella-riga`: «+ Riga» della barra → una riga in più nel file.
- `titolo-rinomina`: il titolo in cima, Invio → `note.rename` in `Viaggio a Lisbona.md`, il fuoco nel testo.
- `slash-dopo-rinomina`: nella nota rinominata «/h2» apre ancora il menu → `## Dopo il nome` in `Viaggio a Lisbona.md`.
- `slash-compito`: «/compito» sceglie «Elenco di attività» → `- [ ] Prenotare l'albergo`.
- `esci-dall-elenco`: Invio sulla voce vuota del compito, «- tre», Invio, Invio, «quattro» → `- [ ] Prenotare l'albergo`, riga vuota, `- tre`, riga vuota, `quattro`.

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
- `rispondi`: il segno della discussione, una risposta → la risposta è nel file, firmata `@Sara Neri`; `setSetting profile.name`.
- `risolvi`: «Risolvi» → un segno in meno nella nota, la discussione resta nel file.

La Base, `Opere.base` (`?base=1`):

- `base-apri`: Ctrl O, «Opere.base» → otto righe.
- `base-filtro`: il valore del filtro, «Applica» → `value: 16000` nel file, meno righe.
- `base-ordina`: «Decrescente» → `descending: true` nel file.
- `base-bacheca-trascina`: una scheda da «Prenotata» ad «Arrivata» → `stato: "Arrivata"` nella nota.
- `base-schede`: la vista Schede → le schede delle opere.

La sbirciata, Ctrl O e la concentrazione, da «Benvenuto»:

- `sbirciata`: Alt+clic su un link, una frase → la frase è nella nota sbirciata, che resta aperta.
- `sbirciata-un-esc`: «[[Benv» nella sbirciata, Esc → si chiude il completamento e la sbirciata resta; una frase, un Esc solo → la sbirciata si chiude. Il «/» nella sbirciata non si apre: segue la nota della linguetta attiva.
- `ctrl-o-nota`: Ctrl O, «Frammenti», Invio → la linguetta «Frammenti di codice».
- `ctrl-o-sbircia`: Alt+Invio su un risultato → la sbirciata di quella nota.
- `ctrl-o-etichette`: «#» → la tessera «Etichette», righe con «N note».
- `concentrazione`: «>concentrazione» → `#app[data-focus-mode]`, «Esci dalla concentrazione» nella banda.
- `concentrazione-esc`: Esc → fuori, col fuoco nel testo.

In inglese (`localStorage["fub.locale.language"] = "en"`, come Impostazioni):

- `inglese`: la banda, la modalità «Writing» e il «/» («Heading 2», «Search all commands») in inglese.
- `inglese-torna`: tolta la lingua, la banda dice di nuovo «Scrittura».

## I compiti saltati

Il corridore non ha un «rosso atteso». Un compito che fallisce per un
difetto di Fub sta in `SALTATI`, nello stesso file, col motivo e i passi; il
primo compito ne stampa i nomi. Corretto il difetto, il compito torna fra gli
altri. Oggi non ne è saltato nessuno.

## Che cosa il gruppo non prova

- **La tastiera dei completamenti.** L'orologio del palco è fermo, e
  CodeMirror accetta un completamento dalla tastiera solo dopo un attimo
  misurato con l'orologio: le voci di «[[» e «@» si scelgono col mouse.
- **La Base del core.** Righe, filtri e Bacheca li dà la scenografia
  `bench/base-fixture.ts`: il compito guarda i file, non le colonne
  ricalcolate. La Base si apre da Ctrl O; il finto host la tiene per un
  documento come l'host vero, e dall'albero si apre col clic.
- **Gli appunti del sistema.** L'incolla è un evento `paste` col testo.
