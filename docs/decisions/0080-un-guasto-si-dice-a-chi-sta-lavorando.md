# 0080 — Un guasto si dice a chi sta lavorando, e il salvataggio ha un esito

|  |  |
|---|---|
| **Decisa** | 2026-08-03 |
| **Origine** | `todo.md` §20.4 ([seduta 20](../roadmap/20-quando-qualcosa-va-storto.md)) — **chiude la voce**, e con lei la [seduta 20](../roadmap/20-quando-qualcosa-va-storto.md) meno la §20.5. È l'ultimo dei quattro punti in cui il percorso di ciò che va storto era interrotto |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/20-quando-qualcosa-va-storto.md) · [ciò che va storto è un evento, 0052](0052-cio-che-va-storto-e-un-evento.md) · [l'alimentazione risponde, 0051](0051-l-alimentazione-risponde.md) · [il lavoro lungo si racconta, 0035](0035-il-lavoro-lungo-si-racconta.md) · [origine degli eventi, 0012](0012-origine-degli-eventi.md) · [elenco delle capacità, 0013](0013-elenco-delle-capacita.md)

---

Le altre tre voci della seduta 20 riguardavano il backend: chi vedeva il
problema non poteva dirlo, chi lo diceva trovava un ascoltatore che lo buttava
via, e nel contratto la variante per scriverlo non c'era. Questa è **la metà
umana**, ed è l'ultimo pezzo del percorso: il guasto adesso attraversa tutto il
backend, esce dal contratto come `Event::Trouble`, arriva al centro notifiche —
e nella shell c'erano quattordici altri guasti che quel percorso non lo facevano
per niente, perché nascono **di qua** dal confine e in un evento del kernel non
passano mai.

## Il caso peggiore era il salvataggio, e non era un avviso mancante

`saveCurrent` era una riga: `await api.writeDocument(currentDoc, text)`, senza
`catch`, invocata da un `setTimeout`. Vault in sola lettura, disco pieno, file
tenuto da un'altra applicazione, permessi cambiati sotto: la promise veniva
rigettata in un contesto che non ha un gestore, e nella finestra **non cambiava
niente**. Nessun avviso, nessun colore, nessuna parola: si continuava a scrivere
per un'ora dentro una nota che nessuno stava scrivendo su disco.

La cosa importante è che la superficie per dirlo **c'era già** — `notify`, dal
§10.3 — e non bastava. Il salvataggio non aveva un avviso perché non aveva un
**esito**: non c'era «salvato», non c'era «sto salvando», non c'era «non
salvato». Il difetto non era nel canale, era che il fatto non veniva prodotto.

Da qui la prima decisione: **un avviso e uno stato, e servono tutti e due**.

- L'avviso **interrompe una volta**. È giusto per un fatto che succede, ed è
  inutile per una condizione che dura: chi si gira dall'altra parte lo perde, e
  quattro secondi dopo lo perde comunque.
- Lo stato **resta finché non è riparato**. Sta nella barra di stato, che è
  l'unica superficie della shell che c'è sempre e non chiede di essere aperta.

È la stessa coppia che l'avvio del vault aveva già in repo, ed è la ragione per
cui in `main.ts` la barra del vault **è rimasta** accanto al `notify` nuovo:
quel punto era l'unico dei quattordici che arrivasse all'utente, era stato
scritto giusto, e questa decisione lo generalizza invece di sostituirlo.

## Quattro stati e non due, ed è la sola cosa che si poteva sbagliare

`dirty` dice se c'è qualcosa da scrivere. Non dice se ciò che si è provato a
scrivere è arrivato — sono due fatti diversi, e prima erano lo stesso campo. Un
buffer può essere **pulito con l'ultima scrittura fallita**: è il caso in cui il
testo sul disco è vecchio e nessuna battuta nuova è in attesa, ed è precisamente
quello che prima non aveva nome.

Quindi al buffer si aggiunge un `esito` (`ok` / `in_corso` / `fallito`), e la
riga nella barra si legge da **entrambi** con una precedenza:

```
fallito  →  «Salvataggio fallito»    (anche se il buffer è sporco, anche se è pulito)
in_corso →  «Salvataggio…»
dirty    →  «Non salvato»
altro    →  «Salvato»
```

