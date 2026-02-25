async function loadData(){
  const res = await fetch('data.json', {cache:'no-store'});
  if(!res.ok) throw new Error('Failed to load data.json');
  return await res.json();
}

function el(tag, attrs={}, children=[]){
  const e = document.createElement(tag);
  for(const [k,v] of Object.entries(attrs)){
    if(k === 'class') e.className = v;
    else if(k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  for(const c of children) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

function getMultiSelectValues(selectEl){
  return Array.from(selectEl.selectedOptions).map(o => o.value);
}

function safeYear(val){
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : null;
}

function normalize(s){ return (s ?? '').toString().toLowerCase(); }

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

function downloadText(filename, text){
  const blob = new Blob([text], {type:'text/plain;charset=utf-8'});
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
  // if it already looks like a URL, make it clickable
  if(/^https?:\/\//i.test(s)){
    return `<a href="${s}" target="_blank" rel="noopener noreferrer">${s}</a>`;
  }
  return s;
}

let DATA = null;
let ALL_COLS = [];
let VISIBLE_COLS = [];

function renderTable(rows){
  const table = document.getElementById('papersTable');
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  thead.innerHTML = '';
  tbody.innerHTML = '';

  const trh = document.createElement('tr');
  for(const col of VISIBLE_COLS){
    trh.appendChild(el('th', {}, [col]));
  }
  thead.appendChild(trh);

  for(const r of rows){
    const tr = document.createElement('tr');
    for(const col of VISIBLE_COLS){
      let v = r[col] ?? '';
      if(col === 'DOI_or_URL') tr.appendChild(el('td', {html: linkify(v)}));
      else tr.appendChild(el('td', {}, [v]));
    }
    tbody.appendChild(tr);
  }

  const meta = document.getElementById('meta');
  meta.textContent = `Showing ${rows.length} / ${DATA.papers.length} papers`;
}

function applyFilters(){
  const pillars = new Set(getMultiSelectValues(document.getElementById('pillarSelect')));
  const sources = new Set(getMultiSelectValues(document.getElementById('sourceSelect')));
  const q = normalize(document.getElementById('searchBox').value);
  const yMin = safeYear(document.getElementById('yearMin').value);
  const yMax = safeYear(document.getElementById('yearMax').value);

  const colsForSearch = ALL_COLS.filter(c => c !== 'BibTeX'); // keep search snappy

  const filtered = DATA.papers.filter(p => {
    if(pillars.size && !pillars.has((p.Pillar ?? '').toString())) return false;

    if(sources.size && !sources.has((p.SourceOfAnomaly ?? '').toString())) return false;

    const y = safeYear(p.Year);
    if(yMin !== null && (y === null || y < yMin)) return false;
    if(yMax !== null && (y === null || y > yMax)) return false;

    if(q){
      const hay = colsForSearch.map(c => normalize(p[c])).join(' | ');
      if(!hay.includes(q)) return false;
    }
    return true;
  });

  renderTable(filtered);
  return filtered;
}

function initColumnPicker(){
  const colsSelect = document.getElementById('colsSelect');
  colsSelect.innerHTML = '';
  for(const c of ALL_COLS){
    const opt = el('option', {value: c}, [c]);
    opt.selected = true;
    colsSelect.appendChild(opt);
  }
  colsSelect.addEventListener('change', () => {
    VISIBLE_COLS = getMultiSelectValues(colsSelect);
    applyFilters();
  });
}

function initPillarPicker(){
  const pillarSelect = document.getElementById('pillarSelect');
  pillarSelect.innerHTML = '';
  for(const p of DATA.pillars){
    pillarSelect.appendChild(el('option', {value: p}, [p]));
  }

function initSourcePicker(){
  const sourceSelect = document.getElementById('sourceSelect');
  if(!sourceSelect) return;

  sourceSelect.innerHTML = '';

  const set = new Set();
  for(const p of DATA.papers){
    const v = (p.SourceOfAnomaly ?? '').toString().trim();
    if(v) set.add(v);
  }

  const values = Array.from(set).sort((a,b)=>a.localeCompare(b));

  for(const v of values){
    const option = document.createElement("option");
    option.value = v;
    option.textContent = v;
    sourceSelect.appendChild(option);
  }

  sourceSelect.addEventListener('change', applyFilters);
}

function initControls(){
  document.getElementById('searchBox').addEventListener('input', applyFilters);
  document.getElementById('yearMin').addEventListener('input', applyFilters);
  document.getElementById('yearMax').addEventListener('input', applyFilters);

  document.getElementById('resetBtn').addEventListener('click', () => {
    document.getElementById('searchBox').value = '';
    document.getElementById('yearMin').value = '';
    document.getElementById('yearMax').value = '';
    const pillarSelect = document.getElementById('pillarSelect');
    Array.from(pillarSelect.options).forEach(o => o.selected = false);
    const sourceSelect = document.getElementById('sourceSelect');
    if(sourceSelect) Array.from(sourceSelect.options).forEach(o => o.selected = false);
    const colsSelect = document.getElementById('colsSelect');
    Array.from(colsSelect.options).forEach(o => o.selected = true);
    VISIBLE_COLS = [...ALL_COLS];
    applyFilters();
  });

  document.getElementById('downloadCsvBtn').addEventListener('click', () => {
    const filtered = applyFilters();
    const csv = toCsv(filtered, ALL_COLS);
    downloadText('filtered_papers.csv', csv);
  });
}

(async function main(){
  try{
    DATA = await loadData();
    ALL_COLS = Object.keys(DATA.papers[0] ?? {});
    VISIBLE_COLS = [...ALL_COLS];

    initPillarPicker();
    initSourcePicker();
    initColumnPicker();
    initControls();
    applyFilters();
  }catch(err){
    console.error(err);
    document.body.prepend(el('div', {class:'error', html:`<p style="padding:16px;color:#fff;background:#b91c1c">Error: ${err.message}</p>`}));
  }
})();
