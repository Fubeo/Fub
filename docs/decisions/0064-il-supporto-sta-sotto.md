# 0064 — Il supporto sta sotto, e la specie di una voce non segue il link

|  |  |
|---|---|
| **Decisa** | 2026-08-01 |
| **Origine** | `todo.md` §15.1 (seduta 15) — **meno una casella** |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/15-il-disco.md) · [le voci a leva più alta](../roadmap/leva.md) · [la mappa del disco](../architecture/on-disk-layout.md)

---

Un vault è una cartella sul filesystem, e per tutta la vita del progetto lo è
stato anche nel codice: `std::fs` chiamato dove serviva. Non è un difetto finché
il filesystem è uno solo — ed è precisamente il punto della voce, che nessuno
sta aspettando che diventi un difetto.

Aspettano invece **cinque famiglie di FEATURES**, e chiedono tutte la stessa
cosa allo stesso identico posto: la cifratura at-rest (23.1), i vault remoti e
il sync (18.1), la PWA su OPFS (26.3), i vault read-only e su share di rete
(3.1), i drive rimovibili (2.3). Cinque supporti diversi, un posto solo.

La cifratura è quella che decide la forma, ed è il motivo per cui questa non
poteva essere una voce di plugin: la stratificazione funziona **solo se sta
sotto** `data_*` e `vault_*`, dove nessun cliente la vede e nessuno se ne può
dimenticare. Un plugin di cifratura farebbe attraversare il confine a ogni byte
del vault due volte, e l'indice di ricerca — che persiste attraverso lo spazio
dati come chiunque altro — resterebbe in chiaro comunque.

## La decisione

**Il kernel tocca i byte di un vault da un posto solo: `kernel/storage.rs`.**

```rust
pub trait VaultStorage: Send + Sync {
    fn read(&self, path: &Utf8Path) -> io::Result<Vec<u8>>;
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<()>;
    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> io::Result<()>;
    fn remove(&self, path: &Utf8Path) -> io::Result<()>;
    fn list(&self, dir: &Utf8Path) -> io::Result<Vec<DirEntry>>;
    fn stat(&self, path: &Utf8Path) -> io::Result<Stat>;
    fn exists(&self, path: &Utf8Path) -> bool { /* default: stat().is_ok() */ }
    fn remove_dir_all(&self, dir: &Utf8Path) -> io::Result<()> { /* default */ }
    fn remove_empty_dir(&self, dir: &Utf8Path) -> io::Result<()>;
}

pub struct FsStorage;   // il filesystem, come è sempre stato
pub struct MemStorage;  // la seconda implementazione
```

Il [`Vault`](../../crates/fub-kernel/src/vault.rs) lo tiene in un `Arc` e lo
presta a chi scrive **dentro lo stesso vault** senza passare per un `DocId`: lo
spazio dati dei plugin (`data_read`, `data_write`, `data_list`, `data_remove` in
`host/kernel.rs` e `host/read.rs`), l'elenco degli spazi dati
(`documents.rs`), la camminata di `collect_data_files` (`workspace.rs`) e la
migrazione dello stato per-documento (`docdata.rs`). Sotto la linea del vault,
`std::fs` non compare più.

Il trait è **interno al kernel**, non del contratto: non è una firma che scade
col freeze, e la [leva](../roadmap/leva.md) lo diceva già chiudendo la lettura
esterna che voleva promuovere questa voce a P0. La leva è alta, la scadenza non
c'è, e le due cose non sono in contraddizione.

## Le decisioni prese, da NON ridiscutere senza motivo

### La durabilità **non** entra qui, ed è il motivo dell'ordine

