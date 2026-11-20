import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readWarRoom } from './control-plane.mjs';
import { initializeDemoWorkspace, readDemoWorkspaceStatus } from './demo-workspace.mjs';
import { providerStatus } from './provider.mjs';

const WEB_ROOT = fileURLToPath(new URL('../../web/static/', import.meta.url));
const STATIC = new Map([['/', 'index.html'], ['/app.js', 'app.js'], ['/styles.css', 'styles.css']]);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const MAX_QUERY_LENGTH = 500;
const SNIPPET_LENGTH = 240;

async function searchVault(query) {
  const { search } = await import('./vector-store.mjs');
  return search(query);
}

function sendJson(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

export function createUiServer({ config, search = searchVault }) {
  let server;
  const token = randomBytes(32).toString('hex');
  const authorized = (request) => {
    const supplied = String(request.headers['x-jarvis-token'] || '');
    return supplied.length === token.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(token));
  };
  const api = {
    url: '',
    token,
    async listen(port = 0, host = '127.0.0.1') {
      if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('Jarvis desktop server only binds to loopback.');
      server = createServer(async (request, response) => {
        try {
          const url = new URL(request.url, 'http://127.0.0.1');
          const expectedHost = new URL(api.url).host;
          if (request.headers.host !== expectedHost) return sendJson(response, 403, { error: 'invalid_host' });
          if (url.pathname === '/api/demo/init' && request.method === 'POST') {
            const origin = request.headers.origin;
            if (!authorized(request) || (origin && origin !== api.url)) return sendJson(response, 403, { error: 'local_api_forbidden' });
            try {
              return sendJson(response, 200, await initializeDemoWorkspace(config, { confirmSynthetic: true }));
            } catch (error) {
              if (/not empty/i.test(error.message)) return sendJson(response, 409, { error: 'demo_target_not_empty', guidance: 'Choose a fresh Jarvis home for the synthetic demo. Existing Vault and control state were not changed.' });
              throw error;
            }
          }
          if (request.method !== 'GET') return sendJson(response, 405, { error: 'method_not_allowed' });
          if (url.pathname === '/api/status') return sendJson(response, 200, {
            running: true,
            storage: 'external Vault',
            controlPlane: 'ready',
            integrations: { activity: config.activityOptIn ? 'enabled' : 'disabled', provider: providerStatus(config).status, codex: config.codexAdapterEnabled ? 'configured' : 'disabled' },
          });
          if (url.pathname === '/api/war-room') {
            const origin = request.headers.origin;
            if (!authorized(request) || (origin && origin !== api.url)) return sendJson(response, 403, { error: 'local_api_forbidden' });
            return sendJson(response, 200, readWarRoom(config, url.searchParams.get('project') || ''));
          }
          if (url.pathname === '/api/search') {
            const origin = request.headers.origin;
            if (!authorized(request) || (origin && origin !== api.url)) return sendJson(response, 403, { error: 'local_api_forbidden' });
            const query = String(url.searchParams.get('q') || '').trim();
            if (!query || query.length > MAX_QUERY_LENGTH) return sendJson(response, 400, { error: 'invalid_query' });
            if (!config.vectorDbDir || !existsSync(config.vectorDbDir)) return sendJson(response, 200, { query, results: [], status: 'empty_index' });
            try {
              const results = (await search(query)).map((result) => ({
                source: result.source || '',
                date: result.date || '',
                snippet: String(result.content || '').replace(/\s+/g, ' ').trim().slice(0, SNIPPET_LENGTH),
              }));
              return sendJson(response, 200, { query, results, status: results.length ? 'ok' : 'no_matches' });
            } catch {
              return sendJson(response, 503, { error: 'search_unavailable', guidance: 'Local search is unavailable. Restart the local workspace and try again.' });
            }
          }
          if (url.pathname === '/api/demo/status') {
            if (!authorized(request)) return sendJson(response, 403, { error: 'local_api_forbidden' });
            return sendJson(response, 200, await readDemoWorkspaceStatus(config));
          }
          const file = STATIC.get(url.pathname);
          if (!file) return sendJson(response, 404, { error: 'not_found' });
          const body = await readFile(resolve(WEB_ROOT, file));
          response.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'content-security-policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'" });
          response.end(body);
        } catch (error) {
          sendJson(response, 500, { error: 'local_service_unavailable', guidance: 'Restart the local workspace.' });
        }
      });
      await new Promise((resolvePromise, reject) => { server.once('error', reject); server.listen(port, host, resolvePromise); });
      const address = server.address();
      api.url = `http://127.0.0.1:${address.port}`;
      return api.url;
    },
    async close() {
      if (!server) return;
      await new Promise((resolvePromise) => server.close(resolvePromise));
      server = null;
    },
  };
  return api;
}
