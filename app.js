const STORAGE_KEY = 'kawaii-calorie-tracker-v2';
const LEGACY_STORAGE_KEY = 'kawaii-calorie-tracker-v1';
const DB_NAME = 'kawaii-calorie-tracker-db';
const DB_STORE = 'state';
const DB_RECORD_KEY = 'primary';
const DEFAULT_STATE = Object.freeze({ entries: [], settings: { goal: 2000 } });
const state = createDefaultState();
let deferredPrompt = null;
let editingEntryId = null;
let historyQuery = '';
let storageWarningShown = false;

const MEAL_TYPE_LABELS = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '零食',
  other: '其他'
};

const els = {
  views: [...document.querySelectorAll('.view')],
  navBtns: [...document.querySelectorAll('.nav-btn')],
  todayTotal: document.getElementById('todayTotal'),
  avg7: document.getElementById('avg7'),
  entryCount: document.getElementById('entryCount'),
  remainingLabel: document.getElementById('remainingLabel'),
  remainingCalories: document.getElementById('remainingCalories'),
  remainingHint: document.getElementById('remainingHint'),
  heroCard: document.getElementById('heroCard'),
  heroStatusCard: document.getElementById('heroStatusCard'),
  historyList: document.getElementById('historyList'),
  historySearchInput: document.getElementById('historySearchInput'),
  intakeForm: document.getElementById('intakeForm'),
  intakeText: document.getElementById('intakeText'),
  intakeCalories: document.getElementById('intakeCalories'),
  intakeMealType: document.getElementById('intakeMealType'),
  submitEntryBtn: document.getElementById('submitEntryBtn'),
  editingBanner: document.getElementById('editingBanner'),
  cancelEditBtn: document.getElementById('cancelEditBtn'),
  goalInput: document.getElementById('goalInput'),
  clearDataBtn: document.getElementById('clearDataBtn'),
  exportDataBtn: document.getElementById('exportDataBtn'),
  importDataInput: document.getElementById('importDataInput'),
  installBtn: document.getElementById('installBtn'),
  weeklyChart: document.getElementById('weeklyChart'),
  goalRingProgress: document.getElementById('goalRingProgress'),
  goalPercent: document.getElementById('goalPercent')
};

init();

async function init() {
  bindNav();
  bindForm();
  bindSettings();
  bindHistory();
  bindPwa();
  await hydrateState();
  renderAll();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then(() => {
      navigator.serviceWorker.getRegistration().then((reg) => reg?.update?.()).catch(() => {});
    }).catch(console.error);
  }
}

function createDefaultState() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

async function hydrateState() {
  const local = loadStateFromLocalStorage();
  if (local) {
    replaceState(local);
    void saveStateToIndexedDb(local);
    return;
  }

  const persisted = await loadStateFromIndexedDb();
  if (persisted) {
    replaceState(persisted);
    try {
      saveStateToLocalStorage(persisted);
    } catch (err) {
      reportStorageIssue('本地存储读取不稳定，暂时改用备用存储。', err);
    }
    return;
  }

  replaceState(createDefaultState());
}

function loadStateFromLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    return sanitizeState(JSON.parse(raw));
  } catch (err) {
    reportStorageIssue('本地存储读取失败，正在尝试备用存储。', err);
    return null;
  }
}

function sanitizeState(parsed) {
  return {
    entries: Array.isArray(parsed.entries)
      ? parsed.entries
          .filter((entry) => entry && typeof entry === 'object')
          .map((entry) => ({
            id: String(entry.id || makeEntryId()),
            text: String(entry.text || '').trim().slice(0, 120),
            calories: Math.max(0, Number(entry.calories) || 0),
            mealType: sanitizeMealType(entry.mealType),
            createdAt: entry.createdAt || new Date().toISOString()
          }))
          .filter((entry) => entry.text)
      : [],
    settings: {
      goal: Math.max(0, Number(parsed.settings?.goal || 2000))
    }
  };
}

function replaceState(nextState) {
  state.entries = nextState.entries;
  state.settings = nextState.settings;
}

function saveState() {
  const snapshot = sanitizeState(state);
  replaceState(snapshot);

  try {
    saveStateToLocalStorage(snapshot);
  } catch (err) {
    reportStorageIssue('写入 localStorage 失败，已改存到备用存储。', err);
  }

  void saveStateToIndexedDb(snapshot).catch((err) => {
    reportStorageIssue('备用存储也写入失败了。', err);
  });
}

function saveStateToLocalStorage(snapshot) {
  const serialized = JSON.stringify(snapshot);
  localStorage.setItem(STORAGE_KEY, serialized);
  localStorage.setItem(LEGACY_STORAGE_KEY, serialized);
}

