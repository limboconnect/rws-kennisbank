// =====================================================================
// Parser voor NOC-storingsmails en werkbonnen.
// Draait volledig op het toestel: gevoelige gegevens (IP-adressen,
// serienummers, ticket-/meldingnummers, namen) worden hier weggefilterd
// VOORDAT er iets naar de database gaat.
// =====================================================================

const ACRONIEMEN = new Set(['RWS', 'CVR', 'NOC', 'KBS', 'AIS', 'IAIS', 'VICNET', 'PSS', 'POS', 'UPS', 'LAN', 'FO']);

/** Normaliseer regeleinden en non-breaking spaces. */
function normaliseer(tekst) {
  return String(tekst || '')
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n');
}

/** Verwijder gevoelige gegevens uit vrije tekst. */
export function schoon(tekst) {
  if (!tekst) return '';
  return String(tekst)
    // IPv4-adressen, eventueel met subnet
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?\b/g, '[IP]')
    .replace(/\s*\(\s*\[IP\]\s*\)/g, '')
    // Ticket- en meldingnummers
    .replace(/\b(?:INC|ITASK|RITM|CHG|TASK)\d{5,}\b/gi, '')
    .replace(/\bM\d{8,}(?:\\\d+)?/g, '')
    .replace(/\bPR\d{6,}(?:\.\d+)*/g, '')
    .replace(/\b(?:spie(?:\s*melding)?|melding(?:nummer)?)\s*:?\s*\d{5,}\b/gi, '')
    // Serienummers
    .replace(/serie(?:nummer|nr)\.?\s*:?\s*\S+/gi, '')
    // E-mailadressen en telefoonnummers
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '')
    .replace(/(?:\+31|0031|\b0)[\s()-]*\d(?:[\s()-]*\d){8}/g, '')
    // "Achternaam, Voornaam:" (journaalregels)
    .replace(/\b[A-Z][a-zà-ÿ]+(?:\s(?:van|de|der|den|ter|ten)\s?[a-zà-ÿ]*)*,\s[A-Z][a-zà-ÿ]+\s*:/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^(?:\s*-\s*)+/, '')
    .trim();
}

