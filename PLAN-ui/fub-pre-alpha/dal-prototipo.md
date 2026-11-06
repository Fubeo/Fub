<!-- Generato da PLAN-ui/fub-pre-alpha/script/costruisci-sim.mjs: non si modifica a mano. -->

286 stati: 168 catture, 67 composti, 51 nuovi da approvare. 17 scenari.

#### Gli stati

| S | Stato | Gruppo | Provenienza | Task | Da dove si copia |
|---|---|---|---|---|---|
| S1 | `nota-riposo` | La nota | cattura | S2 T2–T13, main N12 N13 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S2 | `nota` | La nota | cattura | S2 T2, S2 T3, S2 T10 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S3 | `nota-blocchi` | La nota | cattura | main N13, S2 T3 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S4 | `nota-sorgente` | La nota | cattura | main, S2 T3 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S5 | `nota-lettura` | La nota | cattura | main, S2 T3, S2 T11 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S6 | `barra` | La nota | cattura | S2 T16, S2 T17 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S7 | `live-tabella` | La nota | cattura | main, S2 T11 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S8 | `blocchi-menu` | La nota | cattura | main N13, PA (rifiniture di Blocchi) | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S9 | `slash` | La nota | cattura | main N12, S2 T10 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S10 | `slash-filtro` | La nota | cattura | main N12 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S11 | `slash-nessuno` | La nota | cattura | main N12 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S12 | `schede` | La nota | cattura | S2 T6 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S13 | `concentrazione` | La nota | cattura | main, S2 T6 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S14 | `nota-pdf` | La nota | cattura | main, PA (`#page=3`) | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S15 | `icone` | La nota | cattura | S2 T14, S2 T15 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S16 | `icone-emoji` | La nota | cattura | S2 T14, S2 T15 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S17 | `g2-filo-titoli` | La nota | cattura | S2 T5, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S18 | `g2-nota-pdf-senza` | La nota | cattura | main, PA T32 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S19 | `g2-due-riquadri` | I riquadri | cattura | S2 T4, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S20 | `g2-live-lettura` | I riquadri | cattura | S2 T4, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S21 | `g2-trascina` | I riquadri | cattura | S2 T4, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S22 | `g2-menu-riquadro` | I riquadri | cattura | S2 T4, S2 T10 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S23 | `conflitto` | I file, i salvataggi, i conflitti | cattura | main (U59–U60), S2 T5, PA giro della pre-alpha | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S24 | `g2-rinomina` | I file, i salvataggi, i conflitti | cattura | main, S2 T8 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S25 | `g2-titolo-rinomina` | I file, i salvataggi, i conflitti | cattura | main, S2 T5 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S26 | `g2-cestino` | I file, i salvataggi, i conflitti | cattura | main, S2 T8 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S27 | `g2-cestino-vuoto` | I file, i salvataggi, i conflitti | cattura | main, S2 T8 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S28 | `g2-ispettore-3` | I file, i salvataggi, i conflitti | cattura | PA T4, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S29 | `g2-bozza` | I file, i salvataggi, i conflitti | cattura | main, PA T4 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S30 | `g2-bozza-divergente` | I file, i salvataggi, i conflitti | cattura | main, PA T4, PA T5 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S31 | `g2-non-salvata` | I file, i salvataggi, i conflitti | cattura | PA T4 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S32 | `g2-salvataggio-fallito` | I file, i salvataggi, i conflitti | cattura | main, PA T4, S2 T5 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S33 | `g2-conflitto-lettura` | I file, i salvataggi, i conflitti | cattura | PA T5 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S34 | `file-nuovo-tipo` | I file, i salvataggi, i conflitti | nuova, da approvare | PA T43, PA T44 | toppe: panels/explorer.ts (il pulsante #new-note apre il menu), ui/menu.ts |
| S35 | `file-troppo-grande` | I file, i salvataggi, i conflitti | nuova, da approvare | PA T30 | toppe: editors/craft/surface.ts (.craft-empty, azioni per il file troppo grande), skin/media.css |
| S36 | `file-sconosciuto` | I file, i salvataggi, i conflitti | nuova, da approvare | PA T30 | toppe: editors/craft/surface.ts (la stessa vista .craft-empty di craft-rotto, più una riga d'azioni), skin/media.css |
| S37 | `vault-irraggiungibile` | I file, i salvataggi, i conflitti | nuova, da approvare | PA T30, N7 | toppe: apps/client/index.html e src/avvio/*.ts (la schermata d'avvio di N7, già in main: un terzo bottone nel guasto del vault) |
| S38 | `g4-conflitto-confronta` | I file, i salvataggi, i conflitti | cattura | main, PA T5 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S39 | `g4-conflitto-mio` | I file, i salvataggi, i conflitti | cattura | main, PA T5 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S40 | `g4-conflitto-disco` | I file, i salvataggi, i conflitti | cattura | main, PA T5 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S41 | `g4-conflitto-dopo` | I file, i salvataggi, i conflitti | cattura | main, PA T5 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S42 | `foglio` | Il foglio | cattura | K3 T18, S2 T20, griglia T1–T9 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S43 | `foglio-modifica` | Il foglio | cattura | griglia T4, S2 T20 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S44 | `foglio-comandi` | Il foglio | cattura | K3 T12–T15, S2 T20 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S45 | `foglio-comandi-cerca` | Il foglio | cattura | K3 T12–T15 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S46 | `caricamento` | Il foglio | cattura | K3 T15, S2 T20 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S47 | `errore` | Il foglio | cattura | K3 T15, S2 T20 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S48 | `molti` | Il foglio | cattura | K3 T15, S2 T20 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S49 | `g2-foglio-selection` | Il foglio | cattura | griglia T1–T9, S2 T20 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S50 | `g2-foglio-formula` | Il foglio | cattura | griglia T1–T9, K3 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S51 | `g2-foglio-scrive` | Il foglio | cattura | griglia T1–T9 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S52 | `g3-foglio-errore` | Il foglio | cattura | griglia T1–T9, K3 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S53 | `g2-foglio-resize` | Il foglio | cattura | griglia T1–T9 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S54 | `g2-foglio-secondo` | Il foglio | cattura | K3 T18, S2 T20 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S55 | `g2-foglio-ribbon-open` | Il foglio | cattura | K3 T18, S2 T20 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S56 | `g2-foglio-ribbon-palette` | Il foglio | cattura | K3 T18, S2 T20 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S57 | `g2-foglio-ribbon-keytips` | Il foglio | cattura | K3 T18 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S58 | `g2-foglio-ribbon-collapsed` | Il foglio | cattura | K3 T18, S2 T20 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S59 | `g2-foglio-ribbon-table` | Il foglio | cattura | K3 T18 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S60 | `g2-foglio-ribbon-readonly` | Il foglio | cattura | K3 T18 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S61 | `g2-foglio-tab-inserisci` | Il foglio | cattura | K3 T18, S2 T20 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S62 | `g2-foglio-tab-layout` | Il foglio | cattura | K3 T18, S2 T20 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S63 | `g2-foglio-tab-formule` | Il foglio | cattura | K3 T18, S2 T20 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S64 | `g2-foglio-tab-dati` | Il foglio | cattura | K3 T18, S2 T20 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S65 | `g2-foglio-tab-revisione` | Il foglio | cattura | K3 T18, S2 T20 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S66 | `g2-foglio-tab-visualizza` | Il foglio | cattura | K3 T18, S2 T20 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S67 | `g2-foglio-command-form` | Il foglio | cattura | K3 T12, K3 T15 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S68 | `g2-foglio-commands-table` | Il foglio | cattura | K3 T12 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S69 | `g2-foglio-commands-context-off` | Il foglio | cattura | K3 T12 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S70 | `g2-foglio-commands-readonly` | Il foglio | cattura | K3 T12 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S71 | `g2-foglio-result-table` | Il foglio | cattura | K3 T15 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S72 | `g2-foglio-result-empty` | Il foglio | cattura | K3 T15 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S73 | `celle-riposo` | Il foglio | composta, da approvare | griglia T1–T9, PA T27 | piani/celle-griglia.html |
| S74 | `celle-intervallo` | Il foglio | composta, da approvare | griglia T1–T9, PA T27 | piani/celle-griglia.html |
| S75 | `celle-oltre` | Il foglio | composta, da approvare | griglia T1–T9, PA T27 | piani/celle-griglia.html |
| S76 | `celle-editor` | Il foglio | composta, da approvare | griglia T1–T9, PA T27 | piani/celle-griglia.html |
| S77 | `celle-misura` | Il foglio | composta, da approvare | griglia T1–T9, PA T27 | piani/celle-griglia.html |
| S78 | `celle-riempimento` | Il foglio | composta, da approvare | griglia T1–T9, PA T27 | piani/celle-griglia.html |
| S79 | `celle-copiata` | Il foglio | composta, da approvare | griglia T1–T9, PA T27 | piani/celle-griglia.html |
| S80 | `celle-tagliata` | Il foglio | composta, da approvare | griglia T1–T9, PA T27 | piani/celle-griglia.html |
| S81 | `foglio-vuoto` | Il foglio | nuova, da approvare | griglia T1, PA T27 | toppe: editors/grid/surface.ts (.grid-notice, testo nuovo) |
| S82 | `foglio-enorme` | Il foglio | nuova, da approvare | griglia T8, PA T27 | toppe: editors/grid/surface.ts (la stessa .grid-notice di oggi, un testo nuovo in i18n/catalog.ts) |
| S83 | `documento` | Il documento | cattura | S2 T5, S2 T20, S2 T21 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S84 | `documento-oggetti` | Il documento | cattura | main, S2 T21 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S85 | `sola-lettura` | Il documento | cattura | S2 T4, S2 T5, PA sola lettura | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S86 | `g2-doc-tab-inserisci` | Il documento | cattura | S2 T21, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S87 | `g2-doc-tab-disegna` | Il documento | cattura | S2 T21, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S88 | `g2-doc-tab-layout` | Il documento | cattura | S2 T21, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S89 | `g2-doc-tab-revisione` | Il documento | cattura | S2 T21, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S90 | `g2-doc-tab-visualizza` | Il documento | cattura | S2 T21, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S91 | `g3-doc-trova` | Il documento | cattura | S2 T21, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S92 | `g3-doc-chiuse` | Il documento | cattura | main, PA T18 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S93 | `g3-doc-chiuse-pannello` | Il documento | cattura | main, PA T18 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S94 | `g3-doc-oggetti` | Il documento | cattura | S2 T21, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S95 | `g3-doc-odt` | Il documento | cattura | main, PA T18 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S96 | `g2-doc-prestato` | Il documento | cattura | main, K2 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S97 | `disegno` | Il disegno | cattura | S2 T16, S2 T22, K5 T25 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S98 | `disegno-selezione` | Il disegno | cattura | K5, S2 T22 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S99 | `craft` | Il disegno | cattura | main N7, S2 T19 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S100 | `craft-prepara` | Il disegno | cattura | main N7, S2 T19 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S101 | `craft-rotto` | Il disegno | cattura | main N7, S2 T19 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S102 | `g2-disegno-penna` | Il disegno | cattura | S2 T22, K5 T21–T23 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S103 | `g2-disegno-gomma` | Il disegno | cattura | S2 T22, K5 T21–T23 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S104 | `g2-disegno-rettangolo` | Il disegno | cattura | S2 T22, K5 T21–T23 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S105 | `g2-disegno-mano` | Il disegno | cattura | S2 T22 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S106 | `g3-disegno-livelli` | Il disegno | cattura | S2 T22, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S107 | `g3-disegno-tutto` | Il disegno | cattura | S2 T22, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S108 | `g3-disegno-zoom` | Il disegno | cattura | S2 T22, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S109 | `g2-craft-peso` | Il disegno | cattura | main N7, S2 T19 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S110 | `g2-craft-fallita` | Il disegno | cattura | main N7, S2 T19 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S111 | `dis-b-pronto` | Il disegno | composta, da approvare | K5 T21–T23, PA T27 | piani/disegno-motore.html |
| S112 | `dis-b-perse` | Il disegno | composta, da approvare | K5 T21–T23, PA T27 | piani/disegno-motore.html |
| S113 | `dis-b-cinquecento` | Il disegno | composta, da approvare | K5 T21–T23, PA T27 | piani/disegno-motore.html |
| S114 | `dis-b-spento` | Il disegno | composta, da approvare | K5 T21–T23, PA T27 | piani/disegno-motore.html |
| S115 | `dis-b-fermo` | Il disegno | composta, da approvare | K5 T21–T23, PA T27 | piani/disegno-motore.html |
| S116 | `dis-b-senza` | Il disegno | composta, da approvare | K5 T21–T23, PA T27 | piani/disegno-motore.html |
| S117 | `dis-b-rifiutato` | Il disegno | composta, da approvare | K5 T21–T23, PA T27 | piani/disegno-motore.html |
| S118 | `dis-b-si-apre` | Il disegno | composta, da approvare | K5 T21–T23, PA T27 | piani/disegno-motore.html |
| S119 | `dis-b-testo` | Il disegno | composta, da approvare | K5 T21–T23, PA T27 | piani/disegno-motore.html |
| S120 | `dis-b-testo-spento` | Il disegno | composta, da approvare | K5 T21–T23, PA T27 | piani/disegno-motore.html |
| S121 | `dis-b-mano` | Il disegno | composta, da approvare | K5 T21–T23, PA T27 | piani/disegno-motore.html |
| S122 | `dis-b-penna` | Il disegno | composta, da approvare | K5 T21–T23, PA T27 | piani/disegno-motore.html |
| S123 | `dis-b-gomma` | Il disegno | composta, da approvare | K5 T21–T23, PA T27 | piani/disegno-motore.html |
| S124 | `dis-b-rettangolo` | Il disegno | composta, da approvare | K5 T21–T23, PA T27 | piani/disegno-motore.html |
| S125 | `disegno-a-pronto` | Il disegno | nuova, da approvare | K5 T21, K5 T22, K5 T23, S2 T4, PA T27 | toppe: shells/scrittoio/frame/status-band.ts (il bottone #status-standing di S2 T4, anche per il disegno), skin/frame.css; un pezzo di piani/disegno-motore.html (la pagina approvata, cattura p-dis-1) |
| S126 | `disegno-a-perse` | Il disegno | nuova, da approvare | K5 T21, K5 T22, K5 T23, S2 T4, PA T27 | toppe: shells/scrittoio/frame/status-band.ts, skin/frame.css; un pezzo di piani/disegno-motore.html (la pagina approvata, cattura p-dis-1) |
| S127 | `disegno-a-spento` | Il disegno | nuova, da approvare | K5 T21, K5 T22, K5 T23, S2 T4, PA T27 | toppe: shells/scrittoio/frame/status-band.ts, skin/frame.css; un pezzo di piani/disegno-motore.html (la pagina approvata, cattura p-dis-1) |
| S128 | `disegno-a-fermo` | Il disegno | nuova, da approvare | K5 T21, K5 T22, K5 T23, S2 T4, PA T27 | toppe: shells/scrittoio/frame/status-band.ts, skin/frame.css; un pezzo di piani/disegno-motore.html (la pagina approvata, cattura p-dis-1); un pezzo di piani/disegno-motore.html (la pagina approvata, cattura p-dis-4) |
| S129 | `disegno-a-apre` | Il disegno | nuova, da approvare | K5 T21, K5 T22, K5 T23, S2 T4, PA T27 | toppe: shells/scrittoio/frame/status-band.ts, skin/frame.css; un pezzo di piani/disegno-motore.html (la pagina approvata, cattura p-dis-1) |
| S130 | `disegno-a-testo` | Il disegno | nuova, da approvare | K5 T21, K5 T22, PA T27 | un pezzo di piani/disegno-motore.html (la pagina approvata, cattura p-dis-1); un pezzo di piani/disegno-motore.html (la pagina approvata, cattura p-dis-7a) |
| S131 | `disegno-vuoto` | Il disegno | nuova, da approvare | K5 T21, PA T27 | toppe: editors/craft/surface.ts (il foglio vuoto, testo nuovo in i18n/catalog.ts); un pezzo di piani/disegno-motore.html (la pagina approvata, cattura p-dis-1) |
| S132 | `lavagna` | La lavagna | cattura | N6, N4, S2 T23, lavagna in codice | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S133 | `lav-schede` | La lavagna | composta, da approvare | N6 T25, PA T28 | piani/lavagna-schede.html |
| S134 | `lav-schede-vive` | La lavagna | composta, da approvare | N6 T25, PA T28 | piani/lavagna-schede.html |
| S135 | `lav-una-scelta` | La lavagna | composta, da approvare | N6 T25, PA T28 | piani/lavagna-schede.html |
| S136 | `lav-attive` | La lavagna | composta, da approvare | N6 T25, PA T28 | piani/lavagna-schede.html |
| S137 | `lav-testate` | La lavagna | composta, da approvare | N6 T25, PA T28 | piani/lavagna-schede.html |
| S138 | `lav-inchiostro` | La lavagna | composta, da approvare | N6 T25, PA T28 | piani/lavagna-schede.html |
| S139 | `lav-filo` | La lavagna | composta, da approvare | N6 T25, PA T28 | piani/lavagna-schede.html |
| S140 | `lav-mancante` | La lavagna | composta, da approvare | N6 T25, PA T28 | piani/lavagna-schede.html |
| S141 | `lav-rilascio3` | La lavagna | composta, da approvare | N6 T25, PA T28 | piani/lavagna-schede.html |
| S142 | `lav-rilascio47` | La lavagna | composta, da approvare | N6 T25, PA T28 | piani/lavagna-schede.html |
| S143 | `lav-colori` | La lavagna | composta, da approvare | N6 T25, PA T28 | piani/lavagna-schede.html |
| S144 | `lav-notifiche` | La lavagna | composta, da approvare | N6 T25, PA T28 | piani/lavagna-schede.html |
| S145 | `lav-lontano` | La lavagna | composta, da approvare | N6 T25, PA T28 | piani/lavagna-schede.html |
| S146 | `lav-lontanissimo` | La lavagna | composta, da approvare | N6 T25, PA T28 | piani/lavagna-schede.html |
| S147 | `lav-cinquecento` | La lavagna | composta, da approvare | N6 T25, PA T28 | piani/lavagna-schede.html |
| S148 | `pen-chiuso` | La lavagna | composta, da approvare | N4 T20, N4 T21, PA T28 | piani/lavagna-penne.html |
| S149 | `pen-penna` | La lavagna | composta, da approvare | N4 T20, N4 T21, PA T28 | piani/lavagna-penne.html |
| S150 | `pen-evidenziatore` | La lavagna | composta, da approvare | N4 T20, N4 T21, PA T28 | piani/lavagna-penne.html |
| S151 | `pen-gomma` | La lavagna | composta, da approvare | N4 T20, N4 T21, PA T28 | piani/lavagna-penne.html |
| S152 | `pen-mia` | La lavagna | composta, da approvare | N4 T20, N4 T21, PA T28 | piani/lavagna-penne.html |
| S153 | `pen-mouse` | La lavagna | composta, da approvare | N4 T20, N4 T21, PA T28 | piani/lavagna-penne.html |
| S154 | `pen-sola-lettura` | La lavagna | composta, da approvare | N4 T20, N4 T21, PA T28 | piani/lavagna-penne.html |
| S155 | `lav-impianto` | La lavagna | nuova, da approvare | N6 T26, N6 T27, N6 T28, PA T28 | toppe: editors/canvas/chrome/rail.ts (nuovo, su kit/tool-rail.ts come il disegno); toppe: editors/canvas/chrome/options.ts (nuovo, su kit/options-bar.ts); piani/lavagna-schede.html |
| S156 | `lav-vuota` | La lavagna | nuova, da approvare | N6 T26, N6 T27, N6 T28, PA T28 | toppe: editors/canvas/chrome/rail.ts (nuovo, su kit/tool-rail.ts come il disegno); toppe: editors/canvas/chrome/options.ts (nuovo, su kit/options-bar.ts); toppe: editors/canvas/chrome/empty.ts (nuovo) |
| S157 | `lav-sel-una` | La lavagna | nuova, da approvare | N6 T26, N6 T27, N6 T28, PA T28 | toppe: editors/canvas/chrome/rail.ts (nuovo, su kit/tool-rail.ts come il disegno); toppe: editors/canvas/chrome/options.ts (nuovo, su kit/options-bar.ts); toppe: editors/canvas/chrome/selection.ts (nuovo, sul posto di panels/selection-bubble.ts); piani/lavagna-schede.html |
| S158 | `lav-sel-molte` | La lavagna | nuova, da approvare | N6 T26, N6 T27, N6 T28, PA T28 | toppe: editors/canvas/chrome/rail.ts (nuovo, su kit/tool-rail.ts come il disegno); toppe: editors/canvas/chrome/options.ts (nuovo, su kit/options-bar.ts); toppe: editors/canvas/chrome/selection.ts (nuovo); piani/lavagna-schede.html |
| S159 | `lav-scrive` | La lavagna | nuova, da approvare | N6 T26, N6 T27, N6 T28, PA T28, N6 T27 | toppe: editors/canvas/chrome/rail.ts (nuovo, su kit/tool-rail.ts come il disegno); toppe: editors/canvas/chrome/options.ts (la barra di formato di panels/format-bar.ts dentro la riga); piani/lavagna-schede.html |
| S160 | `lav-scrive-slash` | La lavagna | nuova, da approvare | N6 T26, N6 T27, N6 T28, PA T28 | toppe: editors/canvas/chrome/rail.ts (nuovo, su kit/tool-rail.ts come il disegno); toppe: editors/canvas/chrome/options.ts (la barra di formato di panels/format-bar.ts dentro la riga); un pezzo della cattura slash (il DOM del client delle catture, spostato); piani/lavagna-schede.html |
| S161 | `lav-filo-nuovo` | La lavagna | nuova, da approvare | N6 T26, N6 T27, N6 T28, PA T28 | toppe: editors/canvas/chrome/rail.ts (nuovo, su kit/tool-rail.ts come il disegno); toppe: editors/canvas/chrome/options.ts (nuovo, su kit/options-bar.ts); piani/lavagna-schede.html |
| S162 | `lav-penna` | La lavagna | nuova, da approvare | N6 T26, N6 T27, N6 T28, PA T28 | toppe: editors/canvas/chrome/rail.ts (nuovo, su kit/tool-rail.ts come il disegno); piani/lavagna-schede.html |
| S163 | `lav-evidenziatore` | La lavagna | nuova, da approvare | N6 T26, N6 T27, N6 T28, PA T28 | toppe: editors/canvas/chrome/rail.ts (nuovo, su kit/tool-rail.ts come il disegno); piani/lavagna-schede.html |
| S164 | `lav-gomma` | La lavagna | nuova, da approvare | N6 T26, N6 T27, N6 T28, PA T28 | toppe: editors/canvas/chrome/rail.ts (nuovo, su kit/tool-rail.ts come il disegno); piani/lavagna-schede.html |
| S165 | `lav-lazo` | La lavagna | nuova, da approvare | N6 T26, N6 T27, N6 T28, PA T28 | toppe: editors/canvas/chrome/rail.ts (nuovo, su kit/tool-rail.ts come il disegno); toppe: editors/canvas/chrome/options.ts (nuovo, su kit/options-bar.ts); toppe: editors/canvas/tools/lasso.ts (nuovo, N6 T86 con D-22 a); piani/lavagna-schede.html |
| S166 | `lav-estratti` | La lavagna | nuova, da approvare | N6 T26, N6 T27, N6 T28, PA T28, N6 T28 | toppe: editors/canvas/chrome/rail.ts (nuovo, su kit/tool-rail.ts come il disegno); toppe: editors/canvas/chrome/options.ts (nuovo, su kit/options-bar.ts); toppe: editors/canvas/parts-picker.ts (nuovo, su kit/popover.ts e kit/list.ts); piani/lavagna-schede.html |
| S167 | `lav-codice-menu` | La lavagna | nuova, da approvare | lavagna in codice, PA T28 | toppe: editors/canvas/chrome/rail.ts (nuovo, su kit/tool-rail.ts come il disegno); toppe: editors/canvas/chrome/options.ts (nuovo, su kit/options-bar.ts); toppe: editors/canvas/chrome/commands.ts ed engine.ts (il menu contestuale, ui/menu.ts); toppe: editors/canvas/chrome/commands.ts (canvas.layout.grid, .row, .column, .tree); piani/lavagna-schede.html |
| S168 | `lav-codice-riepilogo` | La lavagna | nuova, da approvare | lavagna in codice, PA T28 | toppe: editors/canvas/chrome/rail.ts (nuovo, su kit/tool-rail.ts come il disegno); toppe: editors/canvas/chrome/options.ts (nuovo, su kit/options-bar.ts); toppe: editors/canvas/chrome/commands.ts (canvas.paste_code con kit/dialog.ts); piani/lavagna-schede.html |
| S169 | `lav-codice-problema` | La lavagna | nuova, da approvare | lavagna in codice, PA T28 | toppe: editors/canvas/chrome/rail.ts (nuovo, su kit/tool-rail.ts come il disegno); toppe: editors/canvas/chrome/options.ts (nuovo, su kit/options-bar.ts); toppe: editors/canvas/chrome/commands.ts (canvas.check: niente si scrive); piani/lavagna-schede.html |
| S170 | `pdf` | PDF e foto | cattura | S2 T18 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S171 | `foto` | PDF e foto | cattura | main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S172 | `g2-pdf-cerca` | PDF e foto | cattura | main, S2 T18 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S173 | `g2-pdf-nessuno` | PDF e foto | cattura | main, S2 T18 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S174 | `g2-pdf-miniature` | PDF e foto | cattura | main, S2 T18 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S175 | `g2-pdf-due` | PDF e foto | cattura | main, S2 T18 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S176 | `g2-pdf-scuro` | PDF e foto | cattura | main, S2 T18 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S177 | `g3-pdf-rotto` | PDF e foto | cattura | main, S2 T18 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S178 | `g2-foto-senza` | PDF e foto | cattura | main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S179 | `g2-raw-girato` | PDF e foto | cattura | main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S180 | `g2-raw-senza` | PDF e foto | cattura | main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S181 | `pdf-pagina3` | PDF e foto | nuova, da approvare | PA T32 | catture del client, ritoccate nel testo o nelle righe; CSS dai blocchi |
| S182 | `craft-spente` | Componenti e ricette | cattura | main N7, K2, S2 T19 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S183 | `componenti` | Componenti e ricette | cattura | K2 T1–T7, S2 T10 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S184 | `nuovo-vault` | Componenti e ricette | cattura | K2 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S185 | `g2-comp-spegni` | Componenti e ricette | cattura | K2 T1–T7 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S186 | `g2-comp-orfani` | Componenti e ricette | cattura | K2 T1–T7 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S187 | `g2-comp-cerca` | Componenti e ricette | cattura | K2 T1–T7 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S188 | `dis-comp-acceso` | Componenti e ricette | composta, da approvare | K5 T23, K2 T1–T7 | piani/disegno-motore.html |
| S189 | `dis-comp-spento` | Componenti e ricette | composta, da approvare | K5 T23, K2 T1–T7 | piani/disegno-motore.html |
| S190 | `dis-comp-accendi` | Componenti e ricette | composta, da approvare | K5 T23, K2 T1–T7 | piani/disegno-motore.html |
| S191 | `ricette` | Componenti e ricette | composta, da approvare | A1 T12, PA T29 | piani/ricette.html |
| S192 | `ricette-vuote` | Componenti e ricette | composta, da approvare | A1 T12, PA T29 | piani/ricette.html |
| S193 | `ricette-problemi` | Componenti e ricette | composta, da approvare | A1 T12, PA T29 | piani/ricette.html |
| S194 | `ricette-carica` | Componenti e ricette | composta, da approvare | A1 T12, PA T29 | piani/ricette.html |
| S195 | `ricette-errore` | Componenti e ricette | composta, da approvare | A1 T12, PA T29 | piani/ricette.html |
| S196 | `ricette-cinquecento` | Componenti e ricette | composta, da approvare | A1 T12, PA T29 | piani/ricette.html |
| S197 | `ricetta-dialogo` | Componenti e ricette | composta, da approvare | A1 T12, PA T29 | piani/ricette.html |
| S198 | `ricetta-prova` | Componenti e ricette | composta, da approvare | A1 T12, PA T29 | piani/ricette.html |
| S199 | `ricetta-prova-errore` | Componenti e ricette | composta, da approvare | A1 T12, PA T29 | piani/ricette.html |
| S200 | `ricetta-nessuna-nota` | Componenti e ricette | composta, da approvare | A1 T12, PA T29 | piani/ricette.html |
| S201 | `ricetta-venti` | Componenti e ricette | composta, da approvare | A1 T12, PA T29 | piani/ricette.html |
| S202 | `ricetta-cambiata` | Componenti e ricette | composta, da approvare | A1 T12, PA T29 | piani/ricette.html |
| S203 | `ricetta-fatta` | Componenti e ricette | composta, da approvare | A1 T12, PA T29 | piani/ricette.html |
| S204 | `comp-installato` | Componenti e ricette | nuova, da approvare | K1, K2 T3, PA T29 | toppe: panels/settings.ts (la sezione «Installati su questa macchina», con la scheda di panels/components-page.ts) |
| S205 | `comp-permesso` | Componenti e ricette | nuova, da approvare | K1, K2 T3, PA T29 | toppe: panels/settings.ts (dopo «Scegli file…», kit/dialog.ts) |
| S206 | `comp-rotto-tempo` | Componenti e ricette | nuova, da approvare | K1, K2 T3, PA T29 | toppe: panels/settings.ts e panels/components-page.ts (lo stato del componente, fub-wasm-host: timeout) |
| S207 | `comp-rotto-errore` | Componenti e ricette | nuova, da approvare | K1, K2 T3, PA T29 | toppe: panels/settings.ts e panels/components-page.ts (fub-wasm-host: trap) |
| S208 | `comp-aggiorna` | Componenti e ricette | nuova, da approvare | dopo la pre-alpha | toppe: panels/settings.ts (nessun piano lo copre: «Differenze fra piani e codice») |
| S209 | `ricerca` | La cornice | cattura | S2 T8 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S210 | `grafo` | La cornice | cattura | S2 T10 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S211 | `palette` | La cornice | cattura | main, S2 T10 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S212 | `palette-file` | La cornice | cattura | main, S2 T10 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S213 | `zero` | La cornice | cattura | S2 T10 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S214 | `salvataggio` | La cornice | cattura | main, S2 T5 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S215 | `avvisi` | La cornice | cattura | main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S216 | `toast` | La cornice | cattura | main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S217 | `conferma` | La cornice | cattura | main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S218 | `g2-menu` | La cornice | cattura | S2 T7, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S219 | `g2-vault` | La cornice | cattura | S2 T7, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S220 | `g2-attivita` | La cornice | cattura | S2 T7, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S221 | `g2-ispettore-0` | La cornice | cattura | S2 T9, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S222 | `g2-ispettore-1` | La cornice | cattura | S2 T9, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S223 | `g2-ispettore-2` | La cornice | cattura | S2 T9, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S224 | `g2-ispettore-chiuso` | La cornice | cattura | S2 T9, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S225 | `g2-compatta` | La cornice | cattura | S2 T14, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S226 | `g2-stretta` | La cornice | cattura | S2 T14 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S227 | `g2-stretta-cassetto` | La cornice | cattura | S2 T14 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S228 | `g2-lanciatore-anteprima` | La cornice | cattura | S2 T10, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S229 | `g2-lanciatore-cerca` | La cornice | cattura | S2 T10, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S230 | `g2-lanciatore-comandi` | La cornice | cattura | S2 T10, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S231 | `g2-conferma` | La cornice | cattura | S2 T16, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S232 | `mcp-riflesso` | La cornice | nuova, da approvare | N2, PA T26 | toppe: panels/activity.ts (una riga per le scritture di fub-mcp, N2 T9) |
| S233 | `impostazioni` | Le impostazioni | cattura | S2 T10 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S234 | `aspetto` | Le impostazioni | cattura | main, S2 T10 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S235 | `impostazioni-vault` | Le impostazioni | cattura | main, S2 T10 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S236 | `g2-imp-editor` | Le impostazioni | cattura | main, S2 T10 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S237 | `g2-imp-diagnostica` | Le impostazioni | cattura | main, S2 T10 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S238 | `g2-imp-profili` | Le impostazioni | cattura | K2, S2 T10 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S239 | `g2-imp-tasti` | Le impostazioni | cattura | main, S2 T10 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S240 | `g2-imp-vault` | Le impostazioni | cattura | main, S2 T10 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S241 | `g2-imp-info` | Le impostazioni | cattura | main, PA T22 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S242 | `g2-tema` | Le impostazioni | cattura | S2 T10, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S243 | `g2-app-esterne` | Le impostazioni | cattura | main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S244 | `lav-impostazioni` | Le impostazioni | composta, da approvare | N6 T25, PA T28 | piani/lavagna-schede.html |
| S245 | `pen-impostazioni` | Le impostazioni | composta, da approvare | N4 T20, PA T28 | piani/lavagna-penne.html |
| S246 | `imp-info-prealpha` | Le impostazioni | composta, da approvare | PA T22 | catture del client, ritoccate nel testo o nelle righe; CSS dai blocchi |
| S247 | `vuoto` | Casi ai margini | cattura | S2 T7 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S248 | `avvio-attesa` | Casi ai margini | cattura | main #308 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S249 | `avvio-lento` | Casi ai margini | cattura | main #308 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S250 | `avvio-guasto` | Casi ai margini | cattura | main #308 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S251 | `dati-uno` | Casi ai margini | composta, da approvare | main | catture del client, ritoccate nel testo o nelle righe; CSS dai blocchi |
| S252 | `dati-nome-lungo` | Casi ai margini | composta, da approvare | main | catture del client, ritoccate nel testo o nelle righe; CSS dai blocchi |
| S253 | `dati-cinquemila` | Casi ai margini | composta, da approvare | PA T45 | catture del client, ritoccate nel testo o nelle righe; CSS dai blocchi |
| S254 | `riscontri-a` | I riscontri | composta, da approvare | PA T18 | catture del client, ritoccate nel testo o nelle righe; CSS dai blocchi |
| S255 | `riscontri-b-menu` | I riscontri | nuova, da approvare | PA T18, D9 B | toppe: ui/app-menu.ts (una voce prima di «Impostazioni»), i18n/catalog.ts |
| S256 | `riscontri-b-apre` | I riscontri | nuova, da approvare | PA T18, D9 B | toppe: ui/app-menu.ts (kit/dialog.ts, poi l'apertura del browser che c'è) |
| S257 | `tel-nota` | Il telefono (Android di prova) | cattura | S2 T2–T7, PA telefono | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S258 | `tel-ferma` | Il telefono (Android di prova) | cattura | S2 T3, PA telefono | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S259 | `tel-tastiera` | Il telefono (Android di prova) | cattura | S2 T17, PA telefono | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S260 | `tel-sdraiato` | Il telefono (Android di prova) | cattura | S2 T3, S2 T7, PA telefono | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S261 | `tel-doc` | Il telefono (Android di prova) | cattura | S2 T21, PA telefono | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S262 | `tel-foglio` | Il telefono (Android di prova) | cattura | S2 T20, PA telefono | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S263 | `tel-cassetto` | Il telefono (Android di prova) | cattura | main, PA telefono | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S264 | `tel-ispettore` | Il telefono (Android di prova) | cattura | main, PA telefono | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S265 | `tel-lanciatore` | Il telefono (Android di prova) | cattura | main, PA telefono | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S266 | `tel-avvio` | Il telefono (Android di prova) | cattura | main, PA telefono | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S267 | `tel-avvio-attesa` | Il telefono (Android di prova) | cattura | main #308 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S268 | `g2-tel-doc-pannello` | Il telefono (Android di prova) | cattura | S2 T21, PA telefono | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S269 | `g2-tel-foglio-aperto` | Il telefono (Android di prova) | cattura | S2 T20, PA telefono | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S270 | `t-cassetto-file` | Il telefono (Android di prova) | cattura | main, PA telefono | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S271 | `t-foglio-risultato` | Il telefono (Android di prova) | cattura | K3 T15, PA telefono | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S286 | `t-foglio-errore` | Il telefono (Android di prova) | cattura | K3 T15, PA telefono | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S272 | `tema-sviluppo` | I temi e la skin facile | nuova, da approvare | PA T36, PA T37 | toppe: panels/settings.ts (renderThemeCatalog: due bottoni in più quando developer.mode è acceso), i18n/catalog.ts; toppe: crates/fub-host/src/settings.rs (la chiave developer.mode, gruppo «Sviluppo»), panels/settings.ts la rende come le altre |
| S273 | `tema-installa` | I temi e la skin facile | nuova, da approvare | PA T36, PA T37 | toppe: panels/settings.ts (renderThemeCatalog: due bottoni in più quando developer.mode è acceso), i18n/catalog.ts; toppe: crates/fub-host/src/settings.rs (la chiave developer.mode, gruppo «Sviluppo»), panels/settings.ts la rende come le altre; un pezzo della cattura palette-file (il DOM del client delle catture, spostato) |
| S274 | `tema-sostituisci` | I temi e la skin facile | nuova, da approvare | PA T36 | toppe: panels/settings.ts (renderThemeCatalog: due bottoni in più quando developer.mode è acceso), i18n/catalog.ts; toppe: panels/settings.ts (kit/dialog.ts, prima di uninstall_theme e install_theme), i18n/catalog.ts |
| S275 | `tema-sostituisci-fallito` | I temi e la skin facile | nuova, da approvare | PA T36 | toppe: panels/settings.ts (renderThemeCatalog: due bottoni in più quando developer.mode è acceso), i18n/catalog.ts; toppe: panels/settings.ts (kit/dialog.ts, l'esito d'errore di T36) |
| S276 | `tema-rifiutato` | I temi e la skin facile | nuova, da approvare | PA T36 | toppe: panels/settings.ts (renderThemeCatalog: due bottoni in più quando developer.mode è acceso), i18n/catalog.ts; toppe: panels/settings.ts (i motivi di theme/loader.ts validateThemeBundle divisi in campi, non riscritti), skin/settings.css |
| S277 | `tema-collegato` | I temi e la skin facile | nuova, da approvare | PA T37 | toppe: panels/settings.ts (sotto «Temi installati», con la chiave developer.theme-folder), theme/theme.ts rimonta a fub://theme-changed; toppe: crates/fub-host/src/settings.rs (la chiave developer.mode, gruppo «Sviluppo»), panels/settings.ts la rende come le altre |
| S278 | `tema-anteprima` | I temi e la skin facile | nuova, da approvare | PA T37, PA T38 | toppe: panels/settings.ts (renderThemeCatalog: due bottoni in più quando developer.mode è acceso), i18n/catalog.ts; theme/examples/carta/ (fogli e skin.css) |
| S279 | `tema-tutti-componenti` | I temi e la skin facile | nuova, da approvare | PA T38, PA T39 | toppe: src/dev/catalogo/ (nuovo: il cuore di bench/catalog.ts e bench/kit.ts, caricato con import()), una vista aperta da Aspetto, skin/settings.css |
| S280 | `tema-tutti-tavolozza` | I temi e la skin facile | nuova, da approvare | PA T38, PA T39 | toppe: src/dev/catalogo/ (nuovo: il cuore di bench/catalog.ts e bench/kit.ts, caricato con import()), una vista aperta da Aspetto, skin/settings.css; toppe: src/dev/catalogo/ (la tavolozza di bench/catalog.ts), skin/settings.css |
| S281 | `tema-tutti-caratteri` | I temi e la skin facile | nuova, da approvare | PA T38, PA T39 | toppe: src/dev/catalogo/ (nuovo: il cuore di bench/catalog.ts e bench/kit.ts, caricato con import()), una vista aperta da Aspetto, skin/settings.css; toppe: src/dev/catalogo/ (il campionario di bench/samples.ts), skin/settings.css |
| S282 | `tema-carta` | I temi e la skin facile | nuova, da approvare | PA T42 | theme/examples/carta/ (fogli e skin.css) |
| S283 | `tema-carta-impostazioni` | I temi e la skin facile | nuova, da approvare | PA T42 | theme/examples/carta/ (fogli e skin.css) |
| S284 | `tema-salvia` | I temi e la skin facile | nuova, da approvare | PA T42 | theme/examples/salvia/ (i due fogli) |
| S285 | `tema-salvia-impostazioni` | I temi e la skin facile | nuova, da approvare | PA T42 | theme/examples/salvia/ (i due fogli) |

#### Gli scenari

| Scenario | Che cosa fa la persona | Passi | Gli stati, in ordine |
|---|---|---|---|
| `primo-avvio` | Il primo avvio | 5 | S248 → S249 → S247 → S184 → S1 |
| `scrivere` | Scrivere una nota | 6 | S1 → S9 → S10 → S6 → S214 → S5 |
| `riquadri` | Due riquadri | 4 | S21 → S19 → S20 → S22 |
| `foglio` | Un foglio di calcolo | 8 | S42 → S49 → S78 → S50 → S52 → S64 → S44 → S71 |
| `disegno` | Un disegno | 6 | S102 → S130 → S106 → S126 → S128 → S115 |
| `lavagna` | Una lavagna | 12 | S156 → S155 → S157 → S158 → S160 → S161 → S162 → S165 → S166 → S167 → S168 → S147 |
| `conflitto` | Un conflitto | 5 | S23 → S38 → S39 → S41 → S33 |
| `r01-versione` | Una bozza ritrovata e una versione | 4 | S29 → S30 → S28 → S31 |
| `cestino` | Il cestino | 3 | S26 → S217 → S27 |
| `componente` | Un componente | 7 | S183 → S205 → S204 → S206 → S207 → S208 → S185 |
| `ricetta` | Una ricetta (A1) | 5 | S191 → S197 → S198 → S199 → S203 |
| `vault` | Cambiare vault | 3 | S219 → S235 → S37 |
| `aspetto` | L'aspetto | 6 | S234 → S234 → S234 → S1 → S1 → S282 |
| `tastiera` | Solo con la tastiera | 5 | S212 → S230 → S2 → S8 → S239 |
| `errori` | Quando qualcosa va storto | 6 | S32 → S177 → S36 → S35 → S47 → S250 |
| `telefono` | Al telefono | 9 | S266 → S257 → S259 → S263 → S270 → S261 → S269 → S286 → S157 |
| `skin` | Una skin facile | 6 | S272 → S273 → S276 → S277 → S279 → S284 |

#### I pezzi nuovi (DOM scritto a mano, `toppe/*.html`)

| Modello | Che cos'è | Destinazione | Task | Stati |
|---|---|---|---|---|
| `comp-installato` | Un componente della comunità installato | panels/settings.ts (la sezione «Installati su questa macchina», con la scheda di panels/components-page.ts) | K1, K2 T3, PA T29 | S204 |
| `comp-permesso` | Installare un componente: la richiesta dei permessi | panels/settings.ts (dopo «Scegli file…», kit/dialog.ts) | K1, K2 T3, PA T29 | S205 |
| `comp-fermo-tempo` | Un componente fermato: ha superato il tempo | panels/settings.ts e panels/components-page.ts (lo stato del componente, fub-wasm-host: timeout) | K1, PA T29 | S206 |
| `comp-fermo-errore` | Un componente fermato: un errore interno | panels/settings.ts e panels/components-page.ts (fub-wasm-host: trap) | K1, PA T29 | S207 |
| `comp-aggiorna` | Un componente con una versione nuova (fuori dalla pre-alpha) | panels/settings.ts (nessun piano lo copre: «Differenze fra piani e codice») | fuori dalla pre-alpha | S208 |
| `banda-motore-pronto` | D5 A: il motore del disegno nella banda (pronto) | shells/scrittoio/frame/status-band.ts (il bottone #status-standing di S2 T4, anche per il disegno), skin/frame.css | D5 A: K5 T21–T23 con S2 T4 | S125 |
| `banda-motore-perse` | D5 A: 3 parti restano come sono, nella banda | shells/scrittoio/frame/status-band.ts, skin/frame.css | D5 A: K5 T21–T23 con S2 T4 | S126 |
| `banda-motore-spento` | D5 A: motore spento, nella banda | shells/scrittoio/frame/status-band.ts, skin/frame.css | D5 A: K5 T21–T23 con S2 T4 | S127 |
| `banda-motore-fermo` | D5 A: motore fermo, nella banda (aperto) | shells/scrittoio/frame/status-band.ts, skin/frame.css | D5 A: K5 T21–T23 con S2 T4 | S128 |
| `banda-motore-apre` | D5 A: il disegno si sta aprendo, nella banda | shells/scrittoio/frame/status-band.ts, skin/frame.css | D5 A: K5 T21–T23 con S2 T4 (K5 non ha un segno per «si apre»: Differenze) | S129 |
| `disegno-vuoto` | Un disegno vuoto: l'invito | editors/craft/surface.ts (il foglio vuoto, testo nuovo in i18n/catalog.ts) | K5 T21, PA T27 | S131 |
| `menu-nuovo` | «Nuovo»: la scelta del tipo | panels/explorer.ts (il pulsante #new-note apre il menu), ui/menu.ts | PA T43 | S34 |
| `altra-app` | «Apri con un'altra app» sotto un file che Fub non apre | editors/craft/surface.ts (la stessa vista .craft-empty di craft-rotto, più una riga d'azioni), skin/media.css | PA T30 | S36 |
| `altra-app-grande` | «Apri il sorgente» sotto un file troppo grande | editors/craft/surface.ts (.craft-empty, azioni per il file troppo grande), skin/media.css | PA T30 | S35 |
| `vault-scegli` | «Scegli un altro vault…» nell'avvio guasto | apps/client/index.html e src/avvio/*.ts (la schermata d'avvio di N7, già in main: un terzo bottone nel guasto del vault) | PA T30 | S37 |
| `foglio-enorme` | Un foglio enorme: l'avviso della lettura a pezzi | editors/grid/surface.ts (la stessa .grid-notice di oggi, un testo nuovo in i18n/catalog.ts) | griglia T8, PA T27 | S82 |
| `foglio-vuoto` | Un foglio vuoto: l'invito a scrivere | editors/grid/surface.ts (.grid-notice, testo nuovo) | griglia T1, PA T27 | S81 |
| `lav-colonna` | La colonna degli strumenti della lavagna (8 strumenti) | editors/canvas/chrome/rail.ts (nuovo, su kit/tool-rail.ts come il disegno) | N6 T26 e T49, PA T28 | S155, S156, S157, S158, S159, S160, S161, S162, S163, S164, S165, S166, S167, S168, S169 |
| `lav-opzioni` | La riga delle opzioni della lavagna (Selezione, niente scelto) | editors/canvas/chrome/options.ts (nuovo, su kit/options-bar.ts) | N6 T26 e T50, PA T28 | S155, S156, S157, S158, S161, S165, S166, S167, S168, S169 |
| `lav-opzioni-scrive` | La riga delle opzioni mentre si scrive in una scheda: la barra di formato | editors/canvas/chrome/options.ts (la barra di formato di panels/format-bar.ts dentro la riga) | N6 T27 e T41, PA T28 | S159, S160 |
| `lav-bolla-una` | La barra della selezione sopra una scheda | editors/canvas/chrome/selection.ts (nuovo, sul posto di panels/selection-bubble.ts) | N6 T26 e T51, PA T28 | S157 |
| `lav-bolla-molte` | La barra della selezione sopra molte schede | editors/canvas/chrome/selection.ts (nuovo) | N6 T26 e T51, PA T28 | S158 |
| `lav-vuota` | La lavagna vuota che spiega da sé | editors/canvas/chrome/empty.ts (nuovo) | N6 T26 e T62, PA T28 | S156 |
| `lav-lazo` | Il lazo che prende schede e tratti | editors/canvas/tools/lasso.ts (nuovo, N6 T86 con D-22 a) | PA T28 | S165 |
| `lav-estratti` | Il selettore delle parti attaccato alla scheda rilasciata (PDF) | editors/canvas/parts-picker.ts (nuovo, su kit/popover.ts e kit/list.ts) | N6 T28 e T74–T76, PA T28 | S166 |
| `lav-codice-menu` | Le tre voci della lavagna in codice nel menu della scheda | editors/canvas/chrome/commands.ts ed engine.ts (il menu contestuale, ui/menu.ts) | lavagna in codice T25, PA T28 | S167 |
| `lav-codice-disponi` | «Disponi»: il sottomenu | editors/canvas/chrome/commands.ts (canvas.layout.grid, .row, .column, .tree) | lavagna in codice T25, PA T28 | S167 |
| `lav-codice-riepilogo` | «Incolla codice»: il riassunto prima di scrivere | editors/canvas/chrome/commands.ts (canvas.paste_code con kit/dialog.ts) | lavagna in codice T25, PA T28 | S168 |
| `lav-codice-problema` | «Incolla codice» con un problema: il primo, col suggerimento | editors/canvas/chrome/commands.ts (canvas.check: niente si scrive) | lavagna in codice T25, PA T28 | S169 |
| `mcp-riga` | N2: ciò che ha fatto un agente (MCP), nel centro attività | panels/activity.ts (una riga per le scritture di fub-mcp, N2 T9) | PA T26 | S232 |
| `riscontri-voce` | D9 B: «Segnala un problema…» nel menu dell'applicazione | ui/app-menu.ts (una voce prima di «Impostazioni»), i18n/catalog.ts | D9 B: un task M in più dopo PA T18 | S255 |
| `riscontri-apre` | D9 B: che cosa si apre e che cosa si manda | ui/app-menu.ts (kit/dialog.ts, poi l'apertura del browser che c'è) | D9 B | S256 |
| `tema-sviluppo` | Il gruppo «Sviluppo» con la modalità sviluppatore | crates/fub-host/src/settings.rs (la chiave developer.mode, gruppo «Sviluppo»), panels/settings.ts la rende come le altre | PA T36 | S272, S273, S277 |
| `tema-catalogo` | «Temi installati» in modalità sviluppatore | panels/settings.ts (renderThemeCatalog: due bottoni in più quando developer.mode è acceso), i18n/catalog.ts | PA T36 e T37 | S272, S273, S274, S275, S276, S278 |
| `tema-collegato` | Il tema collegato, in sviluppo | panels/settings.ts (sotto «Temi installati», con la chiave developer.theme-folder), theme/theme.ts rimonta a fub://theme-changed | PA T37 | S277 |
| `tema-diagnosi` | Perché un tema è rifiutato: la diagnosi | panels/settings.ts (i motivi di theme/loader.ts validateThemeBundle divisi in campi, non riscritti), skin/settings.css | PA T36 e T37 | S276 |
| `tema-sostituisci` | Un tema con lo stesso id: «Sostituisci» | panels/settings.ts (kit/dialog.ts, prima di uninstall_theme e install_theme), i18n/catalog.ts | PA T36 | S274 |
| `tema-sostituisci-fallito` | La sostituzione fallita a metà | panels/settings.ts (kit/dialog.ts, l'esito d'errore di T36) | PA T36 | S275 |
| `tutti-componenti` | La pagina «Tutti i componenti»: i componenti negli stati del contratto | src/dev/catalogo/ (nuovo: il cuore di bench/catalog.ts e bench/kit.ts, caricato con import()), una vista aperta da Aspetto, skin/settings.css | PA T38 | S279, S280, S281 |
| `tutti-tavolozza` | «Tutti i componenti»: la tavolozza | src/dev/catalogo/ (la tavolozza di bench/catalog.ts), skin/settings.css | PA T38 | S280 |
| `tutti-caratteri` | «Tutti i componenti»: i caratteri | src/dev/catalogo/ (il campionario di bench/samples.ts), skin/settings.css | PA T38 e T39 | S281 |

#### Il CSS nuovo

| File | Posto | Blocchi | Task | Peso |
|---|---|---|---|---|
| `theme/scrittoio/structure.css` | struttura | `00-structure.css`, `70-kit-struttura.css`, `70f-kit-fila-struttura.css` | S2 T3, T4, T9, T16, T20, T21, T27 | 13 KB |
| `theme/scrittoio/skin/kit.css` | pelle | `71-kit.css`, `72-kit-vassoio.css`, `71f-kit-fila.css` | S2 T16, T20 | 19.4 KB |
| `theme/scrittoio/skin/frame.css` | pelle | `10-frame.css` | S2 T3, T4, T7, T9 | 3.7 KB |
| `theme/scrittoio/skin/drawers.css` | pelle | `20-drawers.css`, `21-icone.css` | S2 T8, T14 | 4.7 KB |
| `theme/scrittoio/skin/tree.css` | pelle | `30-tree.css` | S2 T8 | 2 KB |
| `theme/scrittoio/skin/sheets.css` | pelle | `40-sheets.css` | S2 T5, T6, T27 | 2.5 KB |
| `theme/scrittoio/skin/document.css` | pelle | `50-document.css` | S2 T11, T12 | 5 KB |
| `theme/scrittoio/skin/media.css` | pelle | `85-media.css`, `86-craft.css` | S2 T18, T19 | 2.9 KB |
| `theme/scrittoio/skin/nodes.css` | pelle | `60-nodes.css`, `61-nodes.css` | S2 T9, T13 | 3.9 KB |
| `theme/scrittoio/skin/graph.css` | pelle | `81-graph.css` | S2 T10 | 0.3 KB |
| `theme/scrittoio/skin/menus.css` | pelle | `65-menus.css` | S2 T10 | 1.4 KB |
| `theme/scrittoio/skin/launcher.css` | pelle | `82-launcher.css` | S2 T10 | 0.2 KB |
| `theme/scrittoio/skin/centres.css` | pelle | `45-centres.css` | S2 T5 | 0.8 KB |
| `theme/scrittoio/skin/settings.css` | pelle | `80-settings.css` | S2 T10 | 0.8 KB |
| `theme/scrittoio/skin/welcome.css` | pelle | `83-welcome.css` | S2 T10 | 0.2 KB |
| `shells/scrittoio/mobile/mobile.css` | telefono | `90-mobile.css` | S2 T3, T4, T5, T7, T11, T27 | 7.6 KB |
| `theme/scrittoio/series.ts` | serie | `01-series.css` | S2 T11 | 0.3 KB |
| `theme/scrittoio/recipe.ts` | serie | `02-ruoli.css` | S2 T16, T27 | 1.7 KB |
| `theme/scrittoio/skin/frame.css` | prealpha | `92-prealpha-banda.css` | D5 A: K5 T21–T23 con S2 T4 | 0.9 KB |
| `theme/scrittoio/skin/draw.css` | prealpha | `92-prealpha-disegno.css` | K5 T21, PA T27 | 0.6 KB |
| `theme/scrittoio/skin/settings.css` | prealpha | `92-prealpha-impostazioni.css` | PA T29, T36–T38 | 5.9 KB |
| `theme/scrittoio/skin/nodes.css` | prealpha | `92-prealpha-lavagna.css` | N6 T26–T28, PA T28 | 3.3 KB |
| `theme/scrittoio/skin/media.css` | prealpha | `92-prealpha-media.css` | PA T30 | 0.3 KB |
| `theme/examples/carta/ (fogli e skin.css)` | tema | `93-tema-carta.css` | PA T42, D17 | 4.4 KB |
| `theme/examples/salvia/ (i due fogli)` | tema | `93-tema-salvia.css` | PA T42, D17 | 2.7 KB |
