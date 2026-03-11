async function loadData(){
  const res = await fetch('data.json', {cache:'no-store'});
  if(!res.ok) throw new Error('Failed to load data.json');
  return await res.json();
}

function normalize(s){ return (s ?? '').toString().toLowerCase(); }
function safeYear(val){
  const n = parseInt((val ?? '').toString(), 10);
  return Number.isFinite(n) ? n : null;
}

function splitValues(raw){
  const s = (raw ?? '').toString().trim();
  if(!s) return [];
  const parts = s.split(/[\n;|]+/g).flatMap(x => x.split(/\s*,\s*/g));
  return parts
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => {
      // Normalize lifecycle naming variants
      if(p === "Recovery / Mitigation") return "Recovery/Mitigation";
      if(p === "Analysis / Learning") return "Analysis/Learning";
      return p;
    });
}

function deriveAnomalyType(p) {
  const src = normalize(p.SourceOfAnomaly);
  if (!src) return "";

  if (src === "hardware") return "Hardware";
  if (src === "software/control" || src === "software" || src === "control" || src === "software control") return "Software/Control";
  if (src === "communication" || src === "comms" || src === "network") return "Communication";
  if (src === "environmental" || src === "environment") return "Environmental";
  if (src === "operational/policy" || src === "operational" || src === "policy" || src === "operations/policy" || src === "operational policy") return "Operational/Policy";

  const raw = (p.SourceOfAnomaly || "").trim();
  if (raw === "Hardware" || raw === "Software/Control" || raw === "Communication" || raw === "Environmental" || raw === "Operational/Policy") {
    return raw;
  }
  return "";
}

function toCsv(rows, cols){
  const esc = (v) => {
    const s = (v ?? '').toString().replaceAll('\r',' ').replaceAll('\n',' ');
    if(s.includes('"') || s.includes(',') || s.includes('\t')) return `"${s.replaceAll('"','""')}"`;
    return s;
  };
  const header = cols.map(esc).join(',');
  const lines = rows.map(r => cols.map(c => esc(r[c])).join(','));
  return [header, ...lines].join('\n');
}

