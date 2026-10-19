'use strict';
/* BPM & key with Essentia.js 0.1.3 (AGPL-3.0, https://github.com/MTG/essentia.js, see vendor/essentia/NOTICE.txt).
   Standard Essentia algorithms with the settings Tunebat's analyzer uses: 16 kHz mono input,
   KeyExtractor with the "bgate" profile and PercivalBpmEstimator between 50 and 210 BPM. */
const VERSION = '0.1.3';
// The UMD build of the WebAssembly module ends with `exports.EssentiaWASM = Module` and picks up a
// predefined global Module, which is how it tells us when its runtime is ready.
var exports = {};
var Module = {};
const runtime = new Promise((resolve, reject) => { Module.onRuntimeInitialized = resolve; Module.onAbort = reject; });
const base = new URL('./vendor/essentia/', self.location.href);
importScripts(new URL('essentia-wasm.umd.js?v=' + VERSION, base).href, new URL('essentia.js-core.umd.min.js?v=' + VERSION, base).href);
const ready = runtime.then(() => new Essentia(exports.EssentiaWASM || Module));
ready.then(() => self.postMessage({ ready: true }), error => self.postMessage({ loadError: String(error && error.message || error) }));

self.onmessage = async ({ data }) => {
  const requestId = data && data.requestId;
  let signal;
  try {
    const essentia = await ready;
    signal = essentia.arrayToVector(data.signal);
    const key = essentia.KeyExtractor(signal, true, 4096, 4096, 12, 3500, 60, 25, 0.2, 'bgate', 16000, 0.0001, 440, 'cosine', 'hann');
    const { bpm } = essentia.PercivalBpmEstimator(signal, 1024, 2048, 128, 128, 210, 50, 16000);
    self.postMessage({ requestId, key: key.key, scale: key.scale, strength: key.strength, bpm });
  } catch (error) {
    self.postMessage({ requestId, error: String(error && error.message || error) });
  } finally {
    if (signal && typeof signal.delete === 'function') signal.delete();
  }
};
