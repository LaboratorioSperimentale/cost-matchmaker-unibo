/* ==========================================================================
   COST Action Matchmaker
   ========================================================================== */

const CSV_FILE = 'cost_actions.csv';
const PAGE_SIZE = 24;

// Stato dell'applicazione
let actions = [];   // tutte le Actions caricate dal CSV
let keys = [];      // parole chiave inserite dall'utente
let filtered = [];  // risultati correnti (match o esplora)
let visible = PAGE_SIZE;

const $ = selector => document.querySelector(selector);

/* ==========================================================================
   Utilità
   ========================================================================== */

// Normalizza il testo: minuscolo, senza accenti né punteggiatura
const norm = s =>
  (s || '')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// Converte "gg/mm/aaaa" (o qualsiasi formato valido per Date) in Date
function parseDate(s) {
  if (!s) return null;
  const parts = s.split('/');
  if (parts.length === 3) return new Date(+parts[2], +parts[1] - 1, +parts[0]);
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function dateIt(s) {
  const d = parseDate(s);
  return d ? new Intl.DateTimeFormat('it-IT').format(d) : 'Non disponibile';
}

// Data di scadenza come timestamp, con le date mancanti ordinate in fondo
function endTime(a) {
  return parseDate(a.end) || new Date(9999, 1);
}

// Prima parte dell'area scientifica (prima di "|" o " - ")
function macro(area) {
  return (area || 'Non classificata').split('|')[0].split(' - ')[0].trim() || 'Non classificata';
}

function esc(s) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(s || '').replace(/[&<>"']/g, c => entities[c]);
}

// Link esterno, solo per URL http(s)
function safeLink(url, label) {
  return /^https?:\/\//i.test(url || '')
    ? `<a href="${esc(url)}" target="_blank" rel="noopener">${label} ↗</a>`
    : '';
}

function keywordList(a) {
  return (a.keywords || '').split('|').map(x => x.trim()).filter(Boolean);
}

// Parole di almeno 3 caratteri, normalizzate
function terms(s) {
  return norm(s).split(' ').filter(x => x.length > 2);
}

/* ==========================================================================
   Caricamento e parsing del CSV
   ========================================================================== */

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some(v => v.trim())) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const headers = rows.shift().map(h => h.replace(/^﻿/, '').trim());
  return rows.map(r =>
    Object.fromEntries(headers.map((h, i) => [h, (r[i] || '').trim()]))
  );
}

// Mappa le colonne del CSV su nomi di campo più semplici
function toAction(r) {
  return {
    code: r['Code'],
    status: r['Status'],
    title: r['Title'],
    cost: r['COST Action Website'],
    site: r['Action Website'],
    keywords: r['Keywords of the action'],
    approval: r['CSO App. date'],
    end: r['Action end date'],
    area: r['Science field / research area addressed by the action'],
    members: r['COST members represented (in the MC)'],
  };
}

