# 0098 — Un permesso si vede, e si nega uno per uno

**Data:** 2026-08-04
**Voce:** [§23.17](../roadmap/23-cosa-costano-le-decisioni-chiuse.md#2317-tre-permessi-nuovi-in-tre-commit-e-nessuno-li-mostra-a-chi-deve-accettarli)
**Commit:** *(questo commit)*

## Il fatto

Quattro decisioni di fila avevano scritto la stessa riga in fondo a sé stesse —
*«resta fuori il pannello che i permessi li mostra»* — e con la terza quella
riga ha smesso di essere una dichiarazione ed è diventata una voce. I permessi
esistevano, il cancello li onorava, e **nessuna superficie li rendeva leggibili
a chi doveva accettarli**: `PluginInfo` li portava fino alla shell, e la shell
non li mostrava a nessuno.

Adesso i tredici permessi [conta: permessi-dichiarabili] che un manifest può
dichiarare si leggono nella scheda dei componenti, uno per riga, **in italiano e
non per chiave**, con di fianco il parametro quando ne portano uno che si onori;
e ognuno ha un interruttore. Il kernel fabbrica una chiave d'impostazione per
coppia *(componente, permesso)* — `com.acme:permissions.network` — che vale
`true` finché qualcuno non dice di no, e negarla **toglie la famiglia dalla
politica nello stesso istante**.

Nessuna firma del contratto cambia: nessun tipo nuovo, nessuna variante nuova,
nessuna riga di WIT. **Nessun ritaglio.** Ciò che si aggiunge è una funzione
(`settings::permission_key` e la sua inversa), una costante (`permission::ALL`)
e due campi a un record che vive solo sull'IPC.

## La rilettura della voce ha cambiato due cose

La disciplina di questo repo — *rileggere la voce contro i verbali venuti dopo
di lei, e misurare sul codice ogni prezzo che dichiara* — ha pagato anche qui, e
nelle due direzioni opposte.

**Una misura chiesta dalla voce era già sbagliata nella voce.** La terza casella
diceva: *«va misurato invece che assunto: quante chiavi sono oggi dichiarabili,
e quante di quelle hanno un parametro che cambia cosa si può fare (oggi una
sola, `fub:network`)»*. Misurate: le chiavi sono **tredici**, e quelle che
portano un parametro sono **quattro** — `fub:network`, `fub:read-vault`,
`fub:write-vault` e `fub:external-fs`. Quello che di `fub:network` è unico non è
avere un parametro, è che **il parametro lo legge qualcuno**: gli altri tre lo
dichiarano e nessuno lo confronta, ed è la casella del
[§7.1](../roadmap/07-il-confine.md). La differenza conta per questa voce più che
altrove, perché decide **cosa si può scrivere in una frase che l'utente legge**:
un prefisso di path mostrato accanto a `read-vault` sarebbe una promessa che
l'app non mantiene, e mostrarla sarebbe peggio che tacerla. Quindi si mostra il
solo parametro onorato, e la riga che dice perché sta accanto al codice che la
applica.

**E una delle due strade che la voce dava da scegliere non esiste.** La seconda
casella chiedeva se i permessi si vedano *prima* — «un momento di accettazione
all'installazione, che è la forma che il patto suggerisce» — o *dopo*, cioè
ispezionandoli nelle impostazioni. A M4 **non c'è un'installazione**: i bundle
sono compilati dentro il binario, il caricatore di componenti di terzi è di M5,
e un momento di accettazione senza un momento di arrivo sarebbe una finestra che
compare al primo avvio elencando ciò che l'utente ha già scaricato scegliendo
Fub. Sarebbe teatro, e il genere di teatro che insegna a cliccare «accetto».

La scelta quindi non è fra le due: è che **oggi esiste solo la seconda**, e la
prima nascerà col caricatore, dallo stesso elenco e con le stesse frasi. Che le
frasi siano già scritte e già presidiate è precisamente ciò che rende quel
giorno una superficie in più e non una decisione in più.

## Dove sta scritto un «no»: la 0077, applicata a un'altra domanda

Un permesso negato è **una chiave d'impostazione per coppia**, di specie
`Toggle`, col default a `true`, fabbricata dal kernel alla dichiarazione del
plugin. È la stessa mossa con cui la
[0077](0077-una-scorciatoia-e-una-chiave.md) ha fatto di una scorciatoia una
chiave, e le due alternative scartate sono le stesse:

- una **lista di stringhe** `"com.acme fub:network"` è un formato dentro un
  formato, cioè ciò che `LOG_VERBOSE` aveva già rifiutato;
- un `SettingKind::Map` è **firma** a ridosso del freeze di M4, e la
  pagherebbero host, shell, WIT e il pannello che le disegna.

C'è però una terza ragione che là non c'era, ed è quella che ha reso questa voce
piccola: con una chiave per coppia, negare un permesso **eredita da solo tutto
ciò che le impostazioni sanno già fare**. Da dove viene il valore
(`SettingSource` dice se sei stato tu), l'azzeramento che lo fa ricadere al
default — cioè *riconcedere*, che non ha quindi un secondo comando —, l'evento
`setting_changed` che avvisa le altre finestre, il fatto che non sia scrivibile
da un programma, e il file in cui vive. Zero righe nuove per cinque
comportamenti.

**L'asimmetria da scrivere.** Un id di comando è unico da sé (`note.create`),
quindi `keys.note.create` non collide con nessuno; un nome di permesso è invece
lo **stesso per tutti** — dieci componenti dichiarano `fub:read-vault` — e
quindi il componente deve entrare nella chiave. L'unico posto in cui può
entrare, per la regola dei nomi del §7.4, è la fessura del namespace. Ne segue
che **anche una feature ufficiale nomina col proprio id**,
`fub.search:permissions.read-vault`, ed è l'unico posto del repo in cui il core
non usa la sua licenza di nominare nudo. La licenza esiste perché il core
dichiara chiavi *dell'applicazione* (`versioning.enabled`, `plugins.disabled`);
qui non c'è niente dell'applicazione, perché **ogni permesso è di esattamente un
componente**.

## Il proprietario della chiave è il componente, e il valore gli sopravvive

La chiave la dichiara **il componente a cui il permesso appartiene**, e non il
bundle di core come `plugins.disabled`. È la scelta che ha una conseguenza
brutta in agguato, e vale la pena scriverla perché non si vede leggendo né l'uno
né l'altro dei due meccanismi coinvolti:

> spegnere un componente ne toglie lo schema, quindi la chiave con cui gli si
> nega un permesso **sparisce**.

Se sparisse anche il valore, spegnere e riaccendere un componente sarebbe il modo
di **ridargli tutto** — un giro che si fa con due clic, per sbaglio, senza che
niente lo dica. Non sparisce, perché togliere uno schema non è cancellare un
valore: `settings.json` è una mappa di chiavi, e una chiave che nessuno dichiara
più resta lì e torna a valere quando qualcuno la dichiara di nuovo. Il presidio
lo prova in fila su tutte e tre le occasioni in cui potrebbe rompersi — negare,
spegnere e riaccendere, riaprire il vault da capo — ed è il test più importante
di questo commit
(`interruttori::un_permesso_negato_sopravvive_allo_spegnimento_e_alla_riapertura`).

L'alternativa — la chiave di proprietà del core, come `plugins.disabled` — era
la strada che l'argomento di quel campo suggerisce (*«il giorno che quella
feature si spegne, la chiave che dice chi è spento sparirebbe con lei»*), ed è
stata scartata per due ragioni. La prima è che l'analogia non regge fino in
fondo: `plugins.disabled` parla dei componenti **al plurale** ed è quindi
dell'app, mentre un permesso ha un soggetto solo. La seconda è che il core non
conosce l'elenco: il suo bundle si monta **per primo**, e i componenti che
arrivano dopo non sono nel suo manifest — dichiarare a nome suo chiavi che
nascono dopo di lui avrebbe voluto dire un proprietario che cresce nel tempo,
cioè la sola cosa che lo schema di questo store non sa rappresentare.

