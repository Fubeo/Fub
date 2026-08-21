# 0077 — Una scorciatoia è una chiave di impostazione, e un comando di shell è un comando

|  |  |
|---|---|
| **Decisa** | 2026-08-03 |
| **Origine** | `todo.md` §18.2 ([seduta 18](../roadmap/18-editor-e-tastiera.md)) — chiude **tre caselle su quattro**: registro unico nel frontend, palette fuzzy, conflitti segnalati, e le scorciatoie riconfigurabili senza gli **accordi in sequenza**, che restano |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[la seduta](../roadmap/18-editor-e-tastiera.md) ·
[il registro dei comandi, 0009](0009-registro-dei-comandi.md) ·
[le impostazioni, 0036](0036-le-impostazioni-e-i-tre-stati.md) ·
[un posto solo, 0076](0076-le-impostazioni-vivono-nel-vault.md)

---

La voce chiedeva quattro cose: un registro dei comandi nel frontend alimentato
da `list_commands`, una palette con filtro fuzzy, le scorciatoie configurabili
(con accordi in sequenza) e i conflitti segnalati. Tre erano lavoro; la quarta —
*dove vive una scorciatoia riconfigurata* — era la decisione, e ha tirato con sé
la scoperta che rende il resto semplice.

## Una scorciatoia è una chiave di impostazione, fabbricata dal kernel

Le tre forme possibili, in ordine di quanto sembravano ragionevoli.

**Una lista di stringhe** (`"note.create=Mod-Alt-k"`) è quella che viene per
prima, e questo repo l'ha **già rifiutata** una volta: sta scritto accanto a
`LOG_VERBOSE`, che è una lista di id e non una mappa `id=livello` proprio per
questo. È un formato dentro un formato — nessuno può controllarne la forma, il
pannello non sa disegnarla, e chi sbaglia un `=` scopre che non funziona senza
sapere dove.

**Un `SettingKind::Map` nel contratto** è la forma pulita, e sarebbe stata la
scelta in qualunque altro momento. È **firma**, a ridosso del freeze di M4: la
pagherebbero l'host, la shell, il WIT e il pannello che disegna i campi, e la
pagherebbero per un caso che si può servire senza. Una specie nuova nel
contratto si aggiunge quando serve a esprimere qualcosa che oggi è
inesprimibile; qui non lo è.

**Una chiave per comando, `keys.<id>`, di specie `Text`**, che il kernel
fabbrica da sé quando un `CommandProvider` si registra. Nessun tipo nuovo, e tre
proprietà che nessuna delle altre due aveva:

- **La chiave esiste finché esiste il comando.** La fabbrica
  `register_command_provider`, la ritira `withdraw` insieme a tutte le altre del
  componente: plugin spento, niente chiave — e il valore scritto resta, perché
  spegnere non è riconfigurare.
- **Il pannello esce gratis.** Sono caselle di testo dichiarate come tutte le
  altre: il campo, il «vale per questo vault», l'«azzera» che compare solo dove
  c'è qualcosa da azzerare. Nessuno li ha scritti due volte.
- **Nascono nel vault senza dire niente**, perché la
  [0076](0076-le-impostazioni-vivono-nel-vault.md) è arrivata prima. Le
  scorciatoie viaggiano col vault come il tema e la lingua, che è ciò che
  chiunque si aspetti da un file di configurazione copiabile.

Il default della chiave è **il suggerimento dichiarato dalla `CommandSpec`**, e
questa è la riga che fa sparire un problema invece di risolverlo: il valore
*efficace* della chiave **è** la scorciatoia, sempre. Non c'è nessuna regola di
fusione fra «quella dichiarata» e «quella scelta» da scrivere e da tenere
d'accordo in due punti, e `SettingSource` dice da sé se a decidere è stato
l'utente.

Una cosa sulla **composizione del nome**, che sembra un dettaglio e non lo è: il
prefisso va *dentro* il namespace, non davanti. `com.acme:keys.tasks.add`, non
`keys.com.acme:tasks.add` — il secondo è un id nudo dichiarato da un plugin, che
la regola dei nomi del §7.4 rifiuta. La composizione sta in una funzione sola
per parte (`fub_abi::settings::keybinding_key` e il suo gemello in TypeScript),
e le due si provano sugli stessi casi.

## Un comando di shell è un comando, e la palette non deve saperlo

