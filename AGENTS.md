# Istruzioni per gli agenti

Questo file definisce **come lavorare in Fub**. Non sostituisce la documentazione
canonica: serve a scegliere le fonti giuste, modificare il livello corretto e
produrre una prova sufficiente senza sprecare contesto.

## Ordine di successo

Ottimizza nell'ordine seguente:

1. correttezza osservabile e assenza di perdita dati;
2. rispetto di architettura, sicurezza, compatibilità e ownership;
3. verifica proporzionata al rischio e al blast radius;
4. modifica minima, coerente e manutenibile;
5. documentazione corrente e allineata;
6. efficienza di tempo, tool call e contesto.

Il risparmio di token **non giustifica mai** una diagnosi incompleta, un test
necessario saltato o una modifica architetturale non verificata.

## Prima di modificare

1. Controlla branch, working tree e modifiche già presenti. Non scartare, non
   riscrivere e non incorporare lavoro non pertinente.
2. Leggi [`CONTRIBUTING.md`](CONTRIBUTING.md) e la mappa in
   [`docs/README.md`](docs/README.md).
3. Identifica il comportamento richiesto, l'owner della regola e il test più
   basso che può dimostrarlo.
4. Leggi **solo** la pagina canonica dell'area e gli approfondimenti necessari.
   Per modifiche trasversali usa
   [`docs/architecture/components-and-boundaries.md`](docs/architecture/components-and-boundaries.md).
5. Se tocchi un contratto pubblico o persistente, leggi il riferimento
   pertinente in [`docs/reference/`](docs/reference/).
6. Leggi un ADR soltanto quando serve il perché di una scelta o quando valuti di
   cambiarla. Leggi roadmap e TODO soltanto se il task riguarda quel lavoro.
7. Verifica nel codice e nei test che la documentazione descriva ancora il
   presente prima di basare una modifica su di essa.

Prima di implementare, devi saper rispondere a queste domande:

- qual è il comportamento osservabile da ottenere o preservare?
- quale componente possiede la regola?
- esiste già una porta, un trait, un registro o un helper che esprime il caso?
- cambia ABI, WIT, IPC, schema su disco, sicurezza o lifecycle?
- quali consumatori e confini possono regredire?
- qual è la prova più economica che fallisce senza la modifica e passa con essa?

## Gerarchia delle fonti

Quando le fonti divergono, usa questo ordine:

1. codice e test eseguibili;
2. WIT, schemi persistenti e formati serializzati;
3. pagine di architettura e riferimenti canonici;
4. ADR, limitatamente alla motivazione delle decisioni;
5. stato, roadmap e TODO attivi;
6. cronologia Git.

Una roadmap, un TODO o un'API candidata **non è architettura corrente**. Non
promuovere in `fub-abi`, WIT o IPC una forma futura soltanto perché è descritta
in dettaglio. I contratti pubblici nascono quando casi reali, compatibilità,
limiti e fallback li hanno dimostrati.

Se scopri una divergenza fra presente eseguibile e documentazione canonica,
correggi la pagina pertinente quando rientra nello scope; altrimenti segnalala
esplicitamente nel risultato.

## Disciplina del contesto

Mantieni tutto ciò che può cambiare la conclusione, elimina il rumore.

- Parti da path, simboli, import, riferimenti, test o moduli probabili; non
  mappare l'intera repository senza una ragione concreta.
- Preferisci ricerche e letture mirate; allarga lo scope quando l'evidenza è
  insufficiente o la completezza lo richiede.
- Non produrre dump enormi di log, diff, file generati, dependency tree o
  risultati di ricerca quando una vista mirata conserva l'informazione utile.
- Non troncare distruttivamente diagnostica che potrebbe servire. Se un output è
  riassunto, troncato o conservato come artifact, recupera la parte omessa
  quando può cambiare diagnosi o verifica.
- Non ripetere letture, ricerche o comandi invariati per rassicurazione. Ripetili
  quando lo stato è cambiato, l'output era incompleto o serve una nuova prova.
- Interrompi l'esplorazione quando esiste evidenza sufficiente per una prossima
  azione concreta; riprendila appena emerge una nuova incertezza materiale.
- Se l'harness supporta subagent, delega indagini **indipendenti e sostanziali**
  con domande bounded. Richiedi conclusioni concise con path, simboli, prove e
  incertezze; non delegare lookup banali.

## Confini architetturali

Usa il componente che possiede la responsabilità; non risolvere un problema nel
livello più comodo.

- `fub-abi`: tipi, trait, errori, regole condivise, WIT e forme di contratto. Non
  contiene storage, Tauri, Wasmtime, Markdown o policy di un singolo consumer.
