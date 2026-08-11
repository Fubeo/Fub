# 0088 — Ciò che non è ancora successo, e chi lo ripara

|  |  |
|---|---|
| **Decisa** | 2026-08-04 |
| **Origine** | `todo.md` §15.2 ([seduta 15](../roadmap/15-il-disco.md)) — **chiude la voce** |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[la seduta](../roadmap/15-il-disco.md) ·
[il registro di ciò che è successo, 0067](0067-il-registro-di-cio-che-e-successo.md)
· [una scrittura o c'è o non c'è, 0065](0065-una-scrittura-o-c-e-o-non-c-e.md) ·
[un aggiornamento non è una scrittura, 0066](0066-un-aggiornamento-non-e-una-scrittura.md)
· [una radice sola, 0048](0048-una-radice-sola.md) ·
[l'undo ha due pile, 0045](0045-l-undo-ha-due-pile.md) ·
[una cronologia e la sua porta, 0086](0086-una-cronologia-e-la-sua-porta.md) ·
[il registro dei comandi, 0009](0009-registro-dei-comandi.md)

---

Le due caselle rimaste erano state scritte **prima** che esistessero il supporto
(0064), la scrittura atomica (0065), l'aggiornamento atomico (0066) e il journal
(0067). Rileggerle contro quel codice era il primo lavoro, ed è servito: una
delle due chiedeva una cosa che nel frattempo era già stata fatta per metà,
l'altra ne chiedeva una che nel frattempo era diventata **impossibile da fare
nel modo in cui la chiedeva**.

## Il buffer di crash: il gemello del registro, dall'altro verso

Il journal dice di sé, in testa al proprio modulo, di non contenere il buffer
sporco dell'editor: *«quella è l'altra pila della
[0045](0045-l-undo-ha-due-pile.md), e la riga che separa le due pile — un
comando entra da qui, una battuta di tastiera no — è la stessa che separa questo
file dal buffer di crash»*. Quella frase, scritta un verbale fa, era già la
specifica di questo: le bozze sono **il gemello del registro dall'altro verso**.
Il registro conserva ciò che è **successo** al vault, e per farlo conserva
l'*inverso* e mai il testo; le bozze conservano ciò che **non è ancora
successo**, e per farlo conservano soltanto il testo. Ognuno dei due tiene
esattamente ciò che l'altro ha deciso di non tenere, e nessuno dei due si può
ricostruire dall'altro.

Da qui seguono, quasi senza scelte, il posto e la forma.

**Il posto è `.fub/drafts/`**, profondità uno, la classe **autorevole** della
[0048](0048-una-radice-sola.md). Un testo mai salvato non si rifà da niente: è
per definizione l'unica copia. Le due alternative sono state guardate e scartate
per lo stesso criterio letto da due lati. `.fub/data/` avrebbe dichiarato
**buttabile** ciò che è l'unica copia. Lo stato di vista
([0037](0037-lo-stato-di-vista.md)) sarebbe stato peggio ancora, ed è istruttivo
*perché*: è la [0086](0086-una-cronologia-e-la-sua-porta.md) letta
all'incontrario. Là la proprietà che decideva era che una cronologia di ricerche
**non deve viaggiare** — sta sul file della macchina, non entra in un sync, non
finisce in un repo condiviso —; qui la proprietà che decide è che una bozza
**deve** viaggiare, perché chi apre l'archivio dall'altro computer deve
ritrovarci ciò che aveva scritto. Stesso asse, verso opposto, contenitore
opposto. Che le due voci siano cadute a due giorni di distanza è stata una
fortuna: senza la 0086 fresca, «mettiamola nello stato di vista» sarebbe stata
una scorciatoia ragionevole.

**La forma è un file per bozza**, e nemmeno questa è una preferenza. Un file
unico avrebbe fatto di ogni salvataggio automatico un **aggiornamento** di un
documento condiviso — cioè il difetto che la
[0066](0066-un-aggiornamento-non-e-una-scrittura.md) ha appena finito di
togliere, rientrato dalla porta di servizio. Con un file per bozza ogni
salvataggio è una **scrittura**, e `VaultStorage::write` la fa atomica per
costruzione ([0065](0065-una-scrittura-o-c-e-o-non-c-e.md)). Il nome del file è
il documento codificato con la funzione **reversibile** dello spazio
per-documento (`rules::doc_data::encode`), riusata e non reinventata: con
un'impronta al suo posto nessuno saprebbe più a quale nota offrire il recupero,
che è l'unica cosa che questo codice deve saper fare.

E non una riga di `std::fs`: sotto la linea del vault il supporto è uno solo, o
il giorno in cui uno cifra un dato su due resta in chiaro.

### La tensione di strato, dichiarata invece che risolta di straforo

La voce diceva *kernel*, e metà del lavoro è di **shell**: il kernel non sa cosa
l'utente sta battendo, e non deve saperlo. La riga che ne esce si può dire in
una frase, ed è scritta in testa al modulo perché è la sola cosa che qualcuno
dovrà sapere fra un anno: **la shell decide quando una bozza esiste, il kernel
decide cosa vuol dire tenerla.**

La scrittura passa da due porte IPC (`save_draft`, `discard_draft`) e non da un
comando del registro, e qui c'è la sola decisione di superficie di questo
verbale. L'allowlist della [0057](0057-la-dieta-dell-ipc.md) ha sei ragioni, e
queste due righe cadono nella quinta — *aspetta un cliente*: passerebbero la
riga che divide (fanno accadere qualcosa, non rispondono con dati) e il registro
non le può servire perché una capacità non c'è. La differenza da tutte le altre
righe di quella categoria va detta, perché cambia cosa succederà dopo: lì la
capacità manca perché **nessuno l'ha ancora chiesta**, qui manca **per decisione
e per sempre**. Il testo che l'utente non ha ancora salvato è il dato più
privato che un vault contenga; una `draft_write` sull'`HostApi` lo consegnerebbe
a ogni plugin montato, compresi quelli che a M5 non scriviamo noi. Quelle due
porte non aspettano un cliente: aspettano di non averne mai.

La **lettura** invece sta sul canale di tutti (`IndexQuery::Drafts`), perché
*leggere non è cambiare* ([0085](0085-leggere-non-e-cambiare.md)) e ritrovare
ciò che si stava scrivendo è la lettura più innocua che ci sia — è chi decide
*cosa farne* a mutare qualcosa.

### Il kernel manda i fatti e tace sul giudizio

`DraftInfo` porta `base` (la revisione da cui il buffer si è discostato,
**quando chi l'ha scritta la sapeva**), `current` (quella del file adesso) ed
`exists` (la nota c'è ancora?). Non porta una risposta, e non deve: *tenere il
mio testo o quello sul disco* è una domanda che si fa a una persona, non un ramo
di un `if`.

`base` è opzionale e vuol dire **«non lo so»**, non «nota nuova» — quello lo
dice `exists`. La distinzione sembra pedanteria e non lo è: la shell di oggi non
ha modo di calcolare quell'impronta (il kernel non gliela affaccia, e
ricalcolarla in TypeScript vorrebbe dire una seconda implementazione della
stessa funzione, cioè due verità), quindi passa `null` — e il modulo che giudica
ha un caso `incerta` separato da `divergente`. Trattare ogni incertezza come il
caso peggiore avrebbe insegnato a cliccare senza leggere, che è il modo di
perdere il testo il giorno in cui il conflitto è vero.

**Cosa il kernel non fa: raccogliere.** Lo spazio per-documento
([0044](0044-lo-stato-per-documento.md)) si pota da sé perché non ha senso senza
la nota; una bozza ce l'ha eccome quando la nota non c'è più — anzi è il caso in
cui vale di più, perché è rimasta l'unica copia. Una bozza **orfana** si mostra
e si butta con un gesto, non con uno sweep silenzioso: il criterio della
[seduta 20](../roadmap/20-quando-qualcosa-va-storto.md) è che un dato autorevole
non si perde in silenzio, e qui il dato autorevole è il testo. Segue invece la
rinomina, accanto all'organizzazione e allo spazio per-documento e per la stessa
ragione con un motivo in più: chi rinomina una nota mentre il buffer è sporco
non deve poter perdere il testo per essere passato dal nome nuovo.

### Il recupero è un buffer, non un dialogo

La shell precarica le bozze recuperabili come **buffer sporchi**, e non riscrive
niente sul disco. È la scelta che tiene la decisione all'utente e che non
richiede una superficie nuova: la nota recuperata si comporta come una che si
stava scrivendo — pallino sulla tab, «Non salvato» nella barra di stato, i gesti
di sempre per tenerla o buttarla. E ha una conseguenza che vale più
dell'economia di codice: chi apre il vault per leggere qualcosa non viene
fermato da una domanda modale. Il testo c'è, lo trova quando apre quella nota, e
intanto una notifica gli dice che c'è.

Le bozze **superate** — il disco contiene già quel testo, che è il caso normale
dopo una chiusura ordinata — non arrivano fin lì. Un pannello di recupero che si
apre a ogni avvio con dentro niente di utile è un pannello che si impara a
chiudere senza leggere: cioè che non sarà letto nemmeno il giorno in cui conta.

## I comandi di manutenzione: la casella andava riformulata, non eseguita

La casella diceva: *«`rebuild_index`, `vault_health`, `diagnostic_bundle`,
`repair` — come `CommandProvider`, non come comandi Tauri»*. Misurando prima di
eseguire, uno dei quattro si è rivelato **già altrove**, e non nel posto
sbagliato: `vault_health` è una `IndexQuery` che risponde `Paged<HealthIssue>` —
una terza forma che la casella non contemplava, né comando né comando Tauri.

Resta una query, e la casella si riformula. La salute del vault **è una
lettura**, e una lettura che risponde con dati non può essere un comando: un
`CommandOutcome` porta un messaggio e un effetto, non dati — è la riga che
divide della [0013](0013-elenco-delle-capacita.md), e vale qui come altrove. Gli
altri tre sono **mutazioni**, e quelle sì che vogliono il registro.

Misurando è venuto fuori anche il fatto che rende questa riformulazione più di
una questione di forma: `IndexQuery::VaultHealth` **non aveva nessun lettore**.
Nessuna riga di TypeScript la chiedeva. Era una porta aperta su una stanza dove
non entrava nessuno — la sesta specie del §16.7, una garanzia dichiarata che non
serviva a niente. Adesso un lettore ce l'ha, ed è il rapporto diagnostico, che
di mestiere fa esattamente questo: mettere in un posto solo i fatti che servono
a capire un guasto. Il pannello per una persona resta del §7.2, dove stanno le
altre trenta domande di quella famiglia; qui non ci sarebbe stato per la ragione
giusta — non è recovery.

### La regola riusabile: la dichiarazione sta nel registro, l'esecuzione sta dove sta il potere

Questa è la parte che vale oltre la voce, ed è la
[0086](0086-una-cronologia-e-la-sua-porta.md) generalizzata.

Là si era imparato che un comando scritto in `fub-features` non può toccare lo
stato di vista, perché il proprietario non è un parametro: **non ci arriva**.
Qui succede lo stesso tre volte e per un motivo più forte di un recinto: ciò che
questi comandi fanno non sta sull'`HostApi` **affatto**. Rifare l'indice,
camminare il disco, leggere il registro delle mutazioni — nessuna di queste è
una capacità, e nessuna deve diventarlo. Aggiungerla vorrebbe dire dare a ogni
plugin montato il potere di ributtare l'indice del vault, per servire tre
comandi che sono nostri.

La 0086 aveva risolto pagando un prezzo: `shell.history.clear` è un comando di
shell, quindi **non invocabile da CLI né da un'automazione**. Qui quel prezzo
non si paga, e la differenza è la forma che questo verbale propone: le
`CommandSpec` passano dalla **porta di tutti** — stesso `admit`, stessa
convalida degli argomenti, stessa chiave di scorciatoia fabbricata dal registro,
stesso posto negli elenchi — e a separarsi è **solo chi le esegue**. Il
risultato è che i tre comandi sono in palette, rimappabili, componibili in una
macro e raggiungibili dalla CLI del §27.1 il giorno che ci sarà, senza che una
sola capacità nuova compaia sul confine.

Il costo è dichiarato invece che nascosto: `Maintenance::invoke` non viene mai
chiamata, e il suo corpo è un errore che dice perché. Un test presidia che i tre
id siano davvero nel registro, così che il giorno in cui qualcuno li spostasse
in un ramo privilegiato senza spec, la cosa si veda.

E c'è un difetto che un test ha trovato **prima** che questa riga fosse scritta,
e che vale la pena registrare perché è il modo tipico in cui un ramo
privilegiato sbaglia: il primo tentativo intercettava con un ritorno anticipato,
*sopra* la coda comune. Il test ha visto arrivare all'utente una chiave di
catalogo invece di una frase — perché la localizzazione dell'esito
([0040](0040-chi-localizza.md),
[0041](0041-un-errore-e-testo-che-qualcuno-legge.md)), il completamento del
piano e il drenaggio della coda stanno **dopo**, e valgono per ogni comando. Il
ramo giusto è dentro, non prima. *Un'esecuzione privilegiata si separa su chi
esegue, non su cosa succede attorno.*

### I tre, e la riga che li tiene separati

- `vault.rebuild-index` butta il **derivato** e lo rifà. È sicuro per
  definizione: ciò che tocca è ricostruibile per classe.
- `vault.repair` fa ciò che il rebuild **non** fa — raccoglie gli spazi
  per-documento rimasti orfani — e soprattutto **dice ciò che non può
  riparare**: le righe di registro illeggibili, le bozze che non si sono lette,
  le bozze rimaste senza la loro nota. Senza quella seconda metà i due comandi
  avrebbero avuto lo stesso corpo con due nomi.
- `vault.diagnostic-bundle` scrive un file con i fatti che servono per chiedere
  aiuto. Il file è un **derivato** e sta in `.fub/data/`: è una copia di cose
  che stanno altrove, quindi si può buttare — la classe applicata al caso in cui
  è facile sbagliarla.

Nessuno dei tre tocca una nota. La manutenzione qui dentro ripara ciò che Fub si
è costruito, non ciò che l'utente ha scritto; un comando che «aggiusta» un
documento è un'altra cosa e ha un'altra voce.

## Il prezzo, e cosa resta fuori

**Una variante in coda a tre enum del contratto.** `IndexQuery::Drafts`,
`QueryKind::Drafts`, `IndexResult::Drafts`, più il record `DraftInfo`. È
additiva, quindi non scade col freeze — ma il banco di conformità ha insegnato
una riga che non era scritta da nessuna parte e adesso lo è: **l'ordine dei casi
è il discriminante dell'ABI**, quindi una variante messa accanto alla sua vicina
di senso rinumera tutte quelle dopo. *Additiva vuol dire in fondo.* Il primo
tentativo l'aveva messa accanto a `vault-health`, ed era una rottura silenziosa
che nessuno avrebbe visto finché un guest compilato prima non avesse chiesto una
query e ne avesse ricevuta un'altra.

**Il debounce della bozza è più lungo di quello del salvataggio**, non più
corto, e non è una svista: i due non fanno la stessa cosa. Il salvataggio è la
strada normale e va veloce; la bozza è la rete sotto e deve costare poco. Che
l'autosave scatti dopo 400 ms non rende inutile la rete, perché i 400 ms non
sono il caso interessante: i casi sono il salvataggio che **fallisce** (e lì la
bozza si scrive subito, senza aspettare il debounce, perché l'unica copia è in
RAM), la nota mai salvata, e la finestra fra l'ultima battuta e la scrittura.

**Una bozza che non si scrive non si racconta all'utente**, ed è deliberato: è
una rete che gira di fianco al lavoro vero, e un avviso per ogni bozza mancata
insegnerebbe a ignorare gli avvisi — lo stesso difetto che `cambioSotto` esiste
per non avere. Chi vuole saperlo lo trova nel rapporto diagnostico.

**Non c'è la potatura**, e non serve: le bozze non sono un file che cresce in
coda: sono una per documento aperto e sporco, e si buttano al primo salvataggio
riuscito. L'unica che resta è l'orfana, che resta **apposta**.

**Restano di chi li userà**, come la 0067 aveva già dichiarato: il rollback
vero, l'audit (23.3) e la transazione atomica del 22.4. E resta il pannello per
una persona dei controlli di salute, che è del §7.2 e non di qui.