async function load() {
  const status = $('#dataStatus');
  try {
    const response = await fetch(CSV_FILE, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    actions = parseCSV(await response.text())
      .map(toAction)
      .filter(a => a.code && a.title);

    status.textContent = `${actions.length} Actions caricate`;
    status.className = 'data-status ok';

    if (document.body.dataset.page === 'explore') setupExplore();
  } catch (e) {
    status.textContent = 'Impossibile caricare il CSV';
    status.className = 'data-status error';
  }
}

/* ==========================================================================
   Matching per parole chiave
   ========================================================================== */

// Campi in cui cercare, con peso e etichetta mostrata all'utente
const MATCH_FIELDS = [
  { field: 'keywords', weight: 5, where: 'keyword COST' },
  { field: 'title',    weight: 3, where: 'titolo' },
  { field: 'area',     weight: 2, where: 'area scientifica' },
];
const MAX_WEIGHT = 5;

function match(a) {
  const hits = [];
  let score = 0;

  keys.forEach(key => {
    const normKey = norm(key);
    const keyTerms = terms(key);
    let best = 0;
    let where = '';

    MATCH_FIELDS.forEach(f => {
      const text = a[f.field];
      const normText = norm(text);
      const textTerms = terms(text);

      // Corrispondenza esatta (sottostringa) o per singole parole (anche prefissi)
      const exact = normText.includes(normKey);
      const byTerms =
        keyTerms.length &&
        keyTerms.every(t =>
          textTerms.some(x => x === t || x.startsWith(t) || t.startsWith(x))
        );

      const value = exact ? f.weight : byTerms ? f.weight * 0.7 : 0;
      if (value > best) {
        best = value;
        where = f.where;
      }
    });

    if (best) {
      score += best;
      hits.push({ k: key, where });
    }
  });

  return {
    ...a,
    hits,
    score: Math.round((100 * score) / (keys.length * MAX_WEIGHT)),
  };
}

/* ==========================================================================
   Pagina "Matchmaking"
   ========================================================================== */

function addKeywords() {
  $('#keywords').value
    .split(/[,;\n]+/)
    .map(x => x.trim())
    .filter(Boolean)
    .forEach(k => {
      if (!keys.some(v => norm(v) === norm(k))) keys.push(k);
    });

  $('#keywords').value = '';
  renderTags();
}

function renderTags() {
  const container = $('#keywordTags');
  container.innerHTML = keys
    .map((k, i) =>
      `<span class="tag">${esc(k)}<button data-i="${i}" aria-label="Rimuovi ${esc(k)}">×</button></span>`
    )
    .join('');

  container.querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      keys.splice(+b.dataset.i, 1);
      renderTags();
    };
  });
}

function runMatch() {
  addKeywords();
  if (!keys.length) {
    alert('Inserisci almeno una parola chiave.');
    return;
  }

  filtered = actions.map(match).filter(a => a.hits.length);
  renderMatch();

  $('#resultsSection').hidden = false;
  $('#resultsSection').scrollIntoView({ behavior: 'smooth' });
}

function renderMatch() {
  const sort = $('#sortBy').value;
  const list = [...filtered];

  list.sort((a, b) => {
    if (sort === 'score') return b.score - a.score;
    if (sort === 'end') return endTime(a) - endTime(b);
    return a.title.localeCompare(b.title);
  });

  $('#resultCount').textContent = list.length
    ? `${list.length} ${list.length === 1 ? 'Action corrispondente' : 'Actions corrispondenti'}`
    : 'Nessuna Action corrisponde alle parole inserite.';

  $('#results').innerHTML = list.length
    ? list.map(a => card(a, true)).join('')
    : `<div class="empty">
         <h3>Nessuna corrispondenza</h3>
         <p>Prova sinonimi o termini inglesi presenti nelle keyword COST. Non vengono aggiunti risultati non pertinenti.</p>
       </div>`;
}

/* ==========================================================================
   Card di una Action (usata in entrambe le pagine)
   ========================================================================== */

function description(a) {
  const topics = keywordList(a).slice(0, 4).join(', ');
  return `${a.title}. Area: ${a.area || 'non disponibile'}${topics ? `. Temi principali: ${topics}.` : '.'}`;
}

function card(a, withScore = false) {
  const keywords = keywordList(a);
  const end = parseDate(a.end);
  const expired = end && end < new Date();

  const scoreBlock = withScore
    ? `<div class="score">${a.score}%<small>corrispondenza</small></div>`
    : '';

  const matchBlock = withScore
    ? `<div class="match-box">
         <strong>Corrispondenze trovate</strong>
         <div class="keyword-list">
           ${a.hits.map(h => `<span class="pill match">✓ ${esc(h.k)} · ${esc(h.where)}</span>`).join('')}
         </div>
       </div>`
    : '';

  const keywordPills = keywords.length
    ? keywords.map(k => `<span class="pill">${esc(k)}</span>`).join('')
    : '<span>Non disponibili</span>';

  return `
    <article class="result-card ${expired ? 'expired' : ''}">
      <div class="card-top">
        <div>
          <div class="code">${esc(a.code)}</div>
          <h3>${esc(a.title)}</h3>
        </div>
        ${scoreBlock}
      </div>
      <p class="description">${esc(description(a))}</p>
      <div class="meta">
        <span><strong>Stato:</strong> ${esc(a.status || 'N/D')}</span>
        <span><strong>Scadenza Action:</strong> ${esc(dateIt(a.end))}</span>
        <span><strong>Macro-area:</strong> ${esc(macro(a.area))}</span>
      </div>
      ${matchBlock}
      <p><strong>Parole chiave del CSV</strong></p>
      <div class="keyword-list">${keywordPills}</div>
      <div class="links">
        ${safeLink(a.cost, 'Pagina COST')}
        ${safeLink(a.site, 'Sito della Action')}
      </div>
    </article>`;
}

