# La mappa della Base

La vista Mappa di una [Base](bases.md) (`type: map`, con la chiave `map`).
Il codice è `apps/client/src/editors/base/surface.ts` (`drawMap`).

La vista Mappa mette un segnaposto per ogni riga con le coordinate (`lat_key`,
`lon_key` della chiave `map`) su una griglia del mondo; un clic o Invio su un
segnaposto apre la nota, `+` e `−` (o i tasti) ingrandiscono e le frecce la
spostano. Di serie la mappa è offline e nessuna richiesta esce dal computer.

Le tessere di sfondo arrivano soltanto se la Base dichiara un fornitore
(`provider` con `url_template` https e `network: true`) **e** il suo sito sta
in Impostazioni › Privacy › Tessere delle mappe (`map.tile-hosts`), una scelta
di questo computer che un vault non può dare; OpenStreetMap si aggiunge con un
clic. Allora sotto la mappa c'è «Attiva le mappe online»: è il consenso per
quella vista, e le tessere le scarica l'host. Senza il sito nella lista la
mappa dice «Tessere non ammesse» e offre «Apri le Impostazioni»; una tessera
che non arriva si dice sotto la mappa, e il pulsante resta per riprovare.
Quali tessere l'host accetta: [Le tessere delle
mappe](../reference/map-tiles.md).
