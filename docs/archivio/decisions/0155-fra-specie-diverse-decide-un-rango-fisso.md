# 0155 — Fra specie diverse decide un rango fisso, e non si ribalta

**Stato**: accolta
**Data**: 2026-08-14
**Chiude**: il residuo su `order_of` (issues.md §12; **non** è una voce di
[todo.md](../todo.md))
**Commit**: *(questo commit)*

---

## La domanda

`order_of` è il comparatore di ogni risposta `IndexQuery::Documents` ordinata
per una proprietà. La spec diceva due cose insieme: chi non ha la chiave
finisce **in fondo** in entrambi i versi, e un valore non confrontabile —
`peso: "tanto"` accanto a `peso: 3` — deve fare lo stesso, invece di
spararsi a caso come «pari».

Il ramo `compare == None => Ordering::Equal` rendeva il comparatore **non un
ordine**: su `a.md("tanto")`, `b.md(3)`, `c.md(10)` il testo finiva in testa
in entrambi i versi, perché `Equal` lascia al `DocId` il posto, e `a.md` viene
prima. La correzione ingenua `None => Ordering::Greater` rompe
l'antisimmetria che `sort_by` pretende: `order_of(a, b)` e `order_of(b, a)`
sarebbero entrambi `Greater`.

Restavano tre forme. La proposta minima annotata dal giro precedente: una
**specie di riferimento** (la prima proprietà presente in ordine di `DocId`),
due classi (confrontabili con quella specie, poi il resto in fondo).
L'alternativa più stabile: dichiarare la specie in `property-sort`. La terza,
già in albero dal `b9e98f9`, è un **rango fisso** fra le specie, come Excel,
che il decrescente non ribalta.

## La premessa, rimisurata

Rimisurata a `b9e98f9`. Il ramo `Equal` **non c'è più**: `order_of` sul `None`
di `compare` chiama `species_rank`, otto ranghi — numero, data, bool, testo,
link, elenco, unknown, vuoto — e il rango non si inverte col verso. I test
`diverse_species_sort_by_fixed_rank_in_both_directions` e
`a_mixed_vault_answers_wrong_and_says_nothing_until_the_format_is_declared`
lo tengono. Lo scenario che il difetto misurava — testo in una colonna di
numeri — esce `b, c, a` al crescente e `c, b, a` al decrescente: il testo sta
in fondo ai numeri in entrambi i versi, e l'assente sta ancora dopo.

Quindi la raccomandazione «serve una decisione di prodotto» è ancora vera, e
nel verso buono: il codice ha già preso posizione, e la 0005 l'ha già scritta
nella forma. Mancava il verbale che dicesse **quale delle tre forme** è quella
posizione, e quale no. Le due che cadono cadono per ragioni che dal diff di
`b9e98f9` non si ricostruiscono.

- **La specie di riferimento non è un ordine della coppia.** `finish` confronta
  due documenti alla volta. Per sapere quale specie «è la colonna» bisogna
  aver visto tutti i valori prima di ordinarli. Un documento nuovo con
  `DocId` precedente e specie diversa ribalta la guida: la stessa colonna, gli
  stessi valori, un file in più, e l'ordine dei vecchi cambia. È
  deterministico, è antisimmetrico, e non è stabile.
- **Un campo specie su `property-sort` è major.** Il record è nel frozen
  (`key`, `descending`) e un campo in più è la migrazione che la
  [0002](0002-additivita-del-contratto.md) e la
  [0007](0007-contesto-di-sessione.md) hanno già prezzato. Non scade solo
  l'additività della riga WIT: scade chi la riceve. Per una colonna che oggi
  nessuno dichiara, è il prezzo che la 0002 rende caro.
- **`None => Ordering::Greater` non è una forma, è un comparatore illegale.**
  `sort_by` con un comparatore che non è un ordine debole è un panic in debug
  e una permutazione qualunque in release: la stessa famiglia di danno che il
  `Equal` produceva, solo più onesta.

Il rango fisso è l'unica delle tre che sta in una coppia, non tocca il
contratto, e non dipende da chi è arrivato prima. Il prezzo è dichiarato, ed
è Excel: un numero sporco in una colonna di testi sta **prima**, non in fondo.
Sul caso che il difetto misurava — un testo sporco in una colonna di numeri —
le due letture coincidono, ed è per questo che il rango sembrava «in fondo».
Non lo è. Lo è il posto dell'assente, che resta dopo ogni valore presente, in
entrambi i versi, come già diceva la 0005.

## La decisione

**Fra specie diverse decide un rango fisso, e il rango non si ribalta col
decrescente.** È la forma già in albero, ed è quella che si tiene. Chi non ha
la chiave resta in fondo in entrambi i versi. A parità — stessa specie e
stesso valore, o due valori della stessa specie che `compare` non sa
ordinare (due link, due elenchi, due unknown, due vuoti) — decide il `DocId`,
perché una risposta paginata deve essere un ordine totale.

Il rango — numero, data, bool, testo, link, elenco, unknown, vuoto — è una
convenzione di prodotto, non una verità di natura, e sta nel codice che tutti
attraversano (`fub_abi::rules::properties::order_of`), non nella firma. Il
filtro non cambia: `>` fra un numero e un testo resta *falso*, non un errore.
Le due domande erano già distinte, e restano distinte: confrontare è una
prova, ordinare è un posto.

Il lavoro portato è il fatto scritto dove ci si inciampa, e il banco che il
difetto non aveva. Il doc di `order_of`, di `PropertySort` e del
`record property-sort` dicono adesso il rango invece di promettere un fondo
che il codice non mantiene per un numero in una colonna di testi. Il doc di
`HealthCheck::UnrecognizedDates` smette di dire che l'ordinamento è «pari»:
senza dichiarazione le date non-ISO restano testi, e i testi si ordinano fra
loro come stringhe *dentro* il loro rango — plausibile, e sbagliato come
cronologia, che è il danno che la
[0108](0108-una-data-la-dichiara-chi-possiede-il-vault.md) chiude dichiarando
il formato, non questo verbale. Il presidio nuovo è lo scenario del difetto
in entrambi i versi, più la coppia che distingue Excel dalla specie di
riferimento (un numero in una colonna di testi sta prima), più
l'antisimmetria su ogni coppia di specie e sull'assente.

## Le forme scartate

- **Specie di riferimento.** Risponde alla lettera della spec («in fondo») e
  costa una passata in più più un ordine che un file nuovo può ribaltare.
  Scartata perché la stabilità di una colonna vale più della metafora del
  fondo, e perché sul caso misurato il rango ci arriva lo stesso.
- **Un campo specie su `property-sort`.** È la forma più precisa, e resta
  possibile dopo il freeze come campo in fondo a un record — major per chi lo
  riceve, additiva per il WIT. Non si scrive oggi: non c'è un chiamante che la
  dichiari, e un campo che nessuno riempie è un secondo ordine accanto al
  primo.
- **`None => Ordering::Greater`.** Non è un ordine. Non si discute.

## Cosa resta scoperto

Zero caselle. Due cose dichiarate.

- **Due link, due elenchi, due unknown non hanno un ordine proprio.** Restano
  pari e li rompe il `DocId`. Ordinare i link per destinazione o gli elenchi
  per primo elemento è un'altra domanda, e non ha un cliente.
- **Un numero in una colonna di testi sta in testa.** È Excel, è la scelta, e
  il banco la tiene. Chi vorrà «la specie della colonna» passerà dal campo
  che questa decisione lascia sul tavolo, non da una guida indovinata sul
  primo `DocId`.
