# 0090 — Una sequenza è una modalità che scade

|  |  |
|---|---|
| **Decisa** | 2026-08-04 |
| **Origine** | `todo.md` §18.2 ([seduta 18](../roadmap/18-editor-e-tastiera.md)) — **chiude la voce, e con lei le voci native della seduta** |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[la seduta](../roadmap/18-editor-e-tastiera.md) ·
[una scorciatoia è una chiave, 0077](0077-una-scorciatoia-e-una-chiave.md) ·
[un accordo ha un proprietario, 0081](0081-un-accordo-ha-un-proprietario.md) ·
[il registro dei comandi, 0009](0009-registro-dei-comandi.md) ·
[i riquadri sono un fatto della shell, 0078](0078-i-riquadri-sono-un-fatto-della-shell.md)
· [le impostazioni, 0036](0036-le-impostazioni-e-i-tre-stati.md)

---

La voce diceva così: *«una sequenza ha uno stato, un timeout, un modo di
annullarla e la domanda di cosa fare se il primo tasto è già una scorciatoia da
solo. Niente di tutto ciò si esprime nella sintassi che la `CommandSpec`
dichiara oggi»*.

Le prime quattro cose sono vere e sono state fatte. L'ultima è **falsa**, e
scoprirlo per primo ha cambiato la forma di tutto il resto.

## Ciò che la voce credeva di dover chiedere al contratto

`CommandSpec.keybinding` è un `Option<String>`
([`crates/fub-abi/src/command.rs`](../../crates/fub-abi/src/command.rs)) dalla
[0009](0009-registro-dei-comandi.md), e nel WIT è una stringa. `"Mod-k d"` ci
sta dentro. Il contratto non dichiara una *sintassi* di accordi: dichiara che
c'è un suggerimento, e dice per iscritto che *«chi assegna davvero i tasti è la
shell»* — cioè si è già tolto di mezzo, cinque sedute fa, dalla domanda che
questa voce credeva di dovergli fare.

Il costo sul confine è quindi **zero firma**, come per la
[0078](0078-i-riquadri-sono-un-fatto-della-shell.md), e stavolta anche **zero
Rust**: di questa decisione non c'è un byte di là dal confine. Il freeze di M4
non c'entra niente, e la voce era ferma da un anello che non esisteva.

Vale la pena dire cosa lo teneva in piedi. La voce non aveva sbagliato a
misurare: aveva confuso il *tipo* con la *sintassi*. La sintassi degli accordi
non è mai stata scritta nel contratto — vive in `matchesBinding`, cioè in
quaranta righe di TypeScript — e una voce che chiede «questo si esprime nella
`CommandSpec`?» sta guardando il posto in cui la risposta non è mai stata. È il
quarto caso di fila di una voce da rimisurare prima di eseguirla, dopo la
[0087](0087-il-testo-che-sta-dentro-gli-allegati.md), la
[0088](0088-cio-che-non-e-ancora-successo.md) e la
[0089](0089-da-cosa-e-partita-una-scrittura.md), e il modo è ancora un altro: là
ciò che la voce aspettava era **caduto** o era stato **deciso di no**, qui non
era mai stato vero.

## L'esempio della voce era ineseguibile, e non per un dettaglio

`g` poi `d` è un gesto vim, e vim ha una modalità normale. Questa shell non ne
ha, ed è scritto in `matchesBinding` da prima di questa voce: *«un comando che
dichiarasse `f` ruberebbe una lettera a chi sta scrivendo una nota… la shell non
ha modi, quindi un tasto nudo non ha un momento in cui è libero»*. Sotto la
tastiera c'è un editor, e `g` è testo di qualcuno.

Quindi le strade erano due — il modello **VS Code**, in cui il primo tasto porta
un modificatore (`Mod-k` poi `d`), oppure inventare una modalità, che è un
progetto suo e non è questa voce — e l'esempio della voce è sparito con la
premessa che se lo portava dietro.

