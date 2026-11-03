# App esterne

> **Ambito:** le app Craft che Fub conosce, i file che aprono e come Fub le
> avvia.
> **Fonti autorevoli:** `crates/fub-format-craft/src/apps.rs`.

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
  processo con `SIGKILL` sull'intero gruppo (su unix, così anche i figli del
  figlio) e aspetta che esca. Anche dopo un'uscita normale il gruppo si
  ferma: della CLI non resta niente. Un codice d'uscita diverso da zero è un
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
aspetta: annullare il job ferma il gruppo. Se Fub esce mentre il job aspetta,
nessuno la ferma più e la CLI, che ha un gruppo suo, arriva in fondo da sola.
Su Windows il tempo e l'annullamento fermano solo il processo della CLI, non
i processi che ha avviato lei.