function reportStorageIssue(message, err) {
  console.error(message, err);
  if (storageWarningShown) return;
  storageWarningShown = true;
  setTimeout(() => toast(message), 50);
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadStateFromIndexedDb() {
  if (!('indexedDB' in window)) return null;
  try {
    const db = await openDb();
    const result = await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const store = tx.objectStore(DB_STORE);
      const request = store.get(DB_RECORD_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return result ? sanitizeState(result) : null;
  } catch (err) {
    reportStorageIssue('读取备用存储失败。', err);
    return null;
  }
}

async function saveStateToIndexedDb(snapshot) {
  if (!('indexedDB' in window)) return;
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(DB_STORE).put(snapshot, DB_RECORD_KEY);
  });
  db.close();
}

function bindNav() {
  els.navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      pulse();
      btn.classList.remove('nav-bounce');
      void btn.offsetWidth;
      btn.classList.add('nav-bounce');
      switchView(btn.dataset.target);
    });
  });
}

function switchView(target) {
  els.navBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.target === target));
  els.views.forEach(view => view.classList.toggle('active', view.dataset.view === target));
}

function bindForm() {
  if (!els.intakeForm) return;

  const submitHandler = (e) => {
    if (e) e.preventDefault();
    try {
      const text = (els.intakeText?.value || '').trim();
      const calories = Number(els.intakeCalories?.value);
      const mealType = sanitizeMealType(els.intakeMealType?.value);
      if (!text || !Number.isFinite(calories) || calories < 0) {
        toast('请输入有效的食物名称和热量 ✨');
        return false;
      }

      if (editingEntryId) {
        const entry = state.entries.find((item) => item.id === editingEntryId);
        if (!entry) {
          stopEditing();
          toast('这条记录已经不存在了');
          return false;
        }
        entry.text = text;
        entry.calories = calories;
        entry.mealType = mealType;
        saveState();
        renderAll();
        stopEditing();
        toast('已更新记录 ♡');
        pulse([12]);
        switchView('dashboard');
        return false;
      }

      const entry = {
        id: makeEntryId(),
        text,
        calories,
        mealType,
        createdAt: new Date().toISOString()
      };
      state.entries.unshift(entry);
      saveState();
      renderAll();
      els.intakeForm.reset();
      toast('已保存 ♡');
      pulse([12]);
      switchView('dashboard');
      return false;
    } catch (err) {
      console.error(err);
      toast('保存失败，请刷新后再试');
      return false;
    }
  };

  els.intakeForm.addEventListener('submit', submitHandler);
  els.intakeForm.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target?.tagName !== 'TEXTAREA') submitHandler(e);
  });
  els.cancelEditBtn?.addEventListener('click', () => {
    stopEditing(false);
    toast('已取消编辑');
  });
}

function bindSettings() {
  els.goalInput?.addEventListener('change', () => {
    state.settings.goal = Math.max(0, Number(els.goalInput.value) || 0);
    saveState();
    renderAll();
    toast('目标已更新 ✿');
    pulse();
  });
  els.exportDataBtn?.addEventListener('click', exportBackup);
  els.importDataInput?.addEventListener('change', importBackup);
  els.clearDataBtn?.addEventListener('click', () => {
    const ok = confirm('确定要清空这台设备上的全部热量记录吗？');
    if (!ok) return;
    state.entries = [];
    saveState();
    renderAll();
    stopEditing();
    toast('数据已清空');
    pulse([18]);
  });
}

function bindHistory() {
  els.historySearchInput?.addEventListener('input', () => {
    historyQuery = (els.historySearchInput.value || '').trim();
    renderHistory();
  });

  els.historyList?.addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit-id]');
    if (editBtn) {
      startEditing(editBtn.dataset.editId);
      return;
    }
    const deleteBtn = e.target.closest('[data-delete-id]');
    if (!deleteBtn) return;
    const entry = state.entries.find((item) => item.id === deleteBtn.dataset.deleteId);
    if (!entry) return;
    const ok = confirm(`删除“${entry.text}”这条记录？`);
    if (!ok) return;
    state.entries = state.entries.filter((item) => item.id !== entry.id);
    if (editingEntryId === entry.id) stopEditing();
    saveState();
    renderAll();
    toast('已删除记录');
    pulse([10]);
  });
}

function startEditing(entryId) {
  const entry = state.entries.find((item) => item.id === entryId);
  if (!entry) {
    toast('找不到这条记录');
    return;
  }
  editingEntryId = entry.id;
  if (els.intakeText) els.intakeText.value = entry.text;
  if (els.intakeCalories) els.intakeCalories.value = entry.calories;
  if (els.intakeMealType) els.intakeMealType.value = sanitizeMealType(entry.mealType);
  renderEditorState();
  switchView('log');
  els.intakeText?.focus();
  toast('已载入记录，修改后保存');
  pulse([8, 16, 8]);
}