**Si è preso il modello VS Code.** E la cosa che non era ovvia prima di
scriverla è che la regola ha **due metà che si tengono**, non una restrizione e
basta:

- il **primo** accordo deve portare un modificatore, per la ragione di sempre;
- il **secondo può essere nudo proprio perché il primo non lo era.**

`Mod-k` apre una modalità. Non una modalità nel senso di vim — una che si entra
e ci si resta — ma una che **dura due secondi, si vede, e ha una porta
d'uscita**. Dentro quella finestra la `d` non appartiene a nessuno, e nessuno
gliela ruba. La frase «questa shell non ha modi» resta vera al singolare e
diventa falsa al plurale: non ha modi *in cui si sta*, e ne apre uno *che
scade*. Era l'unico modo di eseguire questa voce senza aprire il progetto che la
voce stessa dichiarava fuori portata.

## Le quattro cose, e cosa si è deciso di ognuna

### Lo stato

È una variabile di modulo in
[`ui/keyboard.ts`](../../frontend/src/ui/keyboard.ts), e non un secondo
registro. Di registri dei comandi ce n'è **uno** dalla
[0077](0077-una-scorciatoia-e-una-chiave.md), di cui la palette e la tastiera
sono due lettori, e lo stato di una sequenza non è un elenco di comandi: è la
memoria di due secondi di chi guida i tasti.

Il modulo è nuovo, e la ragione è la §1.2. La tastiera erano quattro righe
dentro `main.ts` — trova il comando, esegui — e ci potevano stare finché una
scorciatoia era un gesto senza memoria. Adesso ci sono un timer, una via
d'uscita e una cosa da mostrare: tre responsabilità che in `main.ts` sarebbero
tre righe di monolite in più. La divisione è quella di `ui/notify.ts`: la
**regola** sta in `avanza` dentro `ui/commands.ts`, che è pura e non sa cosa sia
un `document`; il modulo nuovo è solo il pezzo che tocca il DOM e non contiene
nessuna decisione. È anche il motivo per cui la macchina a stati si prova su un
banco senza finestra.

### Il timeout: due secondi

Deve stare **sopra** un gesto deliberato di due tasti — tre o quattro decimi,
per chi ha le dita sulla tastiera — e **sotto** il tempo in cui si distoglie lo
sguardo. La cosa da evitare non è l'attesa breve: è l'attesa che sopravvive al
motivo per cui era cominciata, e che fa rispondere il tasto dopo a un gesto che
nessuno ricorda di aver iniziato.

VS Code aspetta per sempre, e se lo può permettere perché tiene un avviso fisso
in fondo alla finestra. Qui sotto c'è un editor: il tasto dopo è **testo di
qualcuno**, e scadere è l'unico modo di fallire che non tocca la nota.

E la scadenza **non esegue niente**. Un timeout che al termine facesse partire
il comando corto sarebbe la regola del prefisso al contrario, con la sorpresa
che arriva due secondi dopo l'ultimo tasto premuto — cioè quando nessuno la sta
più aspettando.

### L'annullamento, che sono tre

`Escape`, un tasto che non continua niente, o il tempo che scade. `Escape` è
trattato **prima** del registro e non può essere conteso da nessun comando: una
via d'uscita che una scorciatoia potesse rubare non sarebbe una via d'uscita.

La decisione meno ovvia è cosa fare del tasto che non continua niente:
**consumarlo**. Chi ha premuto `Mod-k` ha già lasciato il gesto di scrivere, e
vedersi comparire una `x` in mezzo a una frase è l'unico esito che da fuori non
si può prevedere. Costa una lettera a chi ha premuto `Mod-k` per sbaglio, ed è
il prezzo giusto: è visibile, è immediato, e la lettera si riscrive.

Un caso l'ha trovato il banco e non il progetto: **i modificatori da soli non
annullano**. Il `keydown` di `Shift` arriva prima di quello della lettera,
quindi una sequenza `Mod-k D` si sarebbe rotta ogni volta che il secondo tasto
era una maiuscola, e nessuno avrebbe capito perché.