## La negazione è una sottrazione, non un secondo elenco

Il «no» non arriva fino alla politica: si applica **prima**, sulla mappa dei
permessi del manifest, e ciò che `Granted::new` vede è un manifest più povero.
Tre proprietà discendono da questa riga sola, e un campo `denied` dentro la
politica non ne avrebbe avuta nessuna:

- **non può concedere.** Una mappa a cui si tolgono chiavi non ne acquista,
  quindi nessun valore scritto in un file di configurazione — nemmeno quello di
  un **vault che arriva da fuori**, che è la coppia che la
  [§23.13](../roadmap/23-cosa-costano-le-decisioni-chiuse.md) tiene aperta — può
  dare a un componente una famiglia che il suo manifest non dichiarava. È il
  motivo per cui questa chiave può vivere nel vault senza aspettare quella voce:
  il caso peggiore che un vault ostile ottiene è **il default che l'utente ha
  già accettato**;
- **nega insieme il *se* e il *dove*.** Tolta `fub:network`, cade la famiglia e
  con lei l'allowlist. Un elenco parallelo avrebbe avuto un caso in cui i due
  non sono d'accordo, e quel caso — permesso presente, parametro assente —
  significa *qualunque host*;
- **non c'è un secondo ordine di cancelli da tenere allineato.** Il `Guard`
  continua a fare le due domande che faceva, la famiglia e poi l'host, e non sa
  che qualcuno ha detto di no.

