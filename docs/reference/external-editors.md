# App esterne

> **Ambito:** le app Craft che Fub conosce, i file che aprono e come Fub le
> avvia.
> **Fonti autorevoli:** `crates/fub-format-craft/src/apps.rs`,
> `crates/fub-host/src/craft/open_with.rs`.

I file Craft si modificano nelle loro app: VectorCraft, PhotoCraft,
FigCraft e LightCraft, più PdfCraft, GridCraft e WordCraft per gli altri
formati che aprono. Questa pagina dice quali app Fub conosce, quali file
apre ciascuna, come Fub trova il programma e lo avvia, e quale riga di
comando fa l'anteprima che un file non porta. Le famiglie di file che Fub
legge da sé sono in [Formati dei file Craft](craft-formats.md).

## Avvio

Fub avvia un programma in due modi soli, scritti una volta in
`crates/fub-host/src/craft/launch.rs`:

- **Un'app che vive da sola** (`spawn_detached`, per «Apri con»). Stdin,
  stdout e stderr sono chiusi e l'app ha un gruppo di processi suo; su
  Windows parte staccata dalla console e dal gruppo di Fub. Un thread
  `fub-craft-wait` ne aspetta l'uscita, perché non resti un processo zombie,
  e la segna in un registro di processo (`on_exit`, `running`): «avviata da
  Fub e non ancora uscita» si legge da lì.
- **Una riga di comando che si aspetta** (`run_cli`, per le anteprime fatte
  dalle app). stdout e stderr si leggono da due thread, che tengono i primi
  byte fino al tetto e scartano il resto continuando a leggere: un processo
  che scrive molto non si blocca su un tubo pieno. Ogni ~100 ms Fub guarda
  il tempo e l'annullamento del job; a tempo scaduto o annullato ferma il
  processo insieme ai processi che ha avviato e aspetta che esca. Su unix la
  CLI ha un gruppo di processi suo e Fub manda `SIGKILL` all'intero gruppo.
  Su Windows la CLI nasce sospesa, entra in un job object con
  `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` e solo allora parte: ogni processo
  che avvia nasce nel job, e chiudere il job li ferma tutti. Se il job non si
  crea, o la CLI non ci entra, la CLI non parte e l'errore è quello del
  sistema. Anche dopo un'uscita normale il gruppo, o il job, si ferma: della
  CLI non resta niente. Un codice d'uscita diverso da zero è un
  errore col suo codice; un job annullato prima di partire non avvia niente.

| Limite di una CLI | Valore |
|---|---|
| Tempo | 20 s |
| stdout e stderr tenuti | 64 KiB ciascuno |
| Sguardo al tempo e all'annullamento | ogni ~100 ms |

**Niente shell.** Il programma è un percorso assoluto, mai cercato nel
`PATH` né nella cartella corrente, e riceve gli argomenti separati, senza
`sh -c` né `cmd /c`: un nome di file con spazi, virgolette, `;` o `$(…)`
arriva intatto e non diventa mai un comando. La cartella di lavoro è la home
(o la cartella temporanea, senza una home), mai il vault. L'ambiente è
quello di Fub così com'è, meno le variabili che cominciano con `FUB_`: un'app
non trova un token di Fub.

Gli errori non hanno testo: il programma che manca, quello che non si può
eseguire, il tempo scaduto, l'annullamento, un codice d'uscita e un errore
del sistema. Il testo lo mettono «Apri con» e le anteprime con le chiavi del
loro catalogo.

**Chiudendo Fub** un'app avviata con «Apri con» resta aperta: non è nel
gruppo di Fub e nessuno la ferma. Una CLI vive dentro il job che la
aspetta: annullare il job ferma il gruppo. Se Fub esce di colpo mentre il
job aspetta, su Linux la CLI muore con il thread che l'ha avviata
(`PR_SET_PDEATHSIG`) e su Windows con il job object, che il sistema chiude
insieme agli handle di Fub; su macOS nessuno la ferma più e la CLI, che ha un
gruppo suo, arriva in fondo da sola.

## Apri con

«Apri con» chiede due cose all'host, le stesse per il menu della shell, per
l'MCP e per il prestito di un documento (`crates/fub-host/src/open_with.rs`):
quali app aprono un file (`Host::external_editors`) e aprirlo con una
(`Host::open_with`). Col componente `fub.craft` spento, o senza la feature
`craft`, nessuna app apre niente. Senza un documento la lista ha tutte e sette
le app, perché la shell sappia se ce n'è almeno una installata.

Un file arriva all'app in uno di tre modi, provati in quest'ordine
(`crates/fub-host/src/craft/open_with.rs`):

1. **Già aperta** (`in_running`): l'app l'ha avviata Fub, non è uscita e ha un
   canale col token che Fub le ha dato; il file passa dal canale. Se il
   canale non risponde si passa al modo dopo.
2. **Passato alla finestra** (`forwarded`): l'app tiene una finestra sola su
   questo sistema (PhotoCraft e PdfCraft su Linux e Windows); Fub la avvia
   col file e lei lo passa alla finestra che ha già, se c'è.
3. **Processo nuovo** (`new_process`): ogni altra app parte col file.

«Già aperta» vuol dire «avviata da Fub e non ancora uscita»: Fub tiene un
registro delle app che ha avviato, una voce per app col processo dell'ultimo
avvio, che cade quando quel processo esce. Un'app aperta dal sistema o dalla
persona Fub non la vede.

Fub non parla con un canale senza token: un canale senza autenticazione lo
può usare qualunque programma della macchina, e la «chiave» di WordCraft ha
un formato che nessuno ha documentato. Nessuna delle sette app ha ancora un
canale con un token e una porta nota, quindi il primo modo non scatta mai
con loro.

Il programma riceve il percorso canonico e assoluto del file, come un
argomento solo: un nome che comincia con `-` non diventa un'opzione, uno con
gli spazi resta intero, e un vault su un disco montato altrove arriva col
percorso vero. Un Flatpak parte con `flatpak run ai.storyteller.<id> <file>`
(`flatpak` in `/usr/bin` o `/bin`), un pacchetto di macOS con `open -a`.
PdfCraft riceve la pagina, `--page N`, prima del file (su macOS dopo
`--args`); le altre app ignorano la pagina.

Ogni rifiuto ha la sua chiave nel catalogo del core:

| Chiave | Quando |
|---|---|
| `host.open_with.off` | il componente `fub.craft` è spento |
| `host.open_with.unknown_editor` | l'app non è fra le sette |
| `host.open_with.wrong_kind` | l'app non apre quell'estensione |
| `host.open_with.not_installed` | l'app non si trova su questo computer |
| `host.reveal.outside` | il percorso esce dal vault |
| `host.open_with.missing` | il file non c'è più, il percorso è vuoto o porta a una cartella |
| `host.open_with.launch_failed` | il programma non è partito |

Gli errori dicono il nome dell'app, mai il percorso del programma.