function stopEditing(keepInputs = false) {
  editingEntryId = null;
  if (!keepInputs) els.intakeForm?.reset();
  renderEditorState();
}

function renderEditorState() {
  const editing = Boolean(editingEntryId);
  els.editingBanner?.classList.toggle('hidden', !editing);
  if (els.submitEntryBtn) {
    els.submitEntryBtn.textContent = editing ? '更新记录' : '保存记录';
  }
}

function bindPwa() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    els.installBtn?.classList.remove('hidden');
  });
  els.installBtn?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    els.installBtn.classList.add('hidden');
  });
}

function renderAll() {
  renderStats();
  renderHistory();
  renderSettings();
  renderChart();
  renderEditorState();
}

function renderStats() {
  const today = localDateKey();
  const entries = sortedEntries();
  const todayTotal = entries.filter(e => toLocalDateKey(e.createdAt) === today).reduce((sum, e) => sum + e.calories, 0);
  const daily = last7DaysTotals(entries);
  const avg7 = daily.reduce((a, b) => a + b.total, 0) / 7;
  const configuredGoal = Math.max(0, Number(state.settings.goal) || 0);
  const goalForPercent = Math.max(1, configuredGoal || 1);
  const remaining = configuredGoal - todayTotal;
  const over = remaining < 0;
  const percent = configuredGoal > 0
    ? Math.min(100, Math.round((todayTotal / goalForPercent) * 100))
    : 0;

  if (els.todayTotal) els.todayTotal.textContent = todayTotal;
  if (els.avg7) els.avg7.textContent = `${Math.round(avg7)} kcal`;
  if (els.entryCount) els.entryCount.textContent = entries.length;
  if (els.goalPercent) els.goalPercent.textContent = `${percent}%`;
  if (els.remainingLabel) els.remainingLabel.textContent = over ? '今天超标' : '还可摄入';
  if (els.remainingCalories) els.remainingCalories.textContent = `${Math.abs(remaining)} kcal`;
  if (els.remainingHint) {
    els.remainingHint.textContent = configuredGoal <= 0
      ? '先在设置里填一个每日目标吧。'
      : over
        ? '今天已经超过目标了，也没关系，明天继续稳住 ✿'
        : remaining === 0
          ? '刚刚好到达目标，收工撒花 ✦'
          : '距离今日目标还差一点点 ✿';
    els.remainingHint.classList.toggle('over-goal-hint', over);
  }
  if (els.remainingCalories) {
    els.remainingCalories.classList.toggle('over-goal-value', over);
  }
  els.heroCard?.classList.toggle('hero-over-goal', over);
  els.heroStatusCard?.classList.toggle('hero-status-over', over);
  updateGoalRing(percent);
}

function updateGoalRing(percent) {
  if (!els.goalRingProgress) return;
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  els.goalRingProgress.style.strokeDasharray = `${circumference}`;
  els.goalRingProgress.style.strokeDashoffset = `${circumference * (1 - percent / 100)}`;
}

function renderHistory() {
  if (!els.historyList) return;
  const entries = sortedEntries();
  const filtered = historyQuery
    ? entries.filter((entry) => {
        const query = historyQuery.toLowerCase();
        return entry.text.toLowerCase().includes(query) || getMealTypeLabel(entry.mealType).toLowerCase().includes(query);
      })
    : entries;
  const visible = filtered.slice(0, 20);

  if (!entries.length) {
    els.historyList.innerHTML = '<div class="history-item empty-history"><div class="history-meta"><strong>还没有记录</strong><p class="subtle">先去添加今天吃的第一样东西吧 ♡</p></div></div>';
    return;
  }

  if (!visible.length) {
    els.historyList.innerHTML = `<div class="history-item empty-history"><div class="history-meta"><strong>没有找到匹配记录</strong><p class="subtle">试试别的关键词，或者清空搜索词吧：${escapeHtml(historyQuery)}</p></div></div>`;
    return;
  }

  els.historyList.innerHTML = visible.map(entry => `
    <article class="history-item">
      <div class="history-meta">
        <strong>${highlightMatch(entry.text, historyQuery)}</strong>
        <p class="subtle history-meta-line"><span class="meal-badge">${highlightMatch(getMealTypeLabel(entry.mealType), historyQuery)}</span><span>${formatDate(entry.createdAt)}</span></p>
      </div>
      <div class="history-actions">
        <div class="history-calories">${entry.calories} kcal</div>
        <div class="history-btn-row">
          <button type="button" class="mini-ghost-btn" data-edit-id="${entry.id}" aria-label="编辑这条记录">编辑</button>
          <button type="button" class="mini-danger-btn" data-delete-id="${entry.id}" aria-label="删除这条记录">删除</button>
        </div>
      </div>
    </article>
  `).join('');
}

