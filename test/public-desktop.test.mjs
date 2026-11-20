import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { createUiServer } from '../scripts/lib/ui-server.mjs';

test('desktop server renders a nonblank public-safe workspace and local APIs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jarvis-public-ui-'));
  const server = createUiServer({
    config: { runtimeDir: join(root, 'runtime'), controlDbFile: join(root, 'runtime', 'control.db'), memoryDir: join(root, 'vault'), activityOptIn: false },
  });
  try {
    await server.listen(0, '127.0.0.1');
    const html = await (await fetch(server.url)).text();
    assert.match(html, /Jarvis/);
    assert.match(html, /Project War Room/);
    assert.doesNotMatch(html, /undefined|traceback|\/Users\//i);
    const status = await (await fetch(`${server.url}/api/status`)).json();
    assert.equal(status.running, true);
    assert.equal(status.integrations.activity, 'disabled');
    assert.equal((await fetch(`${server.url}/api/war-room?project=demo`)).status, 403);
    assert.equal((await fetch(`${server.url}/api/war-room`, { headers: { 'x-jarvis-token': server.token, origin: 'https://attacker.invalid' } })).status, 403);
    const room = await (await fetch(`${server.url}/api/war-room?project=demo`, { headers: { 'x-jarvis-token': server.token } })).json();
    assert.deepEqual(room.current, []);
    assert.equal((await fetch(`${server.url}/api/demo/init`, { method: 'POST', headers: { 'x-jarvis-token': server.token } })).status, 200);
    const demo = await (await fetch(`${server.url}/api/war-room?project=demo-studio`, { headers: { 'x-jarvis-token': server.token } })).json();
    assert.equal(demo.projects[0].name, 'Sample Studio');
    assert.equal((await fetch(`${server.url}/api/demo/init`, { method: 'POST' })).status, 403);
    assert.equal((await fetch(`${server.url}/../package.json`)).status, 404);
  } finally { await server.close(); await rm(root, { recursive: true, force: true }); }
});

test('desktop shell enforces context isolation and loopback UI', async () => {
  const source = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../scripts/lib/electron-main.mjs', import.meta.url), 'utf8'));
  assert.match(source, /contextIsolation:\s*true/);
  assert.match(source, /nodeIntegration:\s*false/);
  assert.match(source, /sandbox:\s*true/);
  assert.match(source, /127\.0\.0\.1/);
});

test('renderer shows search states and existing demo status', async () => {
  const source = await readFile(new URL('../web/static/app.js', import.meta.url), 'utf8');
  const elements = new Map();
  const element = () => ({ textContent: '', value: '', children: [], append(...items) { this.children.push(...items); }, addEventListener() {}, setAttribute() {}, after() {}, querySelector() { return element(); } });
  const document = {
    querySelectorAll: () => [],
    querySelector: (selector) => {
      if (!elements.has(selector)) elements.set(selector, element());
      return elements.get(selector);
    },
    createElement: element,
  };
  const context = { document, URL, location: { href: 'http://localhost/?token=t' }, fetch: async () => { throw new Error('offline'); } };
  runInNewContext(source, context);
  const respond = (body, ok = true) => { context.fetch = async () => ({ ok, json: async () => body }); };
  respond({ initialized: true });
  await runInNewContext('loadDemoStatus()', context);
  assert.equal(elements.get('#demo-feedback').textContent, 'Synthetic demo is already ready.');
  await runInNewContext('runSearch()', context);
  assert.equal(runInNewContext('searchResults.textContent', context), 'Enter a query to search your local knowledge.');
  runInNewContext("searchInput.value = ' walkthrough '", context);
  respond({ query: 'walkthrough', results: [], status: 'empty_index' });
  await runInNewContext('runSearch()', context);
  assert.equal(runInNewContext('searchResults.textContent', context), 'Your local index is empty. Index your Vault, then search again.');
  respond({ query: 'walkthrough', results: [], status: 'no_matches' });
  await runInNewContext('runSearch()', context);
  assert.equal(runInNewContext('searchResults.textContent', context), 'No matches in your local index.');
  respond({ query: 'walkthrough', status: 'ok', results: [{ source: 'core/projects/sample-studio.md', snippet: 'Prepare the preview walkthrough' }, { snippet: 'untitled' }] });
  await runInNewContext('runSearch()', context);
  const rows = runInNewContext('searchResults.children', context);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].children[0].textContent, 'core/projects/sample-studio.md');
  assert.equal(rows[0].children[1].textContent, 'Prepare the preview walkthrough');
  assert.equal(rows[1].children[0].textContent, 'Local note');
  respond({ error: 'search_unavailable', guidance: 'Local search is unavailable. Restart the local workspace and try again.' }, false);
  await runInNewContext('runSearch()', context);
  assert.equal(runInNewContext('searchResults.textContent', context), 'Local search is unavailable. Restart the local workspace and try again.');
  assert.equal(runInNewContext('searchButton.disabled', context), false);
});

test('desktop search API requires the local token and reports empty, missing and matching results', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jarvis-public-ui-search-'));
  const vectorDbDir = join(root, 'runtime', 'vector');
  const queries = [];
  const server = createUiServer({
    config: { runtimeDir: join(root, 'runtime'), controlDbFile: join(root, 'runtime', 'control.db'), memoryDir: join(root, 'vault'), vectorDbDir, activityOptIn: false },
    search: async (query) => {
      queries.push(query);
      if (query === 'boom') throw new Error('embedding model missing');
      return query === 'walkthrough' ? [{ source: 'core/projects/sample-studio.md', date: '2026-01-01', content: 'Prepare   the preview\nwalkthrough', _distance: 0.2 }] : [];
    },
  });
  const get = (path, headers = { 'x-jarvis-token': server.token }) => fetch(`${server.url}${path}`, { headers });
  try {
    await server.listen(0, '127.0.0.1');
    assert.equal((await get('/api/search?q=walkthrough', {})).status, 403);
    assert.equal((await get('/api/search?q=walkthrough', { 'x-jarvis-token': server.token, origin: 'https://attacker.invalid' })).status, 403);
    assert.equal((await get('/api/search?q=%20%20')).status, 400);
    assert.equal((await get(`/api/search?q=${'a'.repeat(501)}`)).status, 400);
    assert.deepEqual(await (await get('/api/search?q=walkthrough')).json(), { query: 'walkthrough', results: [], status: 'empty_index' });
    assert.deepEqual(queries, []);
    await mkdir(vectorDbDir, { recursive: true });
    assert.deepEqual(await (await get('/api/search?q=%20walkthrough%20')).json(), {
      query: 'walkthrough', status: 'ok', results: [{ source: 'core/projects/sample-studio.md', date: '2026-01-01', snippet: 'Prepare the preview walkthrough' }],
    });
    assert.equal((await (await get('/api/search?q=nothing')).json()).status, 'no_matches');
    const failed = await get('/api/search?q=boom');
    assert.equal(failed.status, 503);
    assert.doesNotMatch(JSON.stringify(await failed.json()), /embedding model missing/);
  } finally { await server.close(); await rm(root, { recursive: true, force: true }); }
});
