import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import {
  soort, parseWerkbon, parseMelding, splitsWerkbonnen, tekstUitEml, htmlNaarTekst,
} from './parser.js';

// Uitnodigings-/herstellink herkennen VOORDAT Supabase de URL opruimt
const startHash = location.hash;
const wachtwoordLink = /type=(invite|recovery|signup)/.test(startHash);
const linkFout = /error_description=([^&]+)/.exec(startHash);

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const app = document.getElementById('app');
const KLEUREN = ['geel', 'roze', 'blauw', 'groen'];
const PINNEN = ['', 'blauw', 'groen'];

const staat = {
  sessie: null,
  gebruiker: null,
  profielen: new Map(),
  objecten: [],
  storingen: [],
  fotos: [],
  pos: null,
  zoek: '',
  wachtwoordZetten: wachtwoordLink,
  prefill: null,         // voorinvulling nieuw object (vanuit melding)
  melding: null,         // laatst herkende melding (alleen in geheugen)
  meldingTekst: '',
  vinkjes: { aan: false, af: false },
  importItems: [],
  importTekst: '',
  importNamen: new Map(),
  slaTimer: null,
  timers: [],
  geladen: false,
};

// ===================================================================
// Hulpfuncties
// ===================================================================
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, el = document) => el.querySelector(sel);

function toast(tekst, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = tekst;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, ms);
}

function naamVan(id) {
  return staat.profielen.get(id) || 'collega';
}

function datumNl(iso) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

function geleden(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return 'zojuist';
  if (s < 86400) return Math.floor(s / 3600) + ' uur geleden';
  const d = Math.floor(s / 86400);
  if (d < 31) return d === 1 ? 'gisteren' : d + ' dagen geleden';
  return datumNl(iso);
}

function afstandKm(a, b) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function kmTekst(km) {
  return km < 10 ? km.toFixed(1).replace('.', ',') + ' km' : Math.round(km) + ' km';
}

