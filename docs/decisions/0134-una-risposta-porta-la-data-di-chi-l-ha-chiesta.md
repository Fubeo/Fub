# 0134 — Una risposta porta la data di chi l'ha chiesta

**Stato**: accolta **Data**: 2026-08-06 **Chiude**: i difetti misurati **0031**,
**0034** e **0087**, che sono la stessa frase **Commit**: *(questo commit)*

---

## La frase, che era una sola scritta in trentanove posti

Tre righe della tabella dei difetti misurati dicevano cose diverse:

- **0031** — `updatePreview` innesta senza token: una risposta in ritardo
  riempie un'anteprima già chiusa;
- **0034** — `refreshFromKernel` non ha contatore di generazione: due giri si
  sovrascrivono fuori ordine;
- **0087** — il ripiego da `patch` a `renderDeclaredView` non ha token di
  sequenza.

Sono tre sintomi di una domanda che il codice non obbligava nessuno a farsi:
**la mia risposta è ancora quella che qualcuno aspetta?** Chiuderli uno per uno
voleva dire scrivere tre volte la stessa promessa — *ricordati
l'`if (mio !== seq) return`* — e lasciarla da riscrivere al quarto posto.

Solo che il quarto posto c'era già. La metà del lavoro era **scritta a mano
quattro volte**, con tre nomi diversi:

| dove | nome | padrone |
|---|---|---|
| `panels/search.ts` · `runSearch` | `searchSeq` | modulo |
| `panels/quick-switcher.ts` · `cerca` | `seq` | chiusura |
| `panels/settings.ts` · `disegna` | `generazione` | modulo |
| `panels/doc-search.ts` · `cerca` | `seq` | chiusura |

La quarta la tabella non la nominava, ed è la prima cosa che il conto vero ha
aggiunto: erano quattro e non tre.

## Il conto vero: trentanove, e tre semantiche