L'altra metà della voce erano i comandi **della shell** — passare a Lettura,
mostrare il pannello dei file, aprire il grafo, aprire un vault, aprire la
palette. Non essendo comandi del kernel non erano comandi affatto: erano
bottoni, e chi non li trovava col mouse non li trovava.

La strada che si offriva era registrarli nel kernel. Non regge: un
`CommandProvider` gira dentro l'host, e «mostra il pannello dei file» è un gesto
che vive nella webview. Registrarlo di là vorrebbe dire un comando che il kernel
elenca e non sa invocare — una bugia dentro il registro, che è la cosa che il
registro esiste per non avere.

Quindi la forma è la stessa — id, titolo, descrizione, accordo — e ciò che
cambia è **chi esegue**: `run()` di qua, `invoke_command` di là.
`ui/commands.ts` è il posto in cui la differenza smette di riguardare chiunque
altro: la palette disegna un elenco, la tastiera cerca un accordo, e nessuna
delle due chiede da che parte del confine venga la riga che ha in mano. Ogni
pannello dichiara i propri al montaggio, che è la regola con cui il monolite è
stato smontato — chi ha interesse dichiara, e nessuno tiene la lista di tutti.

Una conseguenza si vede subito: `Mod-Shift-p` non è più cablato dentro il
`keydown`. La palette è un comando come gli altri, quindi compare nella palette,
e la sua scorciatoia si legge dove si leggono tutte le altre. Era l'unica
combinazione che non stava scritta da nessuna parte.

## I conflitti si dicono, non si vietano

È l'unica cosa che senza pensarci non veniva gratis. Due comandi sullo stesso
accordo non sono un errore da rifiutare: chi rimappa ha il diritto di sbagliare,
e soprattutto **scambiare due scorciatoie fra loro passerebbe per uno stato
illegale** se la scrittura si rifiutasse. Ma è una cosa che nessuno scoprirebbe
da sé — si preme, parte l'altro comando, e non c'è niente da guardare.

Quindi: all'apertura del vault si guarda l'unione dei due registri e si avvisa
una volta, **nominando i comandi**, perché «hai un conflitto» manda a cercare
quale. Il confronto è sull'accordo normalizzato — modificatori ordinati e
minuscoli — o `Shift-Mod-g` e `Mod-Shift-g` sarebbero due accordi diversi per il
codice e lo stesso gesto per le dita: cioè proprio il conflitto che non si
vedrebbe.

E quando un conflitto c'è, a vincere è il **primo** dell'elenco, non nessuno:
chi preme quei tasti vuole che succeda qualcosa, e succedere in modo prevedibile
è meglio che non succedere.

## Il fuzzy, e perché il rango di prima non si butta

Il filtro era per prefisso e sottostringa. Adesso è a **sottosequenza**: `nn`
trova «Nuova nota», `csd` trova «Cerca e sostituisci nel documento».

La tentazione era sostituire il rango con il punteggio fuzzy. Non si fa: un
punteggio fuzzy da solo mette una corrispondenza sparsa nel titolo davanti a una
esatta nella descrizione, cioè peggiora il caso comune per far funzionare quello
raro. Il rango è diventato lo **scaglione** — prima chi comincia con la query,
poi chi la contiene, poi l'id, poi la prosa, e infine le sottosequenze — e il
punteggio fuzzy è lo spareggio dentro ciascuno: a parità di scaglione vince chi
ha i caratteri più vicini.

## Cosa resta scoperto, e si dice

**Gli accordi in sequenza** (`g` poi `d`). Non sono un pezzo mancante di questo
lavoro: sono un secondo problema. Una sequenza ha uno stato — «sto aspettando il
secondo tasto» — con un timeout, un modo di annullarla, e la domanda di cosa
succede se il primo tasto è anche una scorciatoia da solo. Niente di tutto
questo si esprime nella sintassi che la `CommandSpec` dichiara oggi, e mezzo
implementarlo vorrebbe dire una sintassi che accetta `g d` e non lo onora. La
casella resta, nominata.

**La scorciatoia di un comando di shell non è ancora riconfigurabile.** La
chiave la fabbrica il kernel registrando un provider, e un comando che vive
nella webview un provider non ce l'ha. Il pannello le mostra comunque, di sola
lettura, perché sapere quali tasti sono già presi è metà del lavoro di
rimapparne uno. La via d'uscita vera non è un secondo meccanismo di qua: è la
shell che diventa un componente come gli altri, che è la domanda della §16.3 — e
finché quella non ha risposta, un registro di scorciatoie parallelo nel frontend
sarebbe il secondo posto in cui la stessa cosa vive.
