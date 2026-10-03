// Tiny in-browser test harness (no libraries). (A1)
// API: describe(name, fn), it(name, covers[], fn), assert.*, runAll(), scanForWeekdays(textByFile, allow), SUITES
// Other agents add suites by creating tests/tests-<name>.js (module) that imports { describe, it, assert } from './harness.js'
// and adding the file name to SUITES below (optional suites that do not exist yet are skipped).
export const SUITES = ['tests-core.js', 'tests-backup.js', 'tests-ui.js', 'tests-ui-w1.js', 'tests-ui-w2.js', 'tests-ui-w3.js', 'tests-ui-qa.js', 'tests-rework.js', 'tests-functional.js', 'tests-data.js', 'tests-a11y.js', 'tests-perf.js'];
const tests = []; let currentGroup = '';
export function describe(name, fn) { const prev = currentGroup; currentGroup = name; fn(); currentGroup = prev; }
export function it(name, covers, fn) { if (typeof covers === 'function') { fn = covers; covers = []; } tests.push({ group: currentGroup, name, covers, fn }); }
class AssertionError extends Error {}
const show = (v) => { try { return JSON.stringify(v); } catch { return String(v); } };
const deepEq = (a, b) => {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (a instanceof Blob || b instanceof Blob) return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b); if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEq(a[k], b[k]));
};
export const assert = {
  ok(v, m = 'expected truthy') { if (!v) throw new AssertionError(m); },
  eq(a, b, m = '') { if (!Object.is(a, b)) throw new AssertionError(`${m} expected ${show(b)} got ${show(a)}`); },
  deepEq(a, b, m = '') { if (!deepEq(a, b)) throw new AssertionError(`${m} deepEq failed: ${show(a)} vs ${show(b)}`); },
  near(a, b, eps = 1e-9, m = '') { if (!(Math.abs(a - b) <= eps)) throw new AssertionError(`${m} expected ~${b} got ${a}`); },
  async throws(fn, m = 'expected throw') { try { await fn(); } catch (e) { return e; } throw new AssertionError(m); }
};
const WEEKDAY_RE = /\b(mon(day)?|tue(s|sday)?|wed(nesday)?|thu(r|rs|rsday)?|fri(day)?|sat(urday)?|sun(day)?)\b/gi;
/** NO-WEEKDAY grep (QA-010, DoD-09). textByFile: {path: text}. allow: [{file?: regex|string, line: regex}] or [regex]. Returns [{file,line,text,match}]. */
export function scanForWeekdays(textByFile, allow = []) {
  const out = [];
  for (const [file, text] of Object.entries(textByFile)) {
    String(text).split('\n').forEach((line, i) => {
      const m = line.match(WEEKDAY_RE); if (!m) return;
      const ok = allow.some((a) => { const re = a instanceof RegExp ? a : a.line; const f = a.file; return re.test(line) && (!f || (f instanceof RegExp ? f.test(file) : file.includes(f))); });
      if (!ok) out.push({ file, line: i + 1, text: line.trim().slice(0, 160), match: m[0] });
    });
  }
  return out;
}
export async function runAll() {
  for (const s of SUITES) { try { await import('./' + s); } catch (e) { if (!/Failed to fetch|Cannot find|Importing a module script failed|error loading dynamically|404/i.test(String(e && e.message))) { tests.push({ group: 'load ' + s, name: 'suite loads', covers: [], fn: () => { throw e; } }); } } }
  const results = []; let passed = 0, failed = 0;
  for (const t of tests) {
    const t0 = performance.now();
    try { await t.fn(); passed++; results.push({ ...t, ok: true, ms: performance.now() - t0 }); }
    catch (e) { failed++; results.push({ ...t, ok: false, error: String(e && e.stack ? e.message : e), ms: performance.now() - t0 }); }
  }
  render(results, passed, failed);
  window.__results = { passed, failed, total: tests.length, failures: results.filter((r) => !r.ok).map((r) => ({ name: `${r.group}: ${r.name}`, error: r.error })), covers: [...new Set(results.flatMap((r) => r.covers))].sort() };
  window.__done = true;
  return window.__results;
}
function render(results, passed, failed) {
  const root = document.getElementById('out'); if (!root) return;
  root.textContent = '';
  const h = document.createElement('h2'); h.textContent = `${passed} passed, ${failed} failed, ${results.length} total`; root.appendChild(h);
  const table = document.createElement('table'); table.border = '1';
  for (const r of results) {
    const tr = table.insertRow();
    tr.insertCell().textContent = r.ok ? 'PASS' : 'FAIL';
    tr.insertCell().textContent = `${r.group}: ${r.name}`;
    tr.insertCell().textContent = r.covers.join(', ');
    tr.insertCell().textContent = r.ok ? `${r.ms.toFixed(0)} ms` : r.error;
  }
  root.appendChild(table);
}
if (typeof document !== 'undefined' && document.getElementById('out') && !window.__noAutoRun) runAll();
