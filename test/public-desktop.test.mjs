import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
    assert.match(html, /项目作战室/);
    assert.match(html, /lang="zh-CN"/);
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
  assert.match(source, /appendSwitch\('lang', 'zh-CN'\)/);
});

test('renderer localizes labels, empty states and failures without changing API values', async () => {
  const source = await readFile(new URL('../web/static/app.js', import.meta.url), 'utf8');
  const elements = new Map();
  const element = () => ({ textContent: '', children: [], append(...items) { this.children.push(...items); }, addEventListener() {} });
  const document = {
    querySelectorAll: () => [],
    querySelector: (selector) => {
      if (!elements.has(selector)) elements.set(selector, element());
      return elements.get(selector);
    },
    createElement: element,
  };
  const context = { document, URL, location: { href: 'http://localhost/' }, fetch: async () => { throw new Error('offline'); } };
  runInNewContext(source, context);
  const target = element();
  context.target = target;
  context.items = [{ type: 'task', status: 'active' }, { type: 'custom', status: 'custom-status' }, {}];
  runInNewContext("renderList(target, items, '暂无事项')", context);
  assert.equal(target.children[0].children[0].textContent, '任务');
  assert.equal(target.children[0].children[1].textContent, '进行中');
  assert.equal(target.children[1].children[0].textContent, 'custom');
  assert.equal(target.children[1].children[1].textContent, 'custom-status');
  assert.equal(target.children[2].children[0].textContent, '本地事项');
  assert.equal(target.children[2].children[1].textContent, '当前');
  assert.equal(context.items[0].status, 'active');
  runInNewContext("renderList(target, [], '暂无事项')", context);
  assert.equal(target.textContent, '暂无事项');
  await runInNewContext('loadWarRoom()', context);
  assert.match(elements.get('#current-list').textContent, /作战室暂时不可用/);
  await runInNewContext('loadStatus()', context);
  assert.equal(elements.get('#health').textContent, '请重启本地工作空间');
  context.fetch = async () => ({ ok: false, json: async () => ({ guidance: '请重新启动本地工作空间。' }) });
  await runInNewContext('initializeDemo()', context);
  assert.equal(elements.get('#demo-feedback').textContent, '请重新启动本地工作空间。');
  assert.equal(elements.get('#initialize-demo').disabled, false);
  context.fetch = async () => { throw new Error('Failed to fetch'); };
  await runInNewContext('initializeDemo()', context);
  assert.equal(elements.get('#demo-feedback').textContent, '无法创建模拟演示，请检查本地工作空间后重试。');
});
