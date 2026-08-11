# 0037 — Lo stato di vista: di chi è lo scroll, dove vive, e perché non viaggia col vault

|  |  |
|---|---|
| **Decisa** | 2026-07-28 |
| **Origine** | `todo.md` §11.2 (seduta 11) — ne chiude **metà**: lo stato di vista c'è, resta il layout |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[la seduta](../roadmap/11-impostazioni-e-i-tre-stati.md)

---

Il §11.2 teneva insieme **tre** stati che non avevano un contenitore, e la
[0036](0036-le-impostazioni-e-i-tre-stati.md) ne ha chiuso il primo — le
impostazioni — lasciando degli altri due la sola cosa che col freeze di M4
scadeva: *dove non vanno*. Questo verbale chiude il secondo.

Prima di questa decisione, «dove si era rimasti» stava in due posti e nessuno
dei due era una scelta. Per la **shell**: in `localStorage`, che era il posto
giusto per la ragione giusta — non viaggia col vault — e sbagliato per due che
si vedono usandolo. Moriva col profilo della webview: una reinstallazione, un
*clear site data*, e le cartelle aperte non c'erano più. E non lo conosceva
nessuno **fuori** dalla webview: un backend che volesse sapere come si stava
guardando un vault — o potarlo quando quel vault viene dimenticato — non aveva
modo di arrivarci.

Per un **provider**: da nessuna parte. Anzi, da poco meno di prima, perché la
[0013](0013-elenco-delle-capacita.md) aveva ritirato lo `storage_*` volatile a
chiave→valore — l'unica rottura della linea di base di quel giro — dopo aver
constatato che fra i `data_*` da una parte e le impostazioni dall'altra non gli
restava un caso proprio. Il caso proprio c'era, ed è questo. Il ritiro non ha
creato il buco: ha tolto l'illusione che fosse tappato.

Si vedeva nel pannello dei tag, che è il provider ufficiale con più stato di
tutti. Il filtro digitato stava in un campo di `TagPanelView` — la
[decisione 0016](0016-cosa-e-una-view.md) aveva reso `on_action` un `&mut self`
apposta — e quel campo aveva due difetti che nessun test poteva cogliere, perché
erano *fuori* dal giro provato: moriva alla chiusura, e siccome il provider è
**uno solo**, due esemplari dello stesso pannello avrebbero condiviso il filtro
credendo di averne uno per uno.

## La risposta, in una frase

**Lo stato di vista è una famiglia di capacità (due, in verità: si rilegge
mentre si disegna e da lì non si deve poter scrivere), la sua chiave la compone
l'host con dentro il proprietario e l'esemplare — non il chiamante — e il valore
vive in un file della macchina che il kernel possiede, accanto alle impostazioni
di macchina e al registro dei vault, con la stessa disciplina: versione di
schema, scrittura atomica, e un file che non si è potuto leggere non si
riscrive.**

## Le decisioni prese, da NON ridiscutere senza motivo

### Due famiglie, non una

`ViewStateRead` sta in `ReadApi`, `ViewStateWrite` solo in `HostApi`. È la
stessa divisione dei blob e delle impostazioni, e qui la ragione è più stretta
che altrove: il momento in cui una view rilegge il proprio scroll **è mentre si
disegna**, cioè da sotto un prestito condiviso del workspace (`render_view`
prende `&dyn ReadApi`). Se ce ne fosse una sola, o `render_view` avrebbe dovuto
prendere un `&mut` — e allora disegnare potrebbe scrivere, che è precisamente
ciò che la firma esiste per rendere impossibile — o rileggere lo stato sarebbe
stato possibile solo rispondendo a un'azione, cioè mai al primo disegno, che è
l'unico momento in cui serve davvero.

### La chiave è dell'esemplare, e non è un `PaneId`

La 0036 aveva scritto «una mappa indicizzata da `PaneId`». Era un'illustrazione,
non una firma, e lo scarto va detto: un `PaneId` **non esiste**. Esiste
`ViewInstance::instance`, che dalla [0007](0007-contesto-di-sessione.md) è già
«quale delle tre istanze di questa view sono io», e che il kernel timbra su ogni
`render_view` e ogni `view_action`. Prendere quello invece di inventare un
identificatore di pannello ha tre conseguenze buone e nessuna cattiva:

1. esiste già, e non c'è un secondo concetto di «quale pannello» da tenere
   d'accordo col primo;