- `fub-kernel`: workspace, path, persistenza, indici, policy ed eventi. Non
  dipende da Tauri, Wasmtime o provider di formato.
- `fub-host`: composition root, sessioni, bundle, watcher, impostazioni e job.
  Non dipende da Tauri.
- `fub-app`: binario Tauri e adattatori IPC sottili; delega presto all'host e non
  duplica business logic.
- `fub-format-markdown`: semantica specifica Markdown.
- `fub-features`: feature ufficiali indipendenti; una feature spenta non rende
  obbligatoria un'altra feature.
- `fub-wasm-host`: unico crate che conosce Wasmtime.
- `fub-sdk`: API per autori e banco `MemoryHost`.
- `fub-testkit`: integrazione host/kernel; resta dipendenza di sviluppo.
- `apps/client/src/`: shell, editor, layout, focus, rendering e accessibilità.
  Soltanto `host/ipc.ts` e `host/dialog.ts` importano API Tauri.

Preferisci le porte generiche già presenti: `query_index` per i dati,
`list_commands`/`invoke_command` per le azioni e
`list_views`/`render_view`/`view_action` per le view. Una nuova feature non
merita una porta IPC dedicata se il registro esistente ne esprime la semantica.

## Regole per categoria di modifica

### Contratti, ABI, WIT e IPC

- Definisci una regola condivisa una volta, nel livello proprietario.
- Se una forma attraversa WASM, mantieni Rust e WIT coerenti e preserva
  l'additività rispetto a `wit/frozen/`.
- Se attraversa Tauri, aggiorna forma serializzata, mirror TypeScript, fixture,
  fake host e test di conformità pertinenti.
- Gli `u64` che rappresentano identità, revisioni o hash attraversano JSON come
  stringhe.
- Gli errori mantengono una variante/specie tipizzata; non sostituirla con
  `error.to_string()` o parsing di sottostringhe nella shell.
- Non aggiornare una baseline frozen per nascondere una rottura di
  compatibilità.

### Persistenza e dati dell'utente

Prima di cambiare un formato su disco stabilisci:

- chi è l'autorità;
- se il dato è autorevole o ricostruibile;
- versione dello schema e comportamento su versioni future;
- migrazione o ricostruzione;
- atomicità e comportamento in caso di interruzione;
- test per corruzione, conflitto e fallback quando pertinenti.

Non classificare una directory intera come cache dal nome. Non cancellare o
riscrivere dati sconosciuti per tentativi. Le scritture autorevoli devono
preservare il valore precedente quando falliscono.

### Lifecycle, concorrenza ed eventi

- Non mantenere un lock del workspace durante una chiamata a provider o altro
  codice esterno: estrai dati, rilascia, chiama, poi rientra per applicare un
  esito verificato.
- Gli eventi descrivono fatti già accaduti e restano accodati/non rientranti.
- Il lavoro potenzialmente lungo usa job con stato, cancellazione e risultato
  finale; non blocca il custode del workspace.
- Ogni listener, timer, observer, registrazione, watcher o istanza ha un owner e
  un disposer. Mount/unmount ripetuti non devono lasciare risorse vive.
- Le race devono rendere esplicita quale esecuzione è ancora valida; un risultato
  vecchio non deve sovrascrivere stato nuovo.

### Frontend ed editor

- La shell usa l'interfaccia in `apps/client/src/host/`, non `invoke` diretto dai
  pannelli.
- Il core possiede documenti, revisioni, policy, indici ed esiti; la shell
  possiede layout, focus, cursore, scroll, modalità, resa e preferenze locali.
- Una sessione documento e una superficie non sono la stessa cosa: il buffer e
  la coda di salvataggio sono condivisi per documento; cursore, scroll, focus e
  undo locale appartengono alla superficie.
- Le modifiche sincronizzate da un'altra superficie non diventano battute nella
  history locale.
- Preserva conversioni byte UTF-8 ↔ offset JavaScript e terminatori di riga.
- Non introdurre IPC o WASM per ogni battuta e non far attraversare il contratto
  a DOM, callback JavaScript o oggetti CodeMirror.

### Plugin e sicurezza

- Backend nativo e WASM devono osservare la stessa semantica del trait; il
  kernel non distingue il backend.
- La policy passa da un solo `Guard`; non duplicarla negli adattatori.
- Un componente WASM non ottiene WASI, filesystem, rete, DOM o webview per
  implicazione.
- Capability negate, timeout, memoria, trap, mount parziale e teardown sono casi
  di test, non dettagli opzionali.