function downloadText(filename, text, mime='text/plain;charset=utf-8'){
  const blob = new Blob([text], {type:mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function formatDoiOrUrl(s){
  s = (s ?? '').toString().trim();
  if(!s) return '';
  if(/^https?:\/\//i.test(s)) return `<a href="${s}" target="_blank" rel="noopener noreferrer">${s}</a>`;
  if(/^10\.\d{4,9}\//.test(s)){
    const url = `https://doi.org/${s}`;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${s}</a>`;
  }
  return s;
}

let DATA=null;
let ALL_COLS=[];
let VISIBLE_COLS=[];
let FACETS=[];
let state = { facetSelected: {} };

let pillarChart=null;
let yearChart=null;

function matchesAllFilters(paper, opts={excludeFacet:null}){
  const q = normalize(document.getElementById('searchBox')?.value ?? '');
  const yearMin = safeYear(document.getElementById('yearMin')?.value ?? '');
  const yearMax = safeYear(document.getElementById('yearMax')?.value ?? '');

  if(q){
    const hay = ALL_COLS.map(c => normalize(paper[c])).join(' ');
    if(!hay.includes(q)) return false;
  }

  const y = safeYear(paper.Year);
  if(yearMin !== null && (y === null || y < yearMin)) return false;
  if(yearMax !== null && (y === null || y > yearMax)) return false;

  for(const f of FACETS){
    if(opts.excludeFacet && f.key === opts.excludeFacet) continue;
    const selected = state.facetSelected[f.key];
    if(selected && selected.size){
      const vals = splitValues(paper[f.key]);
      let ok=false;
      for(const v of vals){
        if(selected.has(v)){ ok=true; break; }
      }
      if(!ok) return false;
    }
  }
  return true;
}

function getFilteredPapers(){
  return (DATA.papers ?? []).filter(p => matchesAllFilters(p));
}

function renderMeta(filtered){
  const total = (DATA.papers ?? []).length;
  const n = filtered.length;
  const meta = document.getElementById('meta');
  if(meta) meta.textContent = `${n} / ${total} papers`;
}

function renderTable(rows){
  const table = document.getElementById('papersTable');
  if(!table) return;
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  if(!thead || !tbody) return;

  thead.innerHTML = '';
  tbody.innerHTML = '';

  const trh = document.createElement('tr');
  for(const c of VISIBLE_COLS){
    const th = document.createElement('th');
    th.textContent = c;
    trh.appendChild(th);
  }
  thead.appendChild(trh);

  for(const r of rows){
    const tr = document.createElement('tr');
    for(const c of VISIBLE_COLS){
      const td = document.createElement('td');

      if(c === 'DOI_or_URL'){
        td.innerHTML = formatDoiOrUrl(r[c]);
      }else{
        td.textContent = (r[c] ?? '').toString();
      }

      if(c === 'BibTeX'){
        td.classList.add('bibtex-cell');
        td.addEventListener('click', () => openBibtexModal(r));
        td.title = 'Click to view BibTeX';
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

// ----- Modal (matches your IDs) -----
function showModal(title, bodyHtml){
  const modal = document.getElementById('modal');
  const modalTitle = document.getElementById('modalTitle');
  const modalBody = document.getElementById('modalBody');
  if(!modal || !modalTitle || !modalBody) return;

  modalTitle.textContent = title ?? '';
  modalBody.innerHTML = bodyHtml ?? '';

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function hideModal(){
  const modal = document.getElementById('modal');
  if(!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

let MODAL_CURRENT_PAPER = null;

function openBibtexModal(paper){
  MODAL_CURRENT_PAPER = paper;

  const bib = (paper.BibTeX ?? '').toString();
  const doi = (paper.DOI_or_URL ?? '').toString().trim();

  const escaped = bib
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

  showModal(
    paper.BibKey ? `BibTeX — ${paper.BibKey}` : 'BibTeX',
    `<pre style="white-space:pre-wrap; margin:0;">${escaped}</pre>`
  );

  const copyBtn = document.getElementById('copyBibBtn');
  if(copyBtn){
    copyBtn.onclick = async () => {
      try{
        await navigator.clipboard.writeText(bib);
        alert('Copied BibTeX to clipboard.');
      }catch{
        alert('Could not copy. Please copy manually.');
      }
    };
  }

  const openLinkBtn = document.getElementById('openLinkBtn');
  if(openLinkBtn){
    openLinkBtn.disabled = !doi;
    openLinkBtn.onclick = () => {
      if(!doi) return;
      let url = doi;
      if(!/^https?:\/\//i.test(url) && /^10\.\d{4,9}\//.test(url)){
        url = `https://doi.org/${url}`;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    };
  }
}

function initModal(){
  const close = document.getElementById('modalClose');
  if(close) close.addEventListener('click', hideModal);

  const modal = document.getElementById('modal');
  if(modal){
    modal.addEventListener('click', (e) => {
      if(e.target === modal) hideModal();
    });
  }
}

// ----- Facets -----
function facetCounts(excludeFacetKey){
  const counts = new Map();
  for(const p of (DATA.papers ?? [])){
    if(!matchesAllFilters(p, {excludeFacet: excludeFacetKey})) continue;
    for(const v of splitValues(p[excludeFacetKey])){
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }
  return counts;
}

function renderFacets(){
  const facetsDiv = document.getElementById('facets');
  if(!facetsDiv) return;
  facetsDiv.innerHTML = '';

  for(const f of FACETS){
    if(!state.facetSelected[f.key]) state.facetSelected[f.key] = new Set();

    const section = document.createElement('div');
    section.className = 'facet';

    const head = document.createElement('div');
    head.className = 'facet-title';

    const title = document.createElement('div');
    title.textContent = f.label;

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', () => {
      state.facetSelected[f.key] = new Set();
      renderFacets();
      apply();
    });

    head.appendChild(title);
    head.appendChild(clearBtn);

    const items = document.createElement('div');
    items.className = 'facet-items';

    const allVals = new Map();
    for(const p of (DATA.papers ?? [])){
      for(const v of splitValues(p[f.key])){
        allVals.set(v, (allVals.get(v) ?? 0) + 1);
      }
    }

    const dynCounts = facetCounts(f.key);

    const sorted = Array.from(allVals.entries())
      .sort((a,b) => (b[1]-a[1]) || a[0].localeCompare(b[0]));

    for(const [val] of sorted){
      const dyn = dynCounts.get(val) ?? 0;

      const row = document.createElement('div');
      row.className = 'facet-item' + (dyn === 0 ? ' disabled' : '');

      const left = document.createElement('div');
      left.className = 'facet-left';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = state.facetSelected[f.key].has(val);
      cb.disabled = (dyn === 0 && !cb.checked);
      cb.addEventListener('change', () => {
        if(cb.checked) state.facetSelected[f.key].add(val);
        else state.facetSelected[f.key].delete(val);
        renderFacets();
        apply();
      });

      const name = document.createElement('div');
      name.className = 'facet-name';
      name.textContent = val;

      left.appendChild(cb);
      left.appendChild(name);

      const count = document.createElement('div');
      count.className = 'facet-count';
      count.textContent = `${dyn}`;

      row.appendChild(left);
      row.appendChild(count);
      items.appendChild(row);
    }

    section.appendChild(head);
    section.appendChild(items);
    facetsDiv.appendChild(section);
  }
}

function initColumnPicker(){
  const colsSelect = document.getElementById('colsSelect');
  if(!colsSelect) return;

  colsSelect.innerHTML = '';
  for(const c of ALL_COLS){
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    opt.selected = (c !== 'BibTeX');
    colsSelect.appendChild(opt);
  }
  VISIBLE_COLS = Array.from(colsSelect.selectedOptions).map(o => o.value);

  colsSelect.addEventListener('change', () => {
    VISIBLE_COLS = Array.from(colsSelect.selectedOptions).map(o => o.value);
    apply();
  });
}

// ----- Charts (counts lifecycle using primary+secondary via PillarAny) -----
function updateCharts(filtered){
  const pillarOrder = DATA.pillars ?? [];
  const pillarCounts = new Map(pillarOrder.map(p => [p, 0]));

  for(const p of filtered){
    const vals = splitValues(p.PillarAny ?? p.Pillar);
    if(vals.length === 0) continue;
    for(const key of vals){
      if(!pillarCounts.has(key)) pillarCounts.set(key, 0);
      pillarCounts.set(key, (pillarCounts.get(key) ?? 0) + 1);
    }
  }

  const pillarLabels = Array.from(pillarCounts.keys());
  const pillarData = pillarLabels.map(k => pillarCounts.get(k));

  const yearCounts = new Map();
  for(const p of filtered){
    const y = safeYear(p.Year);
    if(y === null) continue;
    yearCounts.set(y, (yearCounts.get(y) ?? 0) + 1);
  }
  const years = Array.from(yearCounts.keys()).sort((a,b)=>a-b);
  const yearData = years.map(y => yearCounts.get(y));

  const pillarCanvas = document.getElementById('pillarChart');
  const yearCanvas = document.getElementById('yearChart');
  if(!pillarCanvas || !yearCanvas) return;

  const pillarCtx = pillarCanvas.getContext('2d');
  const yearCtx = yearCanvas.getContext('2d');

  if(pillarChart) pillarChart.destroy();
  if(yearChart) yearChart.destroy();

  pillarChart = new Chart(pillarCtx, {
    type: 'bar',
    data: { labels: pillarLabels, datasets: [{ label: 'Papers', data: pillarData }] },
    options: { responsive:true, plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true, ticks:{precision:0}}} }
  });

  yearChart = new Chart(yearCtx, {
    type: 'line',
    data: { labels: years, datasets: [{ label: 'Papers', data: yearData, tension:0.2 }] },
    options: { responsive:true, plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true, ticks:{precision:0}}} }
  });
}

