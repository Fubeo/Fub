# 0056 — Un elenco che è la sorgente, e un insieme che il compilatore chiude

|  |  |
|---|---|
| **Decisa** | 2026-07-29 |
| **Origine** | `todo.md` §16.7 (seduta 16) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[la seduta](../roadmap/16-crate-sdk-banchi-di-prova.md) ·
[il gemello, la superficie IPC](0057-la-dieta-dell-ipc.md)

---

Si legge insieme alla [0057](0057-la-dieta-dell-ipc.md). La tassonomia sta qui —
è questa la voce che accusa gli elenchi scritti a mano — e là si applica alla
sola superficie in cui la risposta cambia.

## La prima domanda era se le due voci fossero la stessa

Il §16.7 dice che *«un presidio la cui copertura è un elenco scritto a mano
smette di coprire senza diventare rosso»*. Il §16.6 propone come soluzione **un
elenco scritto a mano**: l'allowlist dei comandi Tauri. O il §16.6 prescrive il
difetto che il §16.7 condanna, o le due cose non sono la stessa cosa.

Non lo sono, e la differenza è meccanica invece che di gusto. Guardata da come
si usa, una lista scritta a mano sta in una di due posizioni:

- **Sorgente di iterazione.** Il test cammina l'elenco e prova ogni voce.
  L'insieme vero vive altrove — le quattro `impl ViewProvider`, i metodi che il
  cancello nega — e nessuno confronta le due cose. Aggiungere al vero senza
  aggiungere all'elenco è **verde**: il test continua a provare quello che
  provava. La copertura scende in silenzio.
- **Asserzione di uguaglianza.** Il test estrae l'insieme vero e pretende che
  sia uguale all'elenco. Aggiungere al vero senza aggiungere all'elenco è
  **rosso**.

Sono la stessa frase — *quattro view*, *trentasette comandi* — in due posizioni
logiche opposte. L'allowlist del §16.6 è nella seconda: non prescrive il
difetto, ne è l'inverso. Il §16.6 è il §16.7 già risolto, per una superficie
sola.

## Tre forme, e un criterio per scegliere

Il repo ha già i tre esemplari, e non se n'era accorto di averne tre:

| forma | come non mente | esemplari in repo |
|---|---|---|
| **l'elenco non esiste** | il compilatore lo ricostruisce | il `match` senza `_` di `ts_mirror.rs`, `fieldless_enums()` e `rust_enum_order` della [0053](0053-il-contratto-ha-una-sorgente.md), `Capability::ALL` |
| **l'elenco è la sorgente** | ciò che elenca è *costruito da lui*, quindi non può divergere | nessuno, prima di questa decisione |
| **l'elenco si confronta** | un test estrae l'insieme vero e pretende l'uguaglianza | `ALLOWED_TRANSITIVE_ABI` in `dependency_invariant.rs`, e ora la [0057](0057-la-dieta-dell-ipc.md) |

Il criterio che sceglie fra le ultime due è **uno solo, e non è un'opinione**:

> *La produzione può leggere l'elenco?*

Se sì, l'elenco diventa la sorgente e la divergenza è impossibile. Se no —
perché ciò che definisce l'insieme è una macro, o un file, o un altro linguaggio
— l'elenco resta una copia e va confrontato con la sorgente, e la divergenza è
possibile ma rumorosa.

È questo criterio a rendere le due voci **due**: sulle view la produzione può
leggere l'elenco, sui comandi Tauri no (`tauri::generate_handler!` prende
identificatori a compile time e non itera niente). Stessa domanda, stessa
tassonomia, due risposte — e il cappello di una seduta che dichiara un confine
chiede due verbali, per il criterio che la
[0055](0055-il-banco-del-lato-host.md) ha fissato.

## Gli elenchi delle view sono quattro, non uno — e uno è di un'altra specie

Il §16.7 ne nomina uno (`view_refresh_masks.rs`). Contati:

| posto | crate | natura | forma |
|---|---|---|---|
| `host/src/mount.rs` | `fub-host` | **produzione** | quattro `CoreBundle` su nove, che *registrano* |
| `features/tests/view_refresh_masks.rs` | `fub-features` | prova | `fn ogni_view()` |
| `features/tests/i_cataloghi.rs` | `fub-features` | prova | quattro chiamate a `viste(…)` |
| `features/tests/conformita.rs` | `fub-features` | prova | quattro chiamate, **per due volte** |

Il quarto è arrivato con la [0054](0054-il-banco-del-lato-provider.md), che lo
ha scritto dichiarando nel proprio doc-comment di star aggiungendo una copia al
difetto che il §16.7 accusa. Era onesto e va tolto: una nota che dice «so che è
sbagliato» non è un presidio, è una nota.

E il primo **non è della stessa specie degli altri tre**. È l'unico che sta in
un altro crate, l'unico che è codice di libreria, e soprattutto l'unico da cui
la cosa **esiste**: gli altri tre descrivono le view ufficiali, `mount.rs` le
*costituisce*. Una view che `mount.rs` non registra non è una view ufficiale che
i test dimenticano — non è una view ufficiale.

## Il posto che la 0055 aveva scelto non può funzionare, e il repo lo dimostra

La [0055](0055-il-banco-del-lato-host.md) ha nominato il posto di
`ogni_view_ufficiale()` — `crates/fub-testkit/src/lib.rs` — e non l'ha
costruito, lasciando a questa voce il costo: `fub-features` fra le dipendenze
del banco.

Il costo è quello, ma non è il problema. Il problema è che **`mount.rs` non
potrebbe leggerlo mai**, e lo dice un test che esiste già:

```rust
// crates/fub-abi/tests/dependency_invariant.rs
fn il_banco_di_prova_non_entra_in_nessuna_libreria() { … }
```

Nessun crate del workspace può dichiarare `fub-testkit` fra le dipendenze
**normali** — ha il kernel dentro, e chi lo prendesse se lo porterebbe in
libreria. `mount.rs` è codice di libreria di `fub-host`. Un inventario nel
testkit servirebbe i tre test e non il quarto elenco, cioè resterebbe una
**sorgente di iterazione** per tre copie e non toccherebbe quella che le
costituisce: la prima delle tre forme fallita, la seconda irraggiungibile per
costruzione. Sarebbe una **quinta copia**, e la peggiore — quella che fa credere
che il problema sia risolto.

La 0055 aveva anche guardato la direzione giusta (il banco è già dev-dependency
di `fub-features`, quindi il ciclo sarebbe legittimo come quello del kernel). Il
ciclo infatti non era l'ostacolo. L'ostacolo era un invariante che quella
decisione non aveva riletto — e che è ironicamente lo stesso file che la
[0054](0054-il-banco-del-lato-provider.md) aveva appena finito di scrivere.

## Deciso: l'inventario appartiene a chi possiede le cose

`crates/fub-features/src/inventario.rs`. È il crate che possiede
`BacklinksView`, `OutlineView`, `TagPanelView`, `StatsView` e i loro cataloghi,
ed è già dipendenza **normale** di `fub-host` — quindi `mount.rs` lo legge senza
che nessun confine si sposti di un centimetro. Nessuna dipendenza nuova nel
grafo, in nessuna direzione.

E l'inventario **non descrive**: `mount.rs` costruisce i bundle delle view
iterandolo. Una riga fuori dall'inventario non è una view ufficiale che i test
dimenticano di provare — è una view che non viene montata, il che si vede alla
prima apertura del vault.

### L'inventario è delle feature, non delle sole view

Guardando `i_cataloghi.rs` per riscriverlo è saltato fuori un elenco che nessuna
voce nomina: quel file elenca a mano **otto** componenti, non quattro — le
quattro view più ricerca, blocchi, versioning e comandi. È lo stesso difetto un
giro più largo: una quinta view entrerebbe muta, ma anche una **nona feature**
entrerebbe senza che nessuno presidi il suo catalogo.