### Il prefisso: vince il corto, e si dice all'avvio

Se esistono `Mod-k` e `Mod-k d`, premere `Mod-k` esegue il primo e il secondo
diventa irraggiungibile. Le tre ragioni, in ordine di peso:

1. **Un tasto che funziona oggi non deve diventare più lento domani.** La regola
   opposta — aspettare per vedere se arriva la `d` — metterebbe due secondi di
   ritardo su ogni pressione di `Mod-k`, cioè pagherebbe il caso raro col caso
   comune.
2. La sequenza è l'ultima arrivata, e chi arriva paga.
3. Soprattutto: la cosa si decide **guardando il registro fermo**, quindi si può
   dire all'avvio invece di lasciarla scoprire a chi preme.

È il terzo punto a rendere questa la scelta onesta invece che la più comoda.
«Accettare `g d` senza onorarlo sarebbe peggio che non accettarlo» era il
criterio della voce, e il modo in cui una sequenza resta *non onorata* di
nascosto è esattamente questo: un prefisso che se la mangia. `prefissiOscurati`
la trova nel registro fermo, `frasedeiConflitti` la dice all'avvio nominando
tutti e due i comandi, e il presidio dei due registri insieme
(`keybindings.test.ts`) la impedisce fra ciò che l'app spedisce. È la stessa
domanda della [0081](0081-un-accordo-ha-un-proprietario.md) — un guasto
invisibile a ogni banco che guardi un registro per volta — su una relazione che
allora non poteva esistere, perché due accordi diversi non si possono contenere
e due sequenze sì.

## Ciò che le sequenze hanno reso visibile: il valore ignorato in silenzio

`normalizza` rispondeva `null` a un accordo senza modificatori, e `conflitti`
faceva `continue`. Non era sbagliato — un accordo che non si preme non litiga
con nessuno — ma il conteggio dei conflitti era l'**unico** posto in cui quel
valore passava, quindi una scorciatoia scritta male era **esclusa** invece che
**segnalata**. Nessuno lo diceva a chi l'aveva scritta.

Finché gli accordi erano quattordici righe di codice sorgente, era un difetto
teorico. Adesso una scorciatoia è un'impostazione — cioè una stringa che
l'utente scrive a mano, dalla 0077 — e le sequenze aggiungono un modo nuovo di
sbagliarla. Quindi:

- `accordiRifiutati` esiste, e la frase di avvio dice i tre casi insieme: due
  comandi che si contendono un tasto, una sequenza coperta dal proprio prefisso,
  un accordo che non si può premere. Chiedono tutti la stessa cosa a chi legge —
  aprire le impostazioni e cambiare una riga — quindi si dicono nello stesso
  posto.
- **un modificatore che non esiste è un rifiuto, non un tasto nudo.** `Ctrl-k`
  passava e valeva `k`: un tasto che risponde mentre si scrive, dichiarato da
  chi credeva di aver scritto Ctrl. È il tipo di silenzio che questa voce
  esisteva per togliere, e si è tolto anche lui.

## Perché la shell non spende una sequenza propria

Nessun comando di questo repo dichiara `Mod-k d`, e non è un lavoro lasciato a
metà. Ogni comando della shell ha già un accordo singolo, che vale di più: una
sequenza è ciò che si spende **quando i comandi diventano più dei tasti**, e
tredici comandi con tredici tasti liberi non sono quel momento. Il criterio è
quello della §3.3 — un gesto disegnato su zero clienti è un gesto indovinato — e
qui il primo cliente non è un pannello che non c'è: è **l'utente**, che da
adesso può scrivere `Mod-k d` nella casella di qualunque comando del kernel e
trovarselo funzionante, senza che noi si sia scelto per lui quale.

## La seconda casella: la via d'uscita che la voce dichiarava è quella giusta