L'elenco della voce diceva «write **atomico**», e la scrittura di `FsStorage`
oggi è una `std::fs::write` come prima. Non è una svista: è la distinzione fra
l'**operazione** e la **proprietà**. L'operazione è di questa voce, la proprietà
è del [§15.2](../roadmap/15-il-disco.md#152-durabilità-e-recovery), e la seduta
mette il §15.1 per primo esattamente perché il §15.2 possa **scendere dentro**
questa funzione invece di essere scritto due volte — una accanto all'astrazione
e una dentro.

Il costo di anticiparla non sarebbe stato zero, e vale la pena scriverlo perché
è la ragione vera: temp+rename su un documento del vault vuol dire **cambiare
inode a ogni salvataggio**, con quel che segue per gli hardlink, per i symlink e
per chi guarda la cartella da fuori — Obsidian, un sync di terzi, un editor
aperto sullo stesso file. Su un file di configurazione che riscriviamo noi da
capo quel prezzo non si vede (`write_atomic` lo paga già dalla
[0036](0036-le-impostazioni-e-i-tre-stati.md)); su una nota dell'utente si vede,
e va deciso guardandolo. Le scelte con un prezzo si mettono a verbale.

E per la stessa ragione non entra qui l'**altro** asse, che si chiama
facilmente allo stesso modo: la *classe* di un dato — «si può buttare o no» — sta
nel path e l'ha decisa la [0048](0048-una-radice-sola.md). Un supporto non sa
cosa sta scrivendo, e non deve saperlo.

### Il `MemStorage` non è il banco di prova dei test e2e

Il movente originale della voce era «oggi ogni test e2e tocca il disco», ed è
stato **tolto** perché lavora contro il §15.2: tutto il punto della durabilità è
temp+rename+fsync sulla directory, cioè una proprietà che esiste **solo** su un
filesystem vero. Una suite spostata su un supporto in memoria smetterebbe di
esercitare esattamente ciò che il §15.2 esiste per aggiungere, e il presidio
della durabilità diventerebbe verde su un supporto che non ha durabilità — che
è il modo in cui un presidio smette di presidiare senza diventare rosso.

Il `MemStorage` è qui per due altre ragioni: essere il **secondo cliente** del
trait — un'astrazione con un cliente solo non è un'astrazione, è un rinvio — e
reggere i test unitari di chi ci sta sopra. I test di durabilità restano su
`FsStorage`.

### Le sette operazioni, e le due che non sono un'ottava

`exists` e `remove_dir_all` hanno un **default composto dalle altre**:
`exists` è uno `stat` con la risposta buttata via, `remove_dir_all` è una
camminata che toglie. Chiederle come capacità in più vorrebbe dire farle
riscrivere a ogni supporto futuro — cioè moltiplicare, che è la famiglia di
difetti del [§7.1](0021-il-confine.md) e del §6.2. `FsStorage` le sovrascrive
perché il filesystem le sa fare in un colpo solo; chi arriva dopo può non farlo e
funziona lo stesso.

Nella stessa direzione, **la creazione delle cartelle mancanti è dentro `write` e
`rename`**, e non più a carico dei chiamanti: era ripetuta a cinque posti, e
ripeterla è il modo in cui un giorno la sesta scrittura se ne dimentica.

### Il recinto **non** si sposta qui

Un `VaultStorage` prende path assoluti e li usa. Chi decide che un plugin non
può nominare `../../etc/passwd` resta `Workspace::plugin_data_path`, dov'era: il
recinto è una regola sul **nome**, il supporto è il posto dove i byte finiscono.
Fonderli avrebbe legato il supporto allo schema di nomi dei plugin, e lo stesso
supporto deve servire i documenti del vault, che ne hanno un altro.

### Gli errori sono `io::Error`, non `KernelError`

Un supporto non conosce il vault: non sa se il path che gli hanno passato è un
documento, un blob di un plugin o un sidecar, e un errore che nominasse la cosa
sbagliata sarebbe peggio di uno generico. A dare un nome al guasto resta chi
chiama, che quel contesto ce l'ha — `KernelError::Io { path, source }` — e lo
faceva già.

## La cosa che la voce non prevedeva, e che la scrittura ha trovato

**`file_type()` e `metadata()` non danno la stessa risposta, e la differenza è un
comportamento.** Su una voce di directory, `file_type()` **non** segue il
symlink; `metadata()` sì. La scansione del vault usava la prima — e per questo un
symlink non partecipava: non era né file né cartella, e i due rami lo saltavano —
mentre `walk_trash` e `collect_data_files` usavano la seconda.

Scrivendo un trait, il modo più naturale di dire «specie» era una sola chiamata,
e la scelta comoda era `metadata()`: una syscall invece di due, e i metadati che
servono già in mano. Sarebbe stato un **cambiamento di comportamento senza una
riga di diff che lo dicesse** — la scansione avrebbe cominciato a seguire i
symlink, e con un anello di symlink non torna. È la cosa contro cui la seduta 15
mette in guardia da un'altra angolazione: un'astrazione che uniforma tre
chiamanti sceglie per tutti e tre, e chi la scrive vede l'uniformità, non la
scelta.

La risposta è una terza variante:

```rust
pub enum EntryKind { File, Dir, Other }
```

La specie di una **voce di elenco** non segue il link — un symlink arriva come
`Other`, e chi cammina lo salta, che è ciò che il vault faceva già. La specie di
uno **`stat`** — che si chiede su un *path* e non su una *voce* — lo segue, come
ha sempre fatto. Le due asimmetrie del filesystem restano due, con un nome
ciascuna invece di essere il terzo ramo implicito di un `if`.

E il nome è la parte che vale: `EntryKind::Other` è il posto dove il
[§15.6](../roadmap/15-il-disco.md#156-la-politica-di-esclusione-è-una-costante-di-compilazione)
potrà decidere altrimenti. I symlink gli sono stati consegnati dalla
[0058](0058-un-nome-che-nasce.md) con l'avvertenza che «un `IgnorePolicy` che non
li nomina lascerà il comportamento a `std::fs`, che li segue senza chiedere»:
adesso quel comportamento ha un nome, quindi la voce trova qualcosa da nominare
invece di dover ricostruire dove guardare.

## I presidi

`crates/fub-kernel/tests/il_supporto.rs`, tre test che presidiano tre cose
diverse:

- **`le_due_implementazioni_rispondono_uguale`** gira lo stesso giro sui due
  supporti. È il presidio del *trait*: finché `FsStorage` è l'unico cliente, il
  contratto che un supporto deve rispettare non sta scritto da nessuna parte se
  non nelle abitudini di `std::fs`, e il giorno in cui arriva quello che cifra
  non c'è niente contro cui provarlo. Sta qui, ed è eseguibile.
- **`un_vault_intero_su_un_supporto_che_non_e_il_disco`** costruisce un `Vault`
  su `MemStorage` e ci fa il giro intero: scrittura, scansione, rinomina,
  cestino, sidecar, svuotamento. Presidia l'altra metà, che il primo non tocca:
  che il vault ci passi **davvero** sopra. Un `std::fs::write` rimasto dentro un
  metodo del vault non fa fallire nessun test di conformità del trait; fa fallire
  questo, perché lì sotto il disco non c'è.
- **`un_collegamento_non_e_la_cosa_a_cui_punta`** presidia la sola riga di
  comportamento che questa voce avrebbe cambiato in silenzio.

Nessun presidio esistente è stato toccato, e non è un caso: la voce non cambia
cosa il kernel fa, cambia da dove lo fa. Un turno che avesse dovuto modificare
`fedelta_del_testo.rs` o `anagrafe.rs` per far passare questo lavoro starebbe
dicendo il contrario.

## Cosa resta scoperto

**Una casella residua, e aspetta il §15.2.** Dentro `.fub/` scrivono ancora con
`std::fs` tre proprietari del kernel — `organization.rs` (`workspace.json`),
`settings.rs` (`settings.json` del vault) ed `entries.rs` (`entries.json`) — e
tutti e tre passano da `write_atomic`, cioè **hanno già** la proprietà che il
`VaultStorage::write` di oggi non promette. Portarli sopra il trait adesso
vorrebbe dire togliergliela: è lavoro che non decide niente, ma il criterio con
cui farlo lo dà il §15.2, e prima di quello sarebbe un peggioramento travestito
da uniformità. Vale la pena tenerlo come precedente al contrario della
[0062](0062-il-log-e-il-pavimento-l-evento-e-la-porta.md): là una casella si è
chiusa perché la decisione di un'altra voce la risolveva, qui una casella si apre
sapendo **quale** voce la risolverà.

**Un buco dichiarato, che non è una casella.** `Workspace::plugin_data_dir`
consegna a un provider nativo una **vera cartella del filesystem**, e lo fa per
una ragione che non si può togliere: tantivy mmappa i suoi segmenti e li rilegge
quando gli pare, anche dai thread di merge. Quel varco è documentato dalla
[0021](0021-il-confine.md) ed è dentro lo stesso recinto di tutto il resto — ma
su un supporto che cifra, **è il punto in cui la cifratura si ferma**. Non è
lavoro rimandato: è un fatto sulla forma dei provider nativi, e la sua risposta
vera è M5, dove l'equivalente per un componente è un preopen WASI e il supporto
può stargli sotto davvero. Sta scritto qui perché chi implementerà il supporto
che cifra deve trovarlo prima di scoprirlo.

**Il §15.2 e il §15.7 restano aperti**, e questa voce non li tocca: la
durabilità alla scrittura e la stessa domanda vista all'apertura.
