// Draaien met: node --test test/
// Alle voorbeelddata hieronder is VERZONNEN.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { soort, parseWerkbon, parseMelding, splitsWerkbonnen, schoon } from '../js/parser.js';

const WERKBON = `Werkbon

Meldingnummer:

900001

Projectnummer:

PR00999999.1000.0001

Referentie klant:

INC0000001

Locatie:

NL___4021 - RWS VICNET GEMAAL WESTERVELD__DORPSVEEN

Status:

Hersteld

Adres:

Westerveldseweg , Dorpsveen

Melding ontvangen:

12-10-2026 08:00:00

Omschrijving:

CQ - INC0000002 - switch onbereikbaar WVD-GML-SWT-001

Probleemtekst

Switch WVD-GML-SWT-001 (10.1.2.3) niet bereikbaar. Let op: eerst NOC bellen voordat je de kast opent. Spie 900001 INC0000003 M260000001\\01

Oorzaak en oplossingstekst

Voeding switch defect

Voeding vervangen, switch weer bereikbaar. Serienummer: ABC123XYZ

Verbruikte materialen

Bestede uren

Werktijd - Jan Jansen

1,00
`;

const MELDING = `Beste engineer,

Referenties:
SPIE Melding: M260000002
Prioriteit: Priority 2

Incident omschrijving: Het basestation op locatie Westerveld (10.9.8.7) is niet meer bereikbaar.

Device Gegevens:
Hostname: WVD-GML-SWT-001
Type/Merk: Voorbeeld IE-1000-8TC
Serienummer: XYZ987
IP-adres: 10.1.2.3

Locatie:
Adres: Westerveldseweg 1, 1234AB DORPSVEEN

Samenvatting: Basestation Westerveld (10.9.8.7) down
#Prioriteit : Priority 2;
Locatiecode: 4021
SLA Target: [12-10-2026 18:00:00]
`;

test('herkent soort tekst', () => {
  assert.equal(soort(WERKBON), 'werkbon');
  assert.equal(soort(MELDING), 'melding');
  assert.equal(soort('hallo'), 'onbekend');
});

test('werkbon: velden', async () => {
  const w = await parseWerkbon(WERKBON);
  assert.equal(w.locatiecode, '4021');
  assert.equal(w.naam, 'Gemaal Westerveld, Dorpsveen');
  assert.equal(w.datum, '2026-10-12');
  assert.equal(w.oorzaak, 'Voeding switch defect');
  assert.match(w.oplossing, /Voeding vervangen/);
  assert.deepEqual(w.hostnames, ['WVD-GML-SWT-001']);
  assert.ok(w.trefwoorden.includes('voeding'));
  assert.equal(w.tips.length, 1);
  assert.match(w.bron_hash, /^[0-9a-f]{64}$/);
});

test('werkbon: gevoelige gegevens weggefilterd', async () => {
  const w = await parseWerkbon(WERKBON);
  const json = JSON.stringify(w);
  for (const verboden of ['10.1.2.3', 'ABC123XYZ', 'INC0000', 'M260000001', '900001', 'PR00999999', 'Jan Jansen']) {
    assert.ok(!json.includes(verboden), 'mag niet voorkomen: ' + verboden);
  }
});

test('melding: velden en filter', async () => {
  const m = await parseMelding(MELDING);
  assert.equal(m.locatiecode, '4021');
  assert.equal(m.prioriteit, 'P2');
  assert.equal(m.apparaattype, 'Voorbeeld IE-1000-8TC');
  assert.deepEqual(m.hostnames, ['WVD-GML-SWT-001']);
  assert.equal(m.naamVoorstel, 'Basestation Westerveld');
  assert.ok(m.sla);
  const json = JSON.stringify(m);
  for (const verboden of ['10.9.8.7', '10.1.2.3', 'XYZ987', 'M260000002']) {
    assert.ok(!json.includes(verboden), 'mag niet voorkomen: ' + verboden);
  }
});

test('meerdere werkbonnen splitsen', () => {
  assert.equal(splitsWerkbonnen(WERKBON + '\n' + WERKBON).length, 2);
});

test('schoon() filtert telefoon en e-mail', () => {
  const s = schoon('Bel +31(0)88-1234567 of mail test@voorbeeld.nl');
  assert.ok(!/\d{7}/.test(s));
  assert.ok(!s.includes('@'));
});

// Tweede mailformaat: "Locatie code" met spatie, Site/Locatie adres/Type/GPS. VERZONNEN data.
const MELDING_V2 = `Support Call Number 900123 - Support Reply: INC0000099 - Monitoring Alert: x12-34-100r-swt1-001 - Unavailable by ICMP ping
Lemmens, Ilja
Summary: INC0000099 - Monitoring Alert: x12-34-100r-swt1-001 - Unavailable by ICMP ping
#Prioriteit : Priority 3;
#Probleemtekst : 01-01-2026 10:00 Jansen, Piet:
Graag zouden wij een first check willen op de onderstaande node.
Locatie informatie:
Site: RWS VICNET TESTCVR01 DE PROEFPOLDER
Locatie adres: Proefweg 1 1234 AB TESTDORP
Locatie code: 77
Node Informatie:
Hostname: x12-34-100r-swt1-001
Type: Cisco IE-3400-8T2S-E (3U)
Serial: FCW0000TEST
IP: 10.0.0.42
GPS: 52.100000, 5.100000
#omschrijving : INC0000099 - Monitoring Alert: x12-34-100r-swt1-001 - Unavailable by ICMP ping;
#type: Incident
SLA Target: [05-01-2026 12:00:00]`;

test('melding v2: Locatie code met spatie wordt herkend', async () => {
  assert.equal(soort(MELDING_V2), 'melding');
  const m = await parseMelding(MELDING_V2);
  assert.equal(m.locatiecode, '77');
  assert.equal(m.naamVoorstel, 'TESTCVR01 De Proefpolder');
  assert.equal(m.adres, 'Proefweg 1 1234 AB TESTDORP');
  assert.equal(m.prioriteit, 'P3');
  assert.equal(m.apparaattype, 'Cisco IE-3400-8T2S-E (3U)');
  assert.deepEqual(m.hostnames, ['x12-34-100r-swt1-001']);
  assert.deepEqual(m.gps, { lat: 52.1, lng: 5.1 });
  assert.ok(m.sla);
  const alles = JSON.stringify(m);
  assert.ok(!alles.includes('10.0.0.42'), 'geen IP');
  assert.ok(!alles.includes('FCW0000TEST'), 'geen serienummer');
  assert.ok(!alles.includes('INC0000099'), 'geen ticketnummer');
  assert.ok(!alles.includes('Jansen'), 'geen namen');
});
