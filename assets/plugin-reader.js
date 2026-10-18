import { readProject, aggregate, exportRows, MAX_FILE } from './plugin-reader-core.js?v=2';

const root = document.getElementById('tool-plugins');
root.innerHTML = `
  <div class="pr-heading"><div><h2 class="display">Plugin Reader</h2>
  <p class="desc">Every session. Every plugin. One place.</p></div>
  <span class="pr-local"><span aria-hidden="true">●</span> On-device analysis</span></div>
  <div class="pr-workspace"><aside class="pr-input-panel" aria-label="Project files">
  <div class="pr-panel-label"><span>01 / Projects</span><span>ALS · FLP</span></div>
  <label class="pr-drop" id="pr-drop">
    <input type="file" id="pr-files" accept=".als,.flp" multiple>
    <span class="pr-drop-icon" aria-hidden="true">+</span>
    <strong id="pr-drop-title">Drop your projects</strong><span>or click to browse</span>
    <small>Up to 50 projects · 32 MB per file</small>
  </label>
  <div class="pr-progress" id="pr-progress" hidden aria-hidden="true"></div>
  <p class="pr-status" id="pr-status" role="status" aria-live="polite">Ableton Live & FL Studio.<br>Files stay on your device.</p>
  <details class="pr-projects" id="pr-projects"><summary>Loaded projects <span id="pr-file-count">(0)</span></summary><ul id="pr-project-list"></ul></details>
  <div class="pr-actions">
    <label class="pr-stock"><input type="checkbox" id="pr-stock"> Include stock devices</label>
    <button type="button" id="pr-clear" disabled>Clear all</button>
  </div>
  <details class="pr-help"><summary>What can it read?</summary><p>Ableton .als and FL Studio .flp projects, including VST2, VST3, Audio Units and Max for Live metadata. Up to 50 projects, 32 MB each.</p><p>Reads saved metadata, including bypassed devices. It cannot check installed plugins, licenses or missing samples. Names, versions and formats stay separate. Stock racks count as devices. Plugins inside FL Studio Patcher are not expanded; some wrappers may not expose a name.</p></details>
  <p class="pr-privacy">Private by design. No uploads or account required.</p>
  </aside><div class="pr-output-panel">
  <div class="pr-panel-label"><span>02 / Your inventory</span><span>Click a plugin for details</span></div>
  <div class="pr-stats" aria-label="Plugin list totals">
    <div><strong id="pr-total">0</strong><span>Plugin entries</span></div>
    <div><strong id="pr-project-total">0</strong><span>Projects read</span></div>
    <div><strong id="pr-uses">0</strong><span>Total uses</span></div>
  </div>
  <div class="pr-filters">
    <label class="pr-search">Search plugins or vendors<input id="pr-search" type="search" placeholder="Name or manufacturer…"></label>
    <label>Project<select id="pr-project"><option value="">All projects</option></select></label>
    <label>Format<select id="pr-format"><option value="">All formats</option></select></label>
    <label>Sort by<select id="pr-sort"><option value="name">Name A–Z</option><option value="uses">Most used</option></select></label>
  </div>
  <div class="pr-list-header"><p class="pr-list-caption" id="pr-caption">Plugin inventory</p><button id="pr-reset" type="button" hidden>Reset filters</button></div>
  <div id="pr-list" class="pr-list"></div>
  <div class="pr-export"><span>Export the current view</span><button type="button" id="pr-copy" disabled>Copy</button><button type="button" id="pr-txt" disabled>TXT ↓</button><button type="button" id="pr-csv" disabled>CSV ↓</button></div>
  </div></div>
`;
const $ = id => document.getElementById(id);
const modal = $('tools-modal');
const tabs = [$('tab-audio'), $('tab-plugins')];
function selectTab(index, focus = false) {
  tabs.forEach((tab, i) => {
    tab.setAttribute('aria-selected', String(i === index));
    tab.tabIndex = i === index ? 0 : -1;
    $(tab.getAttribute('aria-controls')).hidden = i !== index;
  });
  modal.classList.toggle('pr-active', index === 1);
  if (focus) tabs[index].focus();
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(index));
  tab.addEventListener('keydown', event => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      selectTab(event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index, true);
    }
  });
});
// Keep keyboard focus inside the existing dialog, including its new panels.
modal.addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const controls = [...modal.querySelectorAll('button, input, select, summary, a[href], [tabindex="0"]')]
    .filter(el => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length);
  const first = controls[0], last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
});

