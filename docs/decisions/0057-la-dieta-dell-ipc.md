# 0057 — La dieta dell'IPC: un elenco che diventa rosso quando qualcosa si aggiunge

|  |  |
|---|---|
| **Decisa** | 2026-07-29 |
| **Origine** | `todo.md` §16.6 (seduta 16) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/16-crate-sdk-banchi-di-prova.md) · [il gemello, gli elenchi che iterano](0056-un-elenco-che-e-la-sorgente.md)

---

Si legge dopo la [0056](0056-un-elenco-che-e-la-sorgente.md), che stabilisce la
tassonomia degli elenchi scritti a mano e il criterio con cui si sceglie la forma.
Qui si applica alla sola superficie in cui la risposta cambia — e cambia per un
motivo meccanico: **`tauri::generate_handler!` prende identificatori a compile
time e non itera niente**, quindi l'elenco non può diventare la sorgente. Resta
una copia, e va confrontata.

## Il numero della voce è sbagliato per la terza volta

Il §16.6 dice «**38** oggi, in `generate_handler!`», e fa di quel numero il
proprio argomento: *«è il secondo che ci sta scritto»*, dopo un «25» già sbagliato.

Ricontato: sono **37**. Terza volta.

E c'è una trappola sotto, che è la parte istruttiva. I conti possibili sono
quattro e danno quattro numeri diversi:

| cosa si conta | quanti |
|---|---|
| `grep '#\[tauri::command\]'` su tutto il workspace | **43** |
| lo stesso grep sul solo `app/src/lib.rs` | **39** |
| attributi **veri** in `lib.rs` (righe di commento escluse) | **37** |
| nomi dentro `generate_handler!` | **37** |

Le sei occorrenze di troppo sono **prosa**: due nel doc-comment di modulo di
`lib.rs` che spiegano cosa il file è, e quattro in `fubmd-host` e
`fubmd-abi/tests/` che raccontano dove una cosa *stava prima*. Un presidio che
contasse la prosa nascerebbe con un numero che nessuno può far tornare, e
morirebbe alla prima volta che qualcuno scrive `#[tauri::command]` dentro un
commento — cioè scrivendo documentazione, che è la cosa che questo repo fa.

Quindi l'estrattore salta ogni riga che dopo il trim comincia per `//`, e c'è un
test che gli dà in pasto un sorgente finto **con la trappola dentro**
(`l_estrattore_non_conta_la_prosa`). Il presidio del presidio è la parte che di
solito manca, ed è la ragione per cui l'ultima riga di questa tabella è l'unica
di cui ci si può fidare senza guardare.

## Deciso: tre insiemi, due confronti

Il test legge `crates/fubmd-app/src/lib.rs` ed estrae **due insiemi
indipendenti** — i comandi *definiti* (un vero `#[tauri::command]`) e i comandi
*registrati* (dentro `generate_handler!`) — e li confronta con l'allowlist
dichiarata nel test. Due asserzioni, entrambe nelle due direzioni:

1. **definiti == registrati.** Un comando definito e mai registrato è codice
   morto vestito da superficie: dal webview non lo raggiunge nessuno. Oggi non
   ce n'è, e questa asserzione è gratis — ma è l'unica cosa nel repo che se ne
   accorgerebbe.
2. **registrati == allowlist.** È il cuore. Aggiungerne uno è rosso finché non lo
   si dichiara, e l'allowlist è una **fotografia**: una riga senza comando vero è
   rossa quanto un comando senza riga, per la stessa disciplina di
   `ALLOWED_TRANSITIVE_ABI` in `dependency_invariant.rs`.

E l'estrattore **si ferma** invece di far sparire un comando quando non capisce
ciò che legge — la stessa scelta di `read_diagram`. Un parser che degrada in
silenzio su un presidio di copertura ne toglie la ragione d'essere.

## L'allowlist non è un elenco di nomi: è un elenco di ragioni

È questa la parte che ha un cliente vero. Ogni riga porta il comando **e** la
ragione per cui non poteva essere altro, e il messaggio del rosso dice le tre
alternative per esteso — un comando del registro, una view, una query. La riga
che divide è quella della [0013](0013-elenco-delle-capacita.md): *un comando fa
accadere qualcosa e risponde con un messaggio e un effetto; ciò che risponde con
**dati** non può essere un comando, perché `CommandOutcome` non li porta*.