/* ==========================================================================
   Pagina "Esplora"
   ========================================================================== */

function setupExplore() {
  const statuses = [...new Set(actions.map(a => a.status).filter(Boolean))].sort();
  const areas = [...new Set(actions.map(a => macro(a.area)))].sort();
  const years = [...new Set(actions.map(a => parseDate(a.end)?.getFullYear()).filter(Boolean))].sort();

  $('#statusFilter').innerHTML += statuses.map(x => `<option>${esc(x)}</option>`).join('');
  $('#areaFilter').innerHTML += areas.map(x => `<option>${esc(x)}</option>`).join('');
  $('#yearFilter').innerHTML += years.map(x => `<option>${x}</option>`).join('');

  const controls = ['freeSearch', 'statusFilter', 'areaFilter', 'yearFilter', 'timeFilter', 'exploreSort'];
  controls.forEach(id => {
    const eventName = id === 'freeSearch' ? 'input' : 'change';
    $('#' + id).addEventListener(eventName, () => {
      visible = PAGE_SIZE;
      renderExplore();
    });
  });

  $('#clearFilters').onclick = () => {
    ['freeSearch', 'statusFilter', 'areaFilter', 'yearFilter'].forEach(id => ($('#' + id).value = ''));
    $('#timeFilter').value = 'all';
    $('#exploreSort').value = 'end';
    visible = PAGE_SIZE;
    renderExplore();
  };

  $('#loadMore').onclick = () => {
    visible += PAGE_SIZE;
    drawExplore();
  };

  renderExplore();
}

function renderExplore() {
  const query = norm($('#freeSearch').value);
  const status = $('#statusFilter').value;
  const area = $('#areaFilter').value;
  const year = $('#yearFilter').value;
  const time = $('#timeFilter').value;
  const now = new Date();

  filtered = actions.filter(a => {
    const end = parseDate(a.end);
    return (
      (!query || norm([a.code, a.title, a.keywords, a.area].join(' ')).includes(query)) &&
      (!status || a.status === status) &&
      (!area || macro(a.area) === area) &&
      (!year || String(end?.getFullYear()) === year) &&
      (time === 'all' ||
        (time === 'future' && end >= now) ||
        (time === 'past' && end < now))
    );
  });

  const sort = $('#exploreSort').value;
  filtered.sort((a, b) =>
    sort === 'end'
      ? endTime(a) - endTime(b)
      : String(a[sort] || '').localeCompare(String(b[sort] || ''), 'it')
  );

  drawExplore();
}

function drawExplore() {
  $('#exploreCount').textContent = `${filtered.length} Actions trovate`;
  $('#exploreResults').innerHTML =
    filtered.slice(0, visible).map(a => card(a, false)).join('') ||
    '<div class="empty">Nessuna Action soddisfa i filtri.</div>';
  $('#loadMore').hidden = visible >= filtered.length;
}

/* ==========================================================================
   Avvio
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  if (document.body.dataset.page === 'match') {
    $('#addKeyword').onclick = addKeywords;
    $('#keywords').onkeydown = e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addKeywords();
      }
    };
    $('#matchButton').onclick = runMatch;
    $('#resetButton').onclick = () => {
      keys = [];
      renderTags();
      $('#resultsSection').hidden = true;
    };
    $('#sortBy').onchange = renderMatch;
  }

  load();
});