La casella diceva che la scorciatoia di un comando di shell non si riconfigura,
e che la via d'uscita *«non è un secondo registro di qua — è la shell che
diventa un componente come gli altri, cioè la domanda della §16.3»*.

Prima di crederle sulla parola si è misurata una terza strada che la voce non
aveva guardato: un `CommandProvider` **di prossimità**, registrato dall'host per
conto della shell, che dichiari i comandi `shell.*` al solo scopo di far nascere
le chiavi `keys.shell.*`, lasciando l'esecuzione nella webview. Gli id
passerebbero davvero (`CoreBundle` è `Trust::Core`, quindi può nominare nudo) e
la chiave nascerebbe da sola. Si rompe in cinque punti, e li si scrive qui
perché chi eseguirà la §16.3 non debba rimisurarli:

1. **`CommandProvider` non ha una forma solo dichiarativa.** `invoke` è
   obbligatorio, e il kernel non ha un canale verso la webview: `invoke_command`
   è sincrono e torna un `CommandOutcome`. Servirebbe l'equivalente del ramo
   `MAINTENANCE_ID`, che oggi è cablato nel kernel per l'unico precedente di
   «dichiaro qui, eseguo altrove»
   ([0086](0086-una-cronologia-e-la-sua-porta.md)).
2. **`PluginError` non ha un caso** che significhi «dichiarato qui, eseguito
   altrove»: invocarlo da palette, CLI o macro darebbe un `Internal`, cioè
   esattamente la bugia dentro il registro che la 0077 rifiuta.
3. **`allCommands()` concatena senza deduplicare**, quindi ogni comando di shell
   comparirebbe due volte — e con lo stesso accordo da tutte e due le parti,
   cioè in conflitto **con sé stesso**.
4. **Il presidio non lo vedrebbe.** La fixture `command-keys.json` la genera
   `command_keys.rs` dal solo `CoreCommands::specs()`: un provider nuovo in
   `fub-host` non ci entra, e il test resterebbe verde. È il buco della 0081, di
   nuovo.
5. **Il ciclo di vita e lo scope sono tutti e due sbagliati.** I provider si
   registrano **per vault**, e le chiavi `keys.*` sono di scope `Vault`
   ([0036](0036-le-impostazioni-e-i-tre-stati.md)). Ma `shell.vault.open` è il
   comando che esiste *prima* di ogni vault: la sua chiave nascerebbe solo dopo
   che un vault è aperto, cioè quando serve meno, e vivrebbe dentro il vault che
   serve ad aprire.

Le prime quattro sono lavoro; la quinta è una **contraddizione**, e da sola dice
che il posto non è questo. La casella non si riformula: si trasferisce alla
[§16.3](../roadmap/16-crate-sdk-banchi-di-prova.md) con questi cinque punti
addosso, che è la stessa cosa che la voce diceva, resa eseguibile. Nel frattempo
il pannello continua a mostrarle di sola lettura, che è ciò che permette di
sapere quali tasti sono presi prima di rimapparne un altro.

## Cosa resta

Della §18.2 non resta niente, e con lei finiscono le due voci **native** della
seduta 18: quel che ci sta ancora dentro sono due code di sedute chiuse altrove
(§2.9 e §4.4), che è la definizione per esclusione con cui la seduta era nata.

Una cosa non fatta e detta per nome: la sequenza si vede nella barra di stato
(`Mod-K…`) ma **non si vedono le continuazioni possibili**. VS Code, dopo
`Mod-k`, sa dire «e adesso puoi premere d, s, w». Qui no, e non è difficile —
`avanza` conosce già le voci che continuano, perché è la cosa che ha appena
guardato per decidere di aspettare. Non si è fatto perché con zero sequenze
spedite non avrebbe niente da elencare, e un menu che si popola solo dalle
impostazioni dell'utente è una superficie disegnata su un cliente ipotetico. Il
giorno che una sequenza si spende, questa è la riga da scrivere.
