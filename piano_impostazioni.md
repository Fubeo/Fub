# Piano: rappresentazione e visualizzazione delle impostazioni

Questo piano descrive come portare il pannello delle impostazioni della shell
desktop (`apps/client/src/panels/settings.ts`) da un elenco lungo e uniforme a
una finestra di preferenze leggibile, navigabile e accessibile. È un file di
lavoro alla radice, come gli altri `piano_*.md`: descrive un intervento, non
l'architettura corrente.

- **Data:** 30 settembre 2026, branch `feat/workspace-revisione` (HEAD
  `94349061`).
- **Owner:** la shell. Lo schema resta di chi dichiara le impostazioni
  (`SettingSpec` in `fub-abi`), i valori e la provenienza restano del kernel e
  dell'host. Qui cambia soltanto **come la shell li rappresenta e li disegna**.
- **Contratto:** invariato. Nessuna modifica ad ABI, WIT, IPC o schemi su
  disco (vedi «Fuori perimetro»).

## 1. Diagnosi dello stato attuale

Prova: foto del banco (`bench/baseline/settings-*.png`) e scatti headless
locali delle stesse scene, più l'inventario delle 60 `SettingSpec` reali
(15 gruppi, circa 50 righe nel form dopo i filtri).

| # | Problema | Effetto |
|---|---|---|
| D1 | Una sola colonna lunga: 15 gruppi e circa 50 righe senza indice né ricerca | Trovare un'impostazione vuol dire scorrere tutto |
| D2 | Il titolo «Impostazioni» ha il peso del corpo; «Chiudi» è un link testuale accanto alle schede | La finestra non ha una gerarchia leggibile |
| D3 | Ogni riga ripete «valore predefinito · vale per questa macchina» con lo stesso peso | Il dato utile (cosa è cambiato, dove vale) si perde nel rumore |
| D4 | Nessun segno visivo di «modificata»; il valore predefinito non si vede mai | Non si capisce cosa riporterebbe «Azzera» |
| D5 | Interruttori come caselle native; numeri con `min`/`max` come campi nudi da 200px | I controlli non dicono la forma del valore (sì/no, intervallo) |
| D6 | Solo tema e contrasto sono segmentati, per chiave; densità, carattere, modalità e rientro (2–3 opzioni) restano tendine | Stessa forma di dato, due resa diverse |
| D7 | Tema e contrasto hanno un fondo rialzato che nel tema scuro non si vede e le rientra rispetto al resto | Allineamento irregolare |
| D8 | Catalogo temi, frammenti CSS e profili sono appesi in fondo al form, lontano dal loro gruppo | Cose di «Aspetto» finiscono dopo «Diagnostica» |
| D9 | Profili: due riquadri con tendina, campo, area JSON e sei pulsanti in fila | Il gesto comune (cambiare profilo) è sepolto |
| D10 | Errori e «in salvataggio» di una riga non hanno stile (`.setting-error` non è vestita) | Un errore per-campo sembra testo qualunque |
| D11 | Componenti: diagnostiche del runtime a tutta riga, permessi come lunghi elenchi sempre aperti | La scheda è un muro di testo |
| D12 | Vault: righe spoglie, preferito come ★/☆ senza stato annunciato | Lo stato del preferito si sente solo dal tooltip |
| D13 | Lo scroll è del pannello intero: scorrendo spariscono schede e chiusura; `restoreFocus` ripristina lo scroll del corpo, che non scorre | Dopo una scrittura lo scroll non torna dov'era |
| D14 | Il filtro delle scorciatoie vive dentro il corpo e si ricrea a ogni ridisegno | Un `setting_changed` durante la digitazione toglie il fuoco |

## 2. Principi

1. **Lo schema decide, la shell rappresenta.** Il controllo si sceglie dalla
   specie dichiarata e dalla sua forma (numero di opzioni, intervallo), non
   dalla chiave. Restano per chiave soltanto i gesti che la shell già possiede
   (tema e anteprima, lingua, fuso, cartelle escluse, cornice, frammenti CSS).
2. **Una regola pura per ogni decisione.** La scelta del controllo, il passo di
   un cursore, il testo del predefinito, la ricerca e i filtri stanno in un
   modulo senza DOM (`panels/settings-model.ts`), provato da unit test.