2. sopravvive al modello di layout (§1.2): il giorno che i pannelli saranno più
   d'uno, ognuno avrà i propri esemplari e la chiave non cambia forma;
3. è la grana giusta *oggi*. Un `PaneId` avrebbe legato lo stato al riquadro;
   due view diverse nello stesso riquadro hanno stati diversi, e la stessa view
   in due riquadri ne ha due — che è esattamente ciò che l'esemplare dice e il
   riquadro no.

### Chi scrive non è un parametro

Né il proprietario né l'esemplare compaiono nella firma: `view_state(key)` e
`set_view_state(key, value)`. Li timbra l'host, ed è la mossa dell'id di un job
nella [0035](0035-il-lavoro-lungo-si-racconta.md), per la stessa ragione: sono i
due dati che il chiamante potrebbe *mentire*. Se fossero parametri, un provider
potrebbe rileggere lo scroll di un altro — cioè il recinto non esisterebbe — e
due pannelli aperti sullo stesso vault potrebbero sovrascriversi a vicenda
credendo di ricordare.

Ne segue che **non è un permesso dichiarabile**: `ViewStateRead` e
`ViewStateWrite` non hanno un `fub:*` nel manifest, come non ce l'hanno i blob,
perché ciò che si legge e si scrive è già solo il proprio. Un permesso che non
può negare niente è una casella da spuntare che insegna a spuntare caselle.

### Fuori da un esemplare: leggere è `None`, scrivere è un errore

Le due metà rispondono **diversamente**, ed è voluto. Un job, un comando, un
handler di eventi non stanno disegnando per conto di nessuna istanza:

- **leggere torna `None`**, che è la stessa risposta di chi non ha mai salvato
  niente. È il caso normale del primo disegno, e un provider che dovesse
  distinguere «mai scritto» da «errore» per disegnare la propria prima riga
  avrebbe un ramo che nessuno prova;
- **scrivere è `BadArgs`**, e non un silenzio. Una scrittura ingoiata è qualcuno
  che crede di ricordare e non ricorderà: un difetto che si vede solo alla
  riapertura, quando è tardi per capire da dove viene.

### Un file per macchina, e il vault è la prima chiave

`view-state.json` nella cartella di configurazione, accanto a `settings.json` e
`vaults.json`. **Non** dentro il vault: lo scroll di ieri sul portatile non è un
fatto sul vault, e sincronizzarlo vorrebbe dire far litigare due macchine su
dove si era rimasti — che è il difetto che i vault sincronizzati con strumenti
esterni producono per primo.

E **un file solo**, col root del vault come prima chiave, non un file per vault:
i vault che una macchina conosce sono venti più i preferiti (il tetto del
registro), e un file per ognuno vorrebbe dire una cartella di nomi illeggibili —
perché il nome dovrebbe essere l'impronta di un path — che nessuno saprebbe più
mettere in relazione con niente.

Ne segue chi lo pota, ed è la riga che tiene questo file dalla parte giusta:
**dimenticare un vault dimentica come lo si stava guardando**
(`Host::forget_vault`). Senza, sarebbe l'unico posto del progetto che cresce e
non cala mai — e riaprire fra un anno un vault dimenticato ritroverebbe le
cartelle aperte com'erano, che non è ciò che «dimenticare» promette.

### La shell ci è dentro, e la modalità cambia grana

Modalità, cartelle aperte e spazio selezionato sono usciti da `localStorage`. La
shell non è un plugin — non ha un manifest e non le si concedono capacità —
quindi passa dall'API del `Workspace`, e sono i due comandi IPC a timbrare
proprietario (`fub.shell`) ed esemplare: se arrivassero da JS, una pagina
qualunque potrebbe rileggere e riscrivere lo stato di un provider.

Un cambiamento visibile, e va detto perché non è un effetto collaterale: la
**modalità** era globale — una chiave sola per tutte le cartelle — e ora è per
vault, perché il vault è la prima chiave dello store. È la grana giusta: un
vault di appunti che si legge e uno di note che si scrive non hanno ragione di
condividere la modalità, e chi ne tiene uno solo non vede differenza.

L'esemplare della shell è **uno**, e si chiama `window`. Dichiararlo è più
onesto che lasciarlo implicito: oggi l'area principale è un pannello solo,
quindi non c'è niente da distinguere.

### Il cliente vero è il pannello dei tag