L'ordine dei primi due rami è la decisione. Invertirli — cioè far vincere
«sporco» su «fallito» — vorrebbe dire che **la battuta successiva nasconde il
guasto**: l'utente continua a scrivere, la riga torna a dire «non salvato», e
«non l'ho ancora scritto» è indistinguibile da «non riesco a scriverlo». Sarebbe
lo stesso difetto di prima rimesso al suo posto da un'altra parte, e più
difficile da vedere perché adesso una riga c'è.

Quella precedenza è una funzione pura in un file suo (`state/salvataggio.ts`),
provata da sei casi. Sta lì e non accanto ai buffer per una ragione che si è
vista provandola: `panels/document.ts` monta editor, tab e riquadri, e
importarlo in un test vuol dire portarsi dietro mezza shell e un `document`
globale — mentre la decisione si prova in mezzo secondo e senza un DOM. È la
stessa disciplina di `raccogli` in `ui/notify.ts`, e la regola che se ne ricava è
quella: **la parte che si può sbagliare in un modo che, guardando l'app mentre
tutto funziona, non si vede, va dove la si può interrogare da sola**.

## I quattordici, e il criterio con cui si è scelto il tono

Tutti e quattordici passano adesso da `notify`, con la loro chiave nel catalogo
della shell (§12.4) e in tutte e due le lingue. Il tono non è una sfumatura: è
`guasto` quando **si è perso o si sta per perdere lavoro dell'utente**, `info`
quando si è perso qualcosa che si ricostruisce da sé.

Con quel criterio, tre punti hanno preso `info` e vale la pena dire perché,
perché sono i tre in cui era facile sbagliare in eccesso:

- **`document.changed_on_disk`**, cioè una riscrittura del kernel o di un plugin
  sotto un buffer sporco. La gemella — `document.overwritten`, la stessa cosa
  fatta da **un'altra applicazione** — è `guasto`. Le due si distinguono grazie
  alla [0012](0012-origine-degli-eventi.md), e la differenza è che il lavoro che
  il buffer sta per coprire nel primo caso lo si riottiene rifacendo
  l'operazione, e nel secondo non è nostro e non lo possiamo rifare. Era già
  scritto giusto nel codice, e finiva in console.
- **La view che chiede una superficie non ospitata**: è una dichiarazione che
  questa shell non soddisfa, non un fallimento.
- **Lo stato di vista non ricordato** (`state/store.ts`). Qui l'obiezione scritta
  nel codice era giusta *e riguardava il testo*: nominare la chiave voleva dire
  un avviso diverso a ogni click, per un file di cache che al prossimo avvio si
  riscrive da sé. La frase nuova non la nomina, e allora quattordici fallimenti
  di fila diventano **una riga con «×14»** — che è esattamente ciò per cui il
  raggruppamento della [0035](0035-il-lavoro-lungo-si-racconta.md) esiste. Il
  criterio generale: *un avviso ripetitivo non è una ragione per tacere, è una
  ragione per scrivere una frase che si raggruppa*.

E un quindicesimo punto, che era **peggiore di tutti** e non aveva nemmeno la
console: `state.commandSpecs = await api.listCommands().catch(() => [])`. Se
l'elenco non arriva all'apertura del vault, la palette è vuota e ogni scorciatoia
dichiarata è morta — cioè metà dei modi di usare l'app smette di rispondere —
e non ne restava una riga da nessuna parte. L'elenco vuoto resta la risposta
giusta ([0068](0068-un-vault-si-apre-per-quel-che-si-legge.md): un vault si apre
comunque); ciò che mancava era dirlo. Lo si è trovato **contando**, non
leggendo — che è il precedente della [0052](0052-cio-che-va-storto-e-un-evento.md)
applicato di nuovo: nessuno dei numeri scritti a mano in giro era giusto, e non
lo era perché li si era creduti.

Con lo stesso conto è caduta anche l'ultima riga che diceva «nessuno lo disegna»:
`VaultInfo.unread` (§15.7) — le note che l'apertura non ha potuto leggere, che la
ricerca non trova e che il grafo non collega. Ogni voce esce **anche** come
evento `trouble`, e da lì il centro notifiche la mostra già; la si legge adesso
anche dall'esito, che è la ragione per cui quel campo esiste — aprire un vault è
il carico sotto cui la coda tronca (§20.5), e la seconda strada non passa dalla
coda.

## Il terzo caso, trovato usandola

