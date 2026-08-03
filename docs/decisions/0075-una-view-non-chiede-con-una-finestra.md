# 0075 — Una view non chiede con una finestra, e chi scrive le versioni è chi le disegna

|  |  |
|---|---|
| **Decisa** | 2026-08-03 |
| **Origine** | `todo.md` §1.2 ([seduta 18](../roadmap/18-editor-e-tastiera.md)) — chiude la casella *migrare cestino e cronologia a `ViewProvider`*; resta il modello di layout. Chiude anche **tre delle cinque** righe residue del [§16.6](../roadmap/16-crate-sdk-banchi-di-prova.md#166-dieta-dellipc) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/18-editor-e-tastiera.md) · [cosa è una view, 0016](0016-cosa-e-una-view.md) · [lo stato di vista, 0037](0037-lo-stato-di-vista.md) · [la dieta dell'IPC, 0057](0057-la-dieta-dell-ipc.md)

---

Il §1.2 teneva questa casella aperta con una ragione precisa: cestino e
cronologia erano il **dogfooding che mancava**, perché sono gli unici due
pannelli in cui una view non guarda soltanto — chiede conferma, riceve testo
digitato, e scrive nel vault. La [0016](0016-cosa-e-una-view.md) aveva tolto il
blocco (nodi di input, `Pending`, riconciliatore per chiave) e da allora restava
solo da farlo.

Farlo ha trovato due cose che nessuno aveva previsto, e sono queste due la
decisione. Il resto è esecuzione.

## Una view non chiede con una finestra: chiede con l'albero che sta disegnando

Il cestino aveva due domande da fare, ed erano il motivo per cui sembrava il caso
difficile: *«svuoto davvero?»* e *«il path d'origine è di nuovo occupato: con che
nome la ripristino?»*. Il pannello nativo le faceva con la modale della shell,
che è una capacità che un provider **non ha**.

La strada che si offriva da sé era aggiungerla al contratto: un
`ViewUpdate::Confirm { message, ok, cancel }`, e la shell disegna la finestra. È
stata scartata, e la ragione non è il costo di una variante. Sarebbe stato un
**secondo modo di disegnare**: una finestra descritta a parole, fuori
dall'albero, con un suo vocabolario di bottoni ed etichette che nessun `UiNode`
può comporre — quindi un posto in cui, la prima volta che a qualcuno serve una
casella di spunta dentro una conferma, il protocollo si biforca.

**La domanda si disegna.** `on_action` scrive la domanda in corso nello stato di
vista (`ask`) e risponde `Replace` con un albero in cui la domanda sta sopra
l'elenco, con i suoi due bottoni; rispondere la cancella. Il nome libero è un
`Form` con dentro un `TextInput` già riempito con la proposta di
`VaultRead::free_name`, che è la differenza fra proporre e decidere — la modale
di prima chiedeva *«la ripristino come "Uno 1"?»* e l'unica risposta possibile
era sì o no.

Che quello stato stia nello **stato di vista** e non in un campo del provider è
la stessa lezione del pannello tag ([0037](0037-lo-stato-di-vista.md)), e qui è
più netta: un campo sarebbe uno per provider, quindi due cestini aperti
condividerebbero la conferma di svuotamento — cioè il gesto irreversibile
verrebbe confermato da una finestra e applicato all'altra.

Ne segue una proprietà che la modale non aveva: la domanda **è nel pannello**,
accanto alle cose di cui parla, e chi la lascia aperta non blocca il resto
dell'app.

## Chi scrive le versioni è chi le disegna

La cronologia sembrava la più dura per la ragione sbagliata: si credeva le
mancasse un canale. Non le mancava niente. Il pannello nativo leggeva le versioni
da tre comandi Tauri, che le chiedevano allo store che vive nell'host; la strada
apparente era portare quelle letture su `IndexQuery` — è quello che la §16.6
aveva scritto, per iscritto e con la sua classificazione.

**La cronologia è una view della feature `fub.versioning`**, cioè dello stesso
plugin che le versioni le scrive. Quindi le rilegge dal **proprio spazio dati**
con `data_read`, che è una capacità che ha già, e non serve nessuna rotta nuova
nel contratto: un `IndexQuery::Versions` scritto a suo tempo sarebbe oggi una
rotta pubblica che nessuno percorre. Il banco lo prova nel modo più diretto
possibile — registra l'handler con lo store e alla view **non lo dà**, e il
pannello elenca lo stesso.

Il costo è che la view non condivide l'esemplare in memoria dello store e
rilegge `versions.json` a ogni disegno. È la scelta giusta due volte: l'indice è
un file piccolo che sta nella cache del sistema, e un pannello che rilegge dice
la verità anche quando a scrivere è stata un'altra finestra.

Ripristinare, invece, **non** è una scrittura della view: è `version.restore`, un
comando del registro dichiarato dalla stessa feature. Una view che riscrivesse il
documento da sé avrebbe un'operazione fuori dal registro — quindi fuori
dall'annullamento, fuori dalla simulazione e invisibile alla palette. Migrandolo
col pannello, la palette lo eredita gratis.

### E lo spegnimento diventa una registrazione che non avviene

La shell teneva il pannello nascosto con un `hidden` guidato da
`VaultInfo.versioning`: il pannello c'era comunque, e a tenerlo vuoto era una
riga di TypeScript. Adesso la view la registra la feature, dentro l'interruttore:
versioning spento significa nessuna `ViewSpec` da montare e nessun
`version.restore` nella palette. È la spegnibilità totale (D7) ottenuta
**togliendo** codice invece di aggiungerne.

## Ciò che il §16.6 aveva classificato bene e capito a metà

Le tre righe del versioning erano scritte così: due letture → `IndexQuery`, un
comando → il registro. Il comando è finito dove doveva. Le due letture **non
sono migrate da nessuna parte: sono sparite**, perché chi le faceva era di qua
dal confine e adesso è di là. Con loro se ne sono andati anche `list_trash` e
`propose_free_name`, che nell'allowlist erano due righe legittime — due capacità
del contratto affacciate alla shell — e che hanno semplicemente perso il
chiamante.

Cioè: davanti a un comando bespoke la prima domanda non è *su che canale lo
sposto*, è **chi lo chiama, e da che parte del confine dovrebbe stare**. Il
debito dichiarato passa da cinque a due (`render_preview` e `render_embed`), e
il numero lo asserisce il test come prima.

## Il presidio che ha fermato la prima stesura, e aveva ragione a metà

La prima versione del cestino importava `TRASH_RESTORE` e `TRASH_EMPTY` da
`crate::commands`. Rosso: `i_moduli_non_si_parlano` ([0073](0073-una-condizione-che-nessuno-valuta.md))
ha detto che la condizione della §16.3 si era sbloccata — il primo import fra due
moduli di feature.

Aveva ragione a fermarla, e la riparazione non è lo split. Quell'import era **la
forma sbagliata di dogfooding**: l'id di un comando è un nome del *registro*,
cioè del contratto, ed è ciò che scriverebbe un plugin di terzi — che i nostri
`const` non li ha e non li avrà mai. Le due stringhe si scrivono, e che restino i
comandi che esistono lo presidia un test che le cerca fra le `CommandSpec`
registrate. È lo stesso scambio del §16.6: un accoppiamento che diventa un
presidio invece di un import.

**La §16.3 resta dov'era.** Il suo compratore non è ancora arrivato.

## La corsa col buffer, e la riparazione che non è questa

Un'azione di view può finire in una scrittura del vault, e il buffer dell'editor
può avere un salvataggio in coda: la riscrittura del kernel finirebbe sotto una
copia più vecchia. Il pannello nativo lo evitava chiamando `flushPendingSave`
prima di ripristinare — di qua dal confine, dove il buffer è.

La shell adesso mette in salvo il buffer **prima di ogni azione di view**. Costa
zero quando il buffer è pulito, che è il caso di ogni battuta di tasto dentro un
filtro, e non chiede alla shell di indovinare quali azioni scrivono — cosa che
non può sapere.

Non è **la** riparazione, ed è bene dirlo: quella è la revisione nella firma di
`write_document`, che sta scritta nella
[§18.1](../roadmap/18-editor-e-tastiera.md#181-editor) e toglie la corsa invece
di ordinarla. Questa toglie l'unico caso in cui la corsa la perdeva sempre lo
stesso.

## Cosa resta aperto

- **Il modello di layout**, che è l'altra casella del §1.2 e non si è mossa: tab,
  split, pane, workspace salvabili. È ciò che tiene ferma la §3.3 (il grafo
  nell'area principale).
- **Le due porte del render** (`render_preview`, `render_embed`): restano il
  debito del §16.6, e la domanda di firma che aprono — portare HTML reso su un
  canale che anche un plugin di comunità può chiamare — va decisa lì.
- **La revisione nella firma di `write_document`** (§18.1), di cui questa
  decisione ha aggiunto un cliente in più invece di uno in meno.
