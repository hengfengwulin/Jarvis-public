const views = [...document.querySelectorAll('.view')];
const nav = [...document.querySelectorAll('[data-view]')];
const title = document.querySelector('#page-title');
const labels = { today: 'Today', 'war-room': 'Project War Room', retrieval: 'Knowledge search', settings: 'Privacy & adapters' };
const token = new URL(location.href).searchParams.get('token') || '';

function show(id) {
  views.forEach((view) => view.classList.toggle('active', view.id === id));
  nav.forEach((button) => button.classList.toggle('active', button.dataset.view === id));
  title.textContent = labels[id] || 'Jarvis';
  if (id === 'war-room') loadWarRoom();
}

async function loadStatus() {
  try {
    const status = await fetch('/api/status').then((response) => response.json());
    document.querySelector('#health').textContent = status.running ? 'Local workspace ready' : 'Local workspace paused';
  } catch { document.querySelector('#health').textContent = 'Restart local workspace'; }
}

function renderList(target, items, empty) {
  target.textContent = '';
  if (!items.length) { target.className = 'empty'; target.textContent = empty; return; }
  target.className = 'items';
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'item';
    const itemTitle = document.createElement('strong');
    itemTitle.textContent = item.summary || item.type || 'Local item';
    const itemStatus = document.createElement('small');
    itemStatus.textContent = item.status || 'current';
    row.append(itemTitle, itemStatus);
    target.append(row);
  }
}

async function loadWarRoom() {
  try {
    const response = await fetch('/api/war-room', { headers: { 'x-jarvis-token': token } });
    if (!response.ok) throw new Error(`War Room unavailable: HTTP ${response.status}`);
    const room = await response.json();
    renderList(document.querySelector('#current-list'), room.current || [], 'No current work yet. Add a synthetic project or reconcile a local manifest.');
    renderList(document.querySelector('#timeline-list'), room.timeline || [], 'Resolved and superseded work appears here.');
  } catch {
    renderList(document.querySelector('#current-list'), [], 'War Room is temporarily unavailable. Run the local control-plane doctor.');
  }
}

async function initializeDemo() {
  const feedback = document.querySelector('#demo-feedback');
  const button = document.querySelector('#initialize-demo');
  button.disabled = true;
  feedback.textContent = 'Creating synthetic local data…';
  try {
    const response = await fetch('/api/demo/init', { method: 'POST', headers: { 'x-jarvis-token': token } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.guidance || 'The synthetic demo could not be created.');
    feedback.textContent = result.alreadyInitialized ? 'Synthetic demo is already ready.' : 'Synthetic demo created. Opening War Room…';
    show('war-room');
  } catch (error) {
    feedback.textContent = error.message;
  } finally { button.disabled = false; }
}

async function loadDemoStatus() {
  try {
    const response = await fetch('/api/demo/status', { headers: { 'x-jarvis-token': token } });
    if (!response.ok) return;
    const demo = await response.json();
    if (demo.initialized) document.querySelector('#demo-feedback').textContent = 'Synthetic demo is already ready.';
  } catch {}
}

const searchBox = document.querySelector('#retrieval .search');
const searchInput = searchBox.querySelector('input');
const searchButton = searchBox.querySelector('button');
const searchResults = document.createElement('div');
searchResults.id = 'search-results';
searchResults.setAttribute('aria-live', 'polite');
searchBox.after(searchResults);

function renderSearchMessage(message) {
  searchResults.className = 'empty';
  searchResults.textContent = message;
}

async function runSearch() {
  const query = searchInput.value.trim();
  if (!query) { renderSearchMessage('Enter a query to search your local knowledge.'); return; }
  searchButton.disabled = true;
  renderSearchMessage('Searching locally…');
  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { headers: { 'x-jarvis-token': token } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.guidance || 'Local search is unavailable.');
    if (result.status === 'empty_index') { renderSearchMessage('Your local index is empty. Index your Vault, then search again.'); return; }
    if (!result.results.length) { renderSearchMessage('No matches in your local index.'); return; }
    searchResults.className = 'items';
    searchResults.textContent = '';
    for (const item of result.results) {
      const row = document.createElement('div');
      row.className = 'item result';
      const source = document.createElement('strong');
      source.textContent = item.source || 'Local note';
      const snippet = document.createElement('p');
      snippet.textContent = item.snippet;
      row.append(source, snippet);
      searchResults.append(row);
    }
  } catch (error) {
    renderSearchMessage(error.message || 'Local search is unavailable.');
  } finally { searchButton.disabled = false; }
}

nav.forEach((button) => button.addEventListener('click', () => show(button.dataset.view)));
searchButton.addEventListener('click', runSearch);
searchInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') runSearch(); });
document.querySelector('#refresh-room').addEventListener('click', loadWarRoom);
document.querySelector('#initialize-demo').addEventListener('click', initializeDemo);
loadStatus();
loadDemoStatus();
