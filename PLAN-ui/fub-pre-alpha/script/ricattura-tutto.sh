#!/bin/bash
# Rifà tutte le catture del simulatore in ../catture-r/, col CSS di oggi
# (blocchi/*.css, senza i temi d'esempio 93-tema-*). Vedi finto/LEGGIMI.md.
#   bash ricattura-tutto.sh <client 0c2a7e91 + cattura.patch + verde.patch> \
#                           <client 5006937c + avvio.patch + verde-avvio.patch>
# Le toppe verdi portano il verde di serie (D25, tinta 160) nel client.
# Le pagine dei piani (p-*) a parte, ricolorate col verde dalla mappa:
#   VERDE=finto/verde-mappa.json node ricattura.mjs <client> cartelle=piani
# s2/lavagna e s2/lavagna-700 non si rifanno: verde-lavagna.mjs ne porta il
# DOM al verde, la foto resta blu (l'eccezione che foto-sim.mjs conosce).
# Poi: DATI=.. RIFATTE=../catture-r/<cartella> node costruisci-sim.mjs ..
# (una cartella per volta), oppure si costruisce da catture/ complete.
set -u
ANTEPRIMA=${1:?manca il client delle catture (0c2a7e91 + cattura.patch + verde.patch)}
AVVIO=${2:?manca il client dell avvio (5006937c + avvio.patch + verde-avvio.patch)}
cd "$(dirname "$0")" || exit 1
export FUB_CLIENT="$ANTEPRIMA"
node ricattura.mjs "$ANTEPRIMA" cartelle=giro4,giro3,giro2,tel,nuove6,nuove5,nuove2,nuove4,nuove3,nuove,s2
echo "== fine anteprima $?"
node ricattura.mjs "$AVVIO" cartelle=avvio
echo "== fine avvio $?"
