# 2. Cosa è una view

Una **seduta (riunione decisionale)** della
[roadmap infrastrutturale](../todo.md). Le firme (vincoli tecnici) lo
stabiliscono: una view è una funzione pura, sincrona, senza stato.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) ·
[i verbali delle decisioni chiuse](../decisions/README.md)

---

La seduta (riunione decisionale) fissa questa forma: *una view è una funzione
pura, sincrona, senza stato, che disegna in sola lettura su una delle tre
superfici che esistono*.

La forma supporta solo elementi statici e sincroni. Coinvolge i capitoli 11, 12,
11.5 e 22.

Contesto della seduta:
- È la più estesa e urgente del piano.
- Sette voci su nove sono firme (vincoli contrattuali).
- Stabiliscono una regola inedita.

**Otto voci su nove sono chiuse** con la
[decisione 0016](../decisions/0016-cosa-e-una-view.md).

Voci chiuse:
- I nodi (§2.1).
- Le superfici (§2.2).
- Le istanze (§2.3).
- Lo stato (§2.4).
- L'invito a ridisegnare e il «non ancora» (§2.5).
- I metadati della `ViewSpec` (§2.6).
- Il payload delle azioni (§2.7).
- La chiave col riconciliatore (sistema di aggiornamento UI) (§2.8).

Il verbale spiega cosa è una view **adesso**. Il file
[architecture/ui-protocol.md](../architecture/ui-protocol.md) descrive la forma
del protocollo.

La nona voce mantiene la priorità P2. Le sue caratteristiche sono:
- Scade dopo il freeze (congelamento del codice).
- È indipendente da altre attività.
- Riduce le prestazioni con liste lunghe. Un vault (archivio locale) capiente
  crea queste liste lunghe.

Questa voce richiede lavoro di shell, piuttosto che una decisione. Si sposta
nella
[~~§2.9~~ in coda alla seduta 18](18-editor-e-tastiera.md#29-prestazioni-della-ui)
con le altre code delle sedute chiuse. Il numero si trasferisce intatto.

La decisione [0114](../decisions/0114-una-finestra-non-si-omette.md) chiude la
nona voce. Risolve il problema anticipando il vault (archivio locale). Calcola
il prezzo teorico. Un vault sintetico da seimila note in un banco (ambiente di
test) stima quanto costa un ridisegno. Questo sostituisce l'uso di uno vero.