- Un contratto estensibile richiede id stabili, ownership, limiti e fallback;
  evita una porta JSON universale non tipizzata.

## Strategia di implementazione

Preferisci cambi piccoli e dimostrabili, non big bang.

1. Caratterizza il comportamento corrente o riproduci il bug con il test più
   vicino possibile.
2. Applica la modifica minima nel componente proprietario.
3. Verifica subito la proprietà locale.
4. Aggiungi o aggiorna il test del confine reale quando il cambiamento lo
   attraversa.
5. Aggiorna la pagina canonica soltanto se cambia il comportamento presente, un
   contratto o un'invariante documentata.
6. Ispeziona il diff finale per modifiche accidentali, duplicazioni, API
   premature, file generati modificati a mano e teardown mancanti.

Non mescolare refactor, feature e cleanup non necessari. Se una correzione
richiede un refactor, mantienilo strettamente funzionale alla proprietà da
provare.

I file generati si modificano attraverso la sorgente e il generatore. Non
sostituire `npm` con un altro package manager e non rigenerare baseline visuali
canoniche fuori dall'ambiente previsto.

## Verifica progressiva

Durante l'iterazione usa il controllo più stretto che fornisce un segnale
significativo. Prima di concludere, allarga secondo blast radius, rischio e
[`CONTRIBUTING.md`](CONTRIBUTING.md).

Matrice minima:

- helper/regola locale → unit test vicino;
- provider → unit test e `fub-sdk::testing::MemoryHost`;
- kernel, storage, mount o sessione → test del crate e integrazione con
  `fub-testkit`;
- contratto Rust/WIT → conformità, additività frozen e proiezioni necessarie;
- IPC → fixture/mirror TypeScript, fake host e test shell;
- frontend → Vitest vicino al modulo, type-check e build;
- resa → banco visuale e accessibilità pertinenti;
- runtime WASM → componente reale, casi positivi e negativi di limiti/lifecycle;
- documentazione → tutti i guard documentali;
- modifica trasversale → ciclo completo pertinente Rust + frontend + guard
  richiesti da `CONTRIBUTING.md` e dalla CI.

Un test focalizzato verde non prova un confine che non esercita. Un test E2E non
sostituisce l'unit test della regola. Un guard strutturale non sostituisce il
comportamento.

Non dichiarare “tutto verde” se non hai eseguito i controlli sullo stato finale.
Se un controllo richiesto non può essere eseguito, indica esattamente quale e
perché.

## Documentazione e lavoro futuro

La documentazione canonica descrive il presente. Mantieni la tassonomia e lo
stile di [`docs/development/documentation-style.md`](docs/development/documentation-style.md).

- Un'attività eseguibile vive in una GitHub Issue.
- Un TODO in `docs/project/` è ammesso soltanto per un prossimo passo approvato,
  collegato a una issue e con regola di uscita.
- Un ADR conserva il perché di una scelta pubblica o costosa da invertire.
- Non creare archivi, verbali di implementazione o specifiche future permanenti
  nelle pagine canoniche.
- Le checklist di un TODO si aggiornano soltanto per comportamento realmente
  entrato in `main`.

## Sicurezza del worktree e Git

- Non usare `reset --hard`, `clean`, checkout distruttivi o altre operazioni che
  eliminano modifiche senza istruzione esplicita.
- Non sovrascrivere modifiche preesistenti non tue; distingui sempre il tuo diff
  dal lavoro già presente.
- Non cambiare branch o riscrivere la cronologia se il task non lo richiede.
- Se devi creare commit, usa il formato di `CONTRIBUTING.md`:
  `tipo(scope): frase in italiano`.
- Non includere file estranei soltanto per ottenere un working tree pulito.

## Gate di chiusura

Prima di considerare il task concluso, verifica:

- il comportamento richiesto è realmente implementato, non soltanto mascherato?
- la regola vive nell'owner corretto e riusa i contratti/registri esistenti?
- hai introdotto dipendenze vietate, duplicazioni o un ramo speciale evitabile?
- compatibilità, dati dell'utente, permessi, errori e teardown sono preservati?
- ogni informazione omessa, riassunta o delegata che potrebbe ribaltare la
  conclusione è stata recuperata?
- i test coprono la proprietà locale e i confini realmente toccati?
- il diff contiene solo modifiche necessarie e i file generati derivano dalla
  sorgente corretta?
- la documentazione descrive il presente e il lavoro residuo è tracciato nel
  posto giusto?

Nel resoconto finale indica in modo conciso: comportamento ottenuto, file/aree
principali toccate, verifiche eseguite, verifiche non eseguite e rischi residui
reali. Non presentare supposizioni come risultati verificati.
