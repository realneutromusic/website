import { readProject } from './plugin-reader-core.js?v=2';
const root = document.getElementById('tool-plugins');
root.innerHTML = `
  <h2 class="display">Plugin Reader</h2>
  <p class="desc">Drop a project to see its third-party plugins. Everything is read locally in your browser.</p>
  <div class="nt-tool-layout">
  <div class="nt-tool-input">
  <label class="drop-zone pr-drop" id="pr-drop">
    <input type="file" id="pr-files" accept=".als,.flp" aria-label="Choose a project to read">
    <svg class="drop-zone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <span class="drop-zone-label">Drop a project or click to choose one</span>
    <span class="drop-zone-sub">FL Studio .flp · Ableton Live .als</span>
  </label>
  <div class="file-chip" id="pr-file-chip"><span class="file-chip-name" id="pr-file-name"></span><button type="button" id="pr-clear" aria-label="Remove project">✕</button></div>
  <p id="pr-status" class="pr-status" role="status" aria-live="polite"></p>
  </div>
  <div class="nt-tool-output" id="pr-results" hidden><button type="button" id="pr-copy" class="pr-copy">Copy Names</button><ul id="pr-list" class="pr-list" aria-label="Plugins used"></ul></div>
  </div>
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



let generation = 0, names = [];
const status = message => { $('pr-status').textContent = message; };
function clearResults() {
  names = []; $('pr-list').replaceChildren(); $('pr-results').hidden = true;
  $('pr-copy').textContent = 'Copy Names';
}
async function analyze(file) {
  const current = ++generation;
  clearResults(); $('pr-file-name').textContent = file.name;
  $('pr-file-chip').classList.add('visible');
  root.setAttribute('aria-busy', 'true'); status('Reading project…');
  await new Promise(resolve => setTimeout(resolve, 0));
  if (current !== generation) return;
  try {
    const result = await readProject(file);
    if (current !== generation) return;
    const plugins = result.plugins.filter(plugin => !plugin.stock);
    names = [...new Map(plugins.filter(plugin => !plugin.unresolved).map(plugin => {
      const name = plugin.name.replace(/[\r\n]+/g, ' ').trim();
      return [name.toLocaleLowerCase('en'), name];
    })).values()].sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }));
    for (const name of names) {
      const item = document.createElement('li'); item.textContent = name; $('pr-list').append(item);
    }
    $('pr-results').hidden = !names.length;
    status(plugins.some(plugin => plugin.unresolved) ? 'Some plugins could not be identified in this project.'
      : result.warnings.length ? result.warnings.map(warning => warning.startsWith('WaveShell')
        ? 'Waves effect name unavailable (WaveShell).'
        : warning.startsWith('Patcher') ? 'Plugins inside Patcher cannot be listed.'
        : 'Some plugin names could not be read.').join(' ')
      : names.length ? '' : 'No third-party plugins found in this project.');
  } catch (error) {
    if (current === generation) status(error.message || 'Could not read this project. Try another file.');
  } finally {
    if (current === generation) root.setAttribute('aria-busy', 'false');
  }
}
function choose(files) {
  if (files.length > 1) { status('Choose one project at a time.'); return; }
  if (files[0]) analyze(files[0]);
}
$('pr-files').addEventListener('change', event => { choose(event.target.files); event.target.value = ''; });
const drop = $('pr-drop');
for (const type of ['dragenter', 'dragover']) drop.addEventListener(type, event => { event.preventDefault(); drop.classList.add('drag-over'); });
for (const type of ['dragleave', 'drop']) drop.addEventListener(type, event => { event.preventDefault(); drop.classList.remove('drag-over'); });
drop.addEventListener('drop', event => { event.stopPropagation(); choose(event.dataTransfer.files); });
for (const type of ['dragover', 'drop']) modal.addEventListener(type, event => {
  if (modal.classList.contains('pr-active') && event.dataTransfer?.types.includes('Files')) event.preventDefault();
});
$('pr-clear').addEventListener('click', () => {
  generation++; clearResults(); status(''); root.setAttribute('aria-busy', 'false');
  $('pr-file-chip').classList.remove('visible'); $('pr-file-name').textContent = ''; $('pr-files').focus();
});
$('pr-copy').addEventListener('click', async () => {
  const current = generation;
  try {
    await navigator.clipboard.writeText(names.join('\n'));
    if (current === generation) { $('pr-copy').textContent = '✓ Copied'; window.NTMotion?.feedback($('pr-copy')); }
  } catch {
    if (current === generation) status('Could not copy automatically. Select the names and copy them.');
  }
});
