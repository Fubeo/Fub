# 26. Otto gesti che l'app fa e nessuno può dichiarare

Una **seduta** della [roadmap infrastrutturale](../todo.md): otto punti in cui
un gesto funziona — l'app lo compie, per sé — e **non esiste il dato che lo
dichiara**. Non sono funzionalità mancanti: sono porte mancanti fra un gesto e
il contratto, e finché non ci sono, ogni gesto nuovo si paga per intero.

**Otto delle otto sono chiuse.** La §26.6 con la
[0144](../decisions/0144-una-spunta-sola-diceva-due-cose.md), che ha spaccato
`fub:clipboard` in `fub:read-clipboard` e `fub:write-clipboard` finché farlo
costava sei righe e zero manifest da migrare — era la sola la cui finestra si
chiudesse prima del freeze. E la §26.3 con la
[0149](../decisions/0149-la-grammatica-di-un-accordo-e-salita.md), che non è
stata decisa ma **raggiunta**: la forma che raccomandava è arrivata da sé
mentre si riparava il difetto che questa voce stessa aveva depositato, e al
verbale è restato il residuo — dire la grammatica dove la legge chi non
compila il contratto. La §26.4 con la
[0150](../decisions/0150-il-piano-e-della-superficie.md), che ha detto **no** al
campo `layer`: il piano è della superficie e non della view, e una superficie in
più è additiva quanto il campo. E la §26.2 con la
[0151](../decisions/0151-il-terzo-registro-si-guarda-anche-senza-salire.md),
nella forma (b) che questa voce raccomandava: i 102 accordi montati sull'editor
adesso un banco li confronta coi due registri dichiarati, e le tre collisioni
che ne escono — `mod-f`, `mod-shift-\`, `mod-shift-l` — stanno scritte per nome,
perché un presidio rosso a tempo indeterminato non è un presidio, e chi tiene
`Ctrl+F` lo decide il fuoco (0156). E la §26.5 con la
[0152](../decisions/0152-il-bersaglio-di-un-clic-non-e-uno-stato.md), che ha
detto **no** al bersaglio del clic dentro `view-context` e ha riparato la
promessa che il contratto ne faceva: la specie è sbagliata, uno stato che dura
non ospita un fatto vero per un istante, e il bersaglio viaggerà con
l'invocazione il giorno che qualcuno lo chieda. E la §26.8 con la
[0153](../decisions/0153-non-c-e-una-terza-pila.md), che non ha aggiunto una
terza pila: una view di terzi che vuole il proprio annulla compone comandi, e il
prezzo di quella strada — `fub:run-command` per ognuna — è il metro che dirà
quando vale la pena di cambiarla. E la §26.1 con la
[0156](../decisions/0156-un-accordo-non-dichiara-un-ambito.md), che ha detto
**no** al campo `context`: un accordo non dichiara un ambito, il contesto si
deriva dal fuoco — dentro l'editor vince l'editor, fuori vince la shell — e i
tasti nudi restano fuori dal registro. Le tre collisioni di 0151 a runtime le
decide il fuoco, e `SCONTRI_NOTI` resta il lucchetto sugli elenchi. E la §26.7
con la
[0157](../decisions/0157-un-rilascio-aspetta-la-seconda-superficie.md), che ha
detto **no** al campo bersaglio su `ui-node`: il drag & drop resta della shell
finché non esiste una seconda superficie che trascina, e il vocabolario del
bersaglio è già quello della 0152 — viaggia con l'invocazione
(`ui-action.payload`), non con lo stato.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) ·
[i verbali delle decisioni chiuse](../decisions/README.md)

---

**Da dove viene questa seduta: da un corpus che prima non c'era.** La
[24](24-tre-firme-che-il-freeze-rende-definitive.md) l'aveva trovata un
consuntivo, la [25](25-sette-scelte-che-il-codice-ha-preso-senza-dirlo.md) una
rilettura. Questa l'ha trovata **una misura fra due elenchi**.

Il 2026-08-10 `docs/microfeatures/` è entrato nel repo: otto file,
[**424 gesti**](../microfeatures/) in forma di casella, collegati da
[FEATURES.md](../FEATURES.md). È la prima volta che questo repo ha scritto, alla
grana del singolo gesto, che cosa l'applicazione deve saper fare — 114 gesti
nominano un tasto per nome, e il resto si divide fra puntatore e superfici. *Il
424 e il 114 hanno il loro comando, e sta più sotto (§26.1, §26.2). Gli altri
due numeri di questa frase — una sessantina di gesti del puntatore, una ventina
di superfici distinte chiamate per nome contro le dieci che il contratto
dichiara — sono stime lette a mano, e per la regola che questa seduta si dà
(«ogni numero porta accanto il comando che lo rimisura») restano dichiarati come
tali: nessuna voce ci si appoggia.*

Poi cinque letture indipendenti hanno misurato quei 424 gesti **contro i
sorgenti di oggi**, a `3d6df0e`, ciascuna con una lente sola: la tastiera, il
fuoco, gli appunti e l'annulla, le superfici, il corpus stesso. Non cercavano
funzionalità mancanti — quelle le elenca già FEATURES.md — ma **il punto in cui
un gesto smette di poter essere un dato**. Ogni numero di questa seduta porta
accanto il comando che lo rimisura, e i numeri che due lenti hanno misurato
diversi sono stati ricontati prima di entrare qui.

**Che cosa questa seduta non è.** Non è l'elenco di ciò che manca a Fub: quello
sta in `FEATURES.md` e in `docs/microfeatures/`, e non è materia di roadmap
infrastrutturale. Le otto voci qui sotto sono **le porte** che quei 424 gesti
chiedono in comune — otto decisioni, non quattrocentoventiquattro
implementazioni. E il corpus resta ciò che è: un elenco di intenzioni, senza un
solo `[conta:]` e senza una sola riga di accessibilità, che nessun presidio
legge e nessuna scadenza governa.

**Una nona lente è stata passata e ha risposto «niente», e va scritto perché
nessuno la ripassi.** La domanda era: fra i 424 gesti, quali chiedono una
**superficie** — un posto dove qualcosa si ancora e si disegna — che il
contratto non nomina? Sembrava la più promettente delle nove, perché il corpus è
pieno di gesti che vogliono un posto: un tooltip col percorso del file
(`../microfeatures/vault-ed-esploratore.md:24`), la tendina per cambiare vault
(`:31`), il menu barra-obliqua ancorato al cursore
(`../microfeatures/block-editor-parita.md:9`), la maniglia del blocco al
passaggio del mouse (`:47`). Nessuno di questi apre una voce, e la ragione è una
sola e vale per tutti: **`ViewSurface` non è il vocabolario della UI dell'app, è
il vocabolario di ciò che un terzo può dichiarare.** Il tooltip, la tendina, la
barra di ricerca nel documento (`ui`, `panels/doc-search.ts`) e il menu
contestuale nativo (`ui/menu.ts`, chiamato da `panels/explorer.ts` in cinque
punti) sono componenti cablati nella shell, con un host loro, e non passano dal
protocollo: non c'è nessuna superficie che chiedono e non ottengono, perché non
la chiedono. L'unico punto in cui un gesto del corpus tocca davvero il
protocollo delle superfici è il menu contestuale — e lì la superficie **c'è**,
`context-menu` è nell'enum, e ciò che manca è un'altra cosa: il bersaglio del
clic. Ha già una voce, la
[§26.5](#265-il-menu-contestuale-la-superficie-cè-il-bersaglio-del-clic-no). Le
dieci superfici sono state rimisurate passando: dieci nell'enum
(`../../crates/fub-abi/src/traits.rs` `ViewSurface::ALL`), **otto ospitate** e
**due no** (`menu`, `context_menu`), che è il numero che questa seduta usa e non
quello che `ui-protocol.md` scrive.

**La lente dichiarata.** Ogni voce è stata guardata con la domanda che la
[§23](23-cosa-costano-le-decisioni-chiuse.md) ha reso un metodo di questo repo,
e che [todo.md:168-173](../todo.md) tiene scritta: *questa decisione toglie a
chi usa l'app qualità, libertà di modificare e scegliere, o privacy?* Le tre
risposte non sono un giudizio: sono il **§3 di ogni voce**, che si chiama «chi
paga» e nomina una persona per forma.

---

**Perché stanno insieme.** In tutte e otto il gesto **funziona**, e funziona
bene: la shell lo compie per il core, in un file, con un ascoltatore scritto a
mano. Non c'è niente di rotto che si veda. Ciò che manca è il **dato** — la
dichiarazione che rende quel gesto una cosa che si può guardare, cambiare,
spegnere o portare da fuori.

Ciò che manca, voce per voce:

* un contesto per un accordo (§26.1);
* un registro che raccolga gli accordi montati dentro l'editor (§26.2);
* una grammatica dichiarata di che cosa sia un accordo (§26.3);
* un livello che dica quale superficie prende il tasto (§26.4);
* un bersaglio che dica su che cosa è caduto il clic destro (§26.5);
* la grana che separi *leggere* gli appunti dallo *scriverci* (§26.6);
* un modo di dichiarare che un nodo accetta un rilascio (§26.7);
* un modo per una view di dire che ha un proprio annulla (§26.8).

**E c'è una seconda proprietà, che è la ragione per cui queste otto si decidono
insieme e non una per volta: in tutte e otto la mossa giusta il repo l'ha già
fatta accanto, su un problema confinante, e questo è il posto in cui non l'ha
fatta.**

* La [0077](../decisions/0077-una-scorciatoia-e-una-chiave.md) ha reso una
  scorciatoia una chiave d'impostazione: per i 32 comandi dei due registri che
  il presidio conosce, non per i tasti nudi (§26.1).
* La [0081](../decisions/0081-un-accordo-ha-un-proprietario.md) ha costruito il
  presidio dei conflitti: su due registri di cinque, e il terzo lo aveva
  indirizzato a una voce che si è chiusa senza guardarlo (§26.2).
* `crates/fub-abi/src/rules/` tiene dodici moduli di regole condivise fra i due
  lati del confine, e nessuno di loro è la grammatica di un accordo — che
  infatti è scritta due volte e diverge (§26.3).
* `frontend/src/theme/tokens.css:98-100` dichiara che l'ordine delle superfici è
  una lista in un posto solo: per i pixel, non per i tasti, ed è la ragione per
  cui i due ordini si contraddicono già oggi (§26.4).
* La [0079](../decisions/0079-il-grafo-esce-dall-overlay.md) ha aperto la
  superficie principale a chi non è il core: per una superficie, non per il menu
  contestuale, che il contratto nomina e che rimanda a un campo che non esiste
  (§26.5).
* La [0095](../decisions/0095-cosa-guardo-e-cosa-sto-scrivendo.md) e la
  [0096](../decisions/0096-una-bozza-non-e-una-nota.md) hanno spaccato due
  permessi perché una frase fosse esprimibile, e la stessa frase, sugli appunti,
  non lo era (§26.6 — la terza spaccatura l'ha fatta la
  [0144](../decisions/0144-una-spunta-sola-diceva-due-cose.md)).
* La [0140](../decisions/0140-dove-stanno-i-byte-di-un-kind-di-terzi.md) ha
  deciso dove stanno i byte di un kind di terzi, e il carico di un rilascio non
  ha nessuna chiave (§26.7).
* La [0045](../decisions/0045-l-undo-ha-due-pile.md) ha scritto che *«a decidere
  quale risponde è il fuoco»*: con due pile e due fuochi, che è il caso in cui
  la regola non serviva ancora (§26.8).

**Nessuna delle otto scade col freeze**, ed è misurato voce per voce: sei non
toccano il contratto affatto nella forma raccomandata, e le altre passano tutte
per la colonna additiva di `crates/fub-abi/tests/wit_additivity.rs:29-36`. Ciò
che scade è un'altra cosa, e va scritta perché nessun presidio la vede: la
**posizione**. Dopo M4 un campo si può solo accodare, e si accoda dietro a
chiunque si sia accodato prima.

**E l'additività non è tutta della stessa qualità**, il che riguarda le forme
che aggiungono un *caso* a un `variant` (le §26.7 e §26.8 ne hanno una ciascuna)
e non quelle che aggiungono un *campo* a un `record`. La riga 32 della tabella
dice che un caso in fondo è additivo; le righe **38-41**, subito sotto e spesso
non lette, dicono che *«nel component model aggiungere un caso a un `variant`
non è nemmeno additivo davvero; la regola che questo progetto ha scelto
(`abi_compatible`) dice che lo è»*. Chi sceglie una di quelle forme si appoggia
alla riga più debole della tabella, e deve saperlo: regge la lettera, non lo
spirito. Una sola voce aveva una scadenza più vicina del freeze, ed era la
§26.6: la sua finestra a costo zero si chiudeva col **primo manifest** che
scrivesse `fub:clipboard`, cioè prima di M3, non insieme. È stata chiusa per
prima, e con la finestra ancora aperta.

---

**Dove due voci si toccano, e perché va letto prima di aprirne una.** Otto voci
scritte una sotto l'altra si leggono come otto lavori indipendenti, e quattro
volte non lo sono. Chi ne prende una in mano deve sapere quale altra ha in mano
insieme, perché il danno non si vede il giorno in cui si decide: si vede il
giorno in cui la seconda arriva e trova la prima già scritta male.

1. **La §26.1 e la §26.4 sono la stessa domanda vista da due lati** — i tasti e
   i pixel. Tutte e due chiedono: *un elenco chiuso di nomi pubblici — gli
   ambiti di un accordo, i livelli di una superficie — si ricava leggendo le
   superfici che esistono, o si indovina oggi?* Tutte e due hanno la stessa
   forma cara (un campo nel contratto) e la stessa forma economica (una lista in
   un posto solo, di qua). **Decise separatamente producono due elenchi con due
   criteri di ammissione diversi**, e il primo terzo che dichiara una superficie
   dovrà tenerli allineati a mano. Vanno decise nella stessa seduta, oppure una
   va scritta come derivata dell'altra — e in quel caso la derivata è la §26.4,
   perché un livello si può ricavare da un ambito e non viceversa.
2. **La §26.4(b) e la §26.8(a) accodano un campo allo stesso `record`** —
   `view-spec` (`abi.wit:2889-2924`). Sono due voci diverse, in due punti
   diversi di questo file, e il WIT non se ne accorgerà: dopo M4 un campo si può
   solo accodare, quindi i due finiranno nell'ordine in cui sono state decise,
   che è l'ordine sbagliato per sempre se nessuno guarda. **Se si decidono a
   distanza, la seconda deve rileggere la prima.** È il costo che la §26.4
   dichiara al suo punto 5, e qui è il punto in cui si paga davvero.
3. **La §26.2(a) non è scrivibile senza la §26.1** — la §26.2 lo dice due volte,
   e la dipendenza ha una conseguenza che va nominata: **la riparazione di
   `Mod-f` non è un difetto, è dentro la §26.1.** Far sì che la tastiera della
   shell rispetti il fuoco *è* dare un contesto a un accordo. Per la regola
   scritta chiudendo la §25.3 — *«un difetto che dipende da una decisione non è
   un difetto»* — non si apre nessuna riga in tabella per `Mod-f`: si decide la
   §26.1 e cade da sé.
4. **La §26.5 e la §26.7 chiedono la stessa cosa al contratto**, con due parole
   diverse: *un nodo dell'albero dichiarativo può dire su che cosa è avvenuto un
   gesto* — il bersaglio del clic destro, il bersaglio del rilascio. Sono
   separabili, e possono restare separate; ciò che non può succedere è che
   arrivino **due vocabolari** per «questo nodo, quello lì». Chi decide la
   seconda usa il nome che ha scelto la prima. (La §26.5(b) chiede in più lo
   stesso elenco di nomi pubblici del punto 1.) La [0152](../decisions/0152-il-bersaglio-di-un-clic-non-e-uno-stato.md)
   ha scelto il nome — con l'invocazione, non con lo stato — e la
   [0157](../decisions/0157-un-rilascio-aspetta-la-seconda-superficie.md) lo
   riusa: il bersaglio del rilascio viaggerà nel `payload` di `ui-action`, e
   un nodo non dichiara se accetta un rilascio finché non esiste una seconda
   superficie che trascina.

---

### 26.1 Un accordo ha un contesto, o non ce l'ha

*chiusa · strato **contratto** · **P1** · [0156](../decisions/0156-un-accordo-non-dichiara-un-ambito.md)*

**1. La domanda.** Una scorciatoia vale **dovunque**, o vale **dove qualcosa ha
il fuoco**? E se vale in un contesto, chi lo dichiara — il contratto, la shell,
o nessuno?

**2. Che cosa si osserva oggi, misurato.** Censimento a `3d6df0e`.

Un accordo il cui **primo tasto è nudo** non è un accordo:
`frontend/src/ui/commands.ts:298-299` —
`const primo = accordi[0]!; if (!primo.mod && !primo.shift && !primo.alt) return null;`
Non è una svista, è presidiata: `frontend/src/ui/keybindings.test.ts:78-86`
pretende che `normalizza(k)` non sia nulla per ogni accordo dichiarato dai due
registri. Un comando con `Esc`, `Invio`, `Tab`, `F2`, `Canc` o `Home` **non
compila la CI**.

I gesti a tasto nudo però esistono, e sono rami `if`/`switch` dentro il widget
che li vuole — validi solo quando quel widget ha il fuoco.

Sono **35**, in **otto** file, contando ogni confronto su un valore di tasto
(uno `switch (e.key)` a otto `case` vale 8); con la convenzione «un sito = una
riga di sorgente» sono **22**. Il numero è stato ricontato apposta, perché due
misure indipendenti ne avevano dati due diversi.

| file | confronti | righe |
|---|---|---|
| `frontend/src/panels/explorer.ts` | 10 | 308 (`switch`, 8 `case`), 740, 741 |
| `frontend/src/ui/node.ts` | 7 | 1273, 1400 (×4), 1408, 1410 |
| `frontend/src/ui/palette.ts` | 6 | 381 (×2), 383, 387, 390, 489 |
| `frontend/src/panels/quick-switcher.ts` | 4 | 295 (×2), 298, 302 |
| `frontend/src/ui/a11y.ts` | 4 | 62 (×2), 127, 132 |
| `frontend/src/ui/menu.ts` | 2 | 133, 134 |
| `frontend/src/panels/search.ts` | 1 | 35 |
| `frontend/src/ui/commands.ts` | 1 | 439 |
| **totale** | **35** | |

**Il concetto «contesto» non esiste in nessun punto del percorso.**
`command-scope` (`crates/fub-abi/wit/fub/abi.wit:1500-1504`) è
`{writes, reach, reversible}`: dice cosa un comando **fa**, non **dove** vale.
`CommandSpec` (`crates/fub-abi/src/command.rs:103-119`) ha sei campi e nessuno è
un ambito. `avanza` (`ui/commands.ts:431-465`) riceve `(entries, attesa, e)` e
**non riceve il bersaglio dell'evento**; `mountKeyboard`
(`ui/keyboard.ts:39-51`) non lo guarda.

L'unico posto del repo in cui la nozione è nominata è di sfuggita, in un
verbale: `docs/decisions/0081-un-accordo-ha-un-proprietario.md:138` — «*vivono
solo dentro l'editor a fuoco, e alcuni devono vincere sulla shell*».

E dal lato di ciò che va costruito: **quarantacinque** dei 424 gesti di
`docs/microfeatures/` cominciano con un tasto nudo.

**Come si rimisura.**

```sh
# tutti i comandi di questo blocco si danno dalla radice del repo
grep -hE '^- \[ \]' docs/microfeatures/*.md | grep -vE 'Ctrl|Shift|Alt|Mod' \
  | grep -cE '\b(Esc|Invio|Tab|F[0-9]|Canc|Delete|Backspace|Home|End|Page Up|Page Down|[Ff]recce|freccia|spaziatrice)\b'
# 45
# il punto di partenza, non il totale: la convenzione che porta a 35 e a 22 è
# quella dichiarata nella tabella qui sopra, e il `\b` serve o `node.key` entra
grep -rnE '\be\.key\b' frontend/src/ | grep -v '\.test\.'
grep -n 'command-scope' -A 10 crates/fub-abi/wit/fub/abi.wit
```

**3. Le forme, e chi paga.**

- [ ] **(a) Un campo in fondo a `command-spec`** — `context: option<string>`
      (`"editor"`, `"tree"`, `"modal"`, `"canvas"`…), più un ambito attivo che
      la shell pubblica e che `avanza` legge. Paga **chi mantiene il
      contratto**: un campo per sempre, e la domanda «chi definisce i nomi degli
      ambiti» va decisa subito perché un nome è un contratto. In cambio i 45
      gesti diventano comandi rilegabili, il controllo dei conflitti smette di
      essere globale — due comandi possono avere `Escape` in due contesti
      diversi senza litigare — e un terzo può dichiararne uno.
- [ ] **(b) Solo shell: l'ambito è un suffisso dell'accordo**
      (`"Escape@modal"`), grammatica dentro `leggiAccordi`, zero WIT. Paga **chi
      scrive un plugin**: dichiara una stringa la cui sintassi non è nel
      contratto, e la scopre quando l'app gliela rifiuta. Più economica, e
      fragile nel punto in cui la §26.3 è già fragile.
- [ ] **(c) Com'è oggi.** Paga **l'utente**: quei gesti non li vede nella
      palette, non li rilega, non li spegne, e se due widget se ne contendono
      uno nessuno glielo dice. E paga **il terzo**, che non può portarne uno
      nemmeno dentro la propria view.

**4. Che cosa il repo ha già deciso qui vicino.**

* La [0081](../decisions/0081-un-accordo-ha-un-proprietario.md): un accordo ha
  un proprietario, e con lei è arrivato il presidio dei conflitti. La sua
  sezione «Cosa il presidio non copre» (righe 135-142) nomina il terzo registro
  e lo indirizza alla §18.2.
* La [0077](../decisions/0077-una-scorciatoia-e-una-chiave.md): una scorciatoia
  **è una chiave di impostazione**. È la ragione per cui l'utente può già
  rilegare i 32 comandi dei due registri dichiarati.
* La [0090](../decisions/0090-una-sequenza-e-una-modalita-che-scade.md): la
  **sequenza** (`Mod-k d`), che è una cosa diversa da un ambito. Una sequenza è
  uno stato temporaneo, un contesto è una condizione.
* La [0104](../decisions/0104-la-superficie-di-scrittura-si-presta.md):
  «l'editor è della shell» vuol dire *questo* editor, non l'editing.

**E c'è una decisione che va letta prima di tutte, perché è quella che questa
voce riapre.** Il tasto nudo non è escluso per svista: la
[0009](../decisions/0009-registro-dei-comandi.md) l'ha **deciso, con la sua
ragione scritta** (`0009:66-67`) — la shell onora il `keybinding` dichiarato *«e
ignora quelli senza modificatori perché ruberebbero una lettera a chi scrive»* —
e la [0090](../decisions/0090-una-sequenza-e-una-modalita-che-scade.md) l'ha
ribadito (`0090:171`: *«un modificatore che non esiste è un rifiuto, non un
tasto nudo»*). Quella ragione è **vera finché un accordo non ha un contesto**:
un `Escape` globale ruba davvero una lettera a chi scrive. La domanda di questa
voce è precisamente se togliere quel *finché*. Chi la decide non sta riempiendo
un vuoto: sta rispondendo a una decisione che ha già una ragione, e deve
misurarsi con quella.

**E il contesto non può passare dall'event bus, ed è già scritto perché.**
`docs/architecture/plugin-boundary.md:230`: farlo passare di là
«*significherebbe consegnare ogni battuta di tasto a ogni handler registrato*».

**E c'è un secondo buco, dichiarato in quattro posti, che questa voce tocca
senza esserlo.** `docs/architecture/plugin-boundary.md:934-951` scrive che nel
contratto **non esiste nessun evento di tastiera** — *«un provider riceve
`UiAction`, cioè un gesto già interpretato da qualcun altro»* — e la stessa
dichiarazione sta in `docs/roadmap/strozzature.md:65`, in
`docs/roadmap/leva.md:563` e nella
[0104](../decisions/0104-la-superficie-di-scrittura-si-presta.md) (`:261`: *«una
modalità modale è precisamente il caso che ha bisogno di un tasto nudo e non di
un gesto già interpretato»*). **Sono due cose diverse e vanno tenute separate**:
quel buco è *un terzo non riceve il tasto*; questa voce è *nessun tasto nudo è
dichiarabile, nemmeno dal core*. Decidere questa non apre quello — ma quello
senza questa non serve a niente, perché il gesto che arriverebbe non avrebbe
comunque un ambito in cui valere.

**5. Reversibile?** La **(a)** attraversa il WIT ma è **additiva**: un campo in
fondo a un `record` è nella colonna delle cose permesse
(`crates/fub-abi/tests/wit_additivity.rs:31`). Quindi **non scade col freeze**:
si può decidere dopo M4 senza pagare una migrazione. La (b) e la (c) non toccano
il contratto affatto.

**6. La raccomandazione: (a), e non prima di aver deciso i nomi.** Il campo è
una riga; la parte cara è l'elenco degli ambiti, perché un ambito è un nome
pubblico e i nomi non si ritirano. Conviene farlo quando esiste il **secondo**
consumatore — cioè quando una superficie nuova del corpus (il canvas, il
database, il viewer) chiede il proprio `Escape`: allora gli ambiti si leggono
dalle superfici che ci sono, invece di indovinarli.

**7. Che cosa resta rotto se non si decide.** Ogni gesto contestuale del corpus
entra come trentaseiesimo, trentasettesimo, trentottesimo confronto su `e.key`
dentro il widget che lo vuole. Non c'è niente di rotto che si veda: c'è una
superficie che cresce fuori da ogni registro, e un utente che sulla metà dei
propri tasti non ha nessuna voce in capitolo.

*Quello che si diceva e che non regge.* Tre affermazioni correnti, tutte e tre
false.

* «Le scorciatoie di Fub sono cablate in `main.ts`»: falso, e nel verso opposto.
  `main.ts` non contiene nessun `e.key`, `ctrlKey` o `metaKey`. C'è **un**
  `keydown` per i comandi (`ui/keyboard.ts:39`), e il commento a
  `main.ts:192-198` lo dichiara: «*La tastiera, in un punto solo, e su un
  registro solo […] La shell non cabla nessuna combinazione*».
* «L'utente non può rilegare»: falso. È la parte più curata del repo (verbali
  0077 e 0116).
* «Un plugin non può dichiarare un accordo»: falso. Un `CommandProvider` di
  terzi ottiene da solo una chiave `<ns>:keys.<nome>` riconfigurabile
  (`workspace.rs:4410-4483`).

Ciò che un plugin davvero non può fare è **un tasto nudo**, **un tasto con un
contesto**, e **un gesto dentro la superficie di scrittura**: tre cose diverse,
e sono le tre voci di questa seduta.

---

### 26.2 Cinque registri di tastiera, e il presidio ne guarda due

*chiusa · strato **shell** · **P1** ·
[0151](../decisions/0151-il-terzo-registro-si-guarda-anche-senza-salire.md)*

**1. La domanda.** Un accordo montato **dentro l'editor** è un accordo? Cioè:
deve stare in un registro che l'utente vede e che il presidio dei conflitti
legge, oppure è un dettaglio del componente che lo ospita?

**2. Che cosa si osserva oggi, misurato.** Censimento a `3d6df0e`. I registri di
tastiera sono **cinque**, non uno.

*Convenzione di conteggio, dichiarata perché due misure diverse davano due
numeri:* nel registro 5 si conta **ogni confronto su un valore di tasto**, non
ogni riga — uno `switch (e.key)` con otto `case` vale 8, e
`e.key === "ArrowDown" || e.key === "ArrowUp"` vale 2. Con l'altra convenzione
(un sito = una riga) il registro 5 vale **22** invece di 35, e nient'altro
cambia.

| # | dove | quanti | dichiarato? | riconfigurabile? |
|---|---|---|---|---|
| 1 | `SHELL_COMMANDS` (`crates/fub-host/src/shell.rs:59-89`) | 16 comandi, **13** con un accordo | sì | sì |
| 2 | i `CommandSpec` del kernel | 20 comandi, **1** con un accordo (`vault.undo` → `Mod-Alt-z`) | sì | sì |
| 3 | `obsidianKeymap` (`frontend/src/editor/editor-commands.ts:416-429`) | 14 accordi | no | no |
| 4 | `basicSetup` + `indentWithTab` (`frontend/src/editor/editor.ts:193-194`) | **88** dichiarazioni, **57** accordi vivi su Linux | no | no |
| 5 | rami di tastiera nel DOM | **35** confronti in **8** file | no | no |

Il presidio dei conflitti legge la riga 1 e la riga 2 e basta:
`frontend/src/ui/keybindings.test.ts:28-36`, `function tutti()` =
`command-keys.json` ∪ `SHELL_KEYS`. Le righe 3, 4 e 5 non le importa nessuno
(`grep -rn "obsidianKeymap" frontend/src/` → due occorrenze, entrambe dentro
`editor-commands.ts`).

**Il conto che ne esce**, in tre numeri disgiunti che sommano. Vanno letti con
la loro unità, perché due di loro sono facili da confondere: qui si contano
**comportamenti di tastiera che esistono**, non comandi rilegabili.

- **14** accordi partono dai due registri dichiarati: tredici di shell e uno del
  kernel. La superficie che l'utente può rilegare è più larga — **32** comandi,
  16 di shell più 16 del kernel (quindici in `CoreCommands::specs()`,
  `commands.rs:1005-1108`, più `version.restore` di `VersioningCommands`,
  `versioning.rs:1747`; non ci sono altri `impl CommandProvider` fuori dai
  banchi) — perché `Workspace::keybinding_specs`
  (`crates/fub-kernel/src/workspace.rs:4468`) emette una chiave `keys.*` per
  **ogni** comando, anche per quelli che partono senza accordo — ma un comando
  senza accordo non è un tasto che si preme, e in questa somma non entra.
- **102** dichiarazioni di binding montate sull'editor che **nessun registro
  conosce**: 88 del registro 4 (87 di `basicSetup` più `indentWithTab`) e 14 del
  registro 3. Sono 102 *dichiarazioni*, non 102 accordi: sette sono duplicati
  fra i due insiemi — `Mod-i`, `Enter`, `Mod-Enter`, `Mod-d`, `Alt-ArrowUp`,
  `Alt-ArrowDown` stanno sia in `obsidianKeymap` sia in `basicSetup`, e il `Tab`
  di `indentWithTab` è già in `obsidianKeymap`. **Gli accordi distinti sono
  95.**
- **35** confronti di tasto nel DOM, che non sono accordi affatto.

Sono **151** comportamenti di tastiera (14 + 102 + 35), e **137** — cioè tutti
tranne i quattordici della prima riga — non passano da nessun registro che
l'utente veda o che un presidio confronti.

**E le collisioni ci sono già.** Normalizzati i tre elenchi e confrontati, tre
accordi di `SHELL_KEYS` collidono con `basicSetup` — verificati uno per uno,
simbolo per simbolo:

```
Mod-f        shell.doc.search        e  openSearchPanel        (searchKeymap)
Mod-Shift-l  shell.mode.live         e  selectSelectionMatches (searchKeymap)
Mod-Shift-\  shell.pane.split.down   e  cursorMatchingBracket  (defaultKeymap)
```

⚠️ **La terza non si conferma col `grep` ovvio.** In `@codemirror/commands` la
forma letterale è **`Shift-Mod-\`**, non `Mod-Shift-\`: CodeMirror normalizza
l'ordine dei modificatori al confronto, quindi l'accordo è lo stesso e la
collisione è reale, ma `grep 'Mod-Shift-\\'` dentro `node_modules` non trova
niente e porta a concludere che non esista. Chi la cita, citi anche la forma
letterale.

Il primo scatta due volte davvero, e la catena è di quattro anelli: nessun
binding di CodeMirror dichiara `stopPropagation` (default `false`), quindi
l'evento gestito dall'editor **risale a `document`**, dove `mountKeyboard`
(`frontend/src/ui/keyboard.ts:39`) lo passa ad `avanza` senza guardare
`e.target`. `Ctrl+F` dentro una nota apre il pannello di ricerca di CodeMirror
**e** l'overlay di `apriRicercaNellaNota`
(`frontend/src/panels/doc-search.ts:78`).

**E non è un difetto misurato, per la regola di questo indice.** Ripararlo vuol
dire rispondere a *«quando l'editor ha il fuoco, l'accordo della shell scatta
ancora?»*, che è parola per parola la domanda della
[§26.1](#261-un-accordo-ha-un-contesto-o-non-ce-lha) — e un difetto la cui
riparazione dipende da una decisione non è un difetto. Sta qui come **sintomo
misurato** della §26.1, non come riga di tabella.

**Come si rimisura.**

```sh
# registro 1: 16 righe, 13 con un accordo
awk 'NR>58&&NR<90' crates/fub-host/src/shell.rs | grep -cE '^\s*\("'
awk 'NR>58&&NR<90' crates/fub-host/src/shell.rs | grep -cE '^\s*\(".*Some\('
# registro 2: un solo CommandSpec dichiara un accordo
grep -rn 'with_keybinding' crates/ --include='*.rs' | grep -v '/tests/' | grep -v 'fn with_keybinding'
# registro 3: 14 voci, 14 accordi distinti
awk 'NR>415&&NR<430' frontend/src/editor/editor-commands.ts | grep -cE '^\s*\{'
grep -rn 'obsidianKeymap' frontend/src/     # chi lo legge: nessuno fuori dal file
# il registro 4 nei documenti: quattro righe, tutte di sfuggita
grep -rn 'basicSetup' docs/ --include='*.md' | grep -v '/\.fub/'
# registro 4: non è misurabile col grep — va eseguito.
# La sottoshell è obbligatoria, o il `cd` resta e i comandi dopo falliscono.
( cd frontend && node --input-type=module -e '
import {closeBracketsKeymap, completionKeymap} from "@codemirror/autocomplete";
import {defaultKeymap, historyKeymap} from "@codemirror/commands";
import {searchKeymap} from "@codemirror/search";
import {foldKeymap} from "@codemirror/language";
import {lintKeymap} from "@codemirror/lint";
const all=[...closeBracketsKeymap,...defaultKeymap,...searchKeymap,
           ...historyKeymap,...foldKeymap,...completionKeymap,...lintKeymap];
console.log(all.length, new Set(all.map(b=>b.linux??b.key)).size);'
)   # 87  57
# registro 5, convenzione A: 27 confronti + gli 8 case dello switch di explorer.ts
grep -rn --include='*.ts' -E '\.key\s*(===|!==)' frontend/src/ \
 | grep -vE '\.test\.ts|__fixtures__|\.e2e\.' \
 | grep -vE '\.spec\.key|node\.key|a\.key === b\.key' \
 | grep -coE '\.key\s*(===|!==)'
# il presidio, e ciò che legge
grep -n 'function tutti' -A 10 frontend/src/ui/keybindings.test.ts
```

⚠️ **Tre trappole di misura, tutte incontrate davvero.** Il pattern `e\.key`
**matcha anche `node.key`** («nod**e.key**») e `e.spec.key`, che sono chiavi di
impostazione e non tasti: senza le esclusioni il conto grezzo dà 29 righe e 35
occorrenze, e **quel 35 non è il 35 di convenzione A** — sono due numeri diversi
che coincidono per caso. Allo stesso modo `basicSetup` dà **87** oggetti *e*
**87** accordi distinti su tutte le piattaforme: due misure indipendenti, stesso
numero, e nessuna delle due conferma l'altra. E
`frontend/src/i18n/strings.ts:877` nomina `intrappolaFuoco` in una frase che
parla dei chiamanti di `onLingua`: non è una fonte sul numero di trappole.

**3. Le forme, e chi paga.**

- [ ] **(a) Il registro 3 sale nel registro 1** — i quattordici accordi
      dell'editor diventano comandi di shell con `run()` che chiama il comando
      CodeMirror, e portano l'ambito della
      [§26.1](#261-un-accordo-ha-un-contesto-o-non-ce-lha) (`"editor"`).
      **Questa forma dipende da quella voce**: senza un contesto, `Tab` e
      `Enter` non sono dichiarabili. E non **aspetta** soltanto quella voce: la
      **ribalta**, e va detto. La
      [0009](../decisions/0009-registro-dei-comandi.md) ha già deciso il
      contrario, con la sua ragione scritta (`0009:66-67`): la shell *«ignora
      quelli senza modificatori perché ruberebbero una lettera a chi scrive»*.
      La ragione è **giusta senza un ambito** — ed è esattamente ciò che un
      ambito scioglie. Chi prende questa forma sta riaprendo una decisione, non
      riempiendo un vuoto. Paga **chi mantiene la shell**, e il conto va fatto
      per intero perché è più lungo di come si scrive di solito:
      - quattordici righe in `SHELL_COMMANDS`;
      - ventotto stringhe in due cataloghi;
      - **quattordici `run()`** che chiamino il comando CodeMirror
        corrispondente;
      - la fixture di `shell_keys_mirror` rigenerata.

      È il costo unitario della forma (d) di questa stessa voce, moltiplicato
      per quattordici. In cambio l'utente rilega `Ctrl+B`, spegne l'auto-indent
      di `Tab`, e i conflitti diventano visibili al banco che li guarda.
- [x] **(b) Solo il presidio** — un mirror che emette `obsidianKeymap` e
      `basicSetup` in una fixture, e la fa entrare in `tutti()`. È la forma già
      in casa: `shell_keys_mirror.rs` fa esattamente questo per il registro 1
      ([0056](../decisions/0056-un-elenco-che-e-la-sorgente.md)). Paga **chi
      mantiene i presidi**: un file generato in più. Non dà **niente**
      all'utente — chiude la porta da cui entrerà la quarta collisione, e lascia
      le 102 dichiarazioni dove sono.
- [ ] **(c) Un `KeymapProvider`** — l'editor dichiara i propri accordi come
      **dato** attraverso il contratto, e allora anche un terzo può aggiungere
      un gesto di editing. Paga **chi mantiene il contratto**: un'interfaccia
      nuova, più la domanda «chi esegue», a cui la
      [0077](../decisions/0077-una-scorciatoia-e-una-chiave.md) ha già risposto
      una volta con un `run()` locale.
- [ ] **(d) Com'è oggi.** Paga **l'utente**: su **137 comportamenti di tastiera
      su 151** non ha nessuna voce in capitolo. Chi vuole `Ctrl+B` per altro non
      può; chi ha una tastiera senza `` ` `` non può spostare
      `toggleInlineCode`; chi non vuole che `Tab` indenti non può. E paga
      **chi scriverà il corpus**, con gli interessi, perché **le due strade non
      costano uguale**. Mettere un gesto in `obsidianKeymap` è **una riga in un
      file**. Lo stesso gesto come comando di shell è una riga in
      `SHELL_COMMANDS`, la fixture rigenerata, un `run()`
      nella shell e due chiavi i18n in due cataloghi che il compilatore TS
      pretende esaustivi. La strada corta è quella che toglie all'utente la
      palette, la rilegatura e il controllo dei conflitti — e sarà quella che
      ogni gesto nuovo prenderà, non per cattiva volontà ma perché costa meno.

**4. Che cosa il repo ha già deciso qui vicino.** Questo buco è **dichiarato a
metà, e il suo proprietario è morto.** La
[0081](../decisions/0081-un-accordo-ha-un-proprietario.md), sezione «Cosa il
presidio non copre» (righe 135-142), nomina il **terzo** registro e scrive:
*«Sta scritto qui perché è la cosa che il prossimo conflitto userà per nascere;
è materia della §18.2, che è aperta»*. Era il 2026-08-03. Il giorno dopo la
[0090](../decisions/0090-una-sequenza-e-una-modalita-che-scade.md) ha chiuso la
§18.2 — *«Della §18.2 non resta niente»* — e il suo «Cosa resta» nomina **una**
cosa sola, che non è questa.

**E non era l'unico indirizzo a quella sezione.** La
[0045](../decisions/0045-l-undo-ha-due-pile.md) manda alla stessa §18.2 le
mutazioni che non passano da un comando (`0045:225`, *«il giorno che
diventeranno comandi (§18.2) entreranno da sole»*) — ed è la
[§26.8](#268-la-terza-pila-lannulla-dentro-una-view-che-non-è-del-core). **Due
verbali diversi, un destinatario solo, morto il giorno dopo.** Il fenomeno è più
grande di come lo racconta il paragrafo qui sotto, ed è la ragione per cui va
detto con un numero: gli indirizzi orfani noti sono **tre** — la keymap
dell'editor (0081), l'undo fuori dai comandi (0045), il filtro per prefisso dei
permessi (§15.5).

Il **quarto** registro non è ignoto ai documenti — è nominato in **quattro**
righe (`0093:46`, `0045:37`, `strozzature.md:130`, `decisions/README.md:106`) —
ma in tutte e quattro **di sfuggita e in un altro discorso**: come sorgente di
una funzione che c'era già (il multi-cursore, `Mod-d`, la history). Nessuna di
quelle righe lo tratta come un **registro di accordi**, nessun elenco lo
governa, e nessun presidio lo confronta. La previsione della 0081 nel frattempo
si è avverata: le collisioni sono tre.

**5. Reversibile?** Sì, tutte e tre. La (a) e la (b) non toccano il WIT affatto.
La (c) è un'interfaccia **nuova**, che
`crates/fub-abi/tests/wit_additivity.rs:34-35` mette fra le mosse additive:
**non scade col freeze**. Questa voce si può decidere dopo M4 in ognuna delle
sue forme.

**6. La raccomandazione: (b) subito e da sola, (a) quando la §26.1 è decisa.**
La (b) è l'unica delle tre che si paga una volta e protegge da tutte le
collisioni future, e va fatta **prima** di scrivere un solo gesto del corpus,
perché il suo valore è proporzionale a quanti accordi nascono dopo di lei. Ma va
fatta sapendo cosa succede: il presidio completo diventa **rosso su `Mod-f`** il
giorno stesso, ed è il modo giusto di scoprirlo. La (a) senza la §26.1 non è
scrivibile — `Tab` e `Enter` sono tasti nudi.

**7. Che cosa resta rotto se non si decide.** Non è che qualcosa si rompa: è che
il registro **quattro** cresce, uno alla volta, e ogni riga che ci entra è un
tasto che l'utente non potrà più cambiare e che nessun presidio confronterà con
gli altri. Le sezioni *Movimento cursore*, *Selezione*, *Tasti di modifica*,
*Operazioni su riga* e *Formattazione rapida* di
`docs/microfeatures/editor-di-testo.md` sono **trentasei** voci (7 + 10 + 9 + 6
+ 4), e la strada da una riga le prende tutte. *Da non confondere col
  quarantacinque della [§26.1](#261-un-accordo-ha-un-contesto-o-non-ce-lha):
  quello è un altro insieme — i gesti a tasto nudo di tutti e otto i file del
  corpus, non le voci di cinque sezioni di uno.*

*Quello che si diceva e che non regge.* Due affermazioni.

* «Il buco è tracciato»: è indirizzato a una sezione chiusa, e oggi non lo tiene
  nessun elenco. È il secondo caso del fenomeno che questo indice descrive già
  in prosa (*«un indirizzo dice chi potrà, non chi lo farà… con l'aggravante che
  sembra sistemata»*); il primo l'aveva pagato il filtro per prefisso dei
  permessi col §15.5.
* «Il registro dell'editor è uno»: sono due, e quello che nessuno ha mai
  nominato è il grande.

---

### 26.3 La grammatica di un accordo non sta nel contratto

*chiusa · strato **contratto** · **P2** ·
[0149](../decisions/0149-la-grammatica-di-un-accordo-e-salita.md)*

**1. La domanda.** «`Mod-k Shift-d`» è un accordo valido? La risposta oggi la
sanno **due funzioni**, in due linguaggi, e non è la stessa. Dove deve vivere la
regola?

**2. Che cosa si osserva oggi, misurato.** Il contratto dichiara il **tipo** e
non la sintassi: `crates/fub-abi/wit/fub/abi.wit:1513` è
`keybinding: option<string>`, e il doc Rust
(`crates/fub-abi/src/command.rs:112-114`) dà un **esempio** — *«es. `"Mod-p"`
(non vincolante: chi assegna davvero i tasti è la shell…)»* — non una regola.

La regola vera sta in quarantacinque righe di TypeScript
(`frontend/src/ui/commands.ts`: `MODIFICATORI` a 258, `leggiAccordi` 277-301,
`canonico` 319-325, `normalizza` 491-494), e dice quattro cose che nessun
documento del contratto scrive: i modificatori sono **tre** (`Ctrl-k` è
**rifiutato**, riga 289); non se ne può ripetere uno (290); il primo accordo
deve portarne uno (299); una sequenza si separa con spazi bianchi (281).

**Una seconda copia esiste già, e sta in un banco**:
`crates/fub-features/tests/command_keys.rs:126-135`, con il doc che dichiara
l'intenzione — *«come lo normalizza la shell»*. **Non è la stessa funzione.** La
copia Rust fa `split('-')` e non conosce lo spazio:

```
TS    normalizza("Mod-k Shift-d")  ->  "mod-k shift-d"
Rust  normalizza("Mod-k Shift-d")  ->  "k shift-mod-d"
```

Il banco che la usa — `no_two_official_commands_want_the_same_chord`
(`command_keys.rs:102-121`) — con due comandi ufficiali in sequenza
confronterebbe due forme canoniche sbagliate. **Oggi è dormiente**: zero comandi
ufficiali usano una sequenza. Si sveglia al primo, e ha una riga sua fra i
difetti misurati.

**La forma per non avere questo problema il repo ce l'ha, e l'ha usata dodici
volte.** `crates/fub-abi/src/rules/` contiene `carichi.rs`, `doc_data.rs`,
`events.rs`, `health.rs`, `ids.rs`, `media.rs`, `path.rs`, `path_policy.rs`,
`properties.rs`, `snippet.rs`, `tag.rs`, `text_policy.rs` — regole del contratto
rispecchiate in `frontend/src/rules/mirrored.ts` e legate da una fixture. **Non
c'è un `chord.rs`.** La grammatica degli accordi è l'unica regola condivisa del
repo che non è mai salita.

**Come si rimisura.**

```sh
ls crates/fub-abi/src/rules/                       # dodici moduli, nessun chord.rs
grep -n 'keybinding' crates/fub-abi/wit/fub/abi.wit
grep -n 'fn normalizza' -A 12 crates/fub-features/tests/command_keys.rs
grep -n 'MODIFICATORI\|fn leggiAccordi\|fn canonico' frontend/src/ui/commands.ts
```

**3. Le forme, e chi paga.**

- [x] **(a) `fub_abi::rules::chord`** — `normalize(&str) -> Option<String>`, i
      modificatori come dato, la gemella in `mirrored.ts` e la fixture che le
      lega. È la mossa della
      [0056](../decisions/0056-un-elenco-che-e-la-sorgente.md) e della
      [0115](../decisions/0115-la-verita-e-la-dichiarazione.md), già fatta
      dodici volte qui dentro. Paga **chi mantiene il contratto**: un modulo,
      una regola rispecchiata, una fixture. In cambio la copia nel banco
      sparisce, e un terzo può leggere la regola invece di scoprirla.
- [ ] **(b) Solo il difetto** — riscrivere `command_keys.rs:normalizza` perché
      splitti prima sugli spazi. Paga **chi mantiene i presidi**: quattro righe.
      Il banco smette di poter mentire, e le copie restano due.
- [x] **(c) La grammatica in prosa** nel doc di `keybinding` dentro `abi.wit`,
      senza codice condiviso. Paga **chi mantiene il contratto**: una frase. Un
      terzo la può leggere; le due copie restano e possono ancora divergere.
- [ ] **(d) Com'è oggi.** Paga **l'utente**, che l'accordo lo scrive **a mano**:
      la scheda «scorciatoie» delle impostazioni
      (`frontend/src/panels/settings.ts:506-540`) è fatta di campi di testo, e
      la grammatica che deve rispettare non sta in nessun documento — sta in un
      commento TypeScript (`commands.ts:229-255`). E paga **il terzo**, che da
      `CommandSpec` sa che il campo è una stringa e vede l'esempio `"Mod-p"`, e
      non ha modo di sapere che `Ctrl-k` sarà rifiutato, che `f` non sarà
      onorato, che uno spazio vuol dire sequenza. Lo scopre quando l'app glielo
      dice (`accordiRifiutati`, `commands.ts:531`) — che è il trattamento
      giusto, e arriva tardi.

**4. Che cosa il repo ha già deciso qui vicino.** La forma (a) non è
un'invenzione di questa voce: è la mossa della
[0020](../decisions/0020-le-regole-in-un-posto-solo.md), che ha **creato**
`fub_abi::rules` e la fixture del mirror proprio perché una regola che serve a
due lati del confine stia in un posto solo. Dodici moduli dopo, la grammatica
degli accordi è l'unica che non ci è mai salita. Le altre decisioni vicine:

* La [0136](../decisions/0136-una-regola-di-identita-di-un-nome-si-dichiara.md):
  *una regola di identità di un nome si dichiara*. Va citata anche per dire dove
  si ferma: il suo censimento copre quaranta funzioni in cinque famiglie, e
  l'accordo non è fra loro.
* La [0090](../decisions/0090-una-sequenza-e-una-modalita-che-scade.md) ha
  guardato questa stringa e ha concluso, correttamente **per la sua domanda**,
  che le sequenze costano *«zero firma e zero Rust»*, perché il contratto
  dichiara un tipo e non una sintassi. La domanda che non ha posto è **chi altro
  deve saper leggere quella stringa**: allora la risposta era «solo questa
  shell», e oggi i lettori sono due.
* La [0009](../decisions/0009-registro-dei-comandi.md) ha reso `keybinding` un
  `Option<String>`.
* La [0077](../decisions/0077-una-scorciatoia-e-una-chiave.md) ha fatto di una
  scorciatoia una chiave che l'utente scrive: cioè ha messo la grammatica in
  mano a chi non l'ha mai letta.

**5. Reversibile?** Sì, e **non scade col freeze**: una funzione in
`fub_abi::rules` è codice Rust che i due lati compilano, non una firma esposta —
nessuno dei dodici moduli di `rules/` compare in `abi.wit`. La (c) è prosa.

**6. La raccomandazione: (b) adesso, (a) al secondo lettore.** La (b) è quattro
righe e toglie un banco che può mentire: si fa e basta. La (a) è la forma giusta
e non è urgente, perché **il numero da cui cresce non è ancora cresciuto**: i
lettori sono due, e diventano tre solo con un secondo host a M5, una CLI o l'API
locale — tutti e tre nominati in `docs/architecture/plugin-boundary.md:354` come
chiamanti dello stesso registro. Il giorno che ne compare un terzo, questa voce
è già scritta.

**7. Che cosa resta rotto se non si decide.** Niente, finché nessun comando
ufficiale usa una sequenza. È l'unica voce di questa seduta che non ha una
vittima oggi — sta qui perché il suo innesco è **scritto**: il primo comando in
sequenza che qualcuno spedisce.

*Quello che si diceva e che non regge.* Che la sintassi degli accordi fosse nel
contratto: non c'è mai stata, e la 0090 l'ha già misurato. Ciò che non era stato
misurato è che nel frattempo ne fosse nata **una seconda copia** — dentro un
banco, con un commento che dichiara di essere la gemella, e che gemella non è.

---

### 26.4 Il livello di una superficie non è un dato

*chiusa · strato **contratto** · **P1** ·
[0150](../decisions/0150-il-piano-e-della-superficie.md)*

**1. La domanda.** Quando due superfici sono aperte insieme, chi sta sopra e chi
prende il tasto? È un fatto **dichiarato** — un livello che ogni superficie
porta con sé — o è la conseguenza di due cose scritte in due posti che non si
parlano?

**2. Che cosa si osserva oggi, misurato.** Censimento a `3d6df0e`. Gli ordini
sono **due**, e sono scollegati.

L'ordine **visivo** è dichiarato, in un posto solo, e con la ragione accanto:
`frontend/src/theme/tokens.css:106-116` — `--z-overlay: 50`, `--z-menu: 50`,
`--z-picker: 60`, `--z-popover: 70`, `--z-dialog: 80`, `--z-toast: 85`,
`--z-modal: 90`, col commento a `:98-100` che dice perché stanno insieme:
*«l'ordine è la lista»*.

L'ordine **della tastiera** non è dichiarato da nessuna parte: è l'ordine in cui
i gestori si sono registrati su `document`. Chi si è registrato **prima** vince
prima — cioè la superficie **più vecchia**, che è quella sotto.

**E i due ordini si contraddicono già oggi, senza plugin, con mouse e
tastiera.** `#settings-panel` sta a `--z-dialog` (**80**), con
`inset: 48px 10% 48px 10%` e sfondo opaco (`frontend/src/style.css:1564-1570`);
la classe `.modale` — che è quella delle tre modali (`ui/palette.ts:294`,
`panels/quick-switcher.ts:320`, `panels/doc-search.ts:189`) — sta a
`--z-popover` (**70**), con `padding-top: 12vh` (`style.css:909-918`). Si aprono
le impostazioni col pulsante, si preme `Mod-Shift-p`: **la palette prende il
fuoco e si disegna dietro il pannello delle impostazioni.** Chi scrive nel campo
non lo vede.

**Il contratto non ha il concetto.** `ViewSurface` nomina **dieci** superfici
(`crates/fub-abi/src/traits.rs:1566-1577`, presidiata a `traits.rs:4412-4476`),
e nessuna di loro è un livello: `view-surface` dice *a cosa ci si attacca*, non
*chi sta sopra* — e `docs/architecture/ui-protocol.md:164-166` lo scrive per
esteso, *«Non è un modello di layout»*. `ViewSpec`
(`crates/fub-abi/wit/fub/abi.wit:2889-2924`) porta
`surface, refresh, follows, params, icon, order, open_by_default, preferred_size, closable`:
`order` è l'ordine **fra le view della stessa superficie**
(`abi.wit:2910-2912`), non fra superfici.

**Come si rimisura.**

```sh
grep -n -- '--z-' frontend/src/theme/tokens.css
grep -rn -- '--z-' frontend/src/ | wc -l          # sedici righe...
grep -rhoE -- '--z-[a-z-]+' frontend/src/ | sort -u | wc -l   # ...ma sette nomi
grep -n 'z-index' frontend/src/style.css | grep -n 'settings-panel\|modale'
grep -n 'ViewSurface::ALL' -A 14 crates/fub-abi/src/traits.rs
```

**3. Le forme, e chi paga.**

- [ ] **(a) Solo shell: il livello è un parametro della trappola.**
      `intrappolaFuoco(root, chiudi, livello)`, e i sette token di `tokens.css`
      diventano il suo enum — un ordine solo per i pixel e per i tasti. Paga
      **chi mantiene la shell**: una quarantina di righe in un file, sette
      chiamanti toccati. Chiude il difetto e non dà niente a nessun terzo.
- [ ] **(b) Un campo `layer` in fondo a `view-spec`.** Paga **chi mantiene il
      contratto**: un campo per sempre, e va deciso **adesso** non perché scada
      ma perché dopo il freeze si può solo **accodare** — il campo si mette dove
      capita, dietro a chiunque abbia accodato prima. In cambio un terzo che
      porta una superficie propria — un viewer PDF, un lightbox, uno slash menu
      — dichiara dove sta invece di scoprirlo.
- [x] **(c) La shell deduce il livello da `view-surface`** (`modal` sopra
      `settings-tab` sopra `context-menu`…). Paga **chi mantiene la shell**:
      zero firma. E paga **il terzo per sempre**: due plugin che vogliono due
      livelli diversi sulla stessa superficie non hanno modo di dirlo.
- [ ] **(d) Com'è oggi.** Paga **l'utente**: i sette numeri stanno in un CSS del
      bundle, non c'è **nessuna** chiave che li nomini, e la contraddizione è
      raggiungibile con due gesti. Paga **il terzo**, che prende la propria
      sorte dal `z-index` che gli capita e dall'istante in cui si è registrato.

**4. Che cosa il repo ha già deciso qui vicino.** La mossa giusta il repo l'ha
già fatta, **su un solo lato**, e ha un nome: la
[0042](../decisions/0042-il-catalogo-della-shell.md) ha portato
`frontend/src/theme/tokens.css`, cioè il file che questa voce misura (dichiarata
anche in `docs/roadmap/strozzature.md:55` e `:123`). `tokens.css:98-100`
dichiara che l'ordine visivo è una lista in un posto solo, e la ragione è la
stessa che questa voce chiede di applicare all'altro ordine.

**E il precedente per la forma (a) è già in casa, a costo quasi zero.**
`frontend/src/theme/contrast.test.ts:59` importa `tokens.css?raw` e pretende una
proprietà **sui token** invece di fidarsi dell'occhio: un banco che legge quella
stessa lista e pretende che l'ordine dei livelli del fuoco sia il suo è la
stessa mossa, sullo stesso file, con lo stesso meccanismo.

* La [0079](../decisions/0079-il-grafo-esce-dall-overlay.md) ha aperto la
  superficie `main` a chi non è il core: ha già risposto una volta alla domanda
  «una superficie della shell può ospitare qualcosa che non è nostro».
* La [0007](../decisions/0007-contesto-di-sessione.md) ha deciso che cosa un
  contesto porta con sé, ed è il posto in cui un livello non c'è.

**5. Reversibile?** La (a) e la (c) non toccano il contratto. La **(b) è
additiva** — `crates/fub-abi/tests/wit_additivity.rs:31` mette «un campo **in
fondo** a un `record`» fra le mosse permesse, quindi tecnicamente **non scade
col freeze**. Ma si **irrigidisce**: dopo M4 il campo si può solo accodare, e
non lo si può più mettere dove starebbe bene. È una scadenza diversa da quella
del freeze, e va scritta perché non se ne accorge nessun presidio.

**6. La raccomandazione: (a) subito, (b) quando esiste la seconda superficie di
terzi.** La (a) è la riparazione del difetto e si paga una volta; è scrivibile
oggi e non pregiudica niente. La (b) va decisa guardando **superfici vere**: il
corpus ne nomina ventiquattro contro le otto di oggi (`docs/microfeatures/`,
sezione «Le superfici» della misura), e l'elenco dei livelli si legge da quelle
invece di indovinarlo — che è lo stesso argomento della §26.1 sui nomi degli
ambiti, e non è un caso: sono la stessa domanda vista dai pixel e dai tasti.

**7. Che cosa resta rotto se non si decide.** Ogni superficie nuova è una
trappola in più che risponde allo stesso `Escape` e un `z-index` in più scelto a
occhio. Il corpus ne chiede cinque di menu contestuali, più il viewer immagini,
il viewer PDF, il player, lo slash menu: otto superfici nuove, otto occasioni
perché i due ordini si contraddicano in un punto che nessuno ha guardato.

*Quello che si diceva e che non regge.* Che il problema fosse
l'**accessibilità** della trappola del fuoco: la trappola è scritta bene, in un
posto solo, col commento che dichiara l'invariante (`ui/a11y.ts:117-121`, *«È la
metà che si dimentica»*) e con il suo presidio (`ui/a11y.test.ts:221-239`). Il
difetto nasce **dall'averne due**, che è una cosa che nessuno dei due presidi
prova: entrambi i banchi di `a11y.test.ts` aprono **una sola** trappola.

⚠️ **Il censimento qui sopra è quello di `3d6df0e`, e la metà shell non è più
così.** Il difetto 0149 — la metà misurata di questa voce — è stato riparato:
l'ordine della tastiera adesso è **dichiarato**, e la regola è che comanda
l'ultima trappola aperta (`ui/a11y.ts`, con la pila delle trappole aperte); le
due superfici a tutto schermo che intrappolano il fuoco stanno sullo stesso
piano `--z-modal`, la regola che le lega sta scritta accanto ai piani in
`theme/tokens.css`, e `--z-overlay` — il piano che zero regole citavano — non
c'è più. La riparazione è la sostanza della **(a)** senza il parametro: l'ordine
si deduce dall'apertura invece di farlo scegliere a ogni chiamante, che è la
stessa ragione per cui la trappola sta in un posto solo. La domanda che le
restava è quella che la (a) non tocca — se un livello sia un fatto che una
superficie di terzi **dichiara**, la **(b)** — e l'ha chiusa la
[0150](../decisions/0150-il-piano-e-della-superficie.md) con un no: un terzo non
porta una superficie, ci si attacca, e il piano è della superficie; volere un
piano diverso è volere una superficie diversa, che si chiede aggiungendo un caso
in fondo a `view-surface` — additivo quanto il campo, quindi la decisione non
consuma nessuna occasione. Chi rilegge la §2 la rimisuri: il verbale ha trovato
tre trappole ancora sotto `--z-modal`, e l'ha scritto.

---

### 26.5 Il menu contestuale: la superficie c'è, il bersaglio del clic no

*chiusa · strato **contratto** · **P1** ·
[0152](../decisions/0152-il-bersaglio-di-un-clic-non-e-uno-stato.md)*

**1. La domanda.** Un terzo può aggiungere una voce a un menu contestuale? E,
prima ancora: **su che cosa** sarebbe quella voce — chi dice al comando che il
clic destro è caduto su *quella* riga dell'albero, su *quella* linguetta, su
*quel* link?

**2. Che cosa si osserva oggi, misurato.** Censimento a `3d6df0e`.

**Il contratto la nomina.** `crates/fub-abi/wit/fub/abi.wit:2872` ha
`context-menu` dentro `enum view-surface` (e `:2869` ha `menu`);
`crates/fub-abi/src/traits.rs:1575` ha `ViewSurface::ContextMenu`.

**La shell dichiara di non ospitarla**, per iscritto e con la ragione:
`frontend/src/ui/views.ts:190-193` —
`NON_OSPITATE = { menu: "questa shell non ha un menu applicativo", context_menu: "questa shell non ha un menu contestuale estendibile" }`
— e una view che la chiede riceve un avviso (`views.ts:259-268`). Questo pezzo
**non è una scoperta**: è già scritto in
`docs/architecture/ui-protocol.md:170-173`, in `docs/roadmap/strozzature.md:70`
e in `docs/roadmap/leva.md:45`.

⚠️ **Con un avvertimento per chi va a leggerlo.** Due righe sopra,
`ui-protocol.md:168` scrive *«Questa shell ne ospita sette»* e mette l'area
principale fra le tre che restano fuori. È **stantio dalla
[0079](../decisions/0079-il-grafo-esce-dall-overlay.md)**, che `main` l'ha
aperta: le ospitate sono **otto** e quelle che restano fuori sono **due**, che è
ciò che dice il codice (`NON_OSPITATE` ne ha due) e ciò che dice `0079:175`. Chi
legge questa voce e poi quel documento trova due numeri e non sa quale sia HEAD.
Non è materia di questa voce — è un difetto misurato, e ha una riga sua.

**Ciò che non è scritto da nessuna parte è il secondo pezzo, ed è quello che
blocca.** Sopra la variante, il contratto scrive: *«Cosa fosse il bersaglio del
clic lo dice il contesto di sessione (decisione 0007), non un parametro di
questa superficie»* (`abi.wit:2870-2871`). Ma `record view-context`
(`abi.wit:2604-2609`, **identico nella copia congelata**
`crates/fub-abi/wit/frozen/0.1.0.wit:2006-2011`) è
`pane, doc, selections, mode`: **quattro campi, e nessun bersaglio.** Un menu
contestuale su una riga dell'albero riguarda un path che **non è** il documento
attivo; su una linguetta riguarda una scheda; su un link riguarda un target.
Nessuno dei tre è esprimibile. **Il contratto rimanda a un campo che non
esiste.**

**E `command-spec` non ha una collocazione.** `abi.wit:1509-1516` è
`id, title, description, keybinding, params, scope`; `command-scope`
(`:1500-1504`) è `writes, reach, reversible` — una dichiarazione di raggio e di
consenso, non una condizione di attivazione. Nessun `when`, nessun `menu`,
nessun `group`.

**Chi può contribuire una voce, oggi:** `frontend/src/ui/menu.ts:28`
`showContextMenu(at, items)` riceve le voci come **letterali dal chiamante**, e
i chiamanti di produzione sono **cinque, tutti nello stesso file**
(`panels/explorer.ts:456`, `:519`, `:615`, `:676`, `:680`); gli ascoltatori
`contextmenu` sono **tre**, di nuovo tutti in `explorer.ts`. Il corpus ne chiede
**cinque** menu diversi — editor, scheda, blocco, albero, link
(`editor-di-testo.md:56` e `:98`, `block-editor-parita.md:80`,
`vault-ed-esploratore.md:26` e `:42`) — e **quattro dei cinque non esistono
affatto**.

**Come si rimisura.**

```sh
grep -n 'context-menu\|context_menu' crates/fub-abi/wit/fub/abi.wit
grep -n 'record view-context' -A 8 crates/fub-abi/wit/fub/abi.wit
grep -n 'record view-context' -A 8 crates/fub-abi/wit/frozen/0.1.0.wit
grep -rn 'showContextMenu\|addEventListener("contextmenu"' frontend/src/
grep -n 'NON_OSPITATE' -A 6 frontend/src/ui/views.ts
```

**3. Le forme, e chi paga.**

- [ ] **(a) Il bersaglio entra nel contesto** — un campo in fondo a
      `view-context`, o un caso nuovo in fondo a `context-kind`, che porti su
      che cosa è caduto il clic. Paga **chi mantiene il contratto**, e il prezzo
      ha una data: `context-kind` (`abi.wit:2613`) è **già congelato a tre
      casi** (`frozen/0.1.0.wit:2015`), e un caso si aggiunge solo **in fondo**,
      perché l'ordine è il discriminante (`wit_additivity.rs:32`). Fattibile
      dopo il freeze, definitivo comunque.
- [ ] **(b) La collocazione entra nel comando** — `command-spec` prende in fondo
      un campo che dice in quali menu il comando compare, e la shell interroga
      il registro al `contextmenu`. Paga **chi mantiene il contratto**: un campo
      additivo, più un vocabolario di zone che è un nome pubblico — la stessa
      domanda dei nomi degli ambiti della §26.1. **Da sola non basta**: senza la
      (a) il comando compare nel menu e non sa su cosa.
- [ ] **(c) Solo shell: un registro di contributi in `ui/menu.ts`**
      (`registraVoce(zona, fn)`) che i pannelli del core popolano. Paga **chi
      mantiene la shell**: una trentina di righe in un file. Toglie il costo al
      core — oggi aggiungere una voce sono tre punti in due file, perché la
      chiave i18n va in `IT` **e** in `EN`, che è un `Record` esaustivo e non
      compila senza — e lascia il terzo fuori esattamente come adesso.
- [ ] **(d) Com'è oggi.** Paga **il terzo**, e il prezzo è che non c'è prezzo:
      **non si può, a nessuna cifra.** E paga **l'utente**, che su quattro delle
      cinque superfici che il corpus nomina non ha menu affatto, e sull'unica
      che ce l'ha non può togliere, aggiungere né riordinare una voce.

**4. Che cosa il repo ha già deciso qui vicino.** La
[0079](../decisions/0079-il-grafo-esce-dall-overlay.md) ha risolto **la stessa
specie di problema per un'altra superficie**: l'area principale era dichiarata
non ospitata, e il varco è stato `UiKind::Custom`. La
[0007](../decisions/0007-contesto-di-sessione.md) ha deciso cosa un contesto
porta, ed è il verbale che `abi.wit:2870` cita per dire che il bersaglio c'è —
mentre il record non ce l'ha. La [0021](../decisions/0021-il-confine.md) ha
deciso che il confine si attraversa con dei nomi, e una zona di menu sarebbe uno
di quei nomi.

**5. Reversibile?** **Non scade, ma si irrigidisce**, ed è misurato:
`command-spec` e `view-context` sono **entrambi** nella linea di base congelata,
e `wit_additivity.rs:29-36` classifica «un campo in fondo a un `record`» e «un
caso in fondo a un `variant`/`enum`» come additivi. La porta resta apribile dopo
M4. Ciò che scade è la **posizione**: farlo dopo vuol dire accodarsi a chiunque
si sia accodato prima.

**6. La raccomandazione: (a) prima della (b), e la (c) mai da sola.** Il
bersaglio è il pezzo che blocca: senza di lui un contributo di menu è una voce
che non sa su cosa agisce, e la (b) da sola costruirebbe la porta davanti al
muro. La (c) risolve il costo del core e **nasconde** la lente — è la forma che
sembra un progresso e non ne è uno, perché il numero che cresce non è quante
voci mette il core, è **quante superfici vorrebbero un menu**: una oggi, cinque
nel corpus.

**7. Che cosa resta rotto se non si decide.** Ogni menu contestuale nuovo è un
array di letterali dentro il file del pannello che lo apre, e chi apre il menu
deve conoscere tutte le voci, comprese quelle che non sono sue. Con cinque menu
sono cinque file che sanno tutto, e un plugin che vuole aggiungere «Apri con…» a
uno qualsiasi dei cinque non ha nessuna porta.

*Quello che si diceva e che non regge.* Che il contratto **non abbia modo** di
ospitare un menu contestuale: la superficie c'è, è nell'enum congelato, e il
non-ospitare è **dichiarato** nel messaggio che l'autore della view legge. Che
il menu **di sistema** esista e non lo si stia usando:
`grep -rn menu crates/fub-app/src/` e `crates/fub-app/tauri.conf.json` danno
**zero**, e le sei righe di `app-e-piattaforma.md:16-23` non hanno niente su cui
appoggiarsi, né in TypeScript né in Rust.

---

### 26.6 Gli appunti sono una spunta sola, e le domande sono due

*chiusa dalla [0144](../decisions/0144-una-spunta-sola-diceva-due-cose.md) ·
strato **contratto** · **P0***

## Com'è finita, e cosa lascia

La domanda era se «può leggere e scrivere gli appunti di sistema» fosse una
domanda o due. **Sono due**, e la forma presa è la (a) che la voce stessa
raccomandava: `fub:clipboard` non esiste più, al suo posto ci sono
`fub:read-clipboard` e `fub:write-clipboard`, e `permission::ALL` passa da
tredici a quattordici.

**La premessa ha retto per intero**, ed è il primo caso di questa specie dopo la
seduta 24, che aveva insegnato a diffidarne. Rimisurata sui sorgenti del
2026-08-11: il nome c'era con quella grafia, la frase con due verbi era davanti
all'utente in due lingue, nessuna capacità lo consumava, il contratto non lo
nominava (`grep -c clipboard` su `abi.wit` e su `wit/frozen/0.1.0.wit` → zero
prima e zero adesso), e nessuno dei cinque verbali che nominano gli appunti
aveva mai posto la domanda della grana.

**Il prezzo dichiarato era esatto, e si è pagato tutto**: sei posti — il
contratto, i due elenchi della shell, le due chiavi i18n per due lingue, il
conto `permessi-dichiarabili` nei suoi punti di prosa, la riga di
[strozzature.md](strozzature.md) dove i permessi senza famiglia erano quattro e
sono cinque, e il commento gemello accanto a
`ogni_permesso_di_una_famiglia_e_nominato`. Zero manifest migrati, zero WIT
toccato. Il presidio `i_permessi_sono_gli_stessi_di_qua_e_di_la` si è aggiornato
da sé perché legge i due elenchi invece di conoscerli, ed è stato verificato
rosso togliendo `"fub:write-clipboard"` dal solo lato della shell.

**Quello che la voce non diceva, e che si vede solo aprendo il file**: la
seconda tabella della shell (`FRASI`) è un `Record<Permesso, Chiave>` esaustivo,
quindi il prezzo della shell non era pagabile a metà nemmeno volendo. È il
motivo per cui questa era la voce più economica delle otto: due dei sei posti li
tiene insieme il compilatore, e un terzo un banco.

**Cosa non è stato deciso, perché era già deciso altrove.** Che quei nomi non
abbiano una capacità che li consumi resta come l'hanno scritto la
[0021](../decisions/0021-il-confine.md) e la
[0098](../decisions/0098-un-permesso-si-vede-e-si-nega.md); la capacità vera nel
WIT — la forma (d) — resta fuori per la ragione della
[0013](../decisions/0013-elenco-delle-capacita.md), ed è indipendente nel verso
che conta: si può avere il nome giusto oggi e la capacità fra un anno, il
contrario no.

**La casella che resta**, e sono i diciassette gesti di appunti che il corpus
chiede in sette degli otto file:

- [ ] **Quando nasce la capacità degli appunti, sono due famiglie e non una, e
      la lettura non ha parametro.** Oggi tutti e diciassette devono essere
      core, e la shell sa fare `navigator.clipboard.writeText` in un punto solo
      (`frontend/src/ui/intents.ts:72`), dietro un `if` su un `ns` letterale.
      Questa voce ha dato il nome giusto al recinto; costruirlo è un'altra
      volta.

---

### 26.7 Un rilascio si consegna, un bersaglio non si dichiara

*chiusa · strato **contratto** · **P1** ·
[0157](../decisions/0157-un-rilascio-aspetta-la-seconda-superficie.md)*

**1. La domanda.** Un nodo dell'albero di una view può dire *«qui si può lasciar
cadere»*? E se sì, che cosa arriva insieme al rilascio — un `DocId`, un `json`
opaco, un tipo dichiarato?

**2. Che cosa si osserva oggi, misurato.** Censimento a `3d6df0e`.

**Nel contratto, zero.** `grep -inE 'drag|drop'` su
`crates/fub-abi/wit/fub/abi.wit` dà **tre** righe, e **tutte e tre sono altro**:
`:1194` il commento e `:1196` la dichiarazione dello stesso
`record event-overflow { dropped: u64 }` (eventi persi), `:2500` la parola
`Drop` di Rust in un commento. `grep -rn '\bdrag\b'` su tutto `crates/` dà **0**
— ma da solo non prova niente, e il comando da citare è quello largo.

**Col comando largo si trova una cosa sola, e vale la pena scriverla.**
`grep -rniE 'drag|trascin'` su `crates/` dà 32 righe, quasi tutte prosa
sull'altro senso di «trascinarsi dietro»; l'unica che parla di un dito che
trascina è **la stessa frase, tre volte**: `abi.wit:2919`,
`crates/fub-abi/src/traits.rs:1717` e la copia congelata in
`wit/frozen/0.1.0.wit:2253` — *«È una preferenza: vale alla prima apertura, poi
comanda ciò che l'utente ha trascinato»*, il commento di `preferred-size`. Cioè:
**il contratto conosce il trascinamento del puntatore** — quello che
ridimensiona un riquadro — **e non conosce il rilascio su un bersaglio.** È
esattamente la separazione che questa voce fa più sotto sui 23 gesti del corpus,
e il contratto l'aveva già fatta da sé, tacendo su una metà.

**Il vocabolario della UI non ha il concetto.**
`crates/fub-abi/src/ui.rs:250-484` — `UiKind` ha **33** varianti, e nessuna è un
bersaglio; nessun campo `draggable` da nessuna parte. `UiAction` (`ui.rs:789`)
ha tre campi (`action`, `payload: Value`, `fields`) e nessun mittente di
trascinamento.

**La shell lo fa, in un file solo.** Gli ascoltatori di trascinamento —
`"dragstart"`, `"dragover"`, `"dragend"`, `"dragleave"`, `"dragenter"`, `"drop"`
— su tutto `frontend/src/` stanno in **un** file, `panels/explorer.ts`, e sono
**otto**, in due funzioni: `wireDrag` (`:830-860`, cinque) e
`wireRootDropTarget` (`:927-943`, tre). *Il numero da citare è otto — gli
ascoltatori: è l'unica convenzione che si riproduce. Il conto delle «occorrenze»
no, perché dipende da dove si mette il confine — allargando a `draggable`,
`dataTransfer` e alla classe `drop-into` sono 17 righe fra la 830 e la 940 e 25
in tutto il file.* Il renderer **generico** degli alberi di un provider,
`frontend/src/ui/node.ts`, ha quattro `addEventListener` in tutto e cinque
cablaggi via `ascolta()`: click, change, `keydown` **solo per `Enter`** su un
controllo (`:1273`), `keydown` **solo per le frecce** su una barra di schede
(`:1398`). **Nessun evento di trascinamento raggiunge mai `on_action`.**

**E i due gesti dello stesso `drop` finiscono in due canali diversi.** Nello
stesso gestore: il riordino chiama `applyReorder` (`explorer.ts:894`) →
`setOrder` (`state/organization.ts:80`) → `api.setOrder` (`host/ipc.ts:160`) →
`invoke("set_order")`, cioè un **comando Tauri bespoke**
(`crates/fub-app/src/lib.rs:612`); lo spostamento in cartella chiama
`moveIntoFolder` → `renameNote` (`state/vault.ts:64`) →
`api.invokeCommand(COMANDI.rinomina)`, cioè **il registro**. Il secondo si
annulla con `Mod-Alt-z`, il primo no — e sono lo stesso gesto per chi lo compie.

**Cosa chiede il corpus:** 23 righe nominano un trascinamento; **14** sono drag
& drop veri (qualcosa si prende e si lascia cadere su un bersaglio), in
**cinque** file (`ricerca-e-task.md:25`; `editor-di-testo.md:54,55,97,100`;
`canvas-e-database.md:14,22`; `vault-ed-esploratore.md:56`;
`block-editor-parita.md:48,49,50,141,163,204`). Le altre nove sono trascinamenti
del **puntatore** — pan, ridimensionamento, selezione — che non hanno bisogno di
un bersaglio, e non contano qui.

**Come si rimisura.**

```sh
grep -inE 'drag|drop' crates/fub-abi/wit/fub/abi.wit
grep -rn '\bdrag\b' crates/ --include=*.rs --include=*.wit | wc -l
grep -rlE 'dragstart|dragover|dragend|dragleave|dragenter|dataTransfer|draggable' frontend/src/
grep -c 'addEventListener' frontend/src/ui/node.ts
grep -rniE 'trascin|drag|drop\b' docs/decisions/ | wc -l   # sei; senza -i, due
```

**3. Le forme, e chi paga.**

- [ ] **(a) Un bersaglio dichiarato nell'albero** — un campo su `ui-node` (o una
      variante che lo avvolge) che dica *«questo nodo accetta rilasci di questi
      tipi»*, e un `ui-action` che arriva col carico del rilascio dentro il
      `payload` che esiste già. Paga **chi mantiene il contratto**, e porta con
      sé una seconda domanda che va decisa insieme: **cosa si trascina** — un
      `DocId`? un `json` opaco? un tipo dichiarato? — che è, parola per parola,
      la domanda che la
      [0140](../decisions/0140-dove-stanno-i-byte-di-un-kind-di-terzi.md) ha
      risolto per i carichi di un kind di terzi.
- [ ] **(b) Solo la consegna, nessuna dichiarazione** — la shell decide da sé
      quali nodi sono bersagli (per esempio ogni `Row`/`TreeItem` che ha una
      `action`) e manda un `UiAction` col carico. Paga **il provider**: non ha
      modo di dire di no, ogni riga diventa un bersaglio, e il rifiuto arriva
      **dopo** il gesto invece che prima — cioè l'utente vede la riga
      illuminarsi e poi non succede niente.
- [ ] **(c) Non decidere: `UiKind::Custom` con un `ns` privato.** Paga
      **l'interoperabilità**: due plugin che fanno la stessa cosa la fanno con
      due `ns` che nessuna shell condivide — l'argomento con cui la
      [0019](../decisions/0019-il-canale-dati.md) ha chiuso il `Custom` come
      strada unica.
- [ ] **(d) Ammettere che il drag & drop è della shell** e scriverne una
      primitiva riusabile di qua, come `showContextMenu` in `ui/menu.ts` è la
      primitiva riusabile del menu. Paga **il terzo, per sempre**: risolve il
      moltiplicatore fra i pannelli del core e lascia fuori chi non è core, che
      è la metà della domanda.

**4. Che cosa il repo ha già deciso qui vicino.** **Nessun verbale ha mai deciso
il drag & drop**, ed è misurato:
`grep -rniE 'trascin|drag|drop\b' docs/decisions/` dà sei righe, **tutte** sul
`Drop` di Rust (`0023:133`, `0028:47`, `0028:50`, `0030:115`, `0126:63`) o sul
«trascinarsi dietro» in senso figurato (`0019:124`). *Il `-i` non è un
dettaglio:* senza, lo stesso comando dà **due** righe invece di sei, perché
`drop\b` non incontra il `Drop` di Rust. Ciò che il repo ha deciso qui vicino è
**come si porta un carico opaco attraverso il confine**
([0140](../decisions/0140-dove-stanno-i-byte-di-un-kind-di-terzi.md)), ed è la
metà cara della forma (a).

**Ma «non deciso» non vuol dire «non visto», e questa voce non scopre niente.**
L'assenza gemella — *un gesto che il contratto non trasporta* — è **già
dichiarata in quattro posti**, e vanno letti prima di rispondere, perché tre di
loro dicono che quest'assenza si apre in modo **additivo** e uno dice a chi
costa:

- [plugin-boundary.md:934-951](../architecture/plugin-boundary.md) — *«nel
  contratto **non esiste nessun evento di tastiera** … un provider riceve
  `UiAction`, cioè un gesto già interpretato da qualcun altro»*. Un rilascio è
  parola per parola lo stesso caso; e `:915-921`, la quarta voce del metro (*«Se
  la superficie esiste … Chi ha bisogno di un gesto che il contratto non
  trasporta non inciampa in nessuna delle tre voci di sopra: le passa tutte, e
  resta fuori»*), è la riga che questo caso attraversa senza toccare niente.
- [strozzature.md:65](strozzature.md) e [leva.md:563](leva.md) — le stesse *«due
  porte, additive e non decise da nessuno»*, contate fra le strozzature vive.
- [0104:263-268](../decisions/0104-la-superficie-di-scrittura-si-presta.md) —
  *«**Le due porte restano chiuse.** … Il prezzo è dichiarato, non pagato: è la
  differenza fra un debito scritto e un debito taciuto.»*

Il quarto posto è di un genere diverso e vale per la forma (d):
[shell.md:65](../architecture/shell.md) elenca `explorer.ts` come *«l'albero,
gli spazi, le appuntate, **il drag & drop**»* — è l'**unico** punto del repo in
cui il drag & drop compare come fatto strutturale, e ci compare come cosa di
**un file solo**. Non è una decisione: è la fotografia di ciò che la (d)
proporrebbe di rendere ufficiale.

**5. Reversibile?** La **(a)** attraversa il WIT: un campo in fondo a `ui-node`
è additivo (`wit_additivity.rs:31`), quindi **non scade col freeze**, ma si
irrigidisce nella posizione come tutti gli additivi di questa seduta. La (b), la
(c) e la (d) non toccano il contratto affatto: `ui-action.payload` è già un
`json`, e riempirlo diversamente non è un ritaglio.

**6. La raccomandazione: (b) adesso non da sola, (a) alla seconda superficie.**
La consegna e la dichiarazione sono separabili — *la consegna non chiede una
firma, la dichiarazione sì* — e questa è la cosa più utile che questa voce ha
misurato. Ma la (b) da sola sposta il costo sull'utente (un bersaglio che si
illumina e rifiuta) invece che sul manutentore, quindi non va presa come
risposta finale. Il momento della (a) è la **seconda** superficie che vuole un
bersaglio: il corpus ne nomina **sette** distinte fra le sue 14 righe — canvas,
schede, blocchi, preferiti, task, tabella inline, calendario.

**7. Che cosa resta rotto se non si decide.** Le 14 richieste del corpus,
scritte come oggi, sono 14 copie di `wireDrag` in 14 pannelli, ognuna con la
propria idea di che cosa sia un rilascio: `dropGesture` (`explorer.ts:865`)
decide `before`/`after`/`into` con una soglia numerica (`:878`,
`y > 0.3 && y < 0.7`) che nessun altro pannello erediterà. E un utente non può
spegnere il drag & drop né cambiarlo, perché `set_order` non passa dal registro
e quindi non ha né palette né scorciatoia né chiave.

*Quello che si diceva e che non regge.* Che un menu contestuale estendibile
sarebbe il posto dove metterlo: non lo è — un menu contestuale non è un
bersaglio di rilascio, ed è comunque una voce diversa (§26.5). Che le 23 righe
di trascinamento del corpus siano tutte drag & drop: nove sono pan,
ridimensionamento o selezione col puntatore. Il numero da citare è **14**.

---

### 26.8 La terza pila: l'annulla dentro una view che non è del core

*chiusa · strato **contratto** · **P2** ·
[0153](../decisions/0153-non-c-e-una-terza-pila.md)*

**1. La domanda.** Una view di terzi con stato manipolabile — un canvas, una
griglia — può avere il proprio annulla? E chi arbitra fra le pile, quando i
fuochi possibili diventano tre?

**2. Che cosa si osserva oggi, misurato.** Censimento a `3d6df0e`.

**Le pile sono due, ed è una decisione presa.** Quella del testo (CodeMirror
`basicSetup`, `frontend/src/editor/editor.ts:193`) e quella delle operazioni
(`crates/fub-kernel/src/undo.rs`, `UndoStack`, tetto 100). L'ambito della prima
è misurabile: un `EditorView` per riquadro (`panels/document.ts:25`), azzerata a
ogni `setDoc` (`editor.ts:56-67`) e **non** toccata da `syncDoc`
(`editor.ts:80`) — cioè **per riquadro e per documento**, non dell'app.

**Una view non può mettere niente in nessuna delle due per via diretta.**
`ViewUpdate` ha **sette** varianti (`crates/fub-abi/src/ui.rs:860-901`:
`Replace`, `None`, `Navigate`, `Reveal`, `RunSearch`, `Custom`, `Patch`), e
**nessuna porta un undo**. L'unica strada è `run-command` (`abi.wit:3513`), che
richiede `fub:run-command` — il permesso che la 0021 chiama *«quello che
moltiplica»* — e che riempie la pila solo a profondità zero
(`workspace.rs:4812`). Una view che scrive con `apply_edit`/`write_document`
produce una mutazione **non annullabile**.

**E non può nemmeno ricevere il tasto.** Il `keydown` dei comandi è
`frontend/src/ui/keyboard.ts:39`, che consulta `allCommands()`. *Non è l'unico
`keydown` montato su `document`, e la differenza conta:* la trappola del fuoco
di `intrappolaFuoco` ne monta un secondo a `frontend/src/ui/a11y.ts:158`, e per
giunta **in fase di cattura**, quindi arriva prima — chi tocca questa voce deve
sapere che i due esistono. Nessuno dei due porta un annulla: nessun comando
rivendica `Mod-z` nei **due registri dichiarati** — `shell-keys.generated.ts`
elenca **16** comandi di shell e nessuno lo rivendica,
`editor/editor-commands.ts:415` `obsidianKeymap` ha **14** accordi e nessuno lo
rivendica. Sono due registri su cinque, e va detto per intero: il registro 4
(`basicSetup`) `Mod-z` **ce l'ha**, ed è il paragrafo qui sotto. Nei due
dichiarati l'esito è `passa` e il tasto scende all'elemento col fuoco. Se il
fuoco è dentro una view montata su `main`, **non lo raccoglie nessuno**.

**E questo pezzo è già scritto altrove, prima ancora della pila.**
[plugin-boundary.md:934-951](../architecture/plugin-boundary.md) lo dichiara in
generale — *«nel contratto **non esiste nessun evento di tastiera** … un
provider riceve `UiAction`, cioè un gesto già interpretato da qualcun altro»* —
e la [0104](../decisions/0104-la-superficie-di-scrittura-si-presta.md)
(`:259-261`) nomina il primo cliente che lo chiederà, *«perché una modalità
modale è precisamente il caso che ha bisogno di un tasto nudo e non di un gesto
già interpretato»*. Va detto qui perché cambia l'ordine delle domande: **prima
del «di chi è la pila» c'è «il tasto arriva?», e la seconda ha già un posto dove
sta scritta.** Questa voce non la riapre; ci si appoggia.

**Il redo non esiste nel contratto**, e non è una svista:
`grep -rn '\bredo\b' crates/` dà **quattro** righe, tutte prosa che dice che non
c'è (`abi.wit:3527`, `traits.rs:1324`, `undo.rs:96`, `commands.rs:1101`). Nel
testo c'è, ma **gratis**: è `historyKeymap` dentro `basicSetup`, cioè una
libreria, non una decisione.

**Cosa chiede il corpus:** `canvas-e-database.md:27` («Annulla e ripeti le
operazioni sul canvas»), `block-editor-parita.md:97,98` («Ctrl+Z annulla» /
«Ctrl+Shift+Z ripeti»), `app-e-piattaforma.md:19` («Menu Modifica standard:
annulla, copia, incolla, trova»). Il canvas **è** una view su `main`: il
commento della variante lo nomina per esteso (`abi.wit:2862-2864`, *«Database
(11), canvas e slide (12)»*).

**Come si rimisura.**

```sh
grep -n 'enum ViewUpdate' -A 45 crates/fub-abi/src/ui.rs
grep -rn '\bredo\b' crates/ | wc -l                       # quattro, tutte prosa
grep -rn 'Mod-z\|Mod-Shift-z' frontend/src/ | wc -l
grep -n 'undo' frontend/src/host/contract.ts              # il campo c'è
grep -rn '\.undo\b' frontend/src/ --include=*.ts          # i lettori: solo presidi
```

**3. Le forme, e chi paga.**

- [ ] **(a) Il fuoco decide, e la view lo dichiara** — un campo su `view-spec`
      che dica *«questa view ha una propria pila»*, e un `ui-action` riservato
      che le arriva quando l'annulla scatta col fuoco dentro. Paga **chi
      mantiene il contratto** (un campo), e soprattutto obbliga a **scrivere
      l'arbitro del fuoco**: la 0045 ha enunciato *«a decidere quale risponde è
      il fuoco»* senza mai doverlo implementare, perché con due pile e due
      superfici la risposta era ovvia. Con tre non lo è più.
- [ ] **(b) Nessuna terza pila: la view compone comandi** — la view invoca
      comandi propri, e i comandi dichiarano `Undo` come tutti. Paga **zero sul
      contratto**, e paga altrove in modo misurabile: il tetto di 100 della pila
      del kernel diventa condiviso fra le operazioni sul vault e i movimenti dei
      nodi di un canvas, e **ogni canvas deve chiedere `fub:run-command`**, che
      è il permesso che moltiplica.
- [ ] **(c) Il redo come seconda pila del kernel.** Paga **chi decide che cosa
      la invalida** — la regola che la 0045 nomina e rimanda — e **non risolve
      il canvas**, perché il canvas non chiede il redo *delle operazioni sul
      vault*.
- [ ] **(d) Non decidere: `ViewUpdate::Custom` con un `ns` privato.** Paga **il
      primo che ci prova**: un `ns` privato, un ramo `if` in `applyIntent`, e
      una shell che deve sapere chi ha il fuoco — tre pezzi cablati per un gesto
      che la 0009 dà gratis a qualunque comando.

**4. Che cosa il repo ha già deciso qui vicino, e perché non basta.** La
[0045](../decisions/0045-l-undo-ha-due-pile.md) ha deciso che le pile **non si
fondono** e che *«a decidere quale risponde è il fuoco»* — ma il caso che aveva
davanti erano **due** pile e **due** fuochi. Una terza superficie, con fuoco
proprio e con operazioni che non sono né testo né scritture sul disco (spostare
un nodo del canvas non tocca il vault finché non si salva), non è nessuna delle
due, e nel verbale non compare. La stessa 0045 mette il redo in «Cosa resta
scoperto» con la ragione *«nessun cliente l'ha chiesta»*: **adesso un cliente
c'è, ed è scritto** (`canvas-e-database.md:27`, `block-editor-parita.md:98`). È
la sola cosa cambiata da allora, ed è la ragione per cui questa non è
già-deciso.

**E c'è un residuo della 0045 che non è mai stato raccolto da nessuno.** Alla
riga `225` lo stesso verbale scrive: *«**Le mutazioni che non passano da un
comando non entrano in pila.** Oggi sono quelle che la shell fa direttamente col
kernel; il giorno che diventeranno comandi (**§18.2**) entreranno da sole.»* La
§18.2 si è chiusa il 2026-08-04 con la
[0090](../decisions/0090-una-sequenza-e-una-modalita-che-scade.md), che dichiara
*«della §18.2 non resta niente»* e nel suo «Cosa resta» nomina un'altra cosa:
**questa riga è caduta con l'indirizzo**. È lo stesso incidente che la §26.2
racconta per la keymap dell'editor, e i verbali che indirizzano a quella §18.2
morta sono **due**: `0081:135-142` e `0045:225`. Chi decide questa voce deve
sapere che una metà della sua domanda era già indirizzata, e che l'indirizzo è
morto: non è un nuovo debito, è un debito che ha perso la busta.

**Un residuo della 0045 che il corpus ha appena reso visibile.**
`CommandOutcome.undo` attraversa l'IPC ed è rispecchiato in
`frontend/src/host/contract.ts:652`, ma **i suoi lettori nella shell sono
zero**: le uniche occorrenze di `.undo` fuori dal contratto sono
`__fixtures__/command-keys.json:16`, `ui/commands.test.ts:110` e
`host/mirror.test.ts:885` — tre presidi, nessun disegno. La 0045 lo aveva
scritto (*«non c'è un "Annulla: rinomina di Nota.md" in un menu»*); il corpus
adesso lo chiede per nome (`app-e-piattaforma.md:19`). L'utente ha `Mod-Alt-z` e
nessun modo di sapere che cosa disferà.

**5. Reversibile?** La **(a) è additiva** — un campo in fondo a `view-spec`
(`abi.wit:2889-2924`) sta nella colonna delle mosse permesse
(`crates/fub-abi/tests/wit_additivity.rs:31`) — quindi **non scade col freeze**;
si irrigidisce nella posizione, come la (b) della §26.4, che è un campo sullo
stesso record e va deciso insieme se si decidono insieme. La (c) tocca il kernel
e non il contratto. La (b) e la (d) non toccano niente.

**6. La raccomandazione: (b) come risposta d'oggi, (a) solo quando la terza
superficie esiste davvero.** La (b) funziona senza aggiungere niente, e il suo
prezzo — `fub:run-command` per ogni canvas — è **esattamente la misura** di
quanto la (a) varrebbe: se arriva il giorno in cui tre view di terzi hanno tutte
dovuto chiedere il permesso che moltiplica per poter fare `Ctrl+Z`, la (a) si è
pagata da sola. Prima di allora è un campo aggiunto a un contratto per un
cliente che non c'è, che è ciò che la 0013 vieta.

**7. Che cosa resta rotto se non si decide.** Il gesto più universale
dell'informatica funziona, nel riquadro principale, **solo se dentro c'è un
editor di testo del core**. In una view di terzi non fa niente, e non c'è modo
di farglielo fare: non c'è un canale per ricevere il tasto, non c'è una pila
dove mettere il passo, e `Mod-z` non è rivendicabile da un `CommandSpec` senza
rubarlo all'editor — che è la ragione per cui la 0045 lo ha vietato a
`vault.undo`.

*Quello che si diceva e che non regge.* Che una rinomina fatta dall'albero non
si annulli, perché l'annulla sarebbe del buffer di testo: **falso in tutti e tre
gli anelli** — `renameNote` passa da `api.invokeCommand` (`state/vault.ts:64`),
`invoke_command` gira in `InvokeMode::Apply` (`crates/fub-app/src/lib.rs:501`),
e `note_rename` rende `.undoable(...)` (`commands.rs:1527`), che
`workspace.rs:4813` mette in pila. Su 17 comandi del core, **otto** rendono un
esito annullabile, e anche «Canc cestina il file» ha il suo inverso
(`commands.rs:1554`). Che il redo non ci sia neanche nell'editor: c'è, ed è
gratis. Quello che manca è il redo **delle operazioni**.
