# 0240 — La pelle che eredita

- **Stato:** accolta
- **Data:** 2026-11-08
- **Ambito:** frontend
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

Un tema `theme-2` può dichiarare `extends: "fub.serie"`: parte dal tema di
serie e porta solo ciò che cambia. L'host lo accetta e consegna `sheet: null`
per una luce senza foglio (vedi
[Temi installati](../reference/permissions-and-security.md#temi-installati)).
Resta da decidere come la shell lo monta.

Fino a qui il caricatore aveva un canale per il foglio e uno per la pelle, e
un tema li sostituiva tutti e due: la sua pelle prendeva il posto di quella di
serie. Per un tema che vuole cambiare tre regole questo vuol dire copiare le
diciottomila righe della pelle di serie e tenerle allineate a mano; e un
componente che arriva con una versione nuova di Fub resta nudo sotto un tema
scritto prima, perché la sua pelle non lo nomina.

## Decisione

**Un canale in più, non una fusione.** Un tema che eredita lascia la pelle di
serie montata nel canale `pelle` e mette la sua in un canale proprio,
`pelle-tema`, subito dopo. La cascata del browser fa il resto: a parità di
specificità vince la regola che viene dopo, cioè quella del tema; una
proprietà o un componente che il tema non nomina resta quello di serie.

**L'ordine dei canali è dichiarato**, non una conseguenza di quando si monta:
`caratteri`, `caratteri-tema`, `foglio`, `pelle`, `pelle-tema`, `preferenze`,
`snippets`. Ogni canale `-tema` sta subito dopo il suo gemello di serie; le
preferenze della persona restano dopo ogni pelle e i frammenti CSS per ultimi,
come prima. `caratteri-tema` è un posto riservato ai caratteri di un tema.

**Il foglio resta uno.** Un tema che eredita e porta il foglio di una luce lo
porta intero, e quel foglio passa ruoli e contrasti come ogni foglio. Una luce
senza foglio usa quello di serie della stessa luce e dello stesso contrasto,
alto compreso. I fogli non si sommano: i ruoli e le coppie di contrasto si
misurano su un foglio solo, quello montato.

**Una commit sola.** Foglio, pelle di serie e pelle del tema si sostituiscono
insieme, dopo che ogni cancello è verde; un rifiuto lascia montato ciò che
c'era. La pelle del tema passa dallo stesso sanificatore, con lo stesso
vocabolario `theme-2` e lo stesso cancello del contenuto. Per un tema che
eredita una pelle assente o vuota è il caso normale e non è un motivo di
rifiuto. Tornare alla serie, applicare un altro tema o annullare l'anteprima
tolgono anche `pelle-tema`.

**`extends` accetta solo la serie.** Ereditare da un altro tema installato è
fuori, per ora: vorrebbe dire catene, cicli, temi che spariscono sotto chi li
estende, e una pelle di terzi non verificata sotto un'altra.

**Quando la serie cambia, il tema eredita il cambio.** È lo scopo: un tema che
eredita veste ciò che nomina, e per il resto è la serie della versione di Fub
che lo monta.

## Conseguenze

### Positive

- un tema di cento righe cambia solo ciò che vuole e resta tale anche quando
  la serie cresce;
- un componente nuovo arriva già vestito sotto un tema scritto prima;
- il caricatore resta per sostituzione, un elemento per canale: niente testi
  da fondere, niente gara di specificità fra due temi.

### Negative

- un tema che eredita cambia aspetto quando cambia la serie, anche dove non
  lo voleva: chi vuole un aspetto fermo non eredita e porta tutto da sé;
- la pelle di serie si analizza e si applica anche sotto un tema che eredita:
  due pelli nel documento invece di una;
- una regola del tema con specificità più bassa di quella di serie perde: chi
  scrive il tema deve uguagliare il selettore che vuole battere.

## Alternative scartate

### Fondere i due testi

Concatenare o fondere la pelle di serie e quella del tema in un solo testo
prima di montarlo. Darebbe lo stesso risultato nella cascata, ma il canale
`pelle` non sarebbe più la pelle di serie: la diagnosi, il rispecchiamento fra
finestre e i banchi non saprebbero più cosa viene da chi, e il sanificatore
dovrebbe rivalidare la serie a ogni montaggio di un tema.

### Ereditare da qualunque tema

Permettere `extends` verso un tema installato. Plausibile, ma porta catene,
cicli e dipendenze fra pacchetti di terzi che l'installazione dovrebbe
risolvere; si può aggiungere dopo senza cambiare l'ordine dei canali.

## Verifica

- `apps/client/src/theme/inherit.test.ts`: un tema senza `extends` monta gli
  stessi elementi di prima; uno con `extends` lascia la pelle di serie e
  aggiunge la sua dopo; una sua regola vince a parità di specificità; un
  componente che non nomina ha lo stile di serie; il contrasto alto usa il
  foglio di serie del contrasto alto; «Annulla anteprima», il ritorno alla
  serie e il passaggio a un tema che non eredita non lasciano `pelle-tema`.
- `apps/client/src/theme/gate.test.ts` e `runtime.test.ts`: la pelle vuota
  rifiuta solo chi non eredita; un tema con `sheet: null` si monta sopra la
  serie.
