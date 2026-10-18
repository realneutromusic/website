import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFLP, aggregate, exportRows } from '../assets/plugin-reader-core.js';

const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const length = n => { const out = []; do { out.push((n & 127) | (n > 127 ? 128 : 0)); n = Math.floor(n / 128); } while (n); return Buffer.from(out); };
const event = (id, payload) => Buffer.concat([Buffer.from([id]), length(payload.length), payload]);
const name = text => event(201, Buffer.from(text + '\0', 'utf16le'));
const field = (id, text) => { const bytes = Buffer.from(text + '\0'); return Buffer.concat([u32(id), u32(bytes.length), u32(0), bytes]); };
const wrapper = revision => event(213, Buffer.concat([u32(revision), field(54, 'Synth Ω'), field(56, 'Maker'), field(55, 'C:/Synth.vst3')]));
const project = (...events) => {
  const data = Buffer.concat(events);
  return Buffer.concat([Buffer.from('FLhd'), u32(6), Buffer.from([0, 0, 1, 0, 96, 0]), Buffer.from('FLdt'), u32(data.length), data]);
};

for (const revision of [6, 8, 9, 10, 11, 12]) test(`FL wrapper revision ${revision} reads metadata`, () => {
  const result = parseFLP(project(name('Fruity Wrapper'), wrapper(revision)));
  assert.equal(result.plugins.length, 1);
  assert.equal(result.plugins[0].name, 'Synth Ω');
  assert.equal(result.plugins[0].format, 'VST3');
  assert.equal(result.plugins[0].vendor, 'Maker');
  assert.equal(result.warnings.length, 0);
});
test('23 revision-12 instances produce named, deduplicated entries', () => {
  const result = parseFLP(project(...Array.from({ length: 23 }, () => [name('Fruity Wrapper'), wrapper(12)]).flat()));
  const rows = aggregate([{ id: 1, name: 'Regression.flp', plugins: result.plugins }]);
  assert.equal(rows.length, 1); assert.equal(rows[0].uses, 23);
  assert.equal(result.plugins.filter(p => p.unresolved).length, 0);
});
test('damaged wrapper is isolated from a later readable plugin', () => {
  const corrupt = event(213, Buffer.concat([u32(12), u32(54), u32(9999), u32(0)]));
  const result = parseFLP(project(name('Fruity Wrapper'), corrupt, name('Fruity Wrapper'), wrapper(12)));
  assert.equal(result.plugins.length, 2);
  assert.equal(result.plugins[0].unresolved, true);
  assert.equal(result.plugins[1].name, 'Synth Ω');
  assert.ok(result.warnings.some(w => w.includes('damaged')));
});
test('invalid event length is rejected instead of silently skipping data', () => {
  const data = project(Buffer.from([213, 255, 255, 255, 255, 255, 255]));
  assert.throws(() => parseFLP(data), /Invalid FL Studio event length/);
});
test('unknown revision does not manufacture a plugin identity', () => {
  const result = parseFLP(project(name('Fruity Wrapper'), wrapper(99)));
  assert.equal(result.plugins[0].unresolved, true);
});
test('CSV quotes multiline names and defuses spreadsheet formulas', () => {
  const result = parseFLP(project(name('Fruity Wrapper'), wrapper(12)));
  const rows = aggregate([{ id: 1, name: '=SUM(1,2)\n"project".flp', plugins: result.plugins }]);
  assert.match(exportRows(rows, true), /"'=SUM\(1,2\)\n""project"".flp"/);
});
