# 0217 — Un `.fubsheet` si copia in una cartella di Excel nuova, calcolata da GridCraft e misurata

- **Stato:** sostituita
- **Data:** 2026-10-22
- **Ambito:** contratto
- **Sostituisce:** —
- **Sostituita da:** 0218

## Contesto

Un foglio `.fubsheet` vive in Fub con identità stabili di righe e colonne, e
chi lo condivide con chi usa Excel deve poterne dare una cartella. Il
`.fubsheet` e la cartella di Excel non sono lo stesso modello:

- le formule del `.fubsheet` hanno la sintassi di Fub (`;` fra gli argomenti,
  poche funzioni), quelle di Excel la sua;
- Excel dà regole ai nomi dei fogli (31 caratteri, niente `: \ / ? * [ ]`,
  nomi diversi senza contare le maiuscole) che il `.fubsheet` non ha;
- il calcolo di Fub e quello di Excel non danno sempre lo stesso valore: Excel
  confronta i testi senza maiuscole, ha funzioni che Fub non ha, scrive 0 dove
  una cella vuota entra in un'operazione;
- gli id delle righe e delle colonne, e le proprietà, non hanno dove stare in
  una cartella.

L'[ADR 0211](0211-copie-esportate-con-la-perdita-misurata.md) ha già deciso
la forma per i documenti di videoscrittura: una copia esportata, che non tocca
il documento, con la perdita misurata rileggendola. L'[ADR
0216](0216-protocollo-grid-2-sorgente-a-byte.md) vieta invece il codec di
GridCraft per scrivere una cartella **esistente**, perché la riscriverebbe dal
modello, e vieta di ricalcolare i valori di una cartella aperta.

## Decisione

- Un `.fubsheet` si **esporta** in Excel dalla porta di export del contratto:
  `fub-format-xlsx` registra un `ExportProvider` con la destinazione
  `xlsx.copy` e il comando `xlsx.export-copy`, che chiede `export.run`. Il
  bundle `fub.xlsx` dell'host li compone con la griglia delle cartelle, e si
  spegne con lei. Il `.fubsheet` non si tocca, e niente entra nel vault.
- La copia è un **file nuovo**: il codec di GridCraft la scrive per intero dal
  suo modello, perché non c'è un file di Excel da preservare. Il divieto della
  0216 resta per ogni cartella che esiste.
- Le righe e le colonne diventano **posizioni** nell'ordine del foglio, che è
  quello con cui le formule del `.fubsheet` le nominano. Gli id stabili non
  entrano nel file, e una nota lo dice.
- Le formule si scrivono nella **sintassi di Excel** dallo stesso albero con
  cui Fub le valuta (`fub_format_sheet::excel_formula`): virgole, nomi dei
  fogli fra apostrofi, parentesi dove Excel associa diverso. Un riferimento
  che in Excel non ha bersaglio diventa `#REF!`. Una formula che Fub non sa
  leggere, o che il lettore di GridCraft non rilegge, resta **testo**, e un
  avviso la nomina.
- I **valori** delle formule sono quelli di GridCraft, che ha la semantica di
  Excel, e la cartella chiede a Excel di ricalcolare all'apertura
  (`fullCalcOnLoad`). Ogni cella il cui valore non è quello che Fub mostra è
  un avviso, con le prime celle per nome e le altre contate. Il calcolo intero
  vale soltanto per la copia: una cartella aperta continua a non ricalcolare.
- Un nome di foglio che Excel non ammette **cambia**, nelle formule
  comprese, e un avviso dice il nome nuovo. Un testo oltre 32.767 caratteri si
  accorcia, e lo dice.
- Ciò che la copia perde si **misura** come nella 0211: la copia si rilegge con
  il codec e si confronta cella per cella con il `.fubsheet` (fogli, celle
  scritte, formule, grassetto, corsivo, colori, allineamenti, formati numerici,
  altezze, larghezze, righe e colonne nascoste). Ogni diminuzione è un avviso
  con il numero; le proprietà perse sono un avviso a parte.

## Conseguenze

### Positive

- Un foglio di Fub si dà a chi usa Excel, con formule che Excel legge e
  ricalcola, e con l'elenco di ciò che cambia.
- Le differenze di calcolo fra Fub ed Excel sono un fatto con le celle, non
  una sorpresa all'apertura.
- Nessuna porta né IPC nuova: export, lavori e attività esistevano già.

### Negative

- La copia non torna indietro: una cartella di Excel non è un `.fubsheet`, e
  i link alle celle del `.fubsheet` non puntano alla copia.
- Il foglio si calcola due volte, una con Fub e una con GridCraft; una
  richiesta sola esporta al massimo 64 fogli.
- Il confronto conta stili e dimensioni che il `.fubsheet` dichiara, non come
  Excel li disegna.

## Alternative scartate

### Scrivere i valori di Fub nelle celle delle formule

La copia mostrerebbe in Excel, prima del ricalcolo, ciò che Fub mostra; ma
Excel ricalcola comunque e il valore cambierebbe senza che nessuno l'abbia
detto. Con il valore di GridCraft la differenza si vede prima, ed è un avviso.

### Tenere gli id delle righe e delle colonne in una parte personalizzata

Una parte che Excel non conosce si perde al primo salvataggio in Excel, e la
copia sembrerebbe tornabile in un `.fubsheet` quando non lo è.

### Lasciare il nome che Excel non ammette

Excel rifiuterebbe la cartella, o la riparerebbe all'apertura cambiando i
nomi senza aggiornare le formule.

## Verifica

- `crates/fub-format-sheet/src/formula.rs`: la sintassi di Excel dallo stesso
  albero, `#REF!` e i casi che non si scrivono;
- `crates/fub-format-xlsx/tests/fubsheet.rs`: valori, formule, stili e
  dimensioni si rileggono, i nomi cambiano anche nelle formule, le formule che
  Excel non legge restano testo, i valori diversi si dicono con le celle, le
  perdite si contano;
- `crates/fub-host/tests/xlsx_workbooks.rs`: il comando accoda l'export, il
  `.fubsheet` resta, la copia si apre nella griglia delle cartelle, una nota o
  una cartella si rifiutano, spento il bundle comando e destinazione
  spariscono.
