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
  return parts.map(p => p.trim()).filter(Boolean);
}

// Derive a coarse anomaly-type label for RQ1-style filtering.
// Categories: Hardware, Software/Control, Communication, Environmental, Operational/Policy
function deriveAnomalyType(p) {
  const src = normalize(p.SourceOfAnomaly);

  if (!src) return "";

  // direct matches (after normalize)
  if (src === "hardware") return "Hardware";
  if (src === "software/control" || src === "software" || src === "control" || src === "software control") {
    return "Software/Control";
  }
  if (src === "communication" || src === "comms" || src === "network") return "Communication";
  if (src === "environmental" || src === "environment") return "Environmental";
  if (
    src === "operational/policy" ||
    src === "operational" ||
    src === "policy" ||
    src === "operations/policy" ||
    src === "operational policy"
  ) {
    return "Operational/Policy";
  }

  // fallback: if column sometimes already has the exact label casing
  // (e.g., "Hardware") and normalize() didn't collapse it as expected
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

function linkify(value){
  const s = (value ?? '').toString().trim();
  if(!s) return '';
  if(/^https?:\/\//i.test(s)){
    return `<a href="${s}" target="_blank" rel="noopener noreferrer">${s}</a>`;
  }
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
  const q = normalize(document.getElementById('searchBox').value);
  if(q){
    const colsForSearch = ALL_COLS.filter(c => c !== 'BibTeX');
    const hay = colsForSearch.map(c => normalize(paper[c])).join(' | ');
    if(!hay.includes(q)) return false;
  }

  const yMin = safeYear(document.getElementById('yearMin').value);
  const yMax = safeYear(document.getElementById('yearMax').value);
  const y = safeYear(paper.Year);
  if(yMin !== null && (y === null || y < yMin)) return false;
  if(yMax !== null && (y === null || y > yMax)) return false;

  for(const f of FACETS){
    if(opts.excludeFacet && opts.excludeFacet === f.key) continue;
    const selected = state.facetSelected[f.key];
    if(selected && selected.size){
      const vals = splitValues(paper[f.key]);
      const ok = vals.some(v => selected.has(v));
      if(!ok) return false;
    }
  }
  return true;
}

function getFilteredPapers(){
  return DATA.papers.filter(p => matchesAllFilters(p));
}

function renderMeta(filtered){
  document.getElementById('meta').textContent = `Showing ${filtered.length} / ${DATA.papers.length} papers`;
}

function renderTable(rows){
  const table = document.getElementById('papersTable');
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  thead.innerHTML = '';
  tbody.innerHTML = '';

  const trh = document.createElement('tr');
  for(const col of VISIBLE_COLS){
    const th = document.createElement('th');
    th.textContent = col;
    trh.appendChild(th);
  }
  thead.appendChild(trh);

  for(const p of rows){
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', () => openModal(p));
    for(const col of VISIBLE_COLS){
      const td = document.createElement('td');
      if(col === 'DOI_or_URL') td.innerHTML = linkify(p[col]);
      else td.textContent = (p[col] ?? '').toString();
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

function facetCounts(excludeFacetKey){
  const counts = new Map();
  for(const p of DATA.papers){
    if(!matchesAllFilters(p, {excludeFacet: excludeFacetKey})) continue;
    for(const v of splitValues(p[excludeFacetKey])){
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }
  return counts;
}

function renderFacets(){
  const facetsDiv = document.getElementById('facets');
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
    for(const p of DATA.papers){
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
  colsSelect.innerHTML = '';

  for(const c of ALL_COLS){
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    opt.selected = (c !== 'BibTeX'); // hide BibTeX by default
    colsSelect.appendChild(opt);
  }
  VISIBLE_COLS = Array.from(colsSelect.selectedOptions).map(o => o.value);

  colsSelect.addEventListener('change', () => {
    VISIBLE_COLS = Array.from(colsSelect.selectedOptions).map(o => o.value);
    apply();
  });
}

function updateCharts(filtered){
  const pillarOrder = DATA.pillars ?? [];
  const pillarCounts = new Map(pillarOrder.map(p => [p, 0]));
  for(const p of filtered){
    const key = (p.Pillar ?? '').toString().trim();
    if(!pillarCounts.has(key)) pillarCounts.set(key, 0);
    pillarCounts.set(key, (pillarCounts.get(key) ?? 0) + 1);
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

  const pillarCtx = document.getElementById('pillarChart').getContext('2d');
  const yearCtx = document.getElementById('yearChart').getContext('2d');

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
  document.getElementById('searchBox').value = '';
  document.getElementById('yearMin').value = '';
  document.getElementById('yearMax').value = '';
  for(const f of FACETS) state.facetSelected[f.key] = new Set();
  const colsSelect = document.getElementById('colsSelect');
  Array.from(colsSelect.options).forEach(o => o.selected = (o.value !== 'BibTeX'));
  VISIBLE_COLS = Array.from(colsSelect.selectedOptions).map(o => o.value);
  renderFacets();
  apply();
}

function bibtexFor(p){
  const b = (p.BibTeX ?? '').toString().trim();
  if(b) return b;
  const key = (p.BibKey ?? '').toString().trim() || 'missingkey';
  const title = (p.Title ?? '').toString().replaceAll('{','').replaceAll('}','');
  const year = safeYear(p.Year);
  const authors = (p.Authors ?? '').toString();
  return `@misc{${key},\n  title={${title}},\n  author={${authors}},\n  year={${year ?? ''}},\n}\n`;
}

function bibtexDownload(filtered){
  const entries = filtered.map(bibtexFor).filter(x => x.trim().length > 0);
  const text = entries.join('\n\n') + '\n';
  downloadText('filtered_papers.bib', text, 'application/x-bibtex;charset=utf-8');
}

function csvDownload(filtered){
  const csv = toCsv(filtered, ALL_COLS);
  downloadText('filtered_papers.csv', csv, 'text/csv;charset=utf-8');
}

// Modal
let currentModalPaper=null;
function kvRow(k,v,isHtml=false){
  const wrap=document.createElement('div'); wrap.className='kv';
  const kk=document.createElement('div'); kk.className='k'; kk.textContent=k;
  const vv=document.createElement('div'); vv.className='v';
  if(isHtml) vv.innerHTML=v; else vv.textContent=(v ?? '').toString();
  wrap.appendChild(kk); wrap.appendChild(vv);
  return wrap;
}
function openModal(p){
  currentModalPaper=p;
  document.getElementById('modalTitle').textContent=(p.Title ?? '').toString() || '(Untitled)';
  const body=document.getElementById('modalBody'); body.innerHTML='';
  body.appendChild(kvRow('Authors', p.Authors));
  body.appendChild(kvRow('Year', p.Year));
  body.appendChild(kvRow('Venue', p['Venue/Publisher']));
  body.appendChild(kvRow('Pillar', p.Pillar));
  body.appendChild(kvRow('DOI/URL', linkify(p.DOI_or_URL), true));
  body.appendChild(kvRow('Abstract', p.Abstract));
  body.appendChild(kvRow('Key findings', p.KeyFindings));
  body.appendChild(kvRow('Limitations', p.Limitations));
  body.appendChild(kvRow('BibTeX', bibtexFor(p)));
  const modal=document.getElementById('modal');
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden','false');
}
function closeModal(){
  const modal=document.getElementById('modal');
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden','true');
  currentModalPaper=null;
}
function initModal(){
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modal').addEventListener('click', (e)=>{ if(e.target.id==='modal') closeModal(); });
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeModal(); });

  document.getElementById('copyBibBtn').addEventListener('click', async ()=>{
    if(!currentModalPaper) return;
    const text=bibtexFor(currentModalPaper);
    try{
      await navigator.clipboard.writeText(text);
      const btn=document.getElementById('copyBibBtn');
      const prev=btn.textContent;
      btn.textContent='Copied!';
      setTimeout(()=>btn.textContent=prev, 900);
    }catch(err){
      alert('Copy failed. Your browser may block clipboard access on this page.');
    }
  });

  document.getElementById('openLinkBtn').addEventListener('click', ()=>{
    if(!currentModalPaper) return;
    const s=(currentModalPaper.DOI_or_URL ?? '').toString().trim();
    let url=s;
    if(/^10\.\d{4,9}\//.test(s)) url=`https://doi.org/${s}`;
    if(/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener');
    else alert('No DOI/URL available for this paper.');
  });
}

(async function main(){
  try{
    DATA=await loadData();
    FACETS=DATA.facets ?? [];
    // Add derived "Anomaly type" facet (RQ1-style)
    // Compute derived label for each paper once on load.
    for(const p of (DATA.papers ?? [])){
      p.AnomalyType = deriveAnomalyType(p);
    }
    // Insert facet after Pillar if not already present
    if(!FACETS.some(f => (f.key || '').toLowerCase() === 'anomalytype')){
      const idx = Math.max(0, FACETS.findIndex(f => (f.key || '') === 'Pillar') + 1);
      FACETS.splice(idx, 0, {key:'AnomalyType', label:'Anomaly type'});
    }

    ALL_COLS=Object.keys(DATA.papers[0] ?? {});
    initColumnPicker();
    renderFacets();
    initModal();

    document.getElementById('searchBox').addEventListener('input', ()=>{ renderFacets(); apply(); });
    document.getElementById('yearMin').addEventListener('input', ()=>{ renderFacets(); apply(); });
    document.getElementById('yearMax').addEventListener('input', ()=>{ renderFacets(); apply(); });

    document.getElementById('resetBtn').addEventListener('click', resetAll);
    document.getElementById('downloadCsvBtn').addEventListener('click', ()=>csvDownload(getFilteredPapers()));
    document.getElementById('downloadBibBtn').addEventListener('click', ()=>bibtexDownload(getFilteredPapers()));

    apply();
  }catch(err){
    console.error(err);
    document.body.prepend(Object.assign(document.createElement('div'), {
      innerHTML: `<p style="padding:16px;color:#fff;background:#b91c1c">Error: ${err.message}</p>`
    }));
  }
})();