function apply(){
  const filtered = getFilteredPapers();
  renderMeta(filtered);
  renderTable(filtered);
  updateCharts(filtered);
}

function resetAll(){
  const sb = document.getElementById('searchBox');
  const y1 = document.getElementById('yearMin');
  const y2 = document.getElementById('yearMax');
  if(sb) sb.value = '';
  if(y1) y1.value = '';
  if(y2) y2.value = '';
  for(const f of FACETS) state.facetSelected[f.key] = new Set();

  const colsSelect = document.getElementById('colsSelect');
  if(colsSelect){
    Array.from(colsSelect.options).forEach(o => o.selected = (o.value !== 'BibTeX'));
    VISIBLE_COLS = Array.from(colsSelect.selectedOptions).map(o => o.value);
  }
  renderFacets();
  apply();
}

function initDownloads(){
  const csvBtn = document.getElementById('downloadCsvBtn');
  if(csvBtn){
    csvBtn.addEventListener('click', () => {
      const filtered = getFilteredPapers();
      const csv = toCsv(filtered, VISIBLE_COLS);
      downloadText('uav_papers_filtered.csv', csv, 'text/csv;charset=utf-8');
    });
  }

  // Your HTML has downloadBibBtn
  const bibBtn = document.getElementById('downloadBibBtn');
  if(bibBtn){
    bibBtn.addEventListener('click', () => {
      const filtered = getFilteredPapers();
      const bibs = filtered.map(p => (p.BibTeX ?? '').toString().trim()).filter(Boolean);
      downloadText('uav_papers_filtered.bib', bibs.join('\n\n') + '\n', 'application/x-bibtex;charset=utf-8');
    });
  }

  const resetBtn = document.getElementById('resetBtn');
  if(resetBtn){
    resetBtn.addEventListener('click', () => resetAll());
  }
}