Classificando i 37 con quel metro, le categorie sono **sei** e non tre. Le tre
che non erano previste sono la parte che valeva la pena scoprire:

| perché | n | cosa dice |
|---|---|---|
| `SuperficieDellApp` | 12 | finestre, dialoghi, ciclo di vita di un vault, registro dei vault. Non c'è un registro a cui chiederlo: è il registro stesso a vivere dentro un vault aperto |
| `Ponte` | 6 | i canali generici — `list_views`, `render_view`, `view_action`, `list_commands`, `invoke_command`, `query_index`. Uno per canale, e **non crescono con le feature**: è precisamente ciò che l'allowlist esiste per preservare |
| `CapacitaDelContratto` | 4 | la shell esercita una capacità dell'elenco chiuso, nominandola |
| `LaPortaEUnaCredenziale` | 6 | vale **perché lo dice questa porta**, non per cosa fa |
| `AspettaUnCliente` | 4 | passerebbe come comando del registro, ma il registro non la può servire |
| `DaMigrare` | **5** | debito dichiarato |

**`CapacitaDelContratto` porta il nome della capacità** (`VaultRead::list_trash`
e simili), e un test verifica che quel metodo esista **dentro quel trait**
leggendo `fubmd-abi/src/traits.rs`. È la sesta specie del §16.7 — *la garanzia
dichiarata che non è mai esistita* — presa dal verso presidiabile: una frase che
rimanda a qualcosa di meccanico deve nominare un `X` che una macchina sa cercare.
Spostare `list_trash` da un trait all'altro diventa rosso.

**`LaPortaEUnaCredenziale`** è la categoria che il §16.6 non prevedeva e che
salva sei comandi da una migrazione sbagliata. `set_setting` non poteva essere
`settings.set` del registro, e il codice lo diceva già: *«da qui passa la persona
davanti allo schermo, che ha cliccato su un interruttore; da `settings.set` passa
un programma»*. Sono due autorità, non due strade per la stessa cosa — la
distinzione della [0012](0012-origine-degli-eventi.md) applicata alla
configurazione. Stessa forma per `view_state`/`set_view_state`, dove proprietario
ed esemplare li timbra **la porta** e non JS ([0035](0035-il-lavoro-lungo-si-racconta.md),
[0037](0037-lo-stato-di-vista.md)): se arrivassero dal webview, una pagina
qualunque potrebbe rileggere lo stato di vista di un provider.

**`AspettaUnCliente`** sono le quattro scritture dell'organizzazione (§11.3).
Passano la riga che divide come comandi, ma **il registro non le può servire**: un
`CommandProvider` ha in mano solo l'`HostApi`, e per quelle scritture una capacità
non esiste — non per dimenticanza, per la regola della
[0013](0013-elenco-delle-capacita.md) («una capacità concessa a nessuno è
superficie da mantenere e sandboxare per sempre»). Sono tenute **fuori** dal
conteggio del debito apposta: il numero presidiato deve dire *quanti si possono
migrare oggi*, o diventa un numero che non scende mai e smette di essere letto.

## Il debito è cinque, non tre — e due non erano nominati da nessuno

Il §16.6 dichiarava il versioning (3 comandi). Sono cinque:

- `list_versions`, `read_version` → sono **letture**: rispondono con dati e vanno
  su `IndexQuery`.
- `restore_version` → è un comando vero, ma bespoke: va nel registro.
- **`render_preview`, `render_embed`** → non li nominava nessuno.

Rispondono con dati (`RenderedDocument`, `EmbedContent`), non sono un canale
generico, non sono una capacità dell'elenco chiuso e non sono un fatto che solo
la shell sappia: sono due `ws.render_*` puri. La conseguenza è concreta e non
formale — **un `ViewProvider` che volesse mostrare un documento reso non ha
nessuna porta, e la shell ce l'ha.** È la stessa asimmetria che ha portato
`search`, `list_tags`, `graph_data` e `backlinks` dentro `query_index` con la
[0019](0019-il-canale-dati.md), e `resolve_link` con la
[0043](0043-il-path-e-la-chiave.md). Il precedente esatto è `IndexQuery::Outline`,
che sta lì per essere «il modo con cui una view legge la struttura di un documento
senza avere un `FormatProvider`»: un documento **reso** è la stessa domanda un
passo più in là, senza avere un renderer.