Cercando in `frontend/src/` ogni `await` seguito da una scrittura nel DOM o
dall'assegnazione di uno stato di modulo, i siti **senza nessuna guardia** sono
**trentanove**. Nove ce l'hanno, e i nove non sono i quattro di sopra: ci sono
anche `document.ts` · `reloadIfClean` (che ricontrolla l'identità del buffer),
`document.ts` · `recuperaBozze`, la coda dei disegni di `document.ts`, e la
palette che si disabilita il bottone.

Il conto è la parte che ha deciso la forma. Con tre, riparare tre volte era
difendibile; con trentanove, no.

Ma il conto ha aggiunto una seconda cosa, più importante del numero, e che la
parola «corse» della tabella nascondeva: **non è una domanda sola, sono due**, e
hanno risposte **opposte**.

- **Trentadue** siti vogliono *buttare*. Ciò che il giro portava è un
  **disegno** — dei risultati, un'anteprima, un albero di view — e un disegno
  scaduto non si recupera: lo rifà il giro nuovo, che è già partito.
- **Sette** vogliono *aspettare*. Ciò che il giro porta è un **effetto** — una
  scrittura su disco, una mutazione del layout, un'icona che si salva — e
  buttarlo non è ordinare, è perdere.

Nessuno vuole *riprovare*: in questa shell il fallimento ha già i suoi rami, e
non c'è nessun sito in cui la risposta giusta a «sono scaduto» sia rifare.

La distinzione non è accademica, ed è il difetto peggiore che si può fare qui:
una forma unica per tutte e trentanove sarebbe stata elegante e avrebbe **perso
dei dati**, perché avrebbe buttato dei salvataggi.

## La decisione: due tipi, e si sceglie prendendone uno in mano

`frontend/src/ui/corsa.ts`, e dentro ci sono due cose, non una.

**`Corsa`** — il padrone di una successione di giri di cui conta solo l'ultimo.
Si apre un giro con `ultimo(corpo)`, e il corpo riceve **`atteso`**, che è
l'unico modo in cui può ottenere il risultato di un'attesa:

```ts
await corsa.ultimo(async (atteso) => {
  const reso = await atteso(api.renderPreview(id));
  innesta(previewEl, reso);
});
```

Se nel frattempo è cominciato un giro più nuovo, `atteso` **non torna**:
interrompe il corpo prima che arrivi a scrivere. Non c'è nessun `if` da scrivere
e nessuno da dimenticare, e — questa è la prova che conta — chi domani aggiunge
un `await` a un corpo già scritto eredita il controllo senza saperlo. È la sola
forma per cui il secondo chiamante non paga niente.

**`Coda`** — il padrone di una successione di lavori che devono arrivare
**tutti**, uno alla volta e nell'ordine chiesto. `accoda(lavoro)` torna l'attesa
del **proprio** lavoro, non della coda, perché «il disco ha ricevuto il mio
testo» e «il disco ha ricevuto qualcosa» sono due frasi diverse.

Che siano **due tipi e non due modalità di uno** è la decisione, non un
dettaglio di confezione: scegliere fra buttare e aspettare è un giudizio su cosa
il lavoro porta, e un giudizio non si esprime passando `true`. Chi ha in mano
una `Corsa` non può accodare per sbaglio, e chi ha una `Coda` non può buttare
per sbaglio.

## La forma viene dalla 0133, e anche il suo limite

È la mossa della [0133](0133-chi-ascolta-nomina-fino-a-quando.md) applicata al
tempo invece che alla vita: là non ci si registra senza nominare un padrone, qui
non si aspetta senza nominare un giro. E come là, **niente marchio**: `atteso`
arriva come parametro del corpo, cioè per averlo bisogna già essere dentro un
giro, e un `unique symbol` non toglierebbe nessuna strada che il parametro non
tolga già. La 0133 ha misurato quando un marchio serve — quando esiste un
sostituto nudo credibile da rendere inesprimibile — e qui non ce n'è uno: il
sostituto è `await`, che è del linguaggio.

Il padrone è un **oggetto**, e non un contatore di modulo, perché il conto lo
imponeva: due delle quattro implementazioni a mano stavano in una chiusura e due
in un modulo. Due riquadri in Lettura sono due anteprime che si riempiono
insieme, e un contatore unico le farebbe annullare a vicenda. Nei tre siti
riparati il padrone è di tre specie diverse, ed è il punto: una `const` di
modulo (`explorer.ts`), un campo della cosa montata (`views.ts` · `Montata`), e
una `WeakMap` sull'elemento che possiede la superficie (`preview.ts`) — dove
*debole* significa che quando il riquadro se ne va la sua corsa se ne va con
lui, senza nessuna cancellazione da ricordarsi.

## La forma alternativa, e perché è stata scartata

**Estrarre il contatore e basta** — una `Generazione` con `inizia()` e
`scaduta()`, cioè le quattro implementazioni a mano messe in un file. È ciò che
le tre righe chiedevano alla lettera, e non basta per la stessa ragione per cui
non bastava alla 0133: il controllo resta **una riga che si scrive**, spostata
dall'`if` al `if`. Al trentanovesimo posto non ci sarà, e soprattutto non ci
sarà dopo il *secondo* `await` di un corpo che oggi ne ha uno solo — che è
esattamente come tre delle quattro implementazioni erano scritte prima che
qualcuno aggiungesse la seconda domanda.

## Ciò che le quattro implementazioni sbagliavano, e non era il contatore

Erano d'accordo sulla forma: numero d'ordine crescente, catturato all'inizio,
riletto dopo. Su due cose no, e tutte e due sono finite nel tipo.

**Il ramo d'errore.** Tre su quattro ricontrollavano il numero anche nel
`catch`, perché un rigetto arrivato scaduto non è un errore da mostrare — è la
ricerca di due tasti fa che non ha trovato l'indice, e dirla adesso vuol dire
scrivere un guasto sopra un risultato buono. La quarta se l'era dimenticato.
Adesso lo tiene `atteso`, che il controllo lo fa su tutti e due i rami.

**L'annullamento.** Una sola su quattro sapeva far scadere i giri in volo
**senza cominciarne uno** (`clearSearch`, che svuota la casella e deve impedire
alla risposta in volo di ripopolarla). Le altre tre non ce l'avevano — non per
una scelta, ma perché la loro superficie si butta invece di riusarsi. È
`annulla()`, ed è la cosa che un contatore nudo non sa fare senza far partire un
giro finto. Ed è anche, letteralmente, la riparazione del **0031**:
`clearPreview` adesso fa scadere la corsa della superficie che sta svuotando.

## Il difetto stava fuori dal sito nominato, per la venticinquesima volta

Il **0087** nomina «il ripiego da `patch` a `renderDeclaredView`». La finestra
non è lì: è in **`renderDeclaredView` e basta**, e il ripiego è solo il
chiamante più evidentemente concorrente. Riparandola al posto nominato sarebbero
rimasti scoperti il ramo `replace` e ogni ridisegno che arriva da un evento —
che sono i più frequenti, perché ogni `stale-views` e ogni `batch_ended` ne fa
partire uno.

E il **0034** aveva un guardiano finto. `refreshFromKernel` confronta una firma
(`ultimaFirma`) e salta il ridisegno se non è cambiata: sembra la cosa, e non lo
è. La firma risponde a *«è cambiato qualcosa?»*, non a *«sono ancora io?»* — e
due giri partiti insieme hanno quasi sempre firme **diverse**, perché nel
frattempo una sottocartella si è aperta o una nota si è salvata. Quindi il giro
vecchio passava il controllo e vinceva, per il solo fatto di arrivare dopo. **Un
dedup non è mai un ordinamento**, e assomiglia abbastanza a uno da fermare chi
guarda.

## L'attore, e ciò che ha imparato provando

**Il compilatore** prende la metà grande: `atteso` non si fabbrica, si riceve, e
per riceverlo bisogna già essere dentro un `ultimo`.

**Un conto** — `.github/scripts/check-corse.mjs` — prende l'altra: *nessuno
scavalca la porta stando dentro*. Sono due modi, e il secondo è quello vero
perché è involontario:

1. un `await` nudo dentro il corpo;
2. un **`} catch` dentro il corpo**, che ingoia il segnale di scadenza insieme
   all'errore. Non è teorico: tutte e quattro le implementazioni a mano avevano
   un `try` attorno alla chiamata, perché tutte e quattro dovevano dire qualcosa
   quando la chiamata falliva. Da lì l'idioma che questa decisione scrive e che
   il conto insegna nel suo messaggio — **l'errore diventa un valore prima del
   cancello**, `await atteso(promessa.catch(…))` — così il ramo che dice «non si
   può cercare» passa dallo stesso controllo del ramo che disegna i risultati,
   invece di essere un secondo posto in cui ricordarselo.

**Il banco** prende il comportamento: dieci prove in `ui/corsa.test.ts`, nessuna
delle quali aspetta un tempo. Ogni attesa è una promessa che il banco risolve
quando decide lui, così l'ordine di arrivo è **scritto** invece che sperato — ed
è la sola forma in cui «il vecchio risponde per primo» è un fatto e non una
coincidenza.

Provate rosse una per una, rompendo ciò che difendono: tolto il controllo dopo
il successo (tre rosse), tolto quello nel ramo d'errore, `annulla` reso inerte,
la coda che non accoda, il rigetto che entra nella catena, la coda che torna sé
stessa invece del lavoro di chi ha accodato, e il contatore reso unico di modulo
— che è la prova che due corse sono due padroni.

**Una zona cieca dichiarata era falsa, e provarla l'ha detto.** Il commento del
conto elencava «l'alias» (`const a = atteso; await a(p)`) fra i modi di
aggirarlo. Costruendolo, il conto è diventato **rosso**: il criterio non è
«esiste un alias» ma «il nome compare nell'espressione attesa», quindi un alias
è una violazione e non un buco. Il conto era più severo di come si descriveva,
ed è giusto che lo sia — `atteso` non ha nessuna ragione di cambiare nome. Il
modo che funziona davvero è un altro, ed è stato trovato costruendolo:
**`.then(…)` al posto di `await`**, che nessuna lettura del testo può seguire.

La zona cieca che conta, però, è la prima e la si dichiara per intero: **questo
conto guarda dentro i giri, quindi non ha niente da dire su chi non ne apre
nessuno** — che è il difetto originale. Trentanove siti, questa tornata ne
chiude tre e ne migra quattro; finché l'elenco non è vuoto, è la lista di ciò
che il conto non vede.

## Ciò che questa decisione lascia scritto per chi viene dopo

I sette siti della classe *aspettare* non li chiude questo verbale: `Coda` è il
tipo che li aspetta, e la coda scritta a mano in `panels/document.ts` è la prova
che la forma era già stata trovata una volta e non aveva un nome.

E i dodici caricatori di stato di modulo — tema, locale, layout, organizzazione,
comandi, spazio attivo — sono tutti raggiungibili da `openVaultPath`, e sono
**una famiglia sola**: due aperture di vault ravvicinate possono lasciare ognuno
di quegli stati preso da un vault diverso. Non è uno dei trentanove più degli
altri; è uno che vale più degli altri, e non è stato riparato qui perché non è
uno dei difetti misurati e merita di essere misurato prima.