(async function main(){
  try{
    DATA = await loadData();
    FACETS = DATA.facets ?? [];

    // Derived anomaly-type facet
    for(const p of (DATA.papers ?? [])){
      p.AnomalyType = deriveAnomalyType(p);
    }

    // Derive PillarAny (primary + secondary)
    for(const p of (DATA.papers ?? [])){
      const prim = (p.Pillar ?? '').toString().trim();
      const all = (p.Pillar_All ?? '').toString().trim();
      const sec = (p.Pillar_Secondary ?? '').toString().trim();
      if(all){
        p.PillarAny = all;
      }else if(sec){
        p.PillarAny = [prim, sec].filter(Boolean).join(', ');
      }else{
        p.PillarAny = prim;
      }
    }

    // Ensure AnomalyType facet exists after Pillar (primary)
    if(!FACETS.some(f => (f.key || '').toLowerCase() === 'anomalytype')){
      const idx = Math.max(0, FACETS.findIndex(f => (f.key || '') === 'Pillar') + 1);
      FACETS.splice(idx, 0, {key:'AnomalyType', label:'Anomaly type'});
    }

    ALL_COLS = Object.keys((DATA.papers ?? [])[0] ?? {});
    initColumnPicker();
    renderFacets();
    initModal();
    initDownloads();

    document.getElementById('searchBox')?.addEventListener('input', ()=>{ renderFacets(); apply(); });
    document.getElementById('yearMin')?.addEventListener('input', ()=>{ renderFacets(); apply(); });
    document.getElementById('yearMax')?.addEventListener('input', ()=>{ renderFacets(); apply(); });

    apply();
  }catch(err){
    console.error(err);
    alert('Failed to load data. Check console for details.');
  }
})();