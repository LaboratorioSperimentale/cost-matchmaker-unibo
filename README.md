# COST Action Matchmaker Unibo v4

Versione basata sul file CSV allegato.

## Pagine
- `index.html`: matchmaking. Mostra esclusivamente Actions che corrispondono ad almeno una parola inserita.
- `esplora.html`: consultazione completa con filtri per testo, stato, macro-area, anno e scadenza.

## Campi CSV usati
- Code
- Status
- Title
- COST Action Website
- Action Website
- Keywords of the action
- Action end date
- Science field / research area addressed by the action

Le parole chiave visualizzate sono prese direttamente da `Keywords of the action`; la scadenza è presa da `Action end date`.

## Avvio
Aprire PowerShell nella cartella ed eseguire:

    python -m http.server 8006

Poi aprire `http://localhost:8006`.
