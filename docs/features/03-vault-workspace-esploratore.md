# 3. Vault, workspace, file explorer e organizzazione base

*Microfeature essenziali: [vault-ed-esploratore.md](../microfeatures/vault-ed-esploratore.md) e [editor-di-testo.md](../microfeatures/editor-di-testo.md).*

## 3.1 Vault

**Cosa fa parte di un vault lo dichiara il vault, con due eccezioni che nessuno
può dichiarare.** Fino alla
[decisione 0110](../decisions/0110-la-struttura-non-e-una-preferenza.md)
l'esclusione era una costante nel sorgente; adesso sono due chiavi di questo
vault — le **cartelle escluse** (`files.excluded-folders`, con `.obsidian`,
`.git` e `node_modules` per default) e i **file nascosti visibili su richiesta**
(`files.show-hidden`) — perché entrambe descrivono *questi file* e viaggiano con
loro. Il confronto fra il nome dichiarato e il nome che sta sul disco ignora le
maiuscole e la composizione Unicode, perché la dichiarazione viaggia col vault e
`Node_Modules` su macOS è la cartella che `node_modules` nomina. Restano fuori
comunque, e non sono una preferenza: la cartella di Fub
(`.fub/`), il cestino (`.trash/`) e i temporanei di una scrittura — mostrarli
vorrebbe dire indicizzare l'indice e riesumare come documenti le note appena
cestinate. Le tre caselle di questa sezione stanno quindi così: *ignore
file/cartelle* è piena, *visualizzazione file nascosti opzionale* è piena, e il
supporto a `.gitignore` è **vuoto e indirizzato** — un file come sorgente di
politica ha una sintassi propria (pattern, non nomi), una precedenza propria e
un proprietario che non è Fub, e il posto dove atterrare adesso c'è.

- [ ] Creazione nuovo vault
- [ ] Apertura vault esistente
- [ ] Vault multipli simultanei
- [ ] Switch rapido tra vault
- [ ] Vault recenti
- [ ] Vault preferiti
- [ ] Icona vault personalizzata
- [ ] Colore vault personalizzato
- [ ] Impostazioni separate per vault
- [ ] Vault read-only
- [ ] Vault archiviati
- [ ] Vault portabili su USB
- [ ] Vault sincronizzabili con tool esterni
- [ ] Vault cifrabili localmente
- [ ] Ignore file/cartelle
- [ ] Supporto `.gitignore` o equivalente
- [ ] Visualizzazione file nascosti opzionale
- [ ] Vault template
- [ ] Creazione vault da template
- [ ] Vault health dashboard
- [ ] Vault size diagnostics
- [ ] Vault repair wizard
- [ ] Apri la cartella del vault nel file manager di sistema
- [ ] Copia percorso del vault negli appunti
- [ ] Importa file/cartelle esterne nel vault

## 3.2 File explorer

- [ ] Esplora file ad albero
- [ ] Cartelle annidate illimitate
- [ ] Creazione nota
- [ ] Creazione cartella
- [ ] Creazione file non-Markdown
- [ ] Rinomina file
- [ ] Duplica nota
- [ ] Duplica cartella
- [ ] Copia/taglia/incolla di note e cartelle
- [ ] Selezione multipla di file e cartelle
- [ ] Operazioni in blocco su file selezionati
- [ ] Spostamento drag & drop
- [ ] Aggiornamento link su rinomina
- [ ] Aggiornamento link su spostamento
- [ ] Cestino interno
- [ ] Ripristino dal cestino
- [ ] Eliminazione permanente
- [ ] Secure delete
- [ ] Preferiti
- [ ] File fissati
- [ ] Ordinamento personalizzato
- [ ] Ordinamento manuale
- [ ] Ordinamento per nome, data, tipo e dimensione
- [ ] Mostra la data di modifica di ogni file
- [ ] Filtri file
- [ ] Ricerca nella sidebar file
- [ ] Aggiornamento manuale dell'elenco (refresh)
- [ ] Visualizzazione allegati
- [ ] Anteprima file
- [ ] Gestione file orfani
- [ ] Rilevamento duplicati
- [ ] Gestione nomi case-sensitive
- [ ] Unicode completo
- [ ] Percorsi relativi
- [ ] Link assoluti interni opzionali
- [ ] File lock opzionale
- [ ] Rilevamento modifiche concorrenti
- [ ] Merge manuale conflitti
- [ ] Cronologia modifiche file

## 3.3 Workspace e layout

- [ ] Sidebar sinistra
- [ ] Sidebar destra
- [ ] Sidebar collassabili
- [ ] Sidebar auto-hide
- [ ] Topbar opzionale
- [ ] Status bar
- [ ] Breadcrumb
- [ ] Tab bar
- [ ] Tab groups
- [ ] Schede fissate
- [ ] Schede raggruppate
- [ ] Editor pop-out
- [ ] Finestre multiple
- [ ] Layout personalizzabili
- [ ] Workspace salvabili
- [ ] Switch workspace rapido
- [ ] Restore layout all’avvio
- [ ] Workspace per progetto
- [ ] Workspace per vault
- [ ] Workspace sync opzionale
- [ ] Drag & drop pannelli
- [ ] Pannelli flottanti
- [ ] Mini map
- [ ] Sticky scroll
- [ ] Empty states curati
- [ ] Sample vault
- [ ] Interactive tutorial
- [ ] Tooltips contestuali
- [ ] Undo toast
- [ ] Redo toast
- [ ] Context menus completi
- [ ] Quick actions
- [ ] Background task manager
- [ ] Lingua dell'interfaccia selezionabile (i18n)
- [ ] Ripristino sessione all'avvio (ultime note aperte)
- [ ] Indicatore di modifica non salvata sulla scheda
- [ ] Storico delle note aperte di recente