Va detto cosa questo *non* rovescia. La [0018](0018-chi-vede-il-modello-parsato.md)
ha confermato `render_preview` come «fast-path della lettura», ma rispondeva a
un'altra domanda — *il modello parsato attraversa l'IPC?*, e la risposta è no —
non a *da quale porta passa*. Le due conclusioni stanno insieme.

E va detto cosa resta da decidere a chi prenderà la migrazione, perché questa
decisione **classifica un debito, non lo salda**: rendere passa dal confine di
fiducia (`Html`/`WebView` solo dal codice fidato, oggi applicato dentro
`render_view` in un punto solo), e portare l'HTML reso su un canale che anche un
plugin di comunità può chiamare è una domanda di firma che va posta lì, non qui.

### Il debito diventa un numero, non una riga di prosa

`il_debito_dichiarato_e_un_numero_presidiato` asserisce il conteggio e nomina le righe. È la
parte che risponde all'accusa che il §16.6 muove a sé stesso: *«un conto scritto a
mano in un documento non è un presidio: è una cosa che diventa falsa in
silenzio»*. Migrarne uno costringe a toccare il numero; chiudere l'ultimo
costringe ad accorgersene. E il residuo della voce non vive più in un documento
che nessuno rilegge, ma in un test che gira in CI.

## Il grafo era già migrato, e la voce non lo sapeva

Il §16.6 elencava «Grafo (1)» fra i bespoke da migrare. Non esiste: `graph_data`
è sparito con la [0019](0019-il-canale-dati.md), e `crates/fubmd-app/src/lib.rs`
lo racconta nel doc-comment di `query_index` («erano quattro comandi — `search`,
`list_tags`, `graph_data` e `backlinks`»). La riga era falsa, ed è la stessa
specie del «38»: una voce che descrive il proprio debito e non torna a
correggersi quando il debito si salda altrove.

## Cosa si è scartato

**Generare `generate_handler!` da un elenco.** È la seconda forma della
[0056](0056-un-elenco-che-e-la-sorgente.md), ed è la migliore quando è
disponibile. Non lo è: la macro vuole identificatori a compile time.

**Contare gli attributi invece dei registrati.** Sono lo stesso numero oggi, e
non è garantito che lo restino — è precisamente ciò che la prima asserzione
verifica. Il numero che conta è quello dei **registrati**: un comando non
registrato non è superficie.

**Una categoria-discarica.** Sei ragioni sono già al limite; una settima
categoria «altro» avrebbe reso l'allowlist un elenco di nomi con una parola
accanto, cioè la cosa che questa decisione esiste per non produrre. C'è invece un
test che pretende che **i ponti restino sei**: un settimo canale generico non è
una riga in più, è un verbale.

**Migrare i cinque adesso.** Tre chiedono varianti nuove di `IndexQuery` e due
chiedono di riaprire il confine di fiducia sul rendering. Il criterio con cui
farlo è deciso — è la riga che divide, dalla 0013 — quindi applicarlo è lavoro;
ma non è lavoro di questa voce, ed è ora presidiato da un numero.

## Cosa resta scoperto, dichiarato

**I cinque `DaMigrare`**, come sopra: è la casella residua di questa voce, nel
senso della [0052](0052-cio-che-va-storto-e-un-evento.md) — ciò che si può fare
senza aprire un verbale, salvo la domanda di firma sul rendering, che va posta a
chi la prende.

**Le quattro `AspettaUnCliente`** non sono debito e non sono definitive: lo
diventeranno il giorno in cui una capacità sull'organizzazione avrà un cliente
vero. Il prezzo di oggi è dichiarato: `IndexQuery::Organization` lascia
**leggere** l'organizzazione a chiunque, e quelle quattro porte lasciano
**scrivere** solo alla shell.

**La regola vale sul confine Tauri, non su quello del webview.** L'allowlist dice
quanti comandi la shell può chiamare; non dice niente su quante chiamate la shell
faccia, né su cosa il webview possa raggiungere di ciò che la porta espone. È un
presidio sulla superficie, non sul traffico.