let projects = [], nextId = 0, generation = 0, queue = Promise.resolve(), pending = 0;
let shown = [];
const status = message => { $('pr-status').textContent = message; };
const node = (tag, text, className) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
};
function options(select, items, placeholder) {
  const selected = select.value;
  select.replaceChildren(new Option(placeholder, ''), ...items.map(([key, name]) => new Option(name, key)));
  if (items.some(([key]) => key === selected)) select.value = selected;
}
function render() {
  root.classList.toggle('pr-has-files', projects.length > 0);
  $('pr-drop-title').textContent = projects.length ? 'Add more projects' : 'Drop your projects';
  $('pr-progress').hidden = !pending;
  $('pr-drop').classList.toggle('pr-reading', pending > 0);
  options($('pr-project'), projects.filter(p => !p.error).map(p => [String(p.id), p.name]), 'All projects');
  const stock = $('pr-stock').checked;
  const available = aggregate(projects, { stock, project: $('pr-project').value });
  options($('pr-format'), [...new Set(available.map(p => p.format))].sort().map(f => [f, f]), 'All formats');
  shown = aggregate(projects, { stock, project: $('pr-project').value, format: $('pr-format').value,
    query: $('pr-search').value, sort: $('pr-sort').value });
  const unresolved = shown.filter(row => row.unresolved).length;
  const all = aggregate(projects, { stock });
  $('pr-total').textContent = all.length;
  $('pr-project-total').textContent = projects.filter(p => !p.error).length;
  $('pr-uses').textContent = all.reduce((sum, row) => sum + row.uses, 0);
  $('pr-file-count').textContent = `(${projects.length})`;
  $('pr-clear').disabled = !projects.length && !pending;
  ['pr-copy', 'pr-txt', 'pr-csv'].forEach(id => { $(id).disabled = !shown.length; });
  $('pr-caption').textContent = `${shown.length} of ${all.length} entries${unresolved ? ` · ${unresolved} unidentified` : ''}`;
  $('pr-reset').hidden = !$('pr-search').value && !$('pr-project').value && !$('pr-format').value;
  const projectList = $('pr-project-list');
  projectList.replaceChildren();
  for (const project of projects) {
    const li = node('li');
    const body = node('div');
    body.append(node('strong', project.name), node('small', project.error || `${project.daw} · ${project.plugins.length} saved devices`));
    if (project.error) li.classList.add('pr-error');
    for (const warning of project.warnings || []) body.append(node('small', warning, 'pr-warning'));
    const remove = node('button', '×');
    remove.type = 'button'; remove.setAttribute('aria-label', `Remove ${project.name}`);
    remove.addEventListener('click', () => {
      projects = projects.filter(p => p.id !== project.id); render(); status(`Removed ${project.name}.`);
      $('pr-projects').querySelector('summary').focus();
    });
    li.append(body, remove); projectList.append(li);
  }
  const list = $('pr-list');
  const expanded = new Set([...list.querySelectorAll('details[open]')].map(el => el.dataset.key));
  list.replaceChildren();
  if (!shown.length) {
    list.append(node('p', !projects.length ? 'Add a project to see what’s inside.' :
      projects.every(p => p.error) ? 'No readable projects yet. Open Projects above for details.' :
      $('pr-search').value || $('pr-format').value ? 'No matching plugins. Try changing your filters.' :
      'No third-party plugins found in this view. Try including stock devices.', 'pr-empty'));
  }
  for (const row of shown) {
    const card = node('details', undefined, 'pr-row');
    card.dataset.key = row.key;
    card.open = expanded.has(row.key);
    const summary = node('summary');
    const identity = node('span', undefined, 'pr-identity');
    identity.append(node('strong', row.name), node('small', row.vendor || (row.unresolved ? 'Identity unavailable' : 'Vendor not stored')));
    const usage = node('span', undefined, 'pr-usage');
    usage.append(node('strong', String(row.uses)), node('small', row.uses === 1 ? 'use' : 'uses'));
    summary.append(identity, node('span', row.format, 'pr-badge'), usage);
    const detail = node('div', undefined, 'pr-row-detail');
    detail.append(node('p', `${row.uses} ${row.uses === 1 ? 'use' : 'uses'} across ${row.projects.size} ${row.projects.size === 1 ? 'project' : 'projects'}`));
    const ul = node('ul');
    for (const name of row.projects.values()) ul.append(node('li', name));
    detail.append(ul);
    if (row.tracks.size) { detail.append(node('p', 'Saved track locations:')); const locations = node('ul');
      for (const track of row.tracks) locations.append(node('li', track)); detail.append(locations); }
    card.append(summary, detail); list.append(card);
  }
}
async function addFiles(files, token) {
  let added = 0, skipped = 0, failed = 0, limited = false;
  for (const file of files) {
    if (token !== generation) return;
    status(`Reading ${file.name}…`);
    // Let the loading message paint before XML parsing begins.
    await new Promise(resolve => setTimeout(resolve, 0));
    if (token !== generation) return;
    const project = { id: ++nextId, name: file.name, plugins: [] };
    try {
      if (!/\.(als|flp)$/i.test(file.name)) throw Error('Choose an Ableton .als or FL Studio .flp project.');
      if (file.size > MAX_FILE) throw Error('This project exceeds the 32 MB file limit.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (crypto.subtle) {
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
        project.fingerprint = file.name + ':' + [...digest].map(b => b.toString(16).padStart(2, '0')).join('');
      }
      if (token !== generation) return;
      if (project.fingerprint && projects.some(p => !p.error && p.fingerprint === project.fingerprint)) { skipped++; continue; }
      if (projects.length >= 50) { limited = true; break; }
      Object.assign(project, await readProject(file, bytes)); added++;
    }
    catch (error) { project.error = error.message || 'Could not read this project.'; failed++; }
    if (token !== generation) return;
    if (projects.length >= 50) { limited = true; break; }
    projects.push(project); render();
  }
  if (token !== generation) return;
  if (failed || projects.some(p => p.warnings?.length)) $('pr-projects').open = true;
  if (token === generation) status(`${added} project(s) read · ${skipped} duplicate(s) skipped · ${failed} file(s) could not be read.${limited ? ' 50 project limit reached. Remove projects to add more.' : ''}${projects.some(p => p.warnings?.length) ? ' Check Projects for reading notes.' : ''}`);
}
function enqueue(files) {
  const batch = [...files], token = generation;
  if (!batch.length) return;
  pending++; render();
  queue = queue.then(() => addFiles(batch, token)).catch(() => { if (token === generation) status('Reading stopped. Please try the project again.'); })
    .finally(() => { pending--; render(); });
}
$('pr-files').addEventListener('change', event => { enqueue(event.target.files); event.target.value = ''; });
const drop = $('pr-drop');
['dragenter', 'dragover'].forEach(type => drop.addEventListener(type, event => { event.preventDefault(); drop.classList.add('pr-over'); }));
['dragleave', 'drop'].forEach(type => drop.addEventListener(type, event => { event.preventDefault(); drop.classList.remove('pr-over'); }));
drop.addEventListener('drop', event => { event.stopPropagation(); enqueue(event.dataTransfer.files); });
// Do not let files dropped elsewhere in the open reader replace the page.
for (const type of ['dragover', 'drop']) modal.addEventListener(type, event => {
  if (modal.classList.contains('pr-active') && event.dataTransfer?.types.includes('Files')) event.preventDefault();
});
for (const id of ['pr-search', 'pr-project', 'pr-format', 'pr-sort', 'pr-stock']) $(id).addEventListener(id === 'pr-search' ? 'input' : 'change', render);
$('pr-reset').addEventListener('click', () => {
  $('pr-search').value = ''; $('pr-project').value = ''; $('pr-format').value = '';
  render(); $('pr-search').focus();
});
$('pr-clear').addEventListener('click', () => {
  generation++; projects = []; $('pr-search').value = ''; $('pr-project').value = ''; $('pr-format').value = '';
  render(); status('All projects cleared. Nothing was saved.');
});
$('pr-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(exportRows(shown)); status('Current view copied.'); }
  catch { status('Clipboard access is unavailable. Use TXT or CSV to save this view.'); }
});
function download(csv) {
  const url = URL.createObjectURL(new Blob([csv ? '\uFEFF' + exportRows(shown, true) : exportRows(shown)], { type: csv ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8' }));
  const link = node('a'); link.href = url; link.download = `neutro-plugin-list.${csv ? 'csv' : 'txt'}`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  status('Current view exported.');
}
$('pr-txt').addEventListener('click', () => download(false));
$('pr-csv').addEventListener('click', () => download(true));
render();
