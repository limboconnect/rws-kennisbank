# RWS Kennisbank

Digitaal post-it-bord voor de storingsdienst: per object de toegang (sleutel, NOC, bijzonderheden),
eerdere storingen met oorzaak en oplossing, en foto's.

**App:** https://limboconnect.github.io/rws-kennisbank/

## Functies
- **Prikbord**: alle objecten, gesorteerd op afstand (GPS), doorzoekbaar op naam, locatiecode, hostname, storing of trefwoord
- **Toegangskaart** per object, met navigeerknop, storingshistorie en foto's
- **Melding plakken**: NOC-mail plakken → object wordt herkend op locatiecode, met SLA-teller en eerdere oplossingen
- **Werkbonnen importeren**: .msg/.eml-bestanden of geplakte tekst → controlelijst → op het bord

## Privacy
Mails en werkbonnen worden **op het toestel** ingelezen. IP-adressen, serienummers, ticket-/meldingnummers,
uren, kilometers en namen worden weggefilterd voordat er iets wordt opgeslagen. Van het meldingnummer
wordt alleen een hash bewaard (om dubbele import te voorkomen).

## Opzet
- Frontend: statische PWA (HTML/JS), gehost op GitHub Pages
- Backend: Supabase (database, login, foto-opslag), alleen toegankelijk voor uitgenodigde gebruikers
- Database-opzet: `supabase/01_schema.sql` (opnieuw draaien is veilig)
- Beheerder (objecten verwijderen): `supabase/02_beheerder.sql`

## Testen
```
node --test test/parser.test.mjs
```
De testdata is verzonnen.
