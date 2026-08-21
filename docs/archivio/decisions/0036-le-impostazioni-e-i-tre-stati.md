# 0036 — Le impostazioni: chi dichiara una chiave, dove sta il suo valore, e chi la può scrivere

|  |  |
|---|---|
| **Decisa** | 2026-07-28 |
| **Origine** | `todo.md` §11.1 (seduta 11) — chiude la voce, e con lei il **primo residuo** della [decisione 0010](0010-comando-descritto-a-una-macchina.md) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[la seduta](../roadmap/11-impostazioni-e-i-tre-stati.md)

---

Il §11.1 chiedeva cinque cose che a guardarle da lontano sembrano cinque voci
diverse — uno schema dichiarato, uno store su livelli, un registro dei vault, un
interruttore che non sia una variabile d'ambiente, import/export/reset come
comandi — e sono **una sola domanda vista da cinque lati**: *dove sta ciò che
l'utente decide, e chi lo può cambiare?*

Prima di questa decisione la risposta era: da nessuna parte, e chiunque. Il
versioning si spegneva con `FUB_VERSIONING`, cioè con una variabile d'ambiente
che l'app non può scrivere e l'utente non può trovare. Il livello **globale non
esisteva affatto** — nessun posto dove tenere i vault recenti, i preferiti, il
tema, le scorciatoie — e la conseguenza si vedeva a due sedute di distanza: la
[0029](0029-chiudere-un-vault-e-chiuderli-tutti.md) aveva chiuso la metà kernel
del §9.6 (l'host tiene una mappa di vault aperti) e aveva dovuto lasciare aperta
l'altra, perché *un elenco di vault non sta in nessun vault*. E
`CommandReach::Settings` era nel contratto dalla
[0010](0010-comando-descritto-a-una-macchina.md), con la sua riga di prosa: «il
vocabolario c'è, lo schema che dice *quali chiavi* no, perché non ci sono ancora
impostazioni».

## La risposta, in una frase

**Una chiave di impostazione esiste perché un manifest la dichiara — con la
regola dei nomi del §7.4, come i servizi — il suo valore vive in due livelli con
una precedenza sola (vault sopra macchina sopra il default dello schema), il
form lo genera la shell da quello schema, e a scriverla sono due autorità
diverse: la persona davanti allo schermo, che le può cambiare tutte, e un
programma, che tocca solo le chiavi che si sono dichiarate scrivibili da un
programma.**

## Le decisioni prese, da NON ridiscutere senza motivo

### Lo schema sta nel manifest, non in un `SettingsProvider`

Il §11.1 lasciava la scelta aperta («`SettingsProvider` (o
`PluginManifest.settings_schema`)»). Vince il manifest, e la ragione è
**l'ordine dei passi del montaggio** ([0031](0031-chi-possiede-i-bundle.md)): la
dichiarazione viene *prima* di `Plugin::activate`, e il primo cliente vero di
un'impostazione è proprio un `activate` che deve sapere se la sua feature è
accesa. Uno schema registrato dopo l'attivazione sarebbe uno schema **assente
nel momento in cui serve**, e chi lo leggesse riceverebbe il default anche
quando l'utente ha deciso il contrario — cioè l'unico errore che questa voce
esiste per non avere.

Ne seguono due proprietà che valgono da sole il campo:

- un componente **non può dichiarare una chiave dopo**. L'insieme delle sue
  chiavi è il suo manifest, e ciò che il file contiene senza che nessuno lo
  dichiari resta lì senza essere letto. Non è uno spazio chiave→valore: è ciò
  che la [0013](0013-elenco-delle-capacita.md) ha tolto (`storage_*`), e non
  rientra dalla finestra della configurazione;
- una chiave è un **nome**, quindi ha un proprietario. Le «chiavi di
  impostazione» erano già uno degli otto spazi di nomi del §7.4 e non le
  verificava nessuno perché non ne esisteva una: adesso `register_plugin` le
  passa a `rules::ids::check` come fa coi servizi. Il core nomina nudo
  (`versioning.enabled`), un plugin dentro il proprio id
  (`com.acme.tasks:board.columns`). Due plugin non possono contendersi una
  chiave, che in un file di configurazione condiviso è la sola cosa che nessuno
  si accorgerebbe mai di aver perso.

### Due livelli, e il terzo non è un livello

Il §11.1 ne nominava tre: globale → vault → profilo/portable. I livelli sono
**due** — il vault (`.fub/settings.json`, che viaggia) e la macchina — e il
terzo non è un posto in cui cercare un valore: è **dove sta** il livello
macchina, e lo decide chi monta (`fub_host::config_dir`). Un terzo strato di
merge sarebbe stato un terzo posto in cui la stessa chiave vale un'altra cosa,
senza che nessuno dei tre sappia dire chi ha vinto.

La precedenza è dichiarata e va in un verso solo: **vault → macchina → default
dello schema**. Il default non è un file: è parte della dichiarazione, ed è per
questo che *un valore c'è sempre* e che `setting(key)` non ha un `Option` nella
firma. La domanda «da dove viene?» ha invece una risposta esplicita
(`SettingSource`), e non è decorazione: è ciò da cui il pannello decide se
mostrare «azzera», e azzerare **fa ricadere al livello sotto** — che non è
sempre il default. Scrivere il default *decide* che vale il default (e resta
scritto quando il default cambia); azzerare *smette di decidere*. Sono due cose,
e hanno due firme.

### Un vault non decide della macchina

> **Corretta dalla [0076](0076-le-impostazioni-vivono-nel-vault.md)**, che ha
> riguardato l'argomento di questa sezione e l'ha trovato debole: un tema o una
> lingua imposti da un vault sono visibili e reversibili, cioè una precauzione e
> non una regola di sicurezza, e non valevano il prezzo di una precedenza fra due
> file. Tema e `locale.*` sono scesi nel vault, la scalata di `resolve` è sparita,
> e `SettingScope::Machine` è rimasto al solo `log.*` — che deve valere anche
> quando un vault non si apre. Ciò che segue racconta come si ragionava allora.

`SettingScope` non è una preferenza di chi scrive lo schema: è una **regola di
sicurezza**. Un vault è dato che arriva da fuori — si scarica, si sincronizza,
lo passa un collega — e un vault che potesse decidere impostazioni della
macchina sarebbe un file che cambia il comportamento di chi lo apre. Le chiavi
`SettingScope::Machine` scritte dentro un `.fub/settings.json` **si ignorano**,
e non in silenzio: chi le legge raccoglie un avviso che nomina la chiave.

È anche la ragione per cui il livello macchina è **condiviso** fra tutti i vault
aperti (`Arc<MachineSettings>`, uno per `Host`): dalla
[0029](0029-chiudere-un-vault-e-chiuderli-tutti.md) i vault aperti insieme sono
N, e la configurazione della macchina è una. N copie sarebbero N idee del tema,
con la seconda finestra che vince sulla prima senza che nessuna delle due lo
sappia.

### I due cancelli della scrittura — il residuo della 0010, chiuso

Un programma che scrive un'impostazione passa da **due** cancelli, e nessuno dei
due basta da solo:

1. il permesso `fub:write-settings` nel manifest — dice **chi**;
2. `SettingSpec.program_writable` sulla chiave — dice **cosa**.

Il secondo è la risposta alla domanda che la
[0010](0010-comando-descritto-a-una-macchina.md) aveva lasciato aperta, ed è
**per chiave** e non per famiglia perché la riga non negoziabile — le
impostazioni di privacy e dell'AI non si spostano da sole — non è una proprietà
di chi chiede: è una proprietà di ciò che si scrive. Il default è `false`, per
la regola di `Trust::default`: *ciò che si ottiene dimenticandosi di dichiarare
non può essere più di ciò che si ottiene dichiarando*. Un'impostazione che
nessuno ha marcato resta dell'utente, e questo vale **anche per un comando del
core** — il test lo prova su `privacy.telemetry`, che è la chiave che quel
giorno arriverà.

E l'altra metà della stessa riga: **la persona davanti allo schermo passa da
un'altra porta**. La shell scrive con un comando IPC che chiama
`Workspace::set_setting`, dove il cancello della chiave non c'è; un programma
passa da `HostApi::set_setting`, dove c'è. Se fossero la stessa strada, o
l'utente non potrebbe cambiare le proprie impostazioni di privacy, o un plugin
potrebbe. È la distinzione dell'origine ([0012](0012-origine-degli-eventi.md))
applicata alla configurazione: *«da sé» vuol dire senza che nessuno abbia
cliccato*.

### Il form lo genera la shell, dallo schema

Il §11.1 lo chiedeva («la shell genera il form dai nodi di input»), e la forma
che ne esce è la **specularità** della [0016](0016-cosa-e-una-view.md): là un
provider manda un albero `UiNode` e la shell lo disegna; qui un provider
dichiara uno **schema** e la shell disegna i campi. La ragione per cui non è un
albero: di quello schema hanno bisogno in tre — il pannello, una CLI (27.1) e un
centro di comando (22.4) — e un albero sarebbe la UI di uno solo.

Leggerlo passa dal **canale dati** (`IndexQuery::Settings` →
`IndexResult::Settings`), come i tag e i backlink, per la regola della
[0013](0013-elenco-delle-capacita.md): un elenco è *dati*, e i dati hanno un
canale solo. Un `settings_list` fra le capacità sarebbe stato il primo caso in
cui la shell e un plugin chiedono la stessa cosa a due porte diverse. La riga
risolta porta **schema, valore e provenienza insieme**: un form che chiedesse
gli schemi da una parte e i valori dall'altra avrebbe due risposte da
riconciliare, e le riconcilierebbe male ogni volta che un valore cambia fra le
due chiamate.

Con questo, la superficie `ViewSurface::SettingsTab` smette di essere dichiarata
e non ospitata: la shell ne ha una — con un limite scritto, tutte le view in
un'area sola invece che una scheda per view, perché le schede vere vogliono il
modello di layout (§1.2).

### Due interruttori, e non è un doppione

- `versioning.enabled` è l'interruttore **della feature**, e lo legge la
  feature: spenta si dichiara lo stesso e non registra niente (D7). «Dichiarato
  con zero registrazioni» è uno stato vero e diverso da «non c'è», ed è quello
  che l'inventario del §7.6 mostra.
- `plugins.disabled` è l'interruttore **dell'host**, e lo legge chi monta: un
  bundle che ci compare non viene montato affatto — niente dichiarazione, niente
  inventario, e nemmeno le sue impostazioni esistono.

Il primo è «acceso ma spento», il secondo è «non c'è». Una feature che si spegne
da sé sa degradare (il versioning smette di fotografare e la storia già scritta
resta leggibile); un bundle non montato non sa niente, perché non c'è nessuno.

Accendere e spegnere resta **host-side**, ed è una conseguenza della
[0031](0031-chi-possiede-i-bundle.md) e non una scelta nuova: l'`HostApi` non ha
capacità di registrazione, quindi un plugin non può montarsi da sé e un comando
— che gira dentro il kernel con un `HostApi` — non vede nemmeno il registry dei
bundle. Ciò che il §11.1 chiedeva davvero non era il *meccanismo*
(`BundleRegistry::unmount` c'era già) ma **dove stare scritto fra un avvio e
l'altro** e un modo di **riaccendere**: la prima è una chiave, la seconda è che
il registry adesso tiene anche i bundle **non montati**. Prima la tabella di
montaggio era una variabile locale di `mount()`: smontare era definitivo, e un
interruttore che si può solo spegnere non è un interruttore.

`plugins.disabled` **non** è scrivibile da un programma, e qui il criterio si
applica al caso più chiaro che ci sia: un componente che potesse spegnere gli
altri avrebbe potere di veto su tutto ciò che gli sta accanto, compreso ciò che
lo controlla.

### Un file che non si è letto non si riscrive

Vale per tutti e tre i file di questa voce, ed è la seconda metà di una regola
che da sola non basta. Un `.fub/settings.json` malformato non impedisce di
aprire il vault: si riparte da vuoto e si raccoglie un avviso che nomina il
file. Fatto solo così, però, la configurazione dell'utente sopravvive per il
tempo di **una** scrittura — perché scrivere una chiave riscrive il file intero,
e lo riscriverebbe dalla mappa vuota. Chi ha sbagliato una virgola perderebbe
tutto al primo interruttore toccato, cioè esattamente il danno che «non
sovrascriverlo col default in silenzio» esiste per evitare, arrivato per
un'altra strada. Quindi un livello che non si è letto è **leggibile a vuoto e
non scrivibile**, e il rifiuto dice cosa fare.

Con lui vanno due righe che stanno sotto: si scrive **su disco prima e in
memoria dopo** (al contrario, una scrittura fallita lascia in memoria un valore
che il file non ha, con l'evento non emesso perché il chiamante ha ricevuto un
errore — tre verità per una chiave, e la terza torna al riavvio); e
`write_atomic` è davvero atomica, cioè il temporaneo ha un nome **unico** e si
**sincronizza prima della rename**. Temp+rename da solo dà atomicità rispetto a
chi legge e non durabilità rispetto a un crash: il nome nuovo può atterrare con
dietro un contenuto non ancora sceso, che è il JSON troncato che quella funzione
esiste per non produrre.

### Il registro dei vault: un file suo, nel livello che ora esiste

Recenti, preferiti, icone. Sta nel livello macchina perché *un elenco di vault
non sta in nessun vault* — un file dentro `Progetti/` che elenca anche `Diario/`
racconta una cosa falsa su un vault che non ha mai visto appena si sposta la
cartella — ed è la ragione per cui questa metà del §9.6 non si poteva chiudere
prima del §11.1.

È un **file suo** e non una chiave: un'impostazione ha *un valore*, questo ha
*dei record*. Una chiave di tipo lista avrebbe tenuto i path, e poi avrebbe
voluto un'altra chiave per le icone e un'altra per i preferiti, tutte da tenere
allineate per indice — una tabella scritta in tre colonne che non si parlano.
Stessa cartella, stessa disciplina (versione di schema e scrittura atomica), due
file.

Il tetto dei recenti (venti, i preferiti non si contano e non scadono) è
**dichiarato** e non silenzioso, e ciò che esce dall'elenco perde solo la
comodità di un click: il vault è sul disco dov'era. `forget` toglie dall'elenco
e non tocca niente — un registro che cancellasse i vault sarebbe un elenco di
scorciatoie con il potere di distruggere ciò a cui puntano.

### Import, export e reset sono comandi, e l'export non scrive un file

Sono comandi ([0009](0009-registro-dei-comandi.md)) e non codice dell'app perché
sono esattamente le tre azioni che ogni app finisce per cablare in un pulsante —
e cablarle vorrebbe dire che una CLI (27.1), una macro (16.2) e un centro di
comando (22.4) non le hanno. Sono anche i primi quattro clienti di
`CommandReach::Settings`, che era vocabolario senza nessuno che lo usasse.

Tre cose che le loro firme dicono:

- **`settings.set` prende il valore come testo**, e la specie gliela dà lo
  schema. È la sola forma che un chiamante non interattivo sa compilare, ed è la
  stessa mossa dei `ParamSpec` un livello più in là — qui il tipo non lo
  dichiara il comando, lo dichiara la chiave che si sta toccando.
- **`settings.export` non scrive un file.** Non può e non deve: nessuna capacità
  dell'`HostApi` tocca il filesystem fuori dal vault
  ([0013](0013-elenco-delle-capacita.md), «allegati/asset: no»), e dove salvare
  lo sa chi ha il dialogo di sistema. L'esito esce come `CommandEffect::Custom`
  e la shell lo raccoglie — negli appunti, che è ciò che questa shell sa fare
  senza chiedere niente a nessuno, e con il payload già nella forma che un
  dialogo di salvataggio vorrà. La riga che conta è che qualcuno lo raccolga:
  `custom` ha per contratto il *degrado garbato*, e un export consegnato a chi
  lo ignora è un export finito nel vuoto, con l'utente convinto di aver
  esportato. Esporta ciò che **qualcuno ha deciso** e non i default: portarli
  dentro vorrebbe dire che reimportare *decide* tutto ciò che nessuno aveva
  deciso, congelando per sempre i default di oggi — compresi quelli che
  cambieranno.
- **`settings.import` non è tutto-o-niente, e lo dice.** Un file che nomina la
  chiave di un plugin che non c'è più non deve impedire di applicare le altre
  venti; ciò che non entra viene contato e nominato. Ed è il punto in cui il
  cancello della chiave si vede meglio: un file di impostazioni che passa di
  mano **non sposta** le chiavi che un programma non può scrivere — e non le
  sposta **nemmeno nella simulazione**, che è la stessa riga vista dal lato
  della [0010](0010-comando-descritto-a-una-macchina.md): un piano che contasse
  fra le applicate una chiave che l'apply rifiuterà non è un piano, è un
  preventivo.

### Il cambio è un evento, e non porta il valore

`Event::SettingChanged { key, scope }`. Non porta il valore nuovo: chi reagisce
lo rilegge, e una copia dentro l'evento sarebbe una seconda verità che invecchia
— due scritture ravvicinate consegnate in ordine inverso, o una consegna persa,
lascerebbero chi ascolta convinto di un valore che non è più quello. La chiave
dice *cosa riguardarsi*, che è l'unica cosa che non si può dedurre da sola.

Per la stessa ragione **non è recuperabile**
([0034](0034-il-freno-e-il-raggruppamento.md)): il valore si rilegge, il
*cambio* no — e chi si spegne quando lo spengono deve saperlo anche quando la
coda è piena.

## Cosa si è scartato, e perché

- **Uno spazio chiave→valore libero.** Sarebbe stato lo `storage_*` della
  [0013](0013-elenco-delle-capacita.md) col cappello della configurazione:
  nessuno schema, nessun default, nessun proprietario, e un file che cresce di
  chiavi che nessuno legge più. Lo schema dichiarato costa una riga a chi scrive
  un plugin e dà al pannello tutto ciò che gli serve per disegnare senza sapere
  niente.
- **I segreti.** Una chiave d'API non è un'impostazione: questo store è un file
  JSON in chiaro, leggibile da chiunque possa interrogare il canale dati, e
  prometterne la riservatezza sarebbe una promessa vera a metà. Quando ci sarà
  un portachiavi di sistema sarà una capacità sua, con una firma sua. Detto qui
  perché una regola che vale «finché nessuno chiede il contrario» va scritta
  dove la si legge prima di chiedere.
- **Il permesso per *leggere*.** Non c'è, e non è una dimenticanza: uno schema è
  pubblico per costruzione (sta nel manifest di chi lo dichiara) e questo store
  non contiene segreti per la riga qui sopra. Un plugin di tema che non potesse
  leggere `editor.font-size` perché non è sua sarebbe un plugin di tema inutile.
  Ciò che è recintato è la scrittura.
- **`FUB_CONFIG_DIR` come variabile d'ambiente.** Sopravvive di proposito,
  mentre questa voce toglie le altre: è il **bootstrap**. Dove stanno le
  impostazioni è l'unica cosa che non può essere un'impostazione, e una
  variabile che dice *dove cercare* è diversa da una che dice *cosa fare*.
  `FUB_VAULT` resta per la stessa specie di ragione: non è una preferenza che
  dura, è un argomento di avvio — il gemello del `fub <path>` che la CLI del
  27.1 avrà.
- **Una dipendenza per la cartella di configurazione** (`dirs`, `directories`).
  Sono venti righe di variabili d'ambiente documentate da vent'anni, contro un
  albero di crate in un progetto che ne dichiara l'SBOM
  ([0001](0001-supply-chain-e-sbom.md)). Il giorno che servisse anche «dove
  stanno le cache» e «dove stanno i dati», la dipendenza tornerebbe a valere il
  suo prezzo.
- **Un editor di liste nel pannello.** `SettingKind::List` si mostra e non si
  edita: un editor di liste è un widget che il protocollo di UI non ha, e
  inventarlo nel pannello vorrebbe dire che la shell sa disegnare qualcosa che
  una view dichiarativa non può chiedere. Chi cambia una lista è il comando che
  la scrive — per `plugins.disabled` è la scheda «Componenti».

## Cosa resta scoperto (e dove è scritto)

- **Il §11.2 è deciso ma non implementato**, ed era la condizione che la seduta
  poneva: i tre stati non nascono con tre meccanismi che non si parlano perché
  ora è scritto *dove non vanno*. Lo **stato di vista** (scroll, sezioni
  collassate, tab attiva) è per-macchina **e per-pannello**, quindi non è una
  chiave di configurazione ma una mappa indicizzata da `PaneId`; il **layout**
  ha più configurazioni per lo stesso utente, quindi non è un valore ma un
  insieme nominato. Nessuno dei due entra in questo store, e la ragione sta
  scritta in `fub_abi::settings` (dove la leggerà chi fosse tentato di
  infilarceli).
- **Il §11.3** — il sidecar `.fub/workspace.json` da assorbire — resta aperto.
  Questa voce gli ha però costruito ciò che serviva: la stessa cartella
  (`.fub/`), la scrittura atomica e la versione di schema che quel file non ha.
- **La migrazione della chiave sul rename** (§11.3) e la **primitiva generale di
  scrittura atomica** (§15.3): `write_atomic` è `pub` nel kernel con un cliente
  solo fuori (il registro dei vault), e il §15.3 la sposterà senza riscriverla.
- **Due processi sulla stessa cartella di configurazione si cancellano le chiavi
  a vicenda.** `write_atomic` dà l'atomicità di *un file* e non di un
  *aggiornamento*: chi la chiama compone il contenuto intero dalla propria copia
  in memoria, quindi la seconda installazione che salva atterra un file integro
  senza le chiavi che la prima aveva scritto dopo che lei aveva letto. Dentro un
  processo il caso non esiste, ed è tutto il punto dell'`Arc<MachineSettings>`
  condiviso qui sopra — il livello macchina è **uno**. Fra processi resta, e la
  risposta non è di questa voce: è un lock del file o una rilettura sotto lock
  prima di ricomporre, cioè lo strato che il **§15.2** copre. Sta scritto lì e
  sul doc di `write_atomic`, dove lo legge chi fosse tentato di credere che il
  nome della funzione prometta anche questo.
- **Un cambio di chiave `Machine` non attraversa i vault aperti.** Il *valore*
  sì — il livello è condiviso, ed è tutto il punto di condividerlo — ma
  `Event::SettingChanged` esce sul bus del vault che ha scritto, e i bus sono
  uno per vault. Chi tiene aperte due finestre vede il valore nuovo alla prima
  rilettura e non appena cambia. Non si chiude qui perché non è una domanda
  sulla configurazione: è la stessa domanda del §20.2 e delle sessioni multiple
  — *chi ha il diritto di emettere sul bus di un vault che non è quello in cui
  sta girando?* — e oggi non ha risposta per nessun evento. Nessuna chiave
  dichiarata è ancora di `Machine`, quindi il caso è vero e non ancora
  raggiungibile.
- **Accendere e spegnere un componente non è ancora un ciclo di vita.** Lato
  host `set_plugin_enabled` monta e smonta subito; la shell riscopre view e
  comandi perché il pannello glielo chiede, non perché ci sia un evento che lo
  dica. Un secondo osservatore — un'altra finestra, una CLI — non lo saprebbe.
  Il canale giusto è quello del §20.2 e delle view invalidate, non una chiamata
  in più.
- **Il canale per gli avvisi di lettura.** Un `.fub/settings.json` malformato,
  una chiave di macchina scritta in un vault, un valore fuori specie: sono
  avvisi, e oggi finiscono su `stderr` come tutto il resto (§20.2). Il pannello
  ha dove metterli il giorno che ci sarà un canale.
- **Il tema, le scorciatoie, la telemetria** non sono chiavi dichiarate: il
  posto dove staranno adesso c'è, ma dichiararle prima che qualcuno le legga
  vorrebbe dire mettere nel pannello righe che non fanno niente. Il §11.1 le
  nominava come *sbloccate*, non come contenuto.
