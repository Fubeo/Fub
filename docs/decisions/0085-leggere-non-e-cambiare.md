# 0085 — Leggere non è cambiare, e un anello non è un costo

|  |  |
|---|---|
| **Decisa** | 2026-08-04 |
| **Origine** | Nessuna voce: tre **difetti** trovati usando la ricerca, sullo stesso percorso — una battuta nella casella. Non chiude niente e non apre niente; la domanda che lascia in eredità è quella della [seduta 20](../roadmap/20-quando-qualcosa-va-storto.md) — cosa fallisce senza produrre nessun segnale |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta della ricerca](../roadmap/21-la-ricerca-predefinita.md) · [quando qualcosa va storto](../roadmap/20-quando-qualcosa-va-storto.md) · [il freno e il raggruppamento, 0034](0034-il-freno-e-il-raggruppamento.md) · [cosa si chiede a una ricerca, 0050](0050-cosa-si-chiede-a-una-ricerca.md) · [una porta per chi cerca, 0082](0082-una-porta-per-chi-cerca.md) · [le due superfici che restavano, 0083](0083-le-due-superfici-che-restavano.md)

---

Scrivere nella casella di ricerca faceva smettere di rispondere la shell. Le
cause sono **tre**, in tre crate diversi, e nessuna delle tre sapeva delle altre;
stanno in un verbale solo perché stanno tutte sul percorso di *una battuta*, che
dopo la [0083](0083-le-due-superfici-che-restavano.md) è il gesto più caldo
dell'app — il pannello si ridisegna mentre si scrive, e ogni tasto rifà il giro
intero.

Ma la cosa che il repo non sapeva non è «erano tre». È che **una sola delle tre
era un anello**, e le altre due erano costi. È la distinzione che vale il
verbale, perché è quella fra un rallentamento e un collasso.

## Le due che erano costi

Le metto prima perché si liquidano in fretta, ed è giusto che sia così.

**Una scansione quadratica** (`fub-kernel/src/occurrences.rs`). `locate` cercava
*tutte* le occorrenze di ogni termine e poi teneva le prime `MAX_PER_DOC`,
togliendo i duplicati con un `contains` a ogni inserimento. Su una parola comune
in una nota lunga sono migliaia di occorrenze e milioni di confronti, moltiplicati
per i documenti della pagina. Due mosse: il tetto vale **anche per la scansione
di un termine** — le occorrenze di un termine escono in ordine di posizione,
quindi oltre il tetto si percorre il resto del file per buttare via ciò che si
trova — e i duplicati si tolgono con un `dedup` dopo l'ordinamento, che
l'ordinamento c'era già.

**Migliaia di reflow** (`frontend/src/panels/search.ts`). Le righe si
attaccavano una per una a una lista **già nella pagina**: qualche migliaio di
`<li>` sono qualche migliaio di ricalcoli del layout. Adesso si montano in un
`DocumentFragment` e si attaccano in una volta sola.

Sono difetti veri e costosi. Ma sono **lineari**: raddoppia il vault e raddoppia
il conto, si aspetta e poi finisce. Nessuno dei due produce lavoro che ne generi
altro.

## L'anello

`fub-host/src/watcher.rs` trattava come cambiamento **qualunque** evento
arrivasse dal rilevatore, comprese le aperture e le letture che inotify riporta
(`Access(Open)`, `Access(Close(Read))`, e l'atime che ne segue, che è la stessa
cosa detta come metadato).

E chi apre i documenti di questo vault più spesso di chiunque altro è **Fub
stesso**: dalla §21.3 la localizzazione delle occorrenze apre il sorgente di ogni
riga di una pagina di risultati.

Il giro:

1. una ricerca legge sessanta note per localizzare le occorrenze;
2. il rilevatore riferisce sessanta «modifiche»;
3. il kernel rilegge quelle sessanta note per scoprire che sono identiche;
4. **quelle riletture sono altre sessanta aperture**, e si torna al punto 2.

Nessuno dei passaggi è sbagliato preso da solo. Il difetto è che il passo 3 è la
risposta al passo 2, e produce l'ingresso del passo 2. Il sistema si alimentava
da sé — un `DocumentChanged` a vuoto e un `IndexUpdated` per ogni passaggio,
finché il ponte non andava in overflow ([0034](0034-il-freno-e-il-raggruppamento.md)) e
la shell non rispondeva più.

