# 0096 — Una bozza non è una nota

**Data:** 2026-08-04
**Voce:** [§23.10](../roadmap/23-cosa-costano-le-decisioni-chiuse.md#2310-le-bozze-si-leggono-con-il-permesso-di-leggere-il-vault)
**Commit:** *(questo commit)*

## Il fatto

`IndexQuery::Drafts` passava da `Capability::Query`, che mappa su
`fub:read-vault`. Cioè: **qualunque plugin che potesse leggere un documento
salvato poteva leggere ciò che l'utente stava scrivendo in quel momento**, e le
due cose erano concesse dalla stessa spunta nello stesso manifest. Il `Guard`
non distingueva le varianti di query, e nell'elenco dei permessi non c'era
niente che nominasse le bozze.

Adesso c'è una famiglia in più — `Capability::Drafts`, con il permesso
`fub:read-drafts` — e `IndexQuery::Drafts` passa **di lì e non da `Query`**. Le
famiglie del `Guard` vanno da sedici a **diciassette**; nessuna firma cambia,
quindi **nessun ritaglio**, e il WIT non è toccato nemmeno nei commenti (un
permesso è una chiave di `option-map`, non un tipo del contratto).

## La voce chiedeva di essere decisa insieme alla §23.5, e non lo è stata

Il sottotitolo della §23.10 diceva due cose: *«va decisa **insieme** alla §23.5
e **prima** della §23.3»*. La 0095 ha chiuso la §23.5 **da sola**, un commit fa.
L'*insieme* è quindi già saltato, e questo verbale è la prova che la voce sapeva
cosa sarebbe successo: la sua prima casella dice *«le due si decidono insieme o
si decidono due volte»*, ed eccoci alla seconda volta.

Vale la pena scriverlo, perché è un modo nuovo in cui una voce invecchia — la
seduta 23 ne aveva censiti tre (la premessa vera e il mondo che si muove sotto,
la premessa incompleta il giorno stesso, la premessa che rende la voce *più*
grave). Questo è il quarto: **una voce che dichiara un ordine e viene scavalcata
da quella con cui doveva stare insieme**. Non è un difetto della 0095, che
l'ordine dichiarato dalla §23.5 l'ha onorato; è che un ordine scritto in una
voce lo legge chi apre *quella* voce, e la §23.10 non l'ha aperta nessuno. La
lezione è piccola e riusabile: **un ordine scritto in una voce va cercato anche
nelle voci che la nominano**, non solo in quella che si sta per fare.

Il *prima della §23.3* invece regge ed è stato onorato qui, e per la ragione che
la voce dà: finché non c'è rete, chi legge le bozze non ha dove mandarle. La
§23.3 è il commit successivo.

## Il caso migliore c'era davvero, ed è stato misurato

La terza casella chiedeva di guardare per primo il caso migliore: *«va
verificato se **qualche** provider registrato interroghi `Drafts`: se la
risposta è nessuno, il cancello non costa niente a nessuno e la voce si chiude
in una riga»*.

La risposta è **nessuno**, e il conto è stato fatto invece che assunto. Di
`IndexQuery::Drafts`, in tutto il workspace, esistono: chi la serve
(`index/core.rs`), chi la conta in manutenzione, i campioni del mirror TS e due
test del kernel. **Nessuna feature ufficiale** la interroga, e nessun
`ViewProvider` registrato. Il cliente vero — il pannello di recupero dopo un
crash — è della **shell**, che chiama `ws.query_index(…)` diretto sul workspace
e non attraverso un `Guard`: non è un plugin, quindi non ha permessi da
dichiarare e questo cancello non la tocca. Anche `PluginPermissions::core()`
resta **invariata**, perché il core non legge le bozze e un permesso preso «per
completezza» è il difetto che la riga di `write-settings` lì accanto ha già
rifiutato una volta.

Il prezzo di questa decisione, misurato, è **zero righe di chiamante**. È il
caso migliore che la voce sperava, ed è raro abbastanza da valere la riga: quasi
sempre recintare qualcosa costa a qualcuno.

## La domanda vera: una classe a sé, o vault come il resto?

La prima casella la pone bene: *«il contenuto che l'utente non ha consegnato al
disco è una classe a sé, o è vault come il resto?»*.

**È una classe a sé**, e le ragioni sono tre, in ordine di forza.

La prima la scrive la [0088](0088-cio-che-non-e-ancora-successo.md) e non è
retorica: *«il testo che l'utente non ha ancora salvato è il dato più privato
che un vault contenga»*. Da quella frase la 0088 deduce, e bene, che la
**scrittura** delle bozze non sarà mai una capacità. Ciò che non ha fatto è
applicare la stessa frase alla lettura, e l'argomento con cui l'ha concessa —
*«leggere non è cambiare»*, della [0085](0085-leggere-non-e-cambiare.md) —
risponde alla domanda sbagliata: protegge l'**integrità**, mentre la minaccia
che quella frase nomina è la **riservatezza**. Contro la riservatezza, leggere è
esattamente il verbo che conta. Un plugin che legge le bozze e le manda altrove
non cambia niente.

La seconda è una differenza di forma, e si vede solo mettendo le due domande una
accanto all'altra. **Un documento salvato lo si legge nominandolo**:
`read_document(id)` chiede *quel* file, e chi concede `read-vault` concede una
superficie che si percorre un nome per volta. `IndexQuery::Drafts` non prende un
`DocId`: prende una pagina, e rende **tutte le bozze col testo dentro**. Non c'è
un nome da chiedere perché non c'è niente da nominare — la risposta è l'elenco
completo di ciò che l'utente sta scrivendo adesso. È la stessa aggravante che la
0095 ha trovato per la selezione (*chi legge la selezione riceve senza chiedere
ciò che l'utente sta facendo*), arrivata da un'altra strada.

La terza è che una bozza è **l'unica copia**. Lo scrive già la
[§23.1](../roadmap/23-cosa-costano-le-decisioni-chiuse.md#231-una-rinomina-fatta-ad-app-chiusa-scollega-tutto-ciò-che-è-indicizzato-per-path)
(«una bozza orfana è l'unica copia rimasta») e lo ripete `drafts.rs` nel
paragrafo sul perché non si raccoglie. Un documento salvato che un plugin legge
esiste comunque sul disco; una bozza è testo che **non esiste da nessun'altra
parte**, e il verso in cui si sbaglia lo dice la seconda casella: *un permesso
di troppo costa a un plugin una riga di manifest; un permesso di meno costa
all'utente il testo che stava scrivendo*.

## Al posto di `read-vault`, non sopra: è qui che si è deciso qualcosa

La casella diceva *«se è una classe a sé, il permesso è uno solo e copre
entrambe»* — sottinteso: la selezione della §23.5 e le bozze di questa. È la
sola frase della voce che non regge, e il perché vale più della correzione.

I permessi della 0095 governano la **sessione**: cosa l'utente sta guardando
*adesso*, pubblicato dalla shell a ogni movimento del cursore, e vivo quanto il
pannello che ha il focus. Una bozza è l'opposto su tutti e tre gli assi: **sta
sul disco** (`.fub/drafts/`, un file per bozza, classe autorevole per la
[0048](0048-una-radice-sola.md)), **sopravvive alla sessione** — è nata per
sopravvivere a un crash — e **non riguarda la nota aperta** ma tutte quelle con
un buffer sporco, comprese quelle di ieri e quelle la cui nota è stata
cancellata. `fub:read-selection` su una bozza sarebbe lo stesso riuso fuori
grana che la 0095 ha rifiutato per `read-vault`: economico oggi, e una decisione
presa di nascosto domani.

Deciso invece — e questa è la scelta di prodotto del verbale — che
`Capability::Drafts` stia **al posto** di `Capability::Query` su quella
variante, e non **sopra** di lei. Cumulativa era la forma ovvia, ed è quella che
la simmetria con `undo_last` (due `check` su un metodo solo) suggeriva. È stata
scartata contando le frasi che l'utente può dire:

- **al posto**: si può dire *«puoi cercare nelle mie note, non puoi leggere ciò
  che sto scrivendo adesso»* **e** *«puoi ritrovare ciò che non ho salvato, il
  resto del vault no»*;
- **sopra**: solo la prima. La seconda diventa inesprimibile, perché un pannello
  di recupero dovrebbe chiedere l'intero vault per leggere il testo che l'utente
  non gli ha consegnato.

E la seconda frase non è ipotetica: **è l'unico cliente che questa domanda abbia
mai avuto**. Un recupero dopo un crash vuole le bozze e nient'altro —
`DraftInfo` porta già `exists`, `base` e `current`, cioè tutto ciò che gli serve
del vault. Farlo dipendere da `read-vault` sarebbe *un permesso troppo grosso
per la cosa che si fa*, che è la definizione con cui la §23.5 descriveva il modo
in cui i permessi smettono di significare qualcosa.

Che questo non sia una **scala** verso il vault è la parte da presidiare, ed è
presidiata: `read-drafts` apre la sola variante `Drafts` e nessun'altra
(`granting_drafts_alone_does_not_open_the_index`). Chi lo ottiene vede ciò che
l'utente non ha salvato e nient'altro — che è una superficie più piccola di
`read-vault`, non una scorciatoia per aggirarlo.

Vale anche notare cosa **non** cambia per chi c'è già: questo cancello è
strettamente una **sottrazione**. Nessun plugin guadagna niente, e ogni plugin
che leggeva le bozze con `read-vault` adesso deve dichiararlo. Che oggi non ce
ne sia nessuno è il motivo per cui la sottrazione non rompe niente; che un
domani ce ne sia è il motivo per cui va fatta adesso.

## Il cancello guarda un argomento, ed è la prima volta

`query_index` è un metodo solo e le famiglie sono due, quindi il `Guard` deve
leggere **quale** domanda passa. È il primo punto in cui guarda un argomento e
non solo il metodo, e va detto cosa questo non fa:

- **non spacca il canale dati** della [0019](0019-il-canale-dati.md). Resta una
  domanda sola, un instradamento solo, un `QueryRoute` solo. Ciò che cambia è
  chi può porla;
- **non allarga la `Policy`**, che continua a rispondere a nomi e a non sapere
  niente di query — la proprietà per cui comporne due non costa una impl da
  venticinque metodi;
- **non è senza precedente**: `undo_last` ricava da un metodo solo **due**
  famiglie (`Commands` e `VaultWrite`) perché due sono le cose che fa. Qui è la
  stessa mossa applicata a una richiesta invece che a un effetto.

La mappa non è un `match` con un `_`, ed è la parte che vale il codice.
`query_capability` è **esaustiva su `QueryKind`**: una famiglia di query nuova
**non compila** finché qualcuno non ha detto sotto quale permesso passa. Con un
ramo di scarto la variante nuova sarebbe atterrata su `Capability::Query`
restando verde — che è **esattamente** come `Drafts` ci è atterrata, e ci è
restata per otto verbali. Il difetto che questa decisione ripara è anche il
modello del difetto che il suo presidio impedisce di ripetere: è la forma di
`ReadOnly::denies`, dove un `match` esaustivo costringe a decidere invece di
lasciare che una famiglia erediti la risposta della vicina.

## I bit sono finiti, e se ne è accorto un `assert` scritto ieri

`CapabilitySet` teneva le famiglie in un `u16`. Con la 0095 erano diventate
sedici — **esattamente** i bit disponibili — e questa è la diciassettesima:
`1 << cap as u16` sarebbe andato in overflow, in debug con un panic, **in
release in silenzio**, cioè concedendo una famiglia a chi non l'aveva
dichiarata. Il cambio a `u32` è meccanico (il tipo e i due shift), ma è il
**primo limite strutturale** che questo elenco incontri da quando esiste, e per
questo sta scritto accanto al tipo invece che solo qui.

Due cose meritano una riga.

La prima è che a vederlo è stato un presidio e non una persona. L'`assert` in
coda a `i_discriminanti_coprono_ogni_famiglia` è stato scritto dalla 0095
*perché* i bit stavano finendo, e ha fatto il suo mestiere una riga prima del
danno. È la stessa specie del `wit_additivity` e del test che conta i verbali
della [0072](0072-un-numero-si-scrive-accanto-a-come-si-ricava.md):
un'affermazione scritta in un documento diventata una cosa che il compilatore o
la CI sa verificare. Adesso dice `u32::BITS` e la stessa riga se ne accorgerà
alla trentatreesima — e la nota accanto dice *allargare il tipo, non togliere
l'assert*, perché il modo di far tacere un presidio è sempre più a portata di
mano di quello di soddisfarlo.

La seconda è **perché** il cambio è stato meccanico, e non è un dettaglio
d'implementazione: `CapabilitySet` **non si persiste da nessuna parte**. Si
ricalcola da `Capability::ALL` a ogni registrazione di plugin, quindi allargare
il tipo non ha una migrazione dietro. Se un giorno lo si salvasse su disco — per
un inventario dei permessi già risolti, che è la cosa che verrebbe in mente —
quella proprietà se ne andrebbe con la prima riga, e questo cambio da mezz'ora
ne diventerebbe un altro. Sta scritto accanto al tipo.

## Perché non c'è ritaglio

Perché non cambia nessuna firma. `fub:read-drafts` è una **chiave** di
`PluginPermissions.granted`, che è un `option-map` — e la
[0017](0017-chi-disegna-cio-che-il-core-non-conosce.md) ha scelto quella forma
proprio perché l'insieme dei permessi non è chiuso: *«presente = acceso»*, e una
chiave nuova è un valore nuovo in una mappa, non un campo nuovo in un record.
`Capability` è un enum del **kernel** e non attraversa il confine.
`IndexQuery::Drafts` e `IndexResult::Drafts` restano identiche, byte per byte.

La tabella di [wit-congelato](../architecture/wit-congelato.md) è stata riletta
prima di concluderlo: nessuna delle rotture che elenca è in gioco qui. Ed è la
proprietà per cui questa decisione poteva essere presa anche dopo M4 — il che
non è un argomento per rimandarla, perché ciò che scade non è la firma ma il
numero di plugin scritti contro un permesso che non c'era.

## Cosa NON è questa decisione

**Non è una difesa contro un plugin ostile**, ed è il registro che la seduta 22
ha imposto e che la 0095 ha tenuto. A M4 un plugin nativo gira in-process: ha
già la memoria del processo, e con lei il disco. Il valore di questo cancello è
la **dichiarazione** — che l'utente possa vederla, e negarla — non
l'imposizione. Gonfiarlo sarebbe il difetto che questa seduta esiste per non
commettere.

**Non è un interruttore sulle bozze.** Che il buffer di crash esista, e cosa
tenga, resta una decisione della 0088 e della shell. Qui si decide **chi altro**
può leggerlo.

**Non è il filtro dei parametri.** Il permesso nasce senza parametro e non è una
dimenticanza: un'allowlist di prefissi su `Drafts` sarebbe possibile — una bozza
un `doc` ce l'ha, quindi un path da confrontare esiste, esattamente come per
`read-session` — ma è la casella del
[§7.1](../roadmap/07-il-confine.md#la-casella-rimasta), che ha una sua vita e un
suo criterio già scritto. Averla nominata qui è ciò che quella casella chiede;
scriverla qui sarebbe stato allargare la voce.

## Il presidio

Tre test, e due dicono la voce intera in un nome.

- **`denying_drafts_leaves_the_rest_of_the_index_readable`** — il primo verso
  della leva: l'indice si legge, le bozze no. Prima di oggi non era
  **esprimibile**, perché la stessa spunta apriva tutte e due.
- **`granting_drafts_alone_does_not_open_the_index`** — il secondo verso, quello
  che la forma cumulativa avrebbe reso impossibile. È il pannello di recupero:
  le bozze passano, l'indice no.
- **`the_two_permissions_are_not_the_same_key`** — che `read-drafts` non sia un
  nome nuovo davanti al cancello vecchio. Un `Granted` costruito col solo
  `fub:read-vault` concede `Query` e nega `Drafts`, che è la riga esatta che
  prima non si poteva scrivere.

Il presidio delle capacità simulate (`invoke_command.rs`) non ha avuto bisogno
di una riga, e la ragione è buona: calcola l'insieme atteso da `Capability::ALL`
filtrato da `ReadOnly`, e `Drafts` è **concessa** in simulazione — leggere non è
un effetto. Il conto si è aggiornato da sé, che è ciò per cui la 0094 lo aveva
riscritto così.

## Cosa resta fuori

- **Il pannello che i permessi li mostra.** Resta il pezzetto di §7.6 senza
  lettore, come già per la 0095: `PluginInfo` porta i permessi dichiarati alla
  shell — e `fub:read-drafts` ci è comparso da solo, senza che nessuno lo
  aggiungesse — ma nessuna superficie li rende ancora leggibili a chi decide.
  Finché è così, la leva esiste nel contratto e non ancora sotto le dita
  dell'utente.
- **Un'allowlist di prefissi su questo permesso**, per la ragione scritta sopra:
  è del §7.1.
- **La scrittura**, che non è rimasta fuori — è negata **per sempre** dalla
  0088, e questo verbale non la riapre.
