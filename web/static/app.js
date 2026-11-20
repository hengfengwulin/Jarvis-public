const views = [...document.querySelectorAll('.view')];
const nav = [...document.querySelectorAll('[data-view]')];
const title = document.querySelector('#page-title');
const labels = { today: '今日', 'war-room': '项目作战室', retrieval: '知识搜索', settings: '隐私与适配器' };
const statusLabels = {
  active: '进行中', current: '当前', resolved: '已解决', superseded: '已替代',
  pending: '待处理', blocked: '受阻', complete: '已完成', completed: '已完成',
  done: '已完成', cancelled: '已取消', archived: '已归档', unknown: '未知',
  feedback_finalize_pending: '等待反馈确认',
};
const typeLabels = { task: '任务', decision: '决策', report: '报告', event: '事件', permission: '权限', automation: '自动化' };
const displayLabel = (labels, value) => Object.hasOwn(labels, value) ? labels[value] : value;
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
    document.querySelector('#health').textContent = status.running ? '本地工作空间已就绪' : '本地工作空间已暂停';
  } catch { document.querySelector('#health').textContent = '请重启本地工作空间'; }
}

function renderList(target, items, empty) {
  target.textContent = '';
  if (!items.length) { target.className = 'empty'; target.textContent = empty; return; }
  target.className = 'items';
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'item';
    const itemTitle = document.createElement('strong');
    itemTitle.textContent = item.summary || displayLabel(typeLabels, item.type) || '本地事项';
    const itemStatus = document.createElement('small');
    itemStatus.textContent = displayLabel(statusLabels, item.status || 'current');
    row.append(itemTitle, itemStatus);
    target.append(row);
  }
}

async function loadWarRoom() {
  try {
    const response = await fetch('/api/war-room', { headers: { 'x-jarvis-token': token } });
    if (!response.ok) throw new Error(`作战室不可用：HTTP ${response.status}`);
    const room = await response.json();
    renderList(document.querySelector('#current-list'), room.current || [], '暂无当前工作。请添加模拟项目或同步本地清单。');
    renderList(document.querySelector('#timeline-list'), room.timeline || [], '已解决或已被替代的工作会显示在这里。');
  } catch {
    renderList(document.querySelector('#current-list'), [], '作战室暂时不可用。请运行本地控制中心诊断。');
  }
}

async function initializeDemo() {
  const feedback = document.querySelector('#demo-feedback');
  const button = document.querySelector('#initialize-demo');
  button.disabled = true;
  feedback.textContent = '正在创建本地模拟数据…';
  try {
    const response = await fetch('/api/demo/init', { method: 'POST', headers: { 'x-jarvis-token': token } });
    const result = await response.json();
    if (!response.ok) {
      feedback.textContent = result.guidance || '无法创建模拟演示。';
      return;
    }
    feedback.textContent = result.alreadyInitialized ? '模拟演示已就绪。' : '模拟演示已创建，正在打开作战室…';
    show('war-room');
  } catch {
    feedback.textContent = '无法创建模拟演示，请检查本地工作空间后重试。';
  } finally { button.disabled = false; }
}

nav.forEach((button) => button.addEventListener('click', () => show(button.dataset.view)));
document.querySelector('#refresh-room').addEventListener('click', loadWarRoom);
document.querySelector('#initialize-demo').addEventListener('click', initializeDemo);
loadStatus();