3. **Nessuna perdita di funzione.** Scrittura per riga, esito vicino al
   controllo, focus ripristinato, gara dei ridisegni, anteprima del tema,
   ripristino di gruppo, profili opachi e inventario dei componenti restano
   come sono.
4. **Accessibilità come requisito.** Ruoli e nomi corretti, un solo punto di
   tabulazione per gruppo di radio, stato annunciato, rispetto del moto ridotto,
   nessuno scroll orizzontale alle larghezze strette.
5. **Ownership.** Ogni ascoltatore ha un owner: quelli sugli elementi fissi
   passano dalla `Lifetime` del pannello; nessun ascoltatore globale nuovo.

## 3. Modello di rappresentazione (`panels/settings-model.ts`)

Funzioni pure, esportate e provate:

| Funzione | Regola |
|---|---|
| `controlFor(entry)` | `toggle` → interruttore (`role="switch"`); `choice` con 2–3 opzioni ed etichette brevi (≤ 18 caratteri) → segmentato; altra `choice` → tendina; `number` con `min` e `max` finiti e al più 1000 passi → cursore + campo numerico; altro `number` → campo numerico; `text` → campo di testo; `list` → elenco |
| `numberStep(kind, value)` | 1 se `min`, `max`, predefinito e valore sono interi; altrimenti 10⁻ᵈ con d = decimali massimi fra quei numeri (al più 2) |
| `defaultText(entry)` | Il predefinito come lo leggerebbe un umano: etichetta dell'opzione, «acceso»/«spento», elenco o «niente» |
| `isModified(entry)` | `source !== "default"`: esiste una scelta esplicita a qualche livello, cioè ciò che «Azzera» dimenticherebbe |
| `normalizeSearch(text)` / `matchesSearch(entry, query)` | Minuscole, senza diacritici; ogni parola della ricerca deve comparire in etichetta, descrizione, chiave, gruppo o etichette delle opzioni |
| `sectionAnchor(title, index)` | Id stabile e sicuro di una sezione per l'indice |

`groupEntries` e `sourceLabel` restano in `settings.ts` con i loro test.

## 4. Visualizzazione

### 4.1 La finestra

- Finestra centrata di al più 1120px, alta quanto lo spazio sotto la
  titlebar meno i margini. Scorre **solo il contenuto**: intestazione,
  navigazione e barra di ricerca restano ferme (risolve D13).
- Intestazione: titolo come `h2` vero e pulsante di chiusura a icona con nome
  accessibile «Chiudi».
- Colonna di navigazione (220px): le quattro schede come `tablist` verticale
  con icona ed etichetta; sotto, «In questa pagina», l'indice delle sezioni
  della scheda corrente come elenco di pulsanti con `aria-current` sulla
  sezione visibile (scrollspy sullo scroll del corpo).
- Barra sopra il contenuto (schede Configurazione e Scorciatoie): campo di
  ricerca persistente, interruttore «Solo modificate» (`aria-pressed`, solo in
  Configurazione) e un conteggio annunciato (`role="status"`). La ricerca non
  ridisegna: nasconde righe e sezioni, e si riapplica dopo ogni ridisegno
  (risolve D1 e D14). Mod+F dentro il pannello porta il fuoco sulla ricerca.
- Sotto i 760px la navigazione diventa una fila di schede orizzontale e
  l'indice sparisce; nessuno scroll orizzontale.

### 4.2 Sezioni e righe

- Ogni gruppo è una `section` con intestazione (`h3`), «Ripristina gruppo»
  quando serve e un contatore delle modificate; le righe stanno in una scheda
  con bordo e raggio, separate da filetti (risolve D7).
- Riga: a sinistra etichetta, descrizione e una riga di metadati; a destra il
  controllo. I metadati sono una pastiglia di ambito («Questa macchina» /
  «Questo vault», con icona) e, se la riga è modificata, «Predefinito: …» e il
  pulsante «Ripristina». La frase completa di `sourceLabel` resta il testo
  che il lettore di schermo sente (`aria-describedby`) (risolve D3 e D4).
- Una riga modificata porta una barra d'accento sul bordo sinistro
  (`data-modified`).
- In salvataggio: la riga è `aria-busy` e mostra un indicatore discreto; su
  errore, un riquadro con bordo e fondo di pericolo, il messaggio e il valore
  tentato (risolve D10).

### 4.3 Controlli