La riparazione è dichiarativa e sta in `is_a_change_kind`: gli accessi non sono
cambiamenti, tutto il resto sì. Con una regola sul verso in cui sbagliare, che è
la parte che merita di essere scritta: `Any` e `Other` — i backend che non sanno
dire cosa è successo — contano come **cambiamenti**. Una rilettura di troppo
costa un file aperto; una di meno costa un indice che drifta in silenzio. Nel
dubbio si paga il file.

C'è un secondo pezzo, più piccolo e della stessa famiglia: la raffica si filtra
**prima** di prendere il lucchetto esclusivo del workspace, e un lotto di sole
letture non è un lotto — si esce subito. Prendere il lucchetto in scrittura per
non fare niente vuol dire togliere il vault ai lettori a ogni ricerca, che sulla
[0024](0024-chi-legge-non-aspetta-chi-legge.md) è esattamente il costo che si
era pagato per evitare.

I presìdi sono due, e il secondo è quello che conta: `what_changes_still_gets_through`
esiste perché un filtro sugli eventi del rilevatore è la cosa più facile da
stringere troppo, e un rilevatore che non rileva niente è velocissimo.

## Perché la differenza è la cosa da ricordare

Un costo lineare degrada in proporzione a ciò che gli si dà: si vede crescere, si
misura, e il caso peggiore è il vault più grande che qualcuno ha.

Un anello non ha un caso peggiore proporzionato a niente. Il lavoro che produce
diventa il suo ingresso, quindi non scala col vault: scala col **tempo**. Sessanta
note lette una volta sono sessanta letture; sessanta note dentro un anello sono
sessanta letture al giro, per sempre, finché qualcosa in mezzo non si rompe — e
ciò che si è rotto qui è il ponte, che è l'unico pezzo con una coda finita e
quindi l'unico che poteva dire qualcosa.

Detto altrimenti: le prime due le avrebbe trovate un banco delle prestazioni
misurando il giro per battuta, che la [0083](0083-le-due-superfici-che-restavano.md)
ha già fatto una volta. La terza no, perché il giro per battuta **misurato in un
banco non ha un rilevatore acceso sopra**. L'anello si chiude solo con tutte e
tre le parti vive insieme: la ricerca che legge, il rilevatore che guarda, il
kernel che reagisce. Nessuno dei tre, da solo, è in errore.

## Era un difetto senza segnale?

Sì, ed è il motivo per cui vale la pena scriverlo qui invece che nel diff.

Fino all'overflow del ponte quell'anello **non diceva niente a nessuno**. Non un
avviso, non un log, non una metrica: solo un'app che a un certo punto non
rispondeva più, e un utente senza modo di sapere perché. Nessuno dei
partecipanti aveva l'informazione per accorgersene — il rilevatore vedeva
aperture legittime, il kernel vedeva richieste legittime, la ricerca leggeva i
file che deve leggere. Il difetto stava **fra** loro, dove non guarda nessuno.

È in pieno la domanda della [seduta 20](../roadmap/20-quando-qualcosa-va-storto.md),
«cosa fallisce senza produrre nessun segnale», ed è la stessa forma della
[0081](0081-un-accordo-ha-un-proprietario.md): una proprietà che nessuno dei
partecipanti può vedere da solo, per costruzione. Lì era una coppia di registri,
qui è un ciclo fra tre componenti — ma la lezione si ripete, e le ripetizioni
sono la cosa che un archivio serve a far notare.

Resta una domanda aperta, che questo verbale non risolve perché non gli compete:
**un rilevatore dovrebbe dichiarare che una lettura non è una scrittura, invece
che scoprirlo?** Oggi la distinzione vive in una funzione dentro l'host, valida
per il backend che c'è. Il giorno in cui il rilevatore diventerà scambiabile —
o in cui un plugin vorrà guardare il disco — quella regola andrà detta nel
contratto, o ognuno la riscoprirà nello stesso modo: con un'app che smette di
rispondere. Sta scritto qui perché è la cosa che il prossimo anello userà per
nascere, e perché il posto in cui deciderlo non esiste ancora.

## L'esito, in breve

Leggere un documento non lo cambia, e adesso il rilevatore lo sa dire. Cercare
un termine comune in una nota lunga costa quanto le occorrenze che si mostrano e
non quante ce ne sono. Una pagina di risultati tocca il documento una volta
sola. E il gesto più caldo dell'app — una battuta nella casella — non produce
più lavoro che chiama altro lavoro.