I due toni del conflitto — `overwritten` per un'altra applicazione, e
`changed_on_disk` per una riscrittura del kernel o di un plugin — descrivevano
due situazioni e ne coprivano tre. La terza è **l'eco del nostro salvataggio**:
si scrive una nota, l'autosave scrive dopo 400 ms, si continua a battere, il
buffer torna sporco, e il `document_changed` che ritorna da quella scrittura
trova un buffer sporco e un'origine che non è la watcher — perché la scrittura è
partita dalla webview, e quella dal kernel è `Actor::User`, la stessa di un
comando lanciato a mano. Risultato: «il file è cambiato sotto di te», detto del
file che contiene esattamente ciò che avevamo appena scritto noi, una volta per
salvataggio.

Non era un difetto introdotto qui: quella riga si emetteva da sempre, e finché
finiva in `console` non l'ha vista nessuno. Portarla sullo schermo l'ha resa
visibile tre volte di fila alla prima nota lunga scritta dopo il commit — che è
il modo in cui questa voce si è verificata da sé, e vale la pena scriverlo: **una
diagnosi che nessuno legge non è una diagnosi giusta, è una diagnosi non
provata**.

La regola aggiunta è una riga (`cambioSotto`, in `state/salvataggio.ts`), e ha un
invariante che i test presidiano: l'eco si riconosce contando le scritture
riuscite di cui non è ancora tornato l'evento, e **`daFuori` risponde prima del
contatore, sempre**. Se un eco andasse perso — coda troncata — il contatore
resterebbe alto e si mangerebbe un avviso di origine kernel o plugin; non può
mangiarsi quello di un'altra applicazione, che è il caso in cui si perde lavoro
che non possiamo rifare. È lo stesso criterio con cui la 0034 ha scelto cosa un
freno può sacrificare.

Con lo spostamento l'avviso è uscito da `reloadIfClean` ed è passato al gestore
dell'evento, che è l'unico a conoscere l'origine. Ci ha guadagnato anche una
seconda strada: `reloadIfClean` la chiama pure la riconciliazione dopo un
`overflow`, che di chi abbia scritto non sa niente — e prima faceva partire
l'avviso lo stesso, deducendone il tono da un'origine che non aveva.

## Ciò che ha trovato un test, ed è il difetto di questa seduta preso dall'altro lato

`ui/notify.ts` prometteva da sempre, per iscritto, che *«se la shell non li ha
(un test, un host che monta solo un pezzo) non succede niente: `notify` continua
a funzionare, perché il canale non dipende dal suo disegno»*. Era vero per il
pannello dello storico e **falso per il toast e per il ridisegno**, che
toccavano `document` senza chiederselo. Finché i chiamanti erano pannelli non si
poteva vedere: un pannello un DOM ce l'ha per definizione.

Aprendo la porta a `state/store.ts` e `state/kernel.ts` — che DOM non ne hanno,
e che nei test girano in Node — il primo avviso emesso da lì è diventato un
rifiuto non gestito. Cioè: **il canale che serve a raccontare i guasti smetteva
di funzionare, in silenzio, proprio mentre gli si raccontava un guasto**. È il
difetto di questa seduta visto dal lato di chi ascolta, e l'ha trovato un test
che non guardava quel file.

Il terzo caso, dopo la riga morta del §20.2 e le tre sorgenti di `Overflow` del
§20.5, di una regola che questa seduta ha finito per scrivere tre volte: **un
documento che afferma una proprietà del codice va riletto contro il codice**. Qui
il documento era un commento, e la proprietà era la promessa su cui l'intera
voce si appoggiava.

## Cosa resta

La seduta 20 resta aperta su una voce sola, la §20.5, che non è una superficie
ma un troncamento: `Dispatcher::next_to_deliver` svuota la coda a budget
esaurito senza guardare `is_recoverable`, e da lì un `Event::Trouble` può non
arrivare mai a un `EventHandler`. Non riguarda ciò che è stato fatto qui — il
ponte verso la webview parte dal bus, che `is_recoverable` la guarda — e resta
il debito degli handler, cioè dei plugin.

Restano fuori, dichiarati e con casa altrove: il **dialogo di conflitto** (§18.1,
M3), che è la risposta *interattiva* dove qui c'è la segnalazione; e
l'**indicatore permanente del watcher** (§9.7), che oggi è un avviso all'apertura.
Tutti e due chiedevano prima di tutto una superficie, e adesso non è più quella a
mancare.