| Specie | Controllo |
|---|---|
| Interruttore | `input[type=checkbox][role=switch]` vestito da interruttore, commutabile con Spazio e Invio, fuoco visibile, contrasto forzato gestito |
| Scelta breve | Segmentato (`radiogroup`, roving tabindex già esistente) |
| Scelta lunga | `select` dello stile di campo |
| Numero con intervallo | Cursore (`input[type=range]`, passo da `numberStep`, etichetta esplicita per i lettori di schermo) + campo numerico stretto; scrive al rilascio (`change`), non a ogni movimento; il campo resta quello preciso (`step="any"`) |
| Numero libero | Campo numerico stretto |
| Testo | Campo largo fino a 280px |
| Elenco | Pastiglie rimovibili + campo «Aggiungi» (solo cartelle escluse; le altre in sola lettura come pastiglie) |

### 4.4 Blocchi speciali al loro posto

- Il catalogo dei temi e i frammenti CSS vanno **dentro la sezione del loro
  gruppo** (quello di `appearance.theme` e di `appearance.css-snippets`),
  subito dopo le righe (risolve D8).
- I profili diventano la sezione «Profili» in fondo alla Configurazione, con
  la sua voce nell'indice. In vista: profilo attivo, scelta e «Attiva»; le
  azioni rare (duplica, esporta, importa, ripristina) e l'area JSON dentro un
  `details` «Gestisci profili» (risolve D9). Il JSON resta opaco.

### 4.5 Le altre schede

- **Componenti:** ogni componente è una scheda: nome, id, fiducia e
  interruttore nell'intestazione; i permessi dentro un `details` con il
  conteggio nel sommario («Permessi (2)»); stato del runtime e budget WASM
  come una riga di stato compatta (risolve D11). Installazione e catalogo
  firmato restano in cima, nella loro sezione.
- **Scorciatoie:** stessa anatomia di riga e stessa ricerca in alto (con una
  ricerca propria, che non si mescola a quella della configurazione); le righe
  stanno in due sezioni, «Comandi dei componenti» e «Comandi di questa
  finestra».
- **Vault:** schede con icona, nome, percorso e azioni; il preferito è un
  pulsante a due stati (`aria-pressed`) con nome accessibile (risolve D12).

## 5. Accessibilità

- `dialog` con `aria-labelledby` sul titolo `h2`; `tablist` con
  `aria-orientation="vertical"`, frecce su e giù oltre a sinistra e destra.
- L'indice è una `nav` con nome; la sezione corrente ha `aria-current="true"`;
  attivarla porta il fuoco sull'intestazione della sezione (`tabindex=-1`) e
  scorre senza animazione se il moto è ridotto.
- La ricerca ha `aria-controls` sul corpo e il conteggio in un `status`
  educato; una ricerca vuota di risultati lo dice e offre «Azzera ricerca».
- Interruttori `role="switch"`, cursori con lo stesso nome e descrizione del
  campo numerico accanto.
- Contrasto forzato: bordi di sistema su schede, pastiglie e interruttori.

## 6. Verifica

| Livello | Prova |
|---|---|
| Regole pure | `settings-model.test.ts`: controllo per specie, passo, predefinito, ricerca con diacritici e più parole, ancore |
| DOM del form | `settings.form.test.ts` aggiornato alla nuova anatomia (sezioni, switch, segmentato, cursore) più ricerca, «Solo modificate», indice e stato vuoto |
| Liste, componenti, profili | `settings.list.test.ts`, `settings.components.test.ts` adattati alla nuova struttura senza perdere asserzioni di comportamento |
| Shell reale | `shell.e2e.test.ts` (scorciatoie, moto del pannello) invariato e verde |
| Guard | `check-listeners`, `check-races`, `check-codemirror-boundary`, `check-npm-copies`; anatomia della pelle (`anatomia.ts`); `theme:verify` dopo `theme:generate` |
| Tipi e build | `npm run typecheck`, `npm run build` |
| Resa | Scatti headless locali (Playwright + host finto del banco) in chiaro, scuro, stretta, ricerca attiva, riga modificata e riga in errore, guardati uno per uno |
| Accessibilità | `npm run bench:a11y` locale sulle scene delle impostazioni |

