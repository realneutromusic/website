/* Project metadata only. No plugin binaries are loaded or executed.
 * FLP event layout: https://pyflp.readthedocs.io/en/stable/architecture/flp-format.html
 * Wrapper fields: https://github.com/demberto/PyFLP/blob/master/pyflp/plugin.py
 */
export const MAX_FILE = 32 * 1024 * 1024;
const MAX_XML = 64 * 1024 * 1024;
const stockNames = {
  Eq8: 'EQ Eight', Eq3: 'EQ Three', Compressor2: 'Compressor', StereoGain: 'Utility',
  OriginalSimpler: 'Simpler', MultiSampler: 'Sampler', InstrumentVector: 'Wavetable',
  UltraAnalog: 'Analog', LoungeLizard: 'Electric', StringStudio: 'Tension',
  InstrumentImpulse: 'Impulse', InstrumentMeld: 'Meld', Hybrid: 'Hybrid Reverb',
  Chorus2: 'Chorus-Ensemble', PhaserNew: 'Phaser-Flanger', Redux2: 'Redux',
  SpectrumAnalyzer: 'Spectrum', DrumGroupDevice: 'Drum Rack',
  InstrumentGroupDevice: 'Instrument Rack', AudioEffectGroupDevice: 'Audio Effect Rack',
  MidiEffectGroupDevice: 'MIDI Effect Rack', MidiArpeggiator: 'Arpeggiator',
  MidiChord: 'Chord', MidiNoteLength: 'Note Length', MidiPitcher: 'Pitch',
  MidiRandom: 'Random', MidiScale: 'Scale', MidiVelocity: 'Velocity'
};
const clean = value => (value || '').replace(/\0/g, '').trim();
const value = (root, names) => {
  for (const name of names) {
    const found = root.getElementsByTagName(name)[0];
    const result = clean(found?.getAttribute('Value'));
    if (result) return result;
  }
  return '';
};
export function parseALS(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('Unsupported XML declarations. Export a standard Ableton Live set.');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror') || doc.documentElement.tagName !== 'Ableton' || !doc.querySelector('LiveSet')) {
    throw Error('This file is not a readable Ableton Live set.');
  }
  const plugins = [], warnings = [];
  const devices = [...doc.getElementsByTagName('Devices')].flatMap(node => [...node.children]);
  for (const device of devices) {
    const track = device.closest('AudioTrack, MidiTrack, GroupTrack, ReturnTrack, MasterTrack, MainTrack');
    const trackName = track ? value([...track.children].find(n => n.tagName === 'Name') || track, ['EffectiveName', 'UserName']) : '';
    const base = { track: trackName, vendor: '', stock: false };
    if (device.tagName === 'PluginDevice' || device.tagName === 'AuPluginDevice') {
      // Do not use the user-editable device label as a plugin identity.
      const info = device.querySelector('VstPluginInfo, Vst3PluginInfo, AuPluginInfo');
      const name = info && value(info, ['PlugName', 'Name']);
      const format = info?.tagName === 'Vst3PluginInfo' ? 'VST3' : info?.tagName === 'AuPluginInfo' ? 'AU' : 'VST2';
      plugins.push({ ...base, name: name || 'Unidentified plugin', format,
        vendor: info ? value(info, ['Manufacturer', 'Vendor']) : '', unresolved: !name });
      if (!name) warnings.push('A plugin has no readable identity in the saved project.');
    } else if (/^MxDevice/.test(device.tagName)) {
      const files = [...device.querySelectorAll('[Value]')].map(n => n.getAttribute('Value'));
      const file = files.find(v => /\.amxd$/i.test(v));
      plugins.push({ ...base, name: file ? file.split(/[\\/]/).pop().replace(/\.amxd$/i, '') : 'Unidentified Max for Live device',
        format: 'Max for Live', unresolved: !file });
      if (!file) warnings.push('A Max for Live device has no readable .amxd filename.');
    } else if ([...device.children].some(n => n.tagName === 'On')) {
      plugins.push({ ...base, name: stockNames[device.tagName] || device.tagName.replace(/([a-z])([A-Z])/g, '$1 $2'),
        format: 'Ableton stock', vendor: 'Ableton', stock: true });
    }
  }
  return { daw: 'Ableton Live', plugins, warnings: [...new Set(warnings)] };
}
function decode(bytes) {
  let oddZeros = 0;
  for (let i = 1; i < bytes.length; i += 2) if (!bytes[i]) oddZeros++;
  const utf16 = bytes.length % 2 === 0 && oddZeros > bytes.length / 4;
  try { return clean(new TextDecoder(utf16 ? 'utf-16le' : 'utf-8', { fatal: true }).decode(bytes)); }
  catch { return clean(new TextDecoder('windows-1252').decode(bytes)); }
}
function wrapper(bytes) {
  if (bytes.length < 4) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // FL's wrapper serialization revision is not the VST version. Newer
  // projects use revision 12 with the same length-prefixed metadata records.
  // https://github.com/dawhubapp/flpdiff/blob/main/docs/fl-format/flp-format-spec.md
  if (![6, 8, 9, 10, 11, 12].includes(view.getUint32(0, true))) return null;
  let offset = 4, name = '', vendor = '', path = '', format = 'VST';
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw Error('Truncated FL Studio plugin metadata.');
    const id = view.getUint32(offset, true), size = view.getUint32(offset + 4, true), high = view.getUint32(offset + 8, true);
    offset += 12;
    if (high || size > bytes.length - offset) throw Error('Invalid FL Studio plugin metadata length.');
    const part = bytes.subarray(offset, offset + size);
    if (id === 54) name = decode(part);
    if (id === 55) path = decode(part);
    if (id === 56) vendor = decode(part);
    if (id === 52) format = 'VST3';
    if (id === 51 && format !== 'VST3') format = 'VST2';
    offset += size;
  }
  if (/\.vst3$/i.test(path)) format = 'VST3';
  if (/\.component$/i.test(path)) format = 'AU';
  if (!name && path) name = path.split(/[\\/]/).pop().replace(/\.(dll|vst3|vst|component)$/i, '');
  return { name, vendor, format };
}
export function parseFLP(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = at => new TextDecoder().decode(bytes.subarray(at, at + 4));
  if (bytes.length < 22 || tag(0) !== 'FLhd' || view.getUint32(4, true) !== 6) throw Error('Invalid FL Studio project header.');
  let offset = 14;
  if (tag(offset) !== 'FLdt') throw Error('FL Studio project data is missing.');
  const size = view.getUint32(offset + 4, true);
  offset += 8;
  if (size > bytes.length - offset) throw Error('This FL Studio project is truncated.');
  const end = offset + size, plugins = [], warnings = [];
  let pending = false;
  const flush = () => {
    if (pending) {
      plugins.push({ name: 'Unidentified plugin', vendor: '', format: 'VST', stock: false, unresolved: true });
      warnings.push('A wrapper has no readable plugin identity; custom channel names were not used.');
    }
    pending = false;
  };
  const nonPlugins = new Set(['', 'sampler', 'audio clip', 'automation clip', 'automation', 'layer']);
  while (offset < end) {
    const id = bytes[offset++];
    let length;
    if (id < 192) length = id < 64 ? 1 : id < 128 ? 2 : 4;
    else {
      length = 0;
      let complete = false;
      for (let shift = 0; shift < 35; shift += 7) {
        if (offset >= end) throw Error('Truncated FL Studio event length.');
        const next = bytes[offset++];
        length += (next & 127) * 2 ** shift;
        if (!(next & 128)) { complete = true; break; }
      }
      if (!complete) throw Error('Invalid FL Studio event length.');
    }
    if (length > end - offset) throw Error('Truncated FL Studio event data.');
    const data = bytes.subarray(offset, offset + length);
    offset += length;
    // New channels / mixer slots also end an unresolved wrapper context.
    if (id === 64 || id === 98) flush();
    if (id === 201) {
      flush();
      const name = decode(data);
      if (name.toLowerCase() === 'fruity wrapper') pending = true;
      else if (!nonPlugins.has(name.toLowerCase())) {
        plugins.push({ name, vendor: 'Image-Line', format: 'FL stock', stock: true });
        if (name.toLowerCase() === 'patcher') warnings.push('Patcher is present. Plugins embedded inside Patcher are not expanded by this reader.');
      }
    }
    if (id === 213 && pending) {
      try {
        const info = wrapper(data);
        if (info?.name) {
          plugins.push({ ...info, stock: false }); pending = false;
          if (/^waveshell/i.test(info.name)) warnings.push('WaveShell exposes its host name here. The contained Waves plugin is not identified by this metadata.');
        }
      } catch {
        // One damaged wrapper must not discard every readable plugin in a set.
        warnings.push('One plugin has damaged metadata. Other readable plugins are still listed.');
      }
    }
  }
  flush();
  return { daw: 'FL Studio', plugins, warnings: [...new Set(warnings)] };
}
export async function readProject(file, suppliedBytes) {
  if (!/\.(als|flp)$/i.test(file.name)) throw Error('Choose an Ableton .als or FL Studio .flp project.');
  if (file.size > MAX_FILE) throw Error('This project exceeds the 32 MB file limit.');
  const bytes = suppliedBytes || new Uint8Array(await file.arrayBuffer());
  if (/\.flp$/i.test(file.name)) return parseFLP(bytes);
  let xml;
  if (bytes[0] === 31 && bytes[1] === 139) {
    if (typeof DecompressionStream === 'undefined') throw Error('Gzip reading requires a current browser. Try Chrome, Edge, Firefox or Safari.');
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const parts = []; let total = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.length;
        if (total > MAX_XML) throw Error('This set exceeds the 64 MB expanded XML limit.');
        parts.push(part.value);
      }
      xml = await new Blob(parts).text();
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  } else xml = new TextDecoder().decode(bytes);
  return parseALS(xml);
}
export function aggregate(projects, { stock = false, project = '', format = '', query = '', sort = 'name' } = {}) {
  const rows = new Map();
  for (const item of projects) {
    if (item.error || (project && String(item.id) !== project)) continue;
    for (const [index, plugin] of item.plugins.entries()) {
      if (!stock && plugin.stock) continue;
      // Keep format, vendor and version intact; unresolved instances cannot be deduplicated safely.
      const key = [plugin.name.trim().toLowerCase(), plugin.vendor.trim().toLowerCase(), plugin.format,
        plugin.unresolved ? `${item.id}:${index}` : ''].join('\u0000');
      if (!rows.has(key)) rows.set(key, { ...plugin, key, uses: 0, projects: new Map(), tracks: new Set() });
      const row = rows.get(key);
      row.uses++;
      row.projects.set(item.id, item.name);
      if (plugin.track) row.tracks.add(`${item.name} / ${plugin.track}`);
    }
  }
  return [...rows.values()].filter(row => (!format || row.format === format) &&
    `${row.name} ${row.vendor}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => (sort === 'uses' ? b.uses - a.uses : 0) || a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }) || a.format.localeCompare(b.format));
}
export function exportRows(rows, csv = false) {
  if (!csv) return rows.map(row => `${row.name}${row.vendor ? ` — ${row.vendor}` : ''} [${row.format}] · ${row.uses} use(s) · ${[...row.projects.values()].join('; ')}`).join('\n');
  // Defuse spreadsheet formula cells, including user-controlled project names.
  const cell = value => '"' + String(value).replace(/^[\s]*[=+@-]/, match => "'" + match).replace(/"/g, '""') + '"';
  return [['Plugin', 'Vendor', 'Format', 'Uses', 'Projects', 'Tracks'], ...rows.map(row =>
    [row.name, row.vendor, row.format, row.uses, [...row.projects.values()].join('; '), [...row.tracks].join('; ')])]
    .map(row => row.map(cell).join(',')).join('\r\n');
}
