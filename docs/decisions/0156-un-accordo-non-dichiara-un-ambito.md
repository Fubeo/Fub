# 0156 — Un accordo non dichiara un ambito: il contesto si deriva dal fuoco

**Stato**: accolta **Data**: 2026-08-14 **Chiude**: §26.1 **Commit**: *(questo
commit)*

---

## La domanda

La [§26.1](../roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md#261-un-accordo-ha-un-contesto-o-non-ce-lha)
chiedeva se una scorciatoia valga **dovunque** o **dove qualcosa ha il fuoco**,
e chi lo dichiara — il contratto, la shell, o nessuno. La voce raccomandava la
forma **(a)** — un campo `context: option<string>` in fondo a `command-spec` —
ma aggiungeva una condizione: «non prima di aver deciso i nomi», cioè quando
esiste il **secondo** consumatore. La
[0150](0150-il-piano-e-della-superficie.md) ha chiuso la domanda gemella — il
livello di una superficie — dicendo no al campo `layer` per la stessa ragione:
un elenco chiuso di nomi pubblici si indovina oggi, e un campo che nessuno legge
è un secondo ordine accanto al primo.

## La premessa, rimisurata

Rimisurata a `b333ab4`.

- **I numeri della voce reggono.** **35** confronti su `e.key` in **8** file
  (**22** siti con la convenzione «un sito = una riga di sorgente»), **45** gesti
  nudi nel corpus, **3** scontri noti. Sono gli stessi numeri che la voce aveva
  misurato a `3d6df0e`, e non sono cambiati.
- **Il percorso non ha nessun posto per un contesto.** `mountKeyboard`
  (`frontend/src/ui/keyboard.ts:38-51`) non guarda `e.target`; `avanza`
  (`ui/commands.ts:431-465`) riceve `(entries, attesa, e)` e **non riceve il
  bersaglio dell'evento**; `command-spec` (`abi.wit:1555-1562`) ha sei campi e
  nessun ambito; il frozen (`frozen/0.1.0.wit`) è identico.
- **Il secondo consumatore non c'è.** `graph.ts` ha zero `e.key`: nessuna
  superficie nuova chiede un ambito oggi. Dei quattro che la voce nominava come
  futuri — canvas, database, viewer — nessuno esiste nel codice.
- **Le tre collisioni di 0151 sono vive e misurate.** `SCONTRI_NOTI` in
  `keybindings.test.ts:152-158` le nomina: `mod-f` (`shell.doc.search` e
  `openSearchPanel`), `mod-shift-\` (`shell.pane.split.down` e
  `cursorMatchingBracket`), `mod-shift-l` (`shell.mode.live` e
  `selectSelectionMatches`). Il lucchetto resta: i due registri dichiarano
  ancora gli stessi tre accordi.

## La decisione

**Niente campo `context` su `command-spec`. Un accordo non dichiara un ambito:
il contesto si deriva dal fuoco.**

La ragione decisiva è la stessa della
[0150](0150-il-piano-e-della-superficie.md), e qui è più forte perché la domanda
gemella è già chiusa: un elenco di nomi pubblici — `"editor"|"tree"|"modal"` — è
lo stesso errore che 0150 ha rifiutato per `layer`, e il suo **primo chiamante**
non c'è. Il secondo — la shell — la risposta ce l'ha già e migliore: il fuoco.
Aggiungere il campo vorrebbe dire riempirlo dalla shell e rileggerlo dalla shell,
che il bersaglio ce l'ha in mano prima di scriverlo: è un secondo ordine accanto
al primo, cioè la malattia che questa voce misurava.

I tasti nudi restano fuori dal registro:
[0009](0009-registro-dei-comandi.md) li ha esclusi con la sua ragione scritta
(`0009:66-67` — *«ignora quelli senza modificatori perché ruberebbero una
lettera a chi scrive»*), e quella ragione **non cambia**: un `Escape` globale
ruba davvero una lettera a chi scrive. Il giorno che un secondo consumatore
chiederà un ambito, la ragione di 0009 si riscriverà per quei tasti soli — non
per tutti.

**E le tre collisioni di 0151 a runtime le vince chi ha il fuoco.** Dentro
l'editor (CodeMirror) vince l'editor; fuori, vince la shell. Non è un elenco di
nomi pubblici — quello è lo stesso errore che 0150 ha rifiutato per `layer`. È
una regola di osservazione, e sta dove il DOM c'è: in `mountKeyboard`
(`frontend/src/ui/keyboard.ts`), dopo `avanza` e prima di `esegui`. Il modulo
toccava già il DOM e non conteneva regole di riconoscimento — la 0156 gli
aggiunge un'osservazione del fuoco, che non è un riconoscimento di tasti: è la
rinuncia a tre accordi quando l'editor li ha già presi in bubbling. La lista dei
tre id sta accanto all'ascoltatore, con un commento che punta qui e a
`SCONTRI_NOTI`.

La regola vale solo quando non c'è una sequenza in corso (`attesa === null`):
con una sequenza, la shell continua (0090). E vale solo per i tre comandi che
l'editor monta anche lui — la palette, la nuova nota, ogni altro comando della
shell resta attivo anche con l'editor a fuoco.

**Il lavoro portato è prosa, non firma.** Il doc di `record command-spec` nel WIT
e il gemello `CommandSpec` in `command.rs` dicono adesso che un accordo non
porta un ambito, che dove vale lo dice il fuoco, e che i tasti nudi restano
ignorati dal registro (0009). Nessun campo nuovo, il frozen è intatto, e
aggiungere l'ambito resta una mossa additiva per quando un secondo consumatore
lo chiederà.

## Le forme scartate

- **(a) il campo `context: option<string>`** — 0150 ha chiuso la domanda
  gemella, e con la stessa ragione: un elenco di nomi pubblici si indovina oggi.
  Nessun secondo consumatore esiste — `graph.ts` ha zero `e.key` — e un campo
  che nessuno legge è un secondo ordine. Non è nemmeno «pagare presto per non
  pagare dopo»: dopo si può ancora, e additivo, per la regola di
  `wit_additivity`. Il prezzo che si pagherebbe oggi è l'elenco degli ambiti,
  che è un contratto di nomi e non si ritira.
- **(b) il suffisso `"Escape@modal"`** — fragile nello stesso punto della
  [§26.3](../roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md#263-la-grammatica-di-un-accordo-non-sta-nel-contratto),
  che la [0149](0149-la-grammatica-di-un-accordo-e-salita.md) ha riparato
  portando la grammatica in `fub_abi::rules::tasti`. Aggiungere una seconda
  grammatica dentro la stringa dell'accordo — `@` come separatore di ambito —
  vorrebbe dire una sintassi che il contratto non dichiara, e che un plugin
  scopre quando l'app gliela rifiuta. La forma canonica dell'accordo è già
  presidiata; un suffisso la romperebbe.
- **(c) com'è oggi** — il contratto taceva, e «com'è oggi» comprendeva un
  contratto che non dice niente e una tastiera che non guarda il fuoco. Dopo la
  prosa e il runtime, non è più «com'è oggi»: il contratto dice che un accordo
  non porta un ambito, e la tastiera rispetta il fuoco. La forma (c) cade con
  entrambe.

## Cosa resta scoperto

- **I 35 rami `e.key` nei widget non salgono.** Il registro 5 di
  [0151](0151-il-terzo-registro-si-guarda-anche-senza-salire.md) — i confronti
  di tastiera nel DOM, in 8 file — resta dov'è: non è un elenco, sono rami
  dentro dei gestori, e non c'è niente da importare. La 0156 non li tocca,
  perché la decisione è sul contratto e sul runtime della shell, non sui widget.
- **I 45 gesti nudi del corpus restano nei widget.** `Esc`, `Invio`, `Tab`,
  `F2`, `Canc`, `Home` — i gesti che cominciano con un tasto nudo — restano
  fuori dal registro, perché 0009 li ha esclusi con la sua ragione, e quella
  ragione non è cambiata. Il giorno che un secondo consumatore chiederà un
  ambito, si riaprirà 0009 per quei tasti soli.
- **Un secondo consumatore potrà chiedere il campo (a) più tardi, additivo.** Il
  canvas, il database, il viewer — le tre superfici che la voce nominava come
  futuri — non esistono nel codice. Quando una di loro chiederà un proprio
  `Escape`, il campo `context` si accoderà in fondo a `command-spec` senza
  pagare una migrazione, e gli ambiti si leggeranno dalle superfici che ci sono
  invece di indovinarli. La decisione di oggi non consuma nessuna occasione.
- **`SCONTRI_NOTI` resta un lucchetto, non uno zero.** I due registri dichiarano
  ancora gli stessi tre accordi, e il banco di 0151 li nomina per farne rosso
  l'elenco. A runtime non scattano più entrambi — decide il fuoco — ma il
  lucchetto presidia la porta da cui entrerebbe una quarta collisione, e il
  banco che prova il runtime sta accanto: è «chi tiene i tre accordi quando
  l'editor ha il fuoco» in `keybindings.test.ts`.