/** SHA-256 hash (hex) – voor dubbele-import-controle zonder het nummer zelf op te slaan. */
export async function hash(waarde) {
  const data = new TextEncoder().encode('rws-kb:' + String(waarde).trim());
  const buf = await globalThis.crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Waarde na "Label:" op dezelfde regel, of anders op de eerstvolgende niet-lege regel. */
function veld(tekst, label) {
  const re = new RegExp('^\\s*#?' + label + '\\s*:?[ \\t]*(.*)$', 'im');
  const m = tekst.match(re);
  if (!m) return '';
  if (m[1].trim()) return m[1].trim().replace(/;$/, '').trim();
  const rest = tekst.slice(m.index + m[0].length).split('\n');
  for (const regel of rest) {
    if (regel.trim()) return regel.trim();
  }
  return '';
}

/** Tekstblok tussen een kop en de eerstvolgende van de eindkoppen. */
function blok(tekst, kop, eindkoppen) {
  const start = tekst.search(kop);
  if (start < 0) return '';
  const naKop = tekst.slice(start).replace(kop, '');
  let eind = naKop.length;
  for (const e of eindkoppen) {
    const i = naKop.search(e);
    if (i >= 0 && i < eind) eind = i;
  }
  return naKop.slice(0, eind).trim();
}

function datumNaarIso(s) {
  const m = String(s || '').match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function datumTijd(s) {
  const m = String(s || '').match(/(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0));
}

function titel(woord) {
  if (/\d/.test(woord) || ACRONIEMEN.has(woord.toUpperCase())) return woord.toUpperCase();
  return woord.charAt(0).toUpperCase() + woord.slice(1).toLowerCase();
}

/** "RWS VICNET GEMAAL WESTERVELD__DORPSVEEN" -> "Gemaal Westerveld, Dorpsveen" */
export function netteNaam(ruw) {
  return String(ruw || '')
    .replace(/^NL_+\d+\s*-\s*/i, '')
    .replace(/^RWS\s+VICNET\s+/i, '')
    .replace(/_{2,}/g, ', ')
    .replace(/_/g, ' ')
    .split(/(\s+|,)/)
    .map((d) => (/^\s+$|^,$/.test(d) || !d ? d : titel(d)))
    .join('')
    .replace(/\s+,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Hostnames zoals ABC-DEF-SWT-001 (mogen bewaard worden). */
export function vindHostnames(tekst) {
  const set = new Set();
  const re = /\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+){2,}\b/g;
  let m;
  while ((m = re.exec(tekst))) {
    const h = m[0];
    if (/^(?:INC|M\d|PR\d)/.test(h)) continue;
    if (/^[A-Z]+-\d+-\d+[A-Z]*$/.test(h) && !/[A-Z]{2,}-[A-Z]/.test(h)) {
      // bijv. IE-3000-8TC is een apparaattype, geen hostname
      continue;
    }
    set.add(h);
  }
  // "ABC-DEF-001_Gi0/1" levert ook "ABC-DEF" op: korte varianten weglaten
  const lijst = [...set];
  return lijst.filter((h) => !lijst.some((ander) => ander !== h && ander.startsWith(h + '-')));
}

/** Meetwaarden uit transceiver-output. */
export function vindMeetwaarden(tekst) {
  const uit = [];
  const rx = tekst.match(/Rx\s+optical\s+power\s*=\s*([+-]?\d+(?:[.,]\d+)?)\s*dBm/i);
  const tx = tekst.match(/Tx\s+power\s*=\s*([+-]?\d+(?:[.,]\d+)?)\s*dBm/i);
  const temp = tekst.match(/temperature\s*=\s*([+-]?\d+(?:[.,]\d+)?)\s*C/i);
  if (rx) uit.push('Rx ' + rx[1].replace('.', ',') + ' dBm');
  if (tx) uit.push('Tx ' + tx[1].replace('.', ',') + ' dBm');
  if (temp) uit.push('temp ' + (+temp[1].replace(',', '.')).toFixed(1).replace('.', ',') + ' °C');
  return uit.join(' · ');
}

const TREFWOORDEN = [
  [/glasvezel|\bvezel|\bfo[\s-]|optical|patch/i, 'glasvezel'],
  [/vervuil|schoongemaakt|reinig/i, 'vervuiling'],
  [/\bsfp\b|transceiver/i, 'SFP'],
  [/\bmeting|\bmeten\b|gemeten/i, 'meting'],
  [/voeding|adapter|psu/i, 'voeding'],
  [/switch/i, 'switch'],
  [/router|\bpe\d/i, 'router'],
  [/basestation|\bais\b|iais/i, 'AIS'],
  [/\bups\b|accu|batterij/i, 'UPS'],
  [/stroom|spanning|groep|zekering|aardlek/i, 'stroom'],
  [/sleutel|toegang|\bhek\b/i, 'toegang'],
  [/camera/i, 'camera'],
  [/slagboom/i, 'slagboom'],
];

export function vindTrefwoorden(tekst) {
  return TREFWOORDEN.filter(([re]) => re.test(tekst)).map(([, w]) => w);
}

/** Werkwijze-tips: zinnen met "eerst", "voordat", "let op", ... */
export function vindTips(tekst) {
  const zinnen = schoon(tekst).split(/(?<=[.!?])\s+|\n+/);
  return zinnen
    .map((z) => z.trim())
    .filter((z) => z.length > 12 && z.length < 220)
    .filter((z) => /\b(voordat|eerst|let op|niet vergeten|altijd|nooit|bellen)\b/i.test(z));
}

/** Herken het soort tekst. */
export function soort(tekst) {
  const t = normaliseer(tekst);
  if (/^\s*Werkbon\b/im.test(t) && /Oorzaak en oplo/i.test(t)) return 'werkbon';
  if (/Locatiecode\s*:/i.test(t) || /Incident omschrijving/i.test(t)) return 'melding';
  return 'onbekend';
}

/** Werkbon -> storing (gefilterd). */
export async function parseWerkbon(ruw) {
  const t = normaliseer(ruw);
  const meldingnr = veld(t, 'Meldingnummer');
  const locatie = veld(t, 'Locatie');
  const codeM = locatie.match(/NL_*(\d{3,6})/i);
  const probleem = blok(t, /Probleemtekst/i, [/Oorzaak en oplo\w*\s*tekst/i, /Verbruikte materialen/i]);
  const oorzaakBlok = blok(t, /Oorzaak en oplo\w*\s*tekst/i, [/Verbruikte materialen/i, /Bestede uren/i, /Handtekening/i]);
  const regels = oorzaakBlok.split('\n').map((r) => r.trim()).filter(Boolean);
  const oorzaak = regels[0] || '';
  const oplossingRuw = regels.slice(1).join('\n');
  // Ruwe transceiver-dump inkorten: meetwaarden staan apart
  const oplossing = oplossingRuw.replace(/The Transceiver[\s\S]*$/i, '').trim();
  const omschrijving = veld(t, 'Omschrijving');
  const alles = [omschrijving, probleem, oorzaakBlok].join('\n');

  return {
    soort: 'werkbon',
    locatiecode: codeM ? codeM[1] : null,
    naam: netteNaam(locatie),
    adres: veld(t, 'Adres').replace(/\s+,/g, ','),
    datum: datumNaarIso(veld(t, 'Melding ontvangen')) || datumNaarIso(t),
    status: veld(t, 'Status'),
    omschrijving: schoon(omschrijving.replace(/^CQ\s*-\s*/i, '')),
    probleem: schoon(probleem),
    oorzaak: schoon(oorzaak),
    oplossing: schoon(oplossing),
    meetwaarden: vindMeetwaarden(oorzaakBlok),
    hostnames: vindHostnames(alles),
    trefwoorden: vindTrefwoorden(alles),
    tips: vindTips(probleem + '\n' + oorzaakBlok),
    bron_hash: meldingnr ? await hash('werkbon:' + meldingnr) : null,
  };
}

/** NOC-storingsmail -> melding (alleen tonen, niets van de nummers bewaren). */
export async function parseMelding(ruw) {
  const t = normaliseer(ruw);
  const code = veld(t, 'Locatiecode').match(/\d{3,6}/);
  const prio = (veld(t, 'Prioriteit').match(/\d/) || [])[0];
  const omschrijvingRuw = veld(t, 'Incident omschrijving') || veld(t, 'omschrijving');
  const samenvatting = veld(t, 'Samenvatting') || veld(t, '#omschrijving');
  const typeMerk = veld(t, 'Type\\s*/\\s*Merk(?: apparaat)?');
  const hostname = veld(t, 'Hostname') || veld(t, 'Naam');
  // SLA: laatste "SLA Target" in de mail
  const slaAlle = [...t.matchAll(/SLA Target:\s*\[?([\d\-: ]+)\]?/gi)];
  const sla = slaAlle.length ? datumTijd(slaAlle[slaAlle.length - 1][1]) : null;
  const naamVoorstel = schoon(samenvatting || '')
    .replace(/\(\s*\[IP\]\s*\)/g, '')
    .replace(/\s*\bdown\b\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const alles = [omschrijvingRuw, samenvatting, t].join('\n');

  return {
    soort: 'melding',
    locatiecode: code ? code[0] : null,
    naamVoorstel: naamVoorstel || hostname || '',
    adres: veld(t, 'Adres'),
    prioriteit: prio ? 'P' + prio : '',
    omschrijving: schoon(omschrijvingRuw),
    apparaattype: typeMerk && !/\d{1,3}(\.\d{1,3}){3}/.test(typeMerk) ? typeMerk : '',
    hostnames: [...new Set([hostname, ...vindHostnames(alles)].filter((h) => h && /-/.test(h)))],
    trefwoorden: vindTrefwoorden(omschrijvingRuw + ' ' + samenvatting),
    sla: sla ? sla.toISOString() : null,
  };
}

/** Eén geplakte tekst kan meerdere werkbonnen bevatten. */
export function splitsWerkbonnen(tekst) {
  const t = normaliseer(tekst);
  const delen = t.split(/^(?=\s*Werkbon\s*$)/m).map((d) => d.trim()).filter(Boolean);
  return delen.length ? delen : [t];
}

/** Platte tekst uit een .eml-bestand halen (eenvoudig, zonder bibliotheek). */
export function tekstUitEml(eml) {
  const t = normaliseer(eml);
  const scheiding = t.indexOf('\n\n');
  let body = scheiding >= 0 ? t.slice(scheiding + 2) : t;
  // quoted-printable decoderen
  if (/content-transfer-encoding:\s*quoted-printable/i.test(t)) {
    body = body.replace(/=\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
  return htmlNaarTekst(body);
}

/** HTML-mail naar leesbare tekst met regeleinden. */
export function htmlNaarTekst(html) {
  if (!/<\w+[^>]*>/.test(html)) return html;
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d|td|th)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}