La regola del §1.6 — una variante entra solo con WIT, conformità,
implementazione e **un cliente vero** nello stesso giro — qui non era una
formalità: la shell da sola non sarebbe bastata, perché passa dall'API del
`Workspace` e non dalla capacità, e la capacità sarebbe nata senza che nessuno
l'avesse mai chiamata.

Il filtro di `TagPanelView` è uscito dal campo della struct ed è entrato nello
stato di vista. La struct non ha più campi, e le due prove che il campo non
poteva superare adesso passano: il filtro sopravvive alla chiusura, e due
esemplari dello stesso pannello ne hanno uno per uno.

### Un filtro vuoto si dimentica

`set_view_state(key, None)` toglie la chiave e **pota i contenitori rimasti
vuoti**. `None` e non una funzione a sé (come `reset_setting`) perché qui non ci
sono livelli sotto a cui ricadere: una chiave c'è o non c'è. E si dimentica
invece di scrivere `""` o `[]` perché è ciò che significa — un esemplare chiuso
non deve lasciare dietro di sé una parentesi graffa vuota per ogni volta che
qualcuno lo ha aperto.

## Cosa si è scartato, e perché

**Tenerlo nei `data_*`.** È il posto dove sarebbe finito da sé, ed è sbagliato
per una ragione sola ma dirimente: i blob vivono **dentro il vault**, quindi
viaggiano con lui. Un vault in cloud avrebbe portato lo scroll del portatile sul
fisso, e due macchine avrebbero litigato su un dato che non è del vault.

**Farne un'impostazione.** Un'impostazione ha un valore per chiave e la decide
l'utente; questo ha un valore per esemplare e non lo decide nessuno — si
deposita mentre si guarda. Metterlo là avrebbe voluto dire un pannello di
impostazioni con dentro lo scroll di ieri, e uno schema dichiarato per una
chiave che il provider inventa mentre lavora.

**Far rientrare lo `storage_*` della 0013.** È l'obiezione da fare a questo
verbale, e la risposta è che le tre proprietà che a quello mancavano ci sono
tutte: quello era **volatile** (questo dura), **di chiunque senza recinto**
(questo ha la chiave composta dall'host), e **senza un posto** (questo ha un
file, con la disciplina della 0036). Ciò che rientra non è la capacità ritirata:
è il caso d'uso che quel ritiro aveva lasciato scoperto, con una firma diversa
per i tre motivi che lo avevano fatto ritirare.

**Un `PaneId` nuovo nel contratto.** Vedi sopra: sarebbe stato un secondo
concetto di «quale pannello» da tenere d'accordo con `ViewInstance`, e con la
grana sbagliata.

**Il layout, adesso.** Il §11.2 chiedeva due contenitori e ne consegna uno. Non
è una scorciatoia: oggi l'area principale è **un pannello solo**, quindi non
esiste nessuna disposizione da salvare, e un formato deciso adesso descriverebbe
una cosa che non c'è. Va col modello di layout
([§1.2](../roadmap/18-editor-e-tastiera.md#12-smontare-il-monolite), seduta 18),
che è anche dove nasce ciò che gli darebbe senso.

## Cosa resta scoperto (e dove è scritto)

- **Il layout.** Metà del §11.2, che resta aperta — col precedente della
  [0031](0031-chi-possiede-i-bundle.md), che è stata la prima a chiuderne mezza.
  Il criterio è in [README.md](README.md): un verbale per pezzo di voce si
  scrive quando il pezzo è una decisione intera.
- **Ogni scrittura è sincrona e riscrive il file intero.** Digitare nel filtro
  dei tag salva a ogni carattere; il file è di pochi KB (venti vault più i
  preferiti, qualche chiave per esemplare) e la scrittura è atomica, quindi oggi
  non è un problema — ma è un costo reale e va detto invece di scoprirlo. Se un
  giorno lo diventerà, la via d'uscita è una scrittura differita, e sarà una
  voce sua.
- **Gli orfani non si potano.** Un esemplare che non si riaprirà mai — una view
  di un plugin disinstallato, un `instance` che la shell non genera più — lascia
  la sua chiave nel file. Non è la crescita senza fine che la potatura per vault
  evita, ed è comunque una cosa che nessuno pulisce: se servirà, si pota quando
  si conosce l'inventario di ciò che può esistere, cioè non prima del modello di
  layout.
- **La shell ha un esemplare solo (`window`).** Il giorno che le finestre
  saranno più d'una, due finestre sullo stesso vault condivideranno modalità,
  cartelle aperte e spazio selezionato. È la stessa domanda del layout, e si
  risponde là.