Quindi l'inventario è delle **feature ufficiali di `fub-features`** — otto righe
con id, nome, catalogo, e i puntatori ai provider che si possono costruire da
soli (la view, il `CommandProvider`) — e le view ne sono un sottoinsieme
*derivato* con un `filter`, non un secondo elenco parallelo. `CORE_ID` resta
fuori ed è giusto: vive in `fub-host` col proprio catalogo, e non è una feature.

Ciò che **non** sale nell'inventario è la registrazione delle **tre** feature
irregolari: ricerca, versioning e blocchi. Registrano cose diverse fra loro — un
`IndexProvider`, un `EventHandler`, tre regole di sintassi più due renderer — e
il versioning ha bisogno di uno stato che vive in `mount.rs`. Forzarle in una
firma comune avrebbe voluto dire inventare un'astrazione per tre casi che non si
somigliano, e `mount.rs` esiste apposta per essere il posto dove l'irregolare è
scritto per esteso. Dall'inventario prendono id, nome e catalogo; resta scritto
a mano soltanto **cosa** ognuna registra.

*(I comandi erano il quarto caso irregolare in un primo giro di questa
decisione, e non lo sono: `CoreCommands` si costruisce da solo come una view,
quindi è un puntatore nell'inventario e `mount.rs` non lo nomina più. La
differenza fra regolare e irregolare non è che tipo di provider si registra: è
**se serve qualcosa che l'inventario non ha**.)*

### E un presidio che chiude il bypass

L'inventario impedisce di dimenticare una view; non impedisce di registrarne una
scavalcandolo. Il presidio nuovo — `crates/fub-host/tests/le_view_ufficiali.rs`
— monta un workspace vero e pretende che l'insieme montato sia **esattamente**
quello dell'inventario, nelle due direzioni. È qui che la seconda forma si
appoggia alla terza: la sorgente è la sorgente perché un'asserzione di
uguaglianza lo verifica.

### Il quinto elenco, che va lasciato dov'è

Riscrivendo i tre presidi ne è saltato fuori un altro che nessuna voce nomina:
`fub-host/tests/headless.rs` asserisce l'uguaglianza con **nove** id di bundle
battuti a mano. È della specie buona — la terza forma, non la seconda — e
infatti è diventato rosso da solo durante le prove.

Va lasciato scritto a mano, ed è una decisione e non una dimenticanza. Il
presidio nuovo confronta ciò che è montato con `ogni_feature_ufficiale()`,
quindi **non direbbe niente se l'inventario stesso fosse sbagliato**: derivare
anche questi nove nomi dall'inventario renderebbe i due test la stessa
asserzione scritta due volte. Un elenco battuto a mano una volta, indipendente
dalla sorgente, è ciò che risponde alla domanda che la sorgente non può porsi —
la stessa ragione per cui `ALLOWED_TRANSITIVE_ABI` è una fotografia e non un
calcolo. La regola non è «mai elenchi a mano»: è **mai un elenco a mano da cui
si itera**.

## Le sette del `TriesEverything` sono giuste, e misurano un'altra cosa

Il §16.7 dice che il test elenca sette capacità per nome, «ed erano cinque
quando questa voce è stata scritta». Ricontato: sette `annota(`, sette
nell'asserzione, e le due arrivate dopo sono `setting`
([0036](0036-le-impostazioni-e-i-tre-stati.md)) e `view-state`
([0037](0037-lo-stato-di-vista.md)). **Il numero è esatto**, ed è l'unico della
seduta che lo era. Il difetto non è quello: è che un'ottava entrerebbe restando
verde.

Ma ricontando è emersa una cosa che la voce non dice, e che cambia il presidio.
**Quelle sette non sono capacità**: sono sette *metodi*. Le capacità nel repo
sono già un insieme chiuso e presidiato — `enum Capability` in
`kernel/src/host/guard.rs` ha **quattordici** famiglie, `Capability::ALL` le
elenca, e i `match` senza `_` in `Capability::permission` e in
`impl Policy for ReadOnly` fanno sì che una quindicesima **non compili** finché
qualcuno non la classifica. La prima forma della tabella qui sopra, applicata
due anni-verbale prima che questa voce la chiedesse.

Il buco vero sta un gradino più in là, ed è più grande di quello che la voce
descrive. `ReadOnly` nega **sette famiglie**: `VaultWrite`, `VaultStructure`,
`DataWrite`, `SettingsWrite`, `ViewStateWrite`, `Events`, `Services`. Il
`TriesEverything` ne esercita **tre** — `VaultStructure` (con cinque metodi su
sette dell'elenco), `SettingsWrite` e `ViewStateWrite`. Quattro famiglie negate
non le prova nessuno, e la coincidenza fra il sette dei metodi e il sette delle
famiglie negate è precisamente questo: una coincidenza.

Quindi il presidio non elenca più: calcola l'atteso iterando `Capability::ALL` e
chiedendo a una `ReadOnly` quali nega, e pretende l'uguaglianza con quelle
davvero rifiutate — nelle due direzioni. È la prima forma (l'insieme è chiuso
dal compilatore) che alimenta la terza (un'asserzione di uguaglianza), e appena
acceso è **rosso su quattro famiglie** che nessuno stava provando. È il modo
migliore in cui un presidio nuovo può nascere.

## Il limite di questo presidio, detto accanto al presidio

La copertura è garantita alla grana della **famiglia**, che è la grana a cui il
`Guard` decide. Non alla grana del **metodo**: un metodo nuovo dentro
`VaultStructure` obbliga il compilatore a implementarlo in `Guard`, ma non
obbliga a scrivere dentro quell'impl la riga `self.check(Capability::…)`. Un
metodo strutturale che dimenticasse la guardia passerebbe.

Lo si scrive qui perché è il criterio che il §16.7 chiede di portare avanti,
letto al contrario: se una copertura ha un limite, il limite va detto **accanto
alla copertura**, o si crederà che copra. Le due specie che la voce elenca — il
conteggio invecchiato che fa sopravvalutare, il limite invecchiato che fa
sottovalutare — nascono entrambe da una frase scritta lontano da ciò che
descrive.

## Cosa si è scartato

**L'inventario nel testkit**, che la 0055 aveva nominato: irraggiungibile da
`mount.rs` per un invariante presidiato, come sopra. Non è stato scartato per il
costo (`fub-features` fra le dipendenze del banco), che pure ci sarebbe stato: è
stato scartato perché non avrebbe fatto la cosa.

**Una macro che generi `mount.rs` dall'inventario.** Toglierebbe anche il ciclo,
ma comprerebbe pochissimo — quattro righe — e pagherebbe con la cosa che
`mount.rs` esiste per avere: essere leggibile per esteso. La tabella di
montaggio è il posto dove si va a capire cosa esiste.

**Un inventario che assorba anche la registrazione delle quattro irregolari.**
Un'astrazione per quattro casi che non si somigliano, e uno dei quattro ha uno
stato che vive dall'altra parte del confine.

**Fare del `TriesEverything` un presidio alla grana del metodo**, parsando le
funzioni delle interfacce `host-*` di `abi.wit` come fa `wit_conformance`. È
possibile — il conto meccanico c'è, sono 34 funzioni su 14 interfacce — e
costerebbe `wit-parser` fra le dev-dependency del kernel. Vale la pena il giorno
in cui un metodo dimenticherà la guardia; oggi il limite è dichiarato e questo
basta a non crederci coperti.

## Il presidio stava a valle dell'unica cosa non presidiata

Il nuovo test calcola l'insieme atteso da `Capability::ALL`. Ma `ALL` è **un
elenco scritto a mano** con la lunghezza dichiarata (`[Capability; 14]`), e il
suo doc-comment diceva che una famiglia dimenticata «nascerebbe negata a tutti —
che è il modo giusto di sbagliare, **ma va visto**». La prima metà è vera per
costruzione (`Granted::new` folda su `ALL`, quindi fallisce chiuso); la seconda
era una raccomandazione, non un presidio. E adesso pesava di più: anche il
presidio nuovo ricava da `ALL` ciò che pretende di aver provato, quindi una
famiglia fuori da `ALL` sparirebbe da **tutti e due** restando verde.

Il compilatore obbliga a toccare l'elenco — la lunghezza non torna — ma non a
metterci dentro la variante giusta: si soddisfa duplicando una riga già
presente.

Chiuso, e senza proc-macro, sfruttando ciò su cui `CapabilitySet` fa già
affidamento (`1 << cap as u16`): i discriminanti sono contigui da zero, quindi
pretendere che quelli di `ALL` siano esattamente `0..len` vieta **insieme** i
duplicati e i buchi. `i_discriminanti_coprono_ogni_famiglia`, in `guard.rs`.
Provato: duplicando una riga per far tornare il `15`, il test dice
`left: [0, 0, 1, …, 13]` contro `right: [0, 1, …, 14]`.

## Quattro affermazioni false, trovate misurando

Ricontare per costruire i presidi ha rimesso in fila della prosa che il codice
smentiva. Corretta nel giro in cui è uscita, com'è la regola:

| dove | diceva | è |
|---|---|---|
| `kernel/src/host/guard.rs`, **tre** punti | «risponde a **dieci** nomi», «**Dieci** bit in un `u16`», «Le **dieci** famiglie» | **quattordici** — e il doc-comment di `Capability`, cinque righe sopra il primo, lo diceva già giusto |
| [0013](0013-elenco-delle-capacita.md) | «copre tutte e **sei** le strutturali», e poi ne elenca cinque | **cinque**: tanti sono i metodi di `VaultStructure` |
| [plugin-boundary.md](../architecture/plugin-boundary.md) | «nega *tutte* e **sei** le strutturali» | il numero è sbagliato, e **la portata di più**: `ReadOnly` nega sette famiglie, e configurazione, stato di vista, blob, job e servizi non sono strutturali in nessun senso |
| [§16.7](../roadmap/16-crate-sdk-banchi-di-prova.md) | «127 file, **2284** link» | **2285**, già nel commit che lo scriveva |

Le prime tre sono la specie che il §16.7 chiama la più grande — *un'affermazione
sui sorgenti scritta in italiano* — e la prima è quella che colpisce: sta nello
**stesso file** del codice che descrive, tre volte, a poche righe da un numero
giusto. La distanza fra la frase e la cosa non è la ragione per cui invecchia.

## Cosa resta scoperto, dichiarato

**La famiglia della prosa che conta i sorgenti.** Il §16.7 se l'era tirata dietro
— i conteggi falsi, il limite dichiarato che non c'è più, la garanzia mai
esistita, le righe di [strozzature.md](../roadmap/strozzature.md) che rimandano a
voci chiuse altrove. È lo stesso *difetto* ma non lo stesso *presidio*: quelli
qui sopra sono insiemi che un test può estrarre, quella è un'affermazione in
italiano dentro un documento. Deciderla a pezzi vorrebbe dire decidere due volte
la forma dell'annotazione, la seconda contro la prima — che è la ragione per cui
la [0053](0053-il-contratto-ha-una-sorgente.md) ha accorpato due voci. Qui la
stessa ragione **separa**: è la
[§16.8](../roadmap/16-crate-sdk-banchi-di-prova.md#168-la-prosa-che-conta-i-sorgenti-non-ha-nessun-presidio),
aperta da questa seduta.

E con una prova che è arrivata mentre si scriveva: il §16.7 dichiara «127 file,
**2284** link», e il controllo ne conta **2285**. Quel numero era falso nel
commit che lo ha scritto — la settima volta in quella sola voce, non la sesta.

**La grana del metodo dentro una famiglia coperta**, come sopra. È l'unico
residuo di questa decisione, ed è dichiarato accanto al presidio invece che qui,
che è il punto di tutta la voce.