function lijst(s) {
  return String(s || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
}

function uniek(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function hashNr(str) {
  let h = 0;
  for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

const ICON = {
  terug: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  zoek: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5A5148" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  bord: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="8" height="8"/><rect x="13" y="3" width="8" height="8"/><rect x="3" y="13" width="8" height="8"/><rect x="13" y="13" width="8" height="8"/></svg>',
  mail: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>',
  upload: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4M7 9l5-5 5 5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></svg>',
  sleutel: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/></svg>',
  tel: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
  info: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/></svg>',
  nav: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l18-8-8 18-2-8-8-2z"/></svg>',
  camera: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  slot: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;margin-top:1px"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  pen: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
};

function kop({ titel, sub = '', terug = null, rechts = '' }) {
  return `<header class="kop"><div class="kop-rij"><div style="min-width:0">
    ${terug ? `<a class="terug" href="${esc(terug.href)}">${ICON.terug}${esc(terug.tekst)}</a>` : ''}
    <h1>${esc(titel)}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}
  </div>${rechts}</div></header>`;
}

function nav(actief) {
  const item = (href, icon, tekst, key) =>
    `<a href="${href}" ${actief === key ? 'aria-current="page"' : ''}>${icon}${tekst}</a>`;
  return `<nav class="nav" aria-label="Hoofdmenu">
    ${item('#/', ICON.bord, 'Prikbord', 'bord')}
    ${item('#/melding', ICON.mail, 'Melding', 'melding')}
    ${item('#/import', ICON.upload, 'Importeren', 'import')}
  </nav>`;
}

function avatar() {
  const n = naamVan(staat.gebruiker?.id);
  const init = n.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return `<a class="avatar" href="#/account" aria-label="Account: ${esc(n)}">${esc(init)}</a>`;
}

// ===================================================================
// Data
// ===================================================================
async function laadAlles() {
  const [o, s, p, f] = await Promise.all([
    sb.from('objecten').select('*').order('bijgewerkt_op', { ascending: false }),
    sb.from('storingen').select('id,object_id,datum,omschrijving,oorzaak,oplossing,meetwaarden,trefwoorden,bron,aangemaakt_door,aangemaakt_op').order('datum', { ascending: false }),
    sb.from('profiles').select('id,naam'),
    sb.from('fotos').select('*').order('aangemaakt_op', { ascending: false }),
  ]);
  const fout = o.error || s.error || p.error || f.error;
  if (fout) throw fout;
  staat.objecten = o.data;
  staat.storingen = s.data;
  staat.fotos = f.data;
  staat.profielen = new Map(p.data.map((x) => [x.id, x.naam]));
  // Eigen profiel aanmaken als dat (nog) ontbreekt
  if (!staat.profielen.has(staat.gebruiker.id)) {
    const naam = staat.gebruiker.email.split('@')[0];
    const { error } = await sb.from('profiles').insert({ id: staat.gebruiker.id, naam });
    if (!error) staat.profielen.set(staat.gebruiker.id, naam);
  }
  staat.geladen = true;
  geocodeOntbrekende();
}

function object(id) {
  return staat.objecten.find((o) => o.id === id);
}

function storingenVan(id) {
  return staat.storingen.filter((s) => s.object_id === id);
}

// Adressen zonder coördinaten op de achtergrond opzoeken (max. 1 per seconde)
let geocodeBezig = false;
async function geocodeOntbrekende() {
  if (geocodeBezig) return;
  geocodeBezig = true;
  try {
    for (const o of staat.objecten.filter((x) => x.lat == null && x.adres)) {
      const pos = await geocode(o.adres);
      if (pos) {
        await sb.from('objecten').update(pos).eq('id', o.id);
        Object.assign(o, pos);
      }
      await new Promise((r) => setTimeout(r, 1100));
    }
  } finally {
    geocodeBezig = false;
  }
}

async function geocode(adres) {
  try {
    const q = encodeURIComponent(adres.replace(/\s+,/g, ','));
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=nl&q=${q}`);
    const j = await r.json();
    if (j[0]) return { lat: +j[0].lat, lng: +j[0].lon };
  } catch { /* geen internet of geen resultaat */ }
  return null;
}

function vraagPositie() {
  if (!navigator.geolocation || staat.posGevraagd) return;
  staat.posGevraagd = true;
  navigator.geolocation.getCurrentPosition(
    (p) => {
      staat.pos = { lat: p.coords.latitude, lng: p.coords.longitude };
      if (route().naam === 'bord') renderBordLijst();
    },
    () => {},
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
  );
}

// ===================================================================
// Router
// ===================================================================
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const delen = h.split('/');
  if (!h) return { naam: 'bord' };
  if (delen[0] === 'object' && delen[2] === 'bewerk') return { naam: 'bewerk', id: delen[1] };
  if (delen[0] === 'object') return { naam: 'object', id: delen[1] };
  if (delen[0] === 'nieuw') return { naam: 'bewerk', id: null };
  if (['melding', 'import', 'account'].includes(delen[0])) return { naam: delen[0] };
  return { naam: 'bord' };
}

async function render() {
  staat.timers.forEach(clearInterval);
  staat.timers = [];

  if (staat.wachtwoordZetten && staat.sessie) return renderWachtwoord();
  if (!staat.sessie) return renderLogin();
  if (!staat.geladen) {
    try {
      await laadAlles();
    } catch (e) {
      app.innerHTML = `<div class="login"><div class="postit roze"><span class="pin"></span><h2>Laden mislukt</h2><p class="tekst">${esc(e.message)}</p><button class="knop" data-actie="herlaad">Opnieuw</button></div></div>`;
      return;
    }
  }
  const r = route();
  window.scrollTo(0, 0);
  ({ bord: renderBord, object: renderObject, bewerk: renderBewerk, melding: renderMelding, import: renderImport, account: renderAccount })[r.naam](r);
}

window.addEventListener('hashchange', render);

// ===================================================================
// Inloggen
// ===================================================================
function renderLogin(melding = '') {
  app.innerHTML = `<main class="login">
    <h1>Kennisbank</h1>
    <form class="postit scheef-3" id="login-form">
      <span class="pin"></span>
      <h2>Inloggen</h2>
      ${linkFout ? `<div class="fout">De link werkt niet meer (${esc(decodeURIComponent(linkFout[1]).replace(/\+/g, ' '))}). Vraag een nieuwe uitnodiging aan.</div>` : ''}
      ${melding ? `<div class="fout">${esc(melding)}</div>` : ''}
      <div class="veld"><label for="email">E-mailadres</label><input id="email" type="email" autocomplete="username" required></div>
      <div class="veld"><label for="ww">Wachtwoord</label><input id="ww" type="password" autocomplete="current-password" required></div>
      <button class="knop groot" type="submit">Inloggen</button>
      <button class="linkknop" type="button" data-actie="vergeten">Wachtwoord vergeten?</button>
    </form>
    <p class="info-kurk">${ICON.slot}Alleen voor uitgenodigde collega's van de storingsdienst.</p>
    <p class="copyright">© ${new Date().getFullYear()} Ilja Lemmens</p>
  </main>`;
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const knop = e.target.querySelector('[type=submit]');
    knop.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: $('#email').value.trim(), password: $('#ww').value });
    knop.disabled = false;
    if (error) renderLogin('Inloggen mislukt. Controleer e-mail en wachtwoord.');
  });
}

async function wachtwoordVergeten() {
  const email = $('#email')?.value.trim();
  if (!email) return toast('Vul eerst je e-mailadres in');
  await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  toast('Als dit adres bekend is, krijg je een mail met een link');
}

function renderWachtwoord(melding = '') {
  app.innerHTML = `<main class="login">
    <h1>Welkom!</h1>
    <form class="postit groen scheef-4" id="ww-form">
      <span class="pin blauw"></span>
      <h2>Kies een wachtwoord</h2>
      ${melding ? `<div class="fout">${esc(melding)}</div>` : ''}
      <div class="veld"><label for="naam">Je naam (zien collega's)</label><input id="naam" type="text" autocomplete="name" value="${esc(naamVan(staat.gebruiker?.id) === 'collega' ? '' : naamVan(staat.gebruiker?.id))}"></div>
      <div class="veld"><label for="ww1">Nieuw wachtwoord (min. 8 tekens)</label><input id="ww1" type="password" autocomplete="new-password" minlength="8" required></div>
      <div class="veld"><label for="ww2">Nog een keer</label><input id="ww2" type="password" autocomplete="new-password" minlength="8" required></div>
      <button class="knop groot" type="submit">Opslaan</button>
    </form>
  </main>`;
  $('#ww-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const w1 = $('#ww1').value, w2 = $('#ww2').value, naam = $('#naam').value.trim();
    if (w1 !== w2) return renderWachtwoord('De wachtwoorden zijn niet gelijk.');
    const { error } = await sb.auth.updateUser({ password: w1 });
    if (error) return renderWachtwoord('Opslaan mislukt: ' + error.message);
    if (naam) await sb.from('profiles').update({ naam }).eq('id', staat.gebruiker.id);
    staat.wachtwoordZetten = false;
    staat.geladen = false;
    location.hash = '#/';
    toast('Wachtwoord opgeslagen');
    render();
  });
}

function renderAccount() {
  const naam = naamVan(staat.gebruiker.id);
  app.innerHTML = `<div class="scherm">
    ${kop({ titel: 'Account', terug: { href: '#/', tekst: 'Prikbord' } })}
    <main class="inhoud">
      <form class="postit papier scheef-3" id="acc-form">
        <span class="pin"></span>
        <div class="veld"><label for="naam">Naam</label><input id="naam" type="text" value="${esc(naam)}" required></div>
        <p class="klein">${esc(staat.gebruiker.email)}</p>
        <button class="knop" type="submit">Opslaan</button>
      </form>
      <button class="knop rand wit" data-actie="nieuw-ww">Wachtwoord wijzigen</button>
      <button class="knop gevaar wit" data-actie="uitloggen">Uitloggen</button>
      <p class="copyright">Copyright © ${new Date().getFullYear()} Ilja Lemmens · alle rechten voorbehouden</p>
    </main>${nav('')}</div>`;
  $('#acc-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const n = $('#naam').value.trim();
    const { error } = await sb.from('profiles').update({ naam: n }).eq('id', staat.gebruiker.id);
    if (error) return toast('Opslaan mislukt');
    staat.profielen.set(staat.gebruiker.id, n);
    toast('Opgeslagen');
  });
}

// ===================================================================
// Prikbord
// ===================================================================
function renderBord() {
  vraagPositie();
  app.innerHTML = `<div class="scherm">
    ${kop({ titel: 'Kennisbank', sub: `Storingsdienst · ${staat.profielen.size} collega's`, rechts: avatar() })}
    <main class="inhoud">
      <div class="veld op-kurk">
        <label for="zoek">Zoek object, storing of trefwoord</label>
        <div class="zoek">${ICON.zoek}<input id="zoek" type="search" placeholder="bijv. gemaal, glasvezel, sleutel" value="${esc(staat.zoek)}"></div>
      </div>
      <a href="#/melding" class="postit melding-knop">
        <span class="pin blauw"></span>
        ${ICON.mail}
        <span><strong>Melding plakken</strong><span class="klein" style="color:var(--inkt)">Plak de mail van het NOC, de app vindt het object</span></span>
      </a>
      <div class="sectie">
        <span class="label" id="bord-label">Op het bord</span>
        <a class="knop wit" href="#/nieuw">${ICON.plus}Nieuw object</a>
      </div>
      <div id="bord-lijst"></div>
    </main>
    ${nav('bord')}
  </div>`;
  $('#zoek').addEventListener('input', (e) => {
    staat.zoek = e.target.value;
    renderBordLijst();
  });
  renderBordLijst();
}

function zoektekst(o) {
  const st = storingenVan(o.id).map((s) => [s.omschrijving, s.oorzaak, s.oplossing, (s.trefwoorden || []).join(' ')].join(' ')).join(' ');
  return [o.naam, o.locatiecode, o.adres, o.sleutel, o.noc_info, o.bijzonderheden, (o.hostnames || []).join(' '), (o.apparaattypes || []).join(' '), st].join(' ').toLowerCase();
}

function renderBordLijst() {
  const doel = $('#bord-lijst');
  if (!doel) return;
  const woorden = staat.zoek.toLowerCase().split(/\s+/).filter(Boolean);
  let lijstO = staat.objecten.filter((o) => {
    if (!woorden.length) return true;
    const t = zoektekst(o);
    return woorden.every((w) => t.includes(w));
  });
  if (staat.pos) {
    lijstO = lijstO
      .map((o) => ({ o, km: o.lat != null ? afstandKm(staat.pos, o) : Infinity }))
      .sort((a, b) => a.km - b.km)
      .map((x) => Object.assign(x.o, { _km: x.km }));
  }
  const label = $('#bord-label');
  if (label) label.textContent = woorden.length ? `${lijstO.length} gevonden` : staat.pos ? 'Dichtbij jou' : 'Op het bord';

  if (!staat.objecten.length) {
    doel.innerHTML = `<p class="leeg">Het bord is nog leeg.<br>Plak een melding of importeer werkbonnen.</p>`;
    return;
  }
  if (!lijstO.length) {
    doel.innerHTML = `<p class="leeg">Niets gevonden voor "${esc(staat.zoek)}"</p>`;
    return;
  }
  doel.innerHTML = `<div class="raster">${lijstO.slice(0, 200).map((o, i) => {
    const n = storingenVan(o.id).length;
    const km = Number.isFinite(o._km) ? ' · ' + kmTekst(o._km) : '';
    return `<a href="#/object/${o.id}" class="postit ${esc(o.kleur || 'geel')} scheef-${(i % 4) + 1}">
      <span class="pin ${PINNEN[hashNr(o.id) % 3]}"></span>
      <h3>${esc(o.naam)}</h3>
      <span class="klein">${o.locatiecode ? 'Locatie ' + esc(o.locatiecode) : esc(o.adres || '')}${km}</span>
      ${o.sleutel ? `<span style="font-size:12px;line-height:1.35">${esc(o.sleutel)}</span>` : ''}
      <span style="margin-top:auto;display:flex;flex-direction:column;gap:4px">
        ${o.noc_toegang ? '<span class="chip">NOC-toegang nodig</span>' : ''}
        <span class="klein">${n} ${n === 1 ? 'storing' : 'storingen'}</span>
      </span>
    </a>`;
  }).join('')}</div>`;
}

// ===================================================================
// Object (toegangskaart)
// ===================================================================
function navigeerUrl(o) {
  const doel = o.lat != null ? `${o.lat},${o.lng}` : o.adres;
  return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(doel || o.naam);
}

function renderObject({ id }) {
  const o = object(id);
  if (!o) {
    app.innerHTML = `<div class="scherm">${kop({ titel: 'Niet gevonden', terug: { href: '#/', tekst: 'Prikbord' } })}<main class="inhoud"><p class="leeg">Dit object bestaat niet (meer).</p></main>${nav('')}</div>`;
    return;
  }
  const storingen = storingenVan(id);
  const fotos = staat.fotos.filter((f) => f.object_id === id);
  const sub = [o.locatiecode ? 'Locatie ' + esc(o.locatiecode) : '', esc(o.adres || '')].filter(Boolean).join(' · ');
  const rij = (icoon, titel, tekst) => tekst ? `<div class="rij">${icoon}<div style="display:flex;flex-direction:column;gap:1px;min-width:0"><span class="rij-titel">${titel}</span><span class="tekst">${esc(tekst)}</span></div></div>` : '';

  app.innerHTML = `<div class="scherm">
    ${kop({ titel: o.naam, sub, terug: { href: '#/', tekst: 'Prikbord' } })}
    <main class="inhoud">
      <div class="knoppen">
        <a class="knop" href="${esc(navigeerUrl(o))}" target="_blank" rel="noopener">${ICON.nav}Navigeer</a>
        <label class="knop rand wit" for="foto-input">${ICON.camera}Foto</label>
        <a class="knop rand wit" href="#/object/${o.id}/bewerk">${ICON.pen}Bewerk</a>
      </div>
      <input id="foto-input" class="visueel-verborgen" type="file" accept="image/*" capture="environment">

      <section class="postit geel scheef-3" aria-labelledby="toegang-kop" style="padding:22px 16px 14px;gap:12px">
        <span class="pin"></span>
        <h2 id="toegang-kop">Toegang</h2>
        ${rij(ICON.sleutel, 'Sleutel', o.sleutel)}
        ${rij(ICON.tel, 'Toegang via NOC', o.noc_toegang ? 'Ja' + (o.noc_info ? '. ' + o.noc_info : '') : o.noc_info)}
        ${rij(ICON.info, 'Bijzonderheden', o.bijzonderheden)}
        ${!o.sleutel && !o.noc_toegang && !o.noc_info && !o.bijzonderheden ? `<p class="tekst">Nog niets ingevuld. <a href="#/object/${o.id}/bewerk">Toegang toevoegen</a></p>` : ''}
        ${(o.apparaattypes?.length || o.hostnames?.length) ? `<div class="chips">${[...(o.apparaattypes || []), ...(o.hostnames || [])].map((x) => `<span class="chip licht">${esc(x)}</span>`).join('')}</div>` : ''}
        <span class="voet">Bijgewerkt door ${esc(naamVan(o.bijgewerkt_door))} · ${esc(geleden(o.bijgewerkt_op))}</span>
      </section>

      <div class="sectie">
        <span class="label">Storingen</span>
        <button class="knop wit" data-actie="storing-form">${ICON.plus}Storing</button>
      </div>
      <form id="storing-form" class="postit papier" hidden>
        <div class="veld"><label for="s-datum">Datum</label><input id="s-datum" type="date" value="${new Date().toISOString().slice(0, 10)}" required></div>
        <div class="veld"><label for="s-oms">Wat was er aan de hand?</label><input id="s-oms" type="text" required></div>
        <div class="veld"><label for="s-oorzaak">Oorzaak</label><input id="s-oorzaak" type="text"></div>
        <div class="veld"><label for="s-opl">Oplossing</label><textarea id="s-opl" rows="3"></textarea></div>
        <div class="knoppen"><button class="knop" type="submit">Opslaan</button><button class="knop rand" type="button" data-actie="storing-annuleer">Annuleren</button></div>
      </form>
      ${storingen.length ? `<div class="raster" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">${storingen.map((s, i) => `
        <article class="postit ${KLEUREN[(i + 1) % 4]} scheef-${((i + 1) % 4) + 1}" style="padding-top:14px">
          <span class="klein">${esc(datumNl(s.datum))} · ${esc(naamVan(s.aangemaakt_door))}${s.bron === 'werkbon' ? ' · werkbon' : ''}</span>
          ${s.omschrijving ? `<strong style="font-size:14px;line-height:1.3">${esc(s.omschrijving)}</strong>` : ''}
          ${s.oorzaak ? `<span class="tekst"><b>Oorzaak:</b> ${esc(s.oorzaak)}</span>` : ''}
          ${s.oplossing ? `<span class="tekst"><b>Oplossing:</b> ${esc(s.oplossing)}</span>` : ''}
          ${s.meetwaarden ? `<span class="klein">Meting: ${esc(s.meetwaarden)}</span>` : ''}
          ${s.trefwoorden?.length ? `<div class="chips">${s.trefwoorden.map((t) => `<span class="chip licht">${esc(t)}</span>`).join('')}</div>` : ''}
          ${s.aangemaakt_door === staat.gebruiker.id ? `<button class="linkknop" style="align-self:flex-start;padding:4px 0;font-size:12px" data-actie="storing-weg" data-id="${s.id}">Verwijderen</button>` : ''}
        </article>`).join('')}</div>` : '<p class="info-kurk">Nog geen storingen vastgelegd.</p>'}

      <div class="sectie"><span class="label">Foto's</span><span class="klein">${fotos.length}</span></div>
      ${fotos.length ? `<div class="fotos" id="fotos">${fotos.map((f, i) => `
        <button class="polaroid scheef-${(i % 4) + 1}" data-actie="foto" data-id="${f.id}" aria-label="Foto${f.bijschrift ? ': ' + esc(f.bijschrift) : ''}">
          <img alt="" data-pad="${esc(f.pad)}">
        </button>`).join('')}</div>` : `<p class="info-kurk">Nog geen foto's. Maak er een met de knop Foto.</p>`}
    </main>
    ${nav('')}
  </div>`;

  $('#foto-input').addEventListener('change', (e) => fotoUploaden(o, e.target.files[0]));
  $('#storing-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const rijData = {
      object_id: o.id,
      datum: $('#s-datum').value,
      omschrijving: $('#s-oms').value.trim(),
      oorzaak: $('#s-oorzaak').value.trim() || null,
      oplossing: $('#s-opl').value.trim() || null,
      bron: 'handmatig',
      aangemaakt_door: staat.gebruiker.id,
    };
    const { data, error } = await sb.from('storingen').insert(rijData).select().single();
    if (error) return toast('Opslaan mislukt: ' + error.message);
    staat.storingen.unshift(data);
    await raakAan(o);
    toast('Storing opgeslagen');
    renderObject({ id: o.id });
  });
  laadThumbnails(fotos);
}

async function raakAan(o) {
  const nu = new Date().toISOString();
  await sb.from('objecten').update({ bijgewerkt_door: staat.gebruiker.id, bijgewerkt_op: nu }).eq('id', o.id);
  o.bijgewerkt_door = staat.gebruiker.id;
  o.bijgewerkt_op = nu;
}

const urlCache = new Map();
async function laadThumbnails(fotos) {
  const nodig = fotos.map((f) => f.pad).filter((p) => !urlCache.has(p));
  if (nodig.length) {
    const { data } = await sb.storage.from('fotos').createSignedUrls(nodig, 3600);
    (data || []).forEach((d) => d.signedUrl && urlCache.set(d.path, d.signedUrl));
  }
  document.querySelectorAll('img[data-pad]').forEach((img) => {
    const u = urlCache.get(img.dataset.pad);
    if (u) img.src = u;
  });
}

async function verkleinFoto(bestand) {
  const bron = await createImageBitmap(bestand, { imageOrientation: 'from-image' });
  const max = 1600;
  const f = Math.min(1, max / Math.max(bron.width, bron.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bron.width * f);
  c.height = Math.round(bron.height * f);
  c.getContext('2d').drawImage(bron, 0, 0, c.width, c.height);
  return new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.8));
}

async function fotoUploaden(o, bestand) {
  if (!bestand) return;
  const bijschrift = prompt('Korte omschrijving (bijv. "sleutelkluisje")') || null;
  toast('Foto uploaden…', 10000);
  try {
    const blob = await verkleinFoto(bestand);
    const pad = `${o.id}/${crypto.randomUUID()}.jpg`;
    const up = await sb.storage.from('fotos').upload(pad, blob, { contentType: 'image/jpeg' });
    if (up.error) throw up.error;
    const { data, error } = await sb.from('fotos').insert({ object_id: o.id, pad, bijschrift, aangemaakt_door: staat.gebruiker.id }).select().single();
    if (error) throw error;
    staat.fotos.unshift(data);
    await raakAan(o);
    toast('Foto opgeslagen');
    renderObject({ id: o.id });
  } catch (e) {
    toast('Uploaden mislukt: ' + e.message, 5000);
  }
}

function toonFoto(id) {
  const f = staat.fotos.find((x) => x.id === id);
  if (!f) return;
  const div = document.createElement('div');
  div.className = 'lightbox';
  div.setAttribute('role', 'dialog');
  div.setAttribute('aria-label', 'Foto');
  div.innerHTML = `<img src="${esc(urlCache.get(f.pad) || '')}" alt="${esc(f.bijschrift || 'Foto')}">
    <p>${esc(f.bijschrift || '')} <span style="opacity:.7">· ${esc(naamVan(f.aangemaakt_door))}, ${esc(datumNl(f.aangemaakt_op))}</span></p>
    <div class="knoppen">
      <button class="knop wit" data-sluit>Sluiten</button>
      ${f.aangemaakt_door === staat.gebruiker.id ? `<button class="knop gevaar wit" data-weg>Verwijderen</button>` : ''}
    </div>`;
  document.body.appendChild(div);
  const sluit = () => div.remove();
  div.addEventListener('click', async (e) => {
    if (e.target === div || e.target.closest('[data-sluit]')) sluit();
    if (e.target.closest('[data-weg]') && confirm('Foto verwijderen?')) {
      await sb.storage.from('fotos').remove([f.pad]);
      await sb.from('fotos').delete().eq('id', f.id);
      staat.fotos = staat.fotos.filter((x) => x.id !== f.id);
      sluit();
      renderObject({ id: f.object_id });
    }
  });
  div.querySelector('[data-sluit]').focus();
}

// ===================================================================
// Object bewerken / nieuw
// ===================================================================
function renderBewerk({ id }) {
  const bestaand = id ? object(id) : null;
  const o = bestaand || { naam: '', kleur: KLEUREN[Math.floor(Math.random() * 4)], ...(staat.prefill || {}) };
  const terug = bestaand ? { href: '#/object/' + id, tekst: o.naam } : { href: '#/', tekst: 'Prikbord' };
  app.innerHTML = `<div class="scherm">
    ${kop({ titel: bestaand ? 'Bewerken' : 'Nieuw object', terug })}
    <main class="inhoud">
      <form class="postit ${esc(o.kleur || 'geel')}" id="obj-form" style="gap:12px;padding-top:22px">
        <span class="pin"></span>
        <div class="veld"><label for="f-naam">Naam</label><input id="f-naam" type="text" value="${esc(o.naam)}" required placeholder="bijv. Gemaal Westerveld"></div>
        <div class="veld"><label for="f-code">Locatiecode (uit de mail)</label><input id="f-code" type="text" inputmode="numeric" value="${esc(o.locatiecode || '')}"></div>
        <div class="veld"><label for="f-adres">Adres</label><input id="f-adres" type="text" value="${esc(o.adres || '')}"></div>
        <button class="knop rand" type="button" data-actie="gps">${ICON.nav}<span id="gps-tekst">${o.lat != null ? 'Locatie opgeslagen · opnieuw bepalen' : 'Mijn huidige locatie gebruiken'}</span></button>
        <h2 style="margin-top:6px">Toegang</h2>
        <div class="veld"><label for="f-sleutel">Sleutel: welke en waar ligt hij?</label><input id="f-sleutel" type="text" value="${esc(o.sleutel || '')}" placeholder="bijv. sleutelkluisje links naast het hek"></div>
        <label class="vinkje"><input id="f-noc" type="checkbox" ${o.noc_toegang ? 'checked' : ''}>Toegang aanvragen via NOC</label>
        <div class="veld"><label for="f-nocinfo">Hoe aanvragen?</label><input id="f-nocinfo" type="text" value="${esc(o.noc_info || '')}" placeholder="bijv. 30 min vooraf, locatiecode doorgeven"></div>
        <div class="veld"><label for="f-bijz">Bijzonderheden</label><textarea id="f-bijz" rows="3" placeholder="bijv. hek klemt, parkeren achterkant">${esc(o.bijzonderheden || '')}</textarea></div>
        <p class="klein" style="margin:0">Zet hier nooit codes of wachtwoorden, alleen wáár je ze haalt.</p>
        <h2 style="margin-top:6px">Techniek</h2>
        <div class="veld"><label for="f-app">Apparaattypes (komma's ertussen)</label><input id="f-app" type="text" value="${esc((o.apparaattypes || []).join(', '))}"></div>
        <div class="veld"><label for="f-host">Hostnames (komma's ertussen)</label><input id="f-host" type="text" value="${esc((o.hostnames || []).join(', '))}"></div>
        <div class="veld"><label for="f-kleur">Kleur post-it</label><select id="f-kleur">${KLEUREN.map((k) => `<option value="${k}" ${o.kleur === k ? 'selected' : ''}>${k}</option>`).join('')}</select></div>
        <button class="knop groot" type="submit">Opslaan</button>
      </form>
    </main>${nav('')}</div>`;

  let coords = o.lat != null ? { lat: o.lat, lng: o.lng } : null;
  app.querySelector('[data-actie="gps"]').addEventListener('click', () => {
    if (!navigator.geolocation) return toast('Locatie niet beschikbaar');
    $('#gps-tekst').textContent = 'Locatie bepalen…';
    navigator.geolocation.getCurrentPosition(
      (p) => { coords = { lat: p.coords.latitude, lng: p.coords.longitude }; $('#gps-tekst').textContent = 'Huidige locatie opgeslagen'; },
      () => { $('#gps-tekst').textContent = 'Locatie niet gevonden'; },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  });

  $('#obj-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = $('#f-code').value.trim() || null;
    if (code && staat.objecten.some((x) => x.locatiecode === code && x.id !== id)) {
      return toast('Er is al een object met locatiecode ' + code, 4000);
    }
    const rij = {
      naam: $('#f-naam').value.trim(),
      locatiecode: code,
      adres: $('#f-adres').value.trim() || null,
      sleutel: $('#f-sleutel').value.trim() || null,
      noc_toegang: $('#f-noc').checked,
      noc_info: $('#f-nocinfo').value.trim() || null,
      bijzonderheden: $('#f-bijz').value.trim() || null,
      apparaattypes: uniek(lijst($('#f-app').value)),
      hostnames: uniek(lijst($('#f-host').value)),
      kleur: $('#f-kleur').value,
      bijgewerkt_door: staat.gebruiker.id,
      bijgewerkt_op: new Date().toISOString(),
      ...(coords || (bestaand && bestaand.adres !== $('#f-adres').value.trim() ? { lat: null, lng: null } : {})),
    };
    const q = bestaand
      ? sb.from('objecten').update(rij).eq('id', id).select().single()
      : sb.from('objecten').insert(rij).select().single();
    const { data, error } = await q;
    if (error) return toast('Opslaan mislukt: ' + error.message, 5000);
    if (bestaand) Object.assign(bestaand, data); else staat.objecten.unshift(data);
    staat.prefill = null;
    toast('Opgeslagen');
    geocodeOntbrekende();
    location.hash = '#/object/' + data.id;
  });
}

// ===================================================================
// Melding plakken
// ===================================================================
function renderMelding() {
  app.innerHTML = `<div class="scherm">
    ${kop({ titel: 'Melding plakken', terug: { href: '#/', tekst: 'Prikbord' } })}
    <main class="inhoud">
      <div class="veld op-kurk">
        <label for="mail">Mail van het NOC</label>
        <textarea id="mail" rows="6" placeholder="Plak hier de hele mail…">${esc(staat.meldingTekst)}</textarea>
      </div>
      <div id="melding-uitkomst"></div>
      <p class="info-kurk">${ICON.slot}De mail zelf wordt niet opgeslagen. IP-adressen, serienummers, ticketnummers en namen worden eruit gefilterd.</p>
    </main>${nav('melding')}</div>`;
  let t;
  $('#mail').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => verwerkMelding(e.target.value), 300);
  });
  if (staat.meldingTekst) verwerkMelding(staat.meldingTekst);
}

async function verwerkMelding(tekst) {
  staat.meldingTekst = tekst;
  const doel = $('#melding-uitkomst');
  if (!doel) return;
  if (!tekst.trim()) { doel.innerHTML = ''; staat.melding = null; return; }
  const s = soort(tekst);
  if (s === 'werkbon') {
    doel.innerHTML = `<div class="postit blauw scheef-4"><span class="pin"></span><h2>Dit is een werkbon</h2>
      <p class="tekst">Werkbonnen zet je via Importeren op het bord, met oorzaak en oplossing erbij.</p>
      <button class="knop" data-actie="werkbon-naar-import">Naar importeren</button></div>`;
    return;
  }
  if (s !== 'melding') {
    doel.innerHTML = `<div class="postit grijs"><h2>Niet herkend</h2><p class="tekst">Ik vind geen locatiecode in deze tekst. Heb je de hele mail geplakt?</p></div>`;
    return;
  }
  const m = await parseMelding(tekst);
  staat.melding = m;
  const o = m.locatiecode ? staat.objecten.find((x) => x.locatiecode === m.locatiecode) : null;
  const eerder = o ? storingenVan(o.id) : [];
  const veldHtml = (titel, waarde) => `<div style="display:flex;flex-direction:column;gap:1px;min-width:0"><span class="rij-titel">${titel}</span><span style="font-size:14px;font-weight:600;overflow-wrap:anywhere">${esc(waarde || '–')}</span></div>`;

  doel.innerHTML = `
    <section class="postit groen scheef-4" style="padding-top:22px;gap:12px">
      <span class="pin blauw"></span>
      <h2>${o ? 'Herkend!' : 'Nieuw object'}</h2>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 12px">
        ${veldHtml('Object', o ? o.naam : m.naamVoorstel)}
        ${veldHtml('Prioriteit', m.prioriteit)}
        ${veldHtml('Locatiecode', m.locatiecode)}
        ${veldHtml('Apparaat', m.apparaattype)}
      </div>
      ${m.omschrijving ? `<p class="tekst" style="margin:0">${esc(m.omschrijving)}</p>` : ''}
      <div id="sla" ${m.sla ? '' : 'hidden'}></div>
    </section>

    ${o && (o.sleutel || o.noc_toegang || o.bijzonderheden) ? `
    <a href="#/object/${o.id}" class="postit geel scheef-3" style="gap:8px">
      <span class="pin"></span><h3>Toegang</h3>
      ${o.sleutel ? `<span class="tekst"><b>Sleutel:</b> ${esc(o.sleutel)}</span>` : ''}
      ${o.noc_toegang ? `<span class="tekst"><b>NOC:</b> ${esc(o.noc_info || 'toegang aanvragen')}</span>` : ''}
      ${o.bijzonderheden ? `<span class="tekst">${esc(o.bijzonderheden)}</span>` : ''}
    </a>` : ''}

    ${eerder.length ? `<div class="sectie"><span class="label">Eerder hier opgelost</span><span class="klein">${eerder.length}</span></div>
      ${eerder.slice(0, 3).map((s, i) => `<div class="postit ${KLEUREN[(i + 1) % 4]} scheef-${(i % 4) + 1}" style="padding-top:12px">
        <span class="klein">${esc(datumNl(s.datum))}</span>
        <strong style="font-size:14px">${esc(s.omschrijving || s.oorzaak || '')}</strong>
        ${s.oplossing ? `<span class="tekst">${esc(s.oplossing)}</span>` : ''}
      </div>`).join('')}` : ''}

    <div class="postit papier scheef-3" style="padding:12px 14px">
      <label class="vinkje"><input type="checkbox" data-vinkje="aan" ${staat.vinkjes.aan ? 'checked' : ''}>Aangemeld bij NOC</label>
      <label class="vinkje"><input type="checkbox" data-vinkje="af" ${staat.vinkjes.af ? 'checked' : ''}>Afgemeld bij NOC</label>
    </div>

    ${o
      ? `<button class="knop groot" data-actie="open-object" data-id="${o.id}">${ICON.sleutel}Open toegangskaart</button>`
      : `<button class="knop groot" data-actie="maak-object">${ICON.plus}Object aanmaken</button>`}
  `;
  clearInterval(staat.slaTimer);
  if (m.sla) {
    const tik = () => tekenSla(m.sla);
    tik();
    staat.slaTimer = setInterval(tik, 30000);
    staat.timers.push(staat.slaTimer);
  }
}

function tekenSla(slaIso) {
  const el = $('#sla');
  if (!el) return;
  const rest = new Date(slaIso).getTime() - Date.now();
  const totaal = 8 * 3600 * 1000;
  const pct = Math.max(0, Math.min(100, (rest / totaal) * 100));
  let tekst;
  if (rest <= 0) tekst = 'verlopen';
  else {
    const u = Math.floor(rest / 3600000), m = Math.floor((rest % 3600000) / 60000);
    tekst = `nog ${u}u ${m}m`;
  }
  el.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px"><span style="font-weight:600">SLA</span><span>${tekst} · ${new Date(slaIso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}</span></div>
    <div class="sla-balk ${rest < 3600000 ? 'krap' : ''}"><div style="width:${pct}%"></div></div>`;
}

async function openObjectVanuitMelding(id) {
  // Nieuwe hostnames/apparaattypes uit de melding toevoegen aan het object
  const o = object(id);
  const m = staat.melding;
  if (o && m) {
    const hosts = uniek([...(o.hostnames || []), ...m.hostnames]);
    const types = uniek([...(o.apparaattypes || []), m.apparaattype]);
    if (hosts.length !== (o.hostnames || []).length || types.length !== (o.apparaattypes || []).length) {
      const { error } = await sb.from('objecten').update({ hostnames: hosts, apparaattypes: types }).eq('id', id);
      if (!error) Object.assign(o, { hostnames: hosts, apparaattypes: types });
    }
  }
  location.hash = '#/object/' + id;
}

// ===================================================================
// Werkbonnen importeren
// ===================================================================
function renderImport() {
  app.innerHTML = `<div class="scherm">
    ${kop({ titel: 'Werkbonnen importeren', terug: { href: '#/', tekst: 'Prikbord' } })}
    <main class="inhoud">
      <div class="dropzone" id="drop">
        ${ICON.upload}
        <strong style="font-size:14px">Sleep werkbon-mails (.msg of .eml) hierheen</strong>
        <div class="knoppen">
          <label class="knop" for="bestanden">Kies bestanden</label>
          <button class="knop rand" data-actie="plak-toggle">Tekst plakken</button>
        </div>
        <input id="bestanden" class="visueel-verborgen" type="file" multiple accept=".msg,.eml,.txt,message/rfc822,text/plain">
      </div>
      <div class="veld op-kurk" id="plak-veld" ${staat.importTekst ? '' : 'hidden'}>
        <label for="plak">Werkbon-tekst (meerdere mag)</label>
        <textarea id="plak" rows="6">${esc(staat.importTekst)}</textarea>
        <button class="knop wit" data-actie="lees-tekst">Inlezen</button>
      </div>
      <div id="import-lijst"></div>
    </main>${nav('import')}</div>`;

  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('actief'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('actief'); }));
  drop.addEventListener('drop', (e) => leesBestanden(e.dataTransfer.files));
  $('#bestanden').addEventListener('change', (e) => leesBestanden(e.target.files));
  renderImportLijst();
  if (staat.importTekst && !staat.importItems.length) leesTekst(staat.importTekst);
}

let MsgReader = null;
async function tekstUitBestand(bestand) {
  const naam = bestand.name.toLowerCase();
  if (naam.endsWith('.msg')) {
    if (!MsgReader) {
      const mod = await import('https://cdn.jsdelivr.net/npm/@kenjiuno/msgreader@1/+esm');
      MsgReader = mod.default?.default || mod.default || mod.MsgReader;
    }
    const data = new MsgReader(await bestand.arrayBuffer()).getFileData();
    if (data.body) return data.body;
    if (data.bodyHtml) return htmlNaarTekst(data.bodyHtml);
    if (data.html) return htmlNaarTekst(new TextDecoder().decode(data.html));
    return '';
  }
  const tekst = await bestand.text();
  return naam.endsWith('.eml') ? tekstUitEml(tekst) : tekst;
}

async function leesBestanden(lijstB) {
  if (!lijstB?.length) return;
  toast(`${lijstB.length} bestand(en) lezen…`, 10000);
  const teksten = [];
  for (const b of lijstB) {
    try {
      teksten.push(await tekstUitBestand(b));
    } catch (e) {
      toast(`${b.name} kon niet gelezen worden`, 4000);
    }
  }
  await verwerkTeksten(teksten);
}

async function leesTekst(tekst) {
  staat.importTekst = tekst;
  await verwerkTeksten([tekst]);
}

async function bekendeHashes() {
  const { data } = await sb.from('storingen').select('bron_hash').not('bron_hash', 'is', null);
  return new Set((data || []).map((x) => x.bron_hash));
}

async function verwerkTeksten(teksten) {
  const items = [];
  for (const t of teksten) {
    for (const deel of splitsWerkbonnen(t)) {
      if (soort(deel) !== 'werkbon') continue;
      items.push(await parseWerkbon(deel));
    }
  }
  if (!items.length) {
    toast('Geen werkbonnen herkend', 4000);
    return;
  }
  const hashes = await bekendeHashes();
  const gezien = new Set();
  const namen = new Map();
  for (const it of items) {
    const o = it.locatiecode ? staat.objecten.find((x) => x.locatiecode === it.locatiecode) : null;
    it.objectId = o?.id || null;
    if (it.bron_hash && (hashes.has(it.bron_hash) || gezien.has(it.bron_hash))) it.status = 'bekend';
    else if (!it.locatiecode) it.status = 'geen-code';
    else it.status = o ? 'bestaand' : 'nieuw';
    if (it.bron_hash) gezien.add(it.bron_hash);
    it.mee = it.status === 'nieuw' || it.status === 'bestaand';
    if (it.status === 'nieuw' && !namen.has(it.locatiecode)) namen.set(it.locatiecode, it.naam);
  }
  staat.importItems = [...staat.importItems.filter((x) => !items.some((y) => y.bron_hash && y.bron_hash === x.bron_hash)), ...items];
  staat.importNamen = new Map([...(staat.importNamen || []), ...namen]);
  toast(`${items.length} werkbon(nen) gelezen`);
  renderImportLijst();
}

function renderImportLijst() {
  const doel = $('#import-lijst');
  if (!doel) return;
  const items = staat.importItems;
  if (!items.length) { doel.innerHTML = ''; return; }
  const nieuweCodes = new Set(items.filter((i) => i.status === 'nieuw').map((i) => i.locatiecode));
  const aantalMee = items.filter((i) => i.mee).length;
  const labels = {
    nieuw: ['Nieuw object', 'chip'],
    bestaand: ['Bij bestaand', 'chip licht'],
    bekend: ['Al bekend, overslaan', 'chip licht'],
    'geen-code': ['Geen locatiecode', 'chip licht'],
  };
  doel.innerHTML = `
    <div class="sectie"><span class="label">Controleren</span><span class="klein">${items.length} gelezen · ${nieuweCodes.size} ${nieuweCodes.size === 1 ? 'nieuw object' : 'nieuwe objecten'}</span></div>
    <div style="display:flex;flex-direction:column;gap:14px">
    ${items.map((it, i) => {
      const o = it.objectId ? object(it.objectId) : null;
      const kleur = it.status === 'nieuw' ? 'geel' : it.status === 'bestaand' ? 'blauw' : 'grijs';
      const [lab, cls] = labels[it.status];
      const naamInvoer = it.status === 'nieuw' && staat.importNamen.get(it.locatiecode) !== undefined && items.findIndex((x) => x.status === 'nieuw' && x.locatiecode === it.locatiecode) === i;
      return `<div class="postit ${kleur} scheef-${(i % 4) + 1}" style="padding:12px 14px;gap:6px">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
          <h3 style="font-size:23px">${esc(o ? o.naam : (staat.importNamen.get(it.locatiecode) || it.naam || 'Onbekend'))}</h3>
          <span class="${cls}" style="white-space:nowrap">${lab}</span>
        </div>
        <span class="klein">${it.locatiecode ? 'Locatie ' + esc(it.locatiecode) + ' · ' : ''}${esc(datumNl(it.datum))}</span>
        ${naamInvoer ? `<div class="veld"><label for="naam-${i}">Naam nieuw object</label><input id="naam-${i}" type="text" data-naam-code="${esc(it.locatiecode)}" value="${esc(staat.importNamen.get(it.locatiecode))}"></div>` : ''}
        ${it.oorzaak ? `<span class="tekst"><b>Oorzaak:</b> ${esc(it.oorzaak)}</span>` : ''}
        ${it.oplossing ? `<span class="tekst"><b>Oplossing:</b> ${esc(it.oplossing)}</span>` : ''}
        ${it.meetwaarden ? `<span class="klein">Meting: ${esc(it.meetwaarden)}</span>` : ''}
        ${it.tips.length ? `<span class="klein">Tip gevonden: ${esc(it.tips[0])}</span>` : ''}
        ${it.status === 'nieuw' || it.status === 'bestaand' ? `<label class="vinkje"><input type="checkbox" data-mee="${i}" ${it.mee ? 'checked' : ''}>Meenemen</label>` : ''}
      </div>`;
    }).join('')}
    </div>
    <p class="info-kurk">${ICON.slot}Weggefilterd: IP-adressen, serienummers, melding- en projectnummers, uren, kilometers en namen.</p>
    <button class="knop groot" data-actie="import-opslaan" ${aantalMee ? '' : 'disabled'}>${aantalMee} ${aantalMee === 1 ? 'werkbon' : 'werkbonnen'} op het bord zetten</button>
    <button class="knop rand wit" data-actie="import-wissen">Lijst wissen</button>`;

  doel.querySelectorAll('[data-mee]').forEach((cb) => cb.addEventListener('change', () => {
    staat.importItems[+cb.dataset.mee].mee = cb.checked;
    renderImportLijst();
  }));
  doel.querySelectorAll('[data-naam-code]').forEach((inp) => inp.addEventListener('input', () => {
    staat.importNamen.set(inp.dataset.naamCode, inp.value);
  }));
}

async function importOpslaan() {
  const knop = app.querySelector('[data-actie="import-opslaan"]');
  if (knop) knop.disabled = true;
  const mee = staat.importItems.filter((i) => i.mee);
  const uid = staat.gebruiker.id;
  try {
    // 1. Nieuwe objecten aanmaken (één per locatiecode)
    const nieuw = new Map();
    for (const it of mee.filter((i) => i.status === 'nieuw')) {
      const g = nieuw.get(it.locatiecode) || { hostnames: [], tips: [], adres: it.adres };
      g.hostnames.push(...it.hostnames);
      g.tips.push(...it.tips);
      nieuw.set(it.locatiecode, g);
    }
    if (nieuw.size) {
      const rijen = [...nieuw].map(([code, g]) => ({
        locatiecode: code,
        naam: (staat.importNamen.get(code) || '').trim() || 'Locatie ' + code,
        adres: g.adres || null,
        hostnames: uniek(g.hostnames),
        bijzonderheden: uniek(g.tips).join('\n') || null,
        kleur: KLEUREN[hashNr(code) % 4],
        bijgewerkt_door: uid,
      }));
      const { data, error } = await sb.from('objecten').insert(rijen).select();
      if (error) throw error;
      staat.objecten.unshift(...data);
      for (const it of mee) {
        if (it.status === 'nieuw') it.objectId = data.find((d) => d.locatiecode === it.locatiecode).id;
      }
    }

    // 2. Bestaande objecten aanvullen met nieuwe hostnames en tips
    for (const it of mee.filter((i) => i.status === 'bestaand')) {
      const o = object(it.objectId);
      const hosts = uniek([...(o.hostnames || []), ...it.hostnames]);
      const bestaandeTekst = (o.bijzonderheden || '').toLowerCase();
      const nieuweTips = it.tips.filter((t) => !bestaandeTekst.includes(t.toLowerCase().slice(0, 40)));
      if (hosts.length !== (o.hostnames || []).length || nieuweTips.length) {
        const upd = { hostnames: hosts, bijzonderheden: [o.bijzonderheden, ...nieuweTips].filter(Boolean).join('\n') || null };
        const { error } = await sb.from('objecten').update(upd).eq('id', o.id);
        if (!error) Object.assign(o, upd);
      }
    }

    // 3. Storingen toevoegen
    const storingRijen = mee.map((it) => ({
      object_id: it.objectId,
      datum: it.datum || new Date().toISOString().slice(0, 10),
      omschrijving: it.omschrijving || null,
      oorzaak: it.oorzaak || null,
      oplossing: it.oplossing || null,
      meetwaarden: it.meetwaarden || null,
      trefwoorden: it.trefwoorden,
      bron: 'werkbon',
      bron_hash: it.bron_hash,
      aangemaakt_door: uid,
    }));
    const { data, error } = await sb.from('storingen').upsert(storingRijen, { onConflict: 'bron_hash', ignoreDuplicates: true }).select();
    if (error) throw error;
    staat.storingen.unshift(...(data || []));
    staat.importItems = [];
    staat.importTekst = '';
    staat.importNamen = new Map();
    toast(`${data?.length ?? storingRijen.length} werkbonnen op het bord gezet`, 4000);
    geocodeOntbrekende();
    location.hash = '#/';
  } catch (e) {
    toast('Importeren mislukt: ' + e.message, 6000);
    if (knop) knop.disabled = false;
  }
}

// ===================================================================
// Klik-acties (event delegation)
// ===================================================================
app.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-actie]');
  if (!el) return;
  const actie = el.dataset.actie;
  switch (actie) {
    case 'herlaad': location.reload(); break;
    case 'vergeten': wachtwoordVergeten(); break;
    case 'uitloggen': await sb.auth.signOut(); break;
    case 'nieuw-ww': staat.wachtwoordZetten = true; render(); break;
    case 'storing-form': $('#storing-form').hidden = false; $('#s-oms').focus(); break;
    case 'storing-annuleer': $('#storing-form').hidden = true; break;
    case 'storing-weg': {
      if (!confirm('Deze storing verwijderen?')) return;
      const { error } = await sb.from('storingen').delete().eq('id', el.dataset.id);
      if (error) return toast('Verwijderen mislukt');
      staat.storingen = staat.storingen.filter((s) => s.id !== el.dataset.id);
      render();
      break;
    }
    case 'foto': toonFoto(el.dataset.id); break;
    case 'werkbon-naar-import':
      staat.importTekst = staat.meldingTekst;
      staat.meldingTekst = '';
      staat.importItems = [];
      location.hash = '#/import';
      break;
    case 'open-object': openObjectVanuitMelding(el.dataset.id); break;
    case 'maak-object': {
      const m = staat.melding;
      staat.prefill = {
        naam: m.naamVoorstel,
        locatiecode: m.locatiecode,
        adres: m.adres,
        apparaattypes: uniek([m.apparaattype]),
        hostnames: m.hostnames,
        ...(m.gps ? { lat: m.gps.lat, lng: m.gps.lng } : {}),
      };
      location.hash = '#/nieuw';
      break;
    }
    case 'plak-toggle': $('#plak-veld').hidden = !$('#plak-veld').hidden; $('#plak')?.focus(); break;
    case 'lees-tekst': leesTekst($('#plak').value); break;
    case 'import-opslaan': importOpslaan(); break;
    case 'import-wissen': staat.importItems = []; staat.importTekst = ''; renderImport(); break;
    default: break;
  }
});

app.addEventListener('change', (e) => {
  const v = e.target.dataset?.vinkje;
  if (v) staat.vinkjes[v] = e.target.checked;
});

// ===================================================================
// Start
// ===================================================================
sb.auth.onAuthStateChange((event, sessie) => {
  const wasIngelogd = !!staat.sessie;
  staat.sessie = sessie;
  staat.gebruiker = sessie?.user || null;
  if (event === 'PASSWORD_RECOVERY') staat.wachtwoordZetten = true;
  if (event === 'SIGNED_OUT') {
    staat.geladen = false;
    staat.objecten = [];
    staat.storingen = [];
    staat.fotos = [];
  }
  if (event === 'SIGNED_IN' && !wasIngelogd) staat.geladen = false;
  // SIGNED_IN komt ook bij terugkeren naar het tabblad: dan niet opnieuw tekenen
  const opnieuw = event === 'SIGNED_IN' ? !wasIngelogd : ['SIGNED_OUT', 'PASSWORD_RECOVERY', 'INITIAL_SESSION'].includes(event);
  if (opnieuw) {
    if (/access_token|error_description/.test(location.hash)) history.replaceState(null, '', location.pathname + '#/');
    setTimeout(render, 0);
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