Le baseline visive canoniche (`bench/baseline/settings*.png`) cambiano per
costruzione. Si rigenerano **solo** dall'artifact `banco-visivo` del runner
Linux dopo il push, come da precedente (`06d7ca4b`, `94349061`); qui non si
riscrivono.

## 7. Fasi

1. **Modello puro** e suoi test (F1).
2. **Scocca**: `index.html` (intestazione, navigazione, barra, corpo che
   scorre), montaggio, schede verticali, indice e scrollspy (F2).
3. **Righe e controlli**: anatomia della riga, switch, segmentato generico,
   cursore, pastiglie, stati di errore e salvataggio; blocchi speciali al loro
   posto; profili (F3).
4. **Altre schede**: componenti, scorciatoie, vault (F4).
5. **Pelle**: `skin/settings.css`, anatomia, rigenerazione della pelle,
   stringhe it/en (F5, in parallelo a F2–F4).
6. **Verifica** completa e iterazione visiva con gli scatti (F6).

Uscita di ogni fase: test vicini verdi e typecheck pulito; uscita del piano:
tutta la tabella del §6 eseguita sullo stato finale.

## 8. Fuori perimetro e seguiti

- **Metadati di schema** (unità, passo, ordine dei gruppi, «avanzate»): oggi
  le unità vivono nelle etichette («Corpo del testo (px)»). Aggiungerli a
  `SettingSpec` cambierebbe un record WIT posizionale; va deciso con casi reali
  e una revisione del contratto, non dentro un lavoro di resa.
- **`insert.date-format` e `insert.hour-cycle`** (`fub.template`) sono `text`
  con un insieme chiuso di valori: dovrebbero essere `choice`. È una modifica
  Rust del provider.
- **Documentazione Rust divergente:** `IndexResult::Settings`
  (`crates/fub-abi/src/traits.rs`) dice «in ordine di chiave», ma le righe
  arrivano in ordine di dichiarazione (`SettingsStore::entries_by_owner`).
- **Baseline visive** delle tre scene `settings*`: da riprendere dal runner.

## 9. Esito (30 settembre 2026)

Il piano è implementato nel working tree di `feat/workspace-revisione`, senza
commit. Nessuna modifica Rust, ABI, WIT, IPC o schema su disco.

**Dove:**
- modello: `apps/client/src/panels/settings-model.ts` e il suo test;
- pannello: `apps/client/src/panels/settings.ts`;
- scocca: `index.html` e `mobile.html` (stessi id);
- pelle: `src/theme/serie/skin/settings.css`, con l'anatomia e i derivati
  rigenerati da `theme:generate`;
- icone `component`, `keyboard` e `monitor`;
- stringhe it/en.

Una revisione indipendente del diff ha trovato sei punti. Tutti sono corretti,
ognuno con un test che fallisce senza la correzione:
1. il fuoco torna sull'opzione scelta di un segmentato, non su «Azzera»;
2. i riquadri aperti (permessi, gestione dei profili) restano aperti dopo un
   ridisegno, e si aprono da soli su una riga in volo o in errore;
3. la cornice della finestra non riattiva le scelte di una scrittura in volo;
4. la riga appena scritta resta in vista sotto il filtro finché il filtro non
   cambia;
5. il cursore si usa solo se i numeri arrivano al centesimo;
6. lingua e fuso dicono «Predefinito: Come il sistema».

**Verifiche eseguite sullo stato finale:**
- `npm run typecheck` e `npm run build`: puliti.
- Vitest: 1969/1971. I due test di `src/redraw.test.ts` vanno in timeout
  (5 s) solo nella suite intera su questa macchina, anche su una copia pulita
  di HEAD; da soli passano 7/7.
- Guard `check-codemirror-boundary`, `check-listeners`, `check-races` e
  `check-npm-copies`: verdi.
- `theme:verify`: uguale.
- `bench:a11y`: 44/44 scene pulite.
- `bench:verify`: 38/44 foto identiche alle baseline del runner. Cambiano solo
  le 6 scene `settings*`, come previsto.

**Residui:**
- Le baseline `bench/baseline/settings{,-components,-vault}-{dark,light}.png`
  vanno riprese dall'artifact `banco-visivo` del runner dopo il push.
- `check-doc-links` e `check-doc-orphans` falliscono in locale soltanto per
  `docs/.fub/`, dati locali ignorati da git.
- Restano i seguiti del §8.