function renderSettings() {
  if (els.goalInput) els.goalInput.value = state.settings.goal;
}

function renderChart() {
  const canvas = els.weeklyChart;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = rect.width || 320;
  const height = 180;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const data = last7DaysTotals(state.entries);
  const max = Math.max(...data.map(d => d.total), state.settings.goal || 1, 100);
  const pad = { top: 16, right: 8, bottom: 28, left: 8 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const gap = 10;
  const barW = chartW / data.length - gap;
  const baselineY = pad.top + chartH;

  ctx.strokeStyle = 'rgba(111, 153, 129, 0.14)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const y = pad.top + (chartH / 3) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(111, 153, 129, 0.22)';
  ctx.beginPath();
  ctx.moveTo(pad.left, baselineY);
  ctx.lineTo(width - pad.right, baselineY);
  ctx.stroke();

  data.forEach((item, i) => {
    const x = pad.left + i * (barW + gap) + gap / 2;
    const rawH = item.total > 0 ? (item.total / max) * chartH : 0;
    const h = rawH > 0 ? Math.max(2, rawH) : 0;
    const y = baselineY - h;
    const isToday = item.isToday;

    if (h > 0) {
      const grad = ctx.createLinearGradient(0, y, 0, baselineY);
      if (isToday) {
        grad.addColorStop(0, '#4fbe78');
        grad.addColorStop(1, '#86e7ad');
      } else {
        grad.addColorStop(0, '#7edc9a');
        grad.addColorStop(1, '#b9f2df');
      }
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, barW, h);

      if (isToday) {
        ctx.strokeStyle = 'rgba(79, 190, 120, 0.9)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, barW, h);
      }

      ctx.fillStyle = isToday ? '#3f9f63' : '#6f9981';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(`${item.total}`, x + barW / 2, Math.max(pad.top + 10, y - 6));
    }

    ctx.fillStyle = isToday ? '#4fbe78' : '#6f9981';
    ctx.font = isToday ? '700 12px system-ui' : '12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(item.label, x + barW / 2, height - 8);
  });
}

function roundRect(ctx, x, y, w, h, r, fill) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function last7DaysTotals(entries) {
  const days = [];
  const byDay = Object.create(null);
  const todayKey = localDateKey();
  entries.forEach(entry => {
    const key = toLocalDateKey(entry.createdAt);
    byDay[key] = (byDay[key] || 0) + Number(entry.calories || 0);
  });
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = toLocalDateKey(d);
    days.push({
      label: d.toLocaleDateString('zh-CN', { weekday: 'short' }).replace('周', ''),
      total: byDay[key] || 0,
      isToday: key === todayKey
    });
  }
  return days;
}

function sortedEntries() {
  return [...state.entries].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function localDateKey() {
  return toLocalDateKey(new Date());
}

function toLocalDateKey(value) {
  const d = new Date(value);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleString('zh-CN', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function exportBackup() {
  try {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      app: 'kawaii-calorie-tracker',
      data: state
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kawaii-calorie-backup-${localDateKey()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('备份已导出');
    pulse([8, 16, 8]);
  } catch (err) {
    console.error(err);
    toast('导出失败');
  }
}

async function importBackup(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const raw = await file.text();
    const parsed = JSON.parse(raw);
    const incoming = sanitizeState(parsed.data || parsed);
    if (!incoming.entries.length && !confirm('这个备份里没有记录，仍然要覆盖当前数据吗？')) {
      e.target.value = '';
      return;
    }
    const ok = confirm('导入备份会覆盖当前这台设备上的数据，确定继续吗？');
    if (!ok) {
      e.target.value = '';
      return;
    }
    state.entries = incoming.entries;
    state.settings = incoming.settings;
    stopEditing();
    saveState();
    renderAll();
    toast('备份已导入 ♡');
    pulse([12, 18, 12]);
  } catch (err) {
    console.error(err);
    toast('导入失败，请检查备份文件');
  } finally {
    e.target.value = '';
  }
}

function sanitizeMealType(value) {
  return Object.prototype.hasOwnProperty.call(MEAL_TYPE_LABELS, value) ? value : 'other';
}

function getMealTypeLabel(value) {
  return MEAL_TYPE_LABELS[sanitizeMealType(value)];
}

function makeEntryId() {
  return (globalThis.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : `entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toast(message) {
  let toastEl = document.querySelector('.toast');
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastEl._timer);
  toastEl._timer = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

function pulse() {}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function highlightMatch(text, query) {
  const safeText = escapeHtml(text);
  if (!query) return safeText;
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'ig');
  return safeText.replace(regex, '<mark>$1</mark>');
}

window.addEventListener('resize', renderChart);
window.addEventListener('error', (e) => {
  console.error('app error', e.error || e.message);
});