Che la chiave viva nel **vault** e non nella macchina è la scelta che dà più
leva a chi la usa: si può lasciare che un componente legga il vault di lavoro e
non il diario. Il prezzo è quello di ogni chiave di vault dalla
[0076](0076-le-impostazioni-vivono-nel-vault.md) — un vault nuovo riparte dalle
impostazioni di fabbrica — e qui *ripartire dalle impostazioni di fabbrica* vuol
dire ripartire da ciò che il manifest dichiara, che è esattamente ciò che
succedeva prima di questo commit.

## Ha effetto adesso, ed è la 0097 letta dalla parte opposta

Una revoca vale **alla chiamata successiva**, non alla riapertura del vault. La
[0097](0097-un-recinto-che-vale-anche-quando-nessuno-guarda.md) aveva scritto il
precedente per la rete — `JobHost::fetch` rilegge il permesso a ogni chiamata
invece di catturarlo all'avvio del job — e qui lo si onora dall'altro capo: là
si **rilegge** perché la politica può essere cambiata, qui si **riscrive la
politica** nel momento in cui cambia. I due si incontrano nel mezzo, e il
risultato è la proprietà che conta: fra il gesto e il rifiuto non c'è niente.

Il conto sta da questa parte per la stessa ragione per cui `Granted` è piccola:
la politica si clona a **ogni prestito**, e un prestito accade a ogni evento
consegnato a ogni handler. Rileggere lì dentro tredici chiavi di configurazione
sarebbe una lettura dello store per evento; ricalcolarla quando l'interruttore
si muove è un conto solo, e lo si fa quando una persona lo muove.

Il ricalcolo sta in `announce_setting` e non nei due chiamanti — `set_setting` e
`reset_setting` — perché scrivere e azzerare sono la stessa cosa vista da due
lati: **azzerare una chiave negata è precisamente il modo in cui si riconcede**.
E sta *prima* dell'evento, non dopo: chi riceve un `setting_changed` può
chiamare, e troverebbe un cancello ancora aperto.

## La frase la scrive la shell, e questa è la riga di sicurezza

L'etichetta della `SettingSpec` fabbricata è la **chiave del permesso**
(`fub:network`), non una frase. Attraverso il confine passa un identificatore, e
la prosa che l'utente legge sta nel catalogo della shell.

Non è una comodità, è la difesa che rende sensato tutto il resto: **chi chiede
un permesso non deve poter scrivere la frase con cui glielo si concede.** Se
l'etichetta venisse dal manifest — o anche solo dal catalogo di stringhe del
componente, che è dove un `Text` di quella spec finirebbe per la regola del
§12.1 (*il catalogo è di chi ha scritto la frase*) — un componente potrebbe
presentare `fub:read-drafts` come «migliora i suggerimenti». Sarebbe l'unica
riga di questa app in cui il testo che protegge l'utente lo scrive la parte da
cui lo si protegge.

Lo stesso ostacolo che le scorciatoie incontrano sul **gruppo** (*«dire
"Scorciatoie" a nome di qualcun altro è ciò che qui non si può fare»*) qui si
presenta sull'etichetta, e la risposta è diversa perché la posta è diversa: là
si è riusato il titolo che il comando aveva già, qui non c'è niente da riusare —
c'è da **non** usare ciò che c'è.

Il costo di questa scelta è due elenchi, uno per lato del confine, che possono
divergere. Il presidio che li tiene insieme legge **il file della shell** e lo
confronta col contratto, nel verso utile (cercare le stringhe di Rust dentro il
TypeScript passerebbe anche trovandole in un commento). È il terzo della sua
specie dopo il tema e la memoria, e con la posta più alta dei tre: un permesso
che il contratto conosce e la shell no è un permesso **che nessuno mostra**,
cioè esattamente il difetto da cui questa voce è nata, rifatto in silenzio.

## Il parametro si mostra e non si edita, e la ragione è un trabocchetto vero

Restringere l'allowlist dal pannello sembrava la cosa ovvia da fare, e sarebbe
stata **sbagliata**. In `Granted::new` un elenco vuoto significa *qualunque
host*:

```rust
let network = (!hosts.is_empty()).then(|| …);
```

È la regola uniforme di `OptionMap` — presente = acceso, il valore è il
parametro — e la 0097 l'ha tenuta apposta, per non fare di `fub:network` l'unica
chiave la cui assenza di parametro significa il contrario che altrove. Ne segue
che una UI che lasciasse togliere gli host uno per uno trasformerebbe «nessuno»
in «tutti» **proprio al gesto in cui qualcuno sta cercando di chiudere**: si
toglie l'ultimo host e si ottiene il permesso più largo che esista.

Quindi il parametro è **cosa si legge**, e ciò che si decide è il permesso
intero. Restringerlo è una domanda seconda, ed è la stessa che il §7.1 pone per
i prefissi di path: chi la aprirà troverà qui il caso da non sbagliare.

## Cosa NON è questa decisione

**Non è una difesa da un componente ostile**, ed è il registro che 0095, 0096 e
0097 hanno tenuto tutte e tre. A M4 un plugin nativo gira in-process: può fare
`std::fs` senza passare dal `Guard`, e togliergli `fub:read-vault` non gli
impedisce di leggere il disco. Il valore di questo pannello è la
**dichiarazione** — che l'utente possa vederla, e negarla — e la promessa che
mantiene è quella del manifest, non quella del sistema operativo. Il confine che
impone è di M5.

**Non è il momento di accettazione**, per la ragione scritta sopra: non c'è
niente da accettare finché non c'è niente da installare.

**Non è un modo di spegnere un componente.** L'interruttore che lo spegne c'è
già ed è accanto, ed è la ragione per cui negare un permesso a una feature
*ufficiale* non ha avuto bisogno di un'eccezione: **spegnerla era già permesso,
e negarle un permesso è meno che spegnerla.**

## Il presidio

- `il_confine::a_denied_permission_shuts_the_gate_at_once` — si legge, si nega,
  non si legge più, si azzera, si legge di nuovo. Nella stessa sessione.
- `il_confine::denying_the_network_takes_the_allowlist_with_it` — negare la rete
  fa cadere la famiglia, e il recinto non resta ad autorizzare qualcosa.
- `il_confine::a_permission_key_can_only_ever_subtract` — la chiave di un
  permesso non dichiarato non esiste, quindi non c'è un file che possa
  concedere.
- `interruttori::un_permesso_negato_sopravvive_allo_spegnimento_e_alla_riapertura`
  — il più importante: le tre occasioni in cui un «no» potrebbe evaporare.
- `interruttori::i_permessi_sono_gli_stessi_di_qua_e_di_la` — i due elenchi, con
  l'ordine compreso.
- `guard::ogni_permesso_di_una_famiglia_e_nominato` — una famiglia nuova col suo
  permesso nuovo non può nascere invisibile.
- `options::l_elenco_dei_permessi_e_chiuso` e
  `settings::la_chiave_di_un_permesso_si_compone_e_si_rilegge` — l'elenco e la
  chiave, dai due lati.
- `permessi.test.ts` — l'ordine delle righe, il permesso che l'host non conosce,
  il parametro della rete, e che nessuna delle tredici frasi sia la chiave nuda.

Il verso **opposto** di `ogni_permesso_di_una_famiglia_e_nominato` non è
presidiato, ed è deliberato: `fub:camera`, `fub:microphone`, `fub:clipboard` e
`fub:external-fs` sono nomi che nessuna famiglia consuma ancora, e pretendere la
corrispondenza piena costringerebbe a toglierli — cioè a lasciare liberi quattro
nomi che qualcun altro potrebbe prendersi.

## Cosa resta fuori

- **Il momento di accettazione all'installazione**, che nasce col caricatore di
  M5 e da questo stesso elenco. Non è una casella residua di questa voce: non
  c'è niente di deciso che qualcuno debba ancora fare, c'è una superficie che
  aspetta la cosa di cui è la superficie.
- **Restringere un parametro** invece di negare il permesso intero: è la casella
  del [§7.1](../roadmap/07-il-confine.md), e questo verbale le lascia in eredità
  il trabocchetto dell'elenco vuoto.
- **Un elenco dei permessi fuori dalle impostazioni** — nella palette, in una
  CLI, in un centro di comando. Il dato e le frasi sono al loro posto perché
  chiunque li chieda; nessuno li ha chiesti, e una superficie preparata senza
  chiamante è ciò che questo repo rifiuta da nove verbali.
