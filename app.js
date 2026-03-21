const STORAGE_KEY = 'kawaii-calorie-tracker-v2';
const LEGACY_STORAGE_KEY = 'kawaii-calorie-tracker-v1';
const DB_NAME = 'kawaii-calorie-tracker-db';
const DB_STORE = 'state';
const DB_RECORD_KEY = 'primary';
const DEFAULT_AI_SETTINGS = Object.freeze({
  provider: 'openrouter',
  model: 'openai/gpt-4o-mini',
  proxyUrl: '/api/ai/estimate'
});
const DEFAULT_STATE = Object.freeze({ entries: [], settings: { goal: 2000, favorites: [], ai: DEFAULT_AI_SETTINGS } });
const QUICK_ADD_TEMPLATES = Object.freeze([
  { text: '拿铁', calories: 180, mealType: 'breakfast', emoji: '☕️' },
  { text: '白煮蛋', calories: 78, mealType: 'breakfast', emoji: '🥚' },
  { text: '米饭一碗', calories: 232, mealType: 'lunch', emoji: '🍚' },
  { text: '鸡胸肉沙拉', calories: 320, mealType: 'lunch', emoji: '🥗' },
  { text: '奶茶', calories: 360, mealType: 'snack', emoji: '🧋' },
  { text: '香蕉', calories: 105, mealType: 'snack', emoji: '🍌' },
  { text: '寿司便当', calories: 520, mealType: 'dinner', emoji: '🍱' },
  { text: '烤三文鱼', calories: 410, mealType: 'dinner', emoji: '🐟' }
]);
const state = createDefaultState();
let deferredPrompt = null;
let editingEntryId = null;
let historyQuery = '';
let historyDateFilter = '';
let historyMealFilter = '';
let chartRangeDays = 7;
let storageWarningShown = false;
let aiConfig = {
  providers: {
    openrouter: { available: false, defaultModel: DEFAULT_AI_SETTINGS.model },
    'z-ai': { available: false, defaultModel: 'glm-4.5v' }
  },
  proxyUrl: DEFAULT_AI_SETTINGS.proxyUrl
};
let aiPhotoDataUrl = '';
let estimatingInFlight = false;

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
  historyDateFilter: document.getElementById('historyDateFilter'),
  historyMealFilter: document.getElementById('historyMealFilter'),
  historyTodayBtn: document.getElementById('historyTodayBtn'),
  historyClearDateBtn: document.getElementById('historyClearDateBtn'),
  intakeForm: document.getElementById('intakeForm'),
  intakeText: document.getElementById('intakeText'),
  intakeCalories: document.getElementById('intakeCalories'),
  intakeMealType: document.getElementById('intakeMealType'),
  intakeLoggedAt: document.getElementById('intakeLoggedAt'),
  submitEntryBtn: document.getElementById('submitEntryBtn'),
  editingBanner: document.getElementById('editingBanner'),
  cancelEditBtn: document.getElementById('cancelEditBtn'),
  aiEstimateText: document.getElementById('aiEstimateText'),
  aiPhotoInput: document.getElementById('aiPhotoInput'),
  aiPhotoName: document.getElementById('aiPhotoName'),
  aiEstimateBtn: document.getElementById('aiEstimateBtn'),
  aiEstimateStatus: document.getElementById('aiEstimateStatus'),
  aiEstimateResult: document.getElementById('aiEstimateResult'),
  aiProviderSelect: document.getElementById('aiProviderSelect'),
  aiModelInput: document.getElementById('aiModelInput'),
  aiProxyUrlInput: document.getElementById('aiProxyUrlInput'),
  aiConfigSource: document.getElementById('aiConfigSource'),
  aiProviderStatus: document.getElementById('aiProviderStatus'),
  goalInput: document.getElementById('goalInput'),
  clearDataBtn: document.getElementById('clearDataBtn'),
  exportDataBtn: document.getElementById('exportDataBtn'),
  importDataInput: document.getElementById('importDataInput'),
  installBtn: document.getElementById('installBtn'),
  quickAddList: document.getElementById('quickAddList'),
  favoriteQuickAddWrap: document.getElementById('favoriteQuickAddWrap'),
  favoriteQuickAddList: document.getElementById('favoriteQuickAddList'),
  chartTitle: document.getElementById('chartTitle'),
  chartSummary: document.getElementById('chartSummary'),
  chartRange7Btn: document.getElementById('chartRange7Btn'),
  chartRange30Btn: document.getElementById('chartRange30Btn'),
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
  bindQuickAdd();
  bindChartControls();
  bindPwa();
  bindAi();
  await hydrateState();
  await hydrateAiConfig();
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
            createdAt: normalizeIsoDate(entry.createdAt) || new Date().toISOString()
          }))
          .filter((entry) => entry.text)
      : [],
    settings: {
      goal: Math.max(0, Number(parsed.settings?.goal || 2000)),
      favorites: sanitizeFavorites(parsed.settings?.favorites),
      ai: sanitizeAiSettings(parsed.settings?.ai)
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
      const createdAt = resolveEntryTimestamp(els.intakeLoggedAt?.value);
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
        entry.createdAt = createdAt;
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
        createdAt
      };
      state.entries.unshift(entry);
      saveState();
      renderAll();
      stopEditing();
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

  els.aiProviderSelect?.addEventListener('change', () => {
    state.settings.ai.provider = normalizeProvider(els.aiProviderSelect.value);
    const providerInfo = aiConfig.providers[state.settings.ai.provider];
    if (!state.settings.ai.model || state.settings.ai.model === DEFAULT_AI_SETTINGS.model || state.settings.ai.model === aiConfig.providers.openrouter.defaultModel || state.settings.ai.model === aiConfig.providers['z-ai'].defaultModel) {
      state.settings.ai.model = providerInfo?.defaultModel || DEFAULT_AI_SETTINGS.model;
    }
    saveState();
    renderSettings();
  });

  els.aiModelInput?.addEventListener('change', () => {
    state.settings.ai.model = sanitizeModel(els.aiModelInput.value);
    saveState();
    renderSettings();
  });

  els.aiProxyUrlInput?.addEventListener('change', () => {
    state.settings.ai.proxyUrl = sanitizeProxyUrl(els.aiProxyUrlInput.value);
    saveState();
    renderSettings();
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

  els.historyDateFilter?.addEventListener('change', () => {
    historyDateFilter = els.historyDateFilter.value || '';
    renderHistory();
  });

  els.historyMealFilter?.addEventListener('change', () => {
    historyMealFilter = sanitizeMealType(els.historyMealFilter.value) === 'other' && !els.historyMealFilter.value ? '' : (els.historyMealFilter.value || '');
    renderHistory();
  });

  els.historyTodayBtn?.addEventListener('click', () => {
    historyDateFilter = localDateKey();
    if (els.historyDateFilter) els.historyDateFilter.value = historyDateFilter;
    renderHistory();
  });

  els.historyClearDateBtn?.addEventListener('click', () => {
    historyDateFilter = '';
    historyMealFilter = '';
    if (els.historyDateFilter) els.historyDateFilter.value = '';
    if (els.historyMealFilter) els.historyMealFilter.value = '';
    renderHistory();
  });

  els.historyList?.addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit-id]');
    if (editBtn) {
      startEditing(editBtn.dataset.editId);
      return;
    }

    const duplicateBtn = e.target.closest('[data-duplicate-id]');
    if (duplicateBtn) {
      duplicateEntry(duplicateBtn.dataset.duplicateId);
      return;
    }

    const favoriteBtn = e.target.closest('[data-favorite-id]');
    if (favoriteBtn) {
      toggleFavoriteFromEntry(favoriteBtn.dataset.favoriteId);
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

function bindQuickAdd() {
  const handleClick = (button) => {
    if (!button) return;
    const source = button.dataset.templateSource || 'default';
    const index = Number(button.dataset.templateIndex);
    const templates = source === 'favorite' ? state.settings.favorites : QUICK_ADD_TEMPLATES;
    const template = templates[index];
    if (!template) return;
    applyTemplate(template);
  };

  els.quickAddList?.addEventListener('click', (e) => handleClick(e.target.closest('[data-template-index]')));
  els.favoriteQuickAddList?.addEventListener('click', (e) => handleClick(e.target.closest('[data-template-index]')));
}

function applyTemplate(template) {
  if (els.intakeText) els.intakeText.value = template.text;
  if (els.intakeCalories) els.intakeCalories.value = template.calories;
  if (els.intakeMealType) els.intakeMealType.value = sanitizeMealType(template.mealType);
  if (!editingEntryId && els.intakeLoggedAt && !els.intakeLoggedAt.value) {
    els.intakeLoggedAt.value = toDatetimeLocalValue(new Date());
  }
  els.intakeText?.focus();
  toast(`已填入 ${template.text}`);
  pulse([8, 16, 8]);
}

function duplicateEntry(entryId) {
  const entry = state.entries.find((item) => item.id === entryId);
  if (!entry) {
    toast('找不到这条记录');
    return;
  }

  state.entries.unshift({
    id: makeEntryId(),
    text: entry.text,
    calories: entry.calories,
    mealType: entry.mealType,
    createdAt: new Date().toISOString()
  });
  saveState();
  renderAll();
  toast(`已再记一次 ${entry.text} ♡`);
  pulse([10, 14, 10]);
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
  if (els.intakeLoggedAt) els.intakeLoggedAt.value = toDatetimeLocalValue(entry.createdAt);
  renderEditorState();
  switchView('log');
  els.intakeText?.focus();
  toast('已载入记录，修改后保存');
  pulse([8, 16, 8]);
}

function stopEditing(keepInputs = false) {
  editingEntryId = null;
  if (!keepInputs) els.intakeForm?.reset();
  if (els.intakeLoggedAt && !keepInputs) {
    els.intakeLoggedAt.value = toDatetimeLocalValue(new Date());
  }
  renderEditorState();
}

function renderEditorState() {
  const editing = Boolean(editingEntryId);
  els.editingBanner?.classList.toggle('hidden', !editing);
  if (els.submitEntryBtn) {
    els.submitEntryBtn.textContent = editing ? '更新记录' : '保存记录';
  }
}

function bindAi() {
  els.aiPhotoInput?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    aiPhotoDataUrl = file ? await readFileAsDataUrl(file) : '';
    if (els.aiPhotoName) els.aiPhotoName.textContent = file ? `已选照片：${file.name}` : '可选：拍照或上传食物图片';
  });

  els.aiEstimateBtn?.addEventListener('click', estimateCaloriesWithAi);
}

async function hydrateAiConfig() {
  try {
    const response = await fetch('/api/ai/config', { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error || 'AI 配置获取失败');
    aiConfig = payload;
    if (!state.settings.ai.proxyUrl || state.settings.ai.proxyUrl === DEFAULT_AI_SETTINGS.proxyUrl) {
      state.settings.ai.proxyUrl = sanitizeProxyUrl(payload.proxyUrl || DEFAULT_AI_SETTINGS.proxyUrl);
    }
    const provider = normalizeProvider(state.settings.ai.provider);
    const providerInfo = aiConfig.providers?.[provider];
    if (!state.settings.ai.model) {
      state.settings.ai.model = providerInfo?.defaultModel || DEFAULT_AI_SETTINGS.model;
    }
    saveState();
  } catch (error) {
    console.error(error);
  }
}

async function estimateCaloriesWithAi() {
  if (estimatingInFlight) return;
  const text = (els.aiEstimateText?.value || '').trim();
  if (!text && !aiPhotoDataUrl) {
    toast('先写点描述，或者加一张照片吧');
    return;
  }

  estimatingInFlight = true;
  if (els.aiEstimateBtn) els.aiEstimateBtn.disabled = true;
  if (els.aiEstimateStatus) els.aiEstimateStatus.textContent = 'AI 正在估算中…';

  try {
    const response = await fetch(state.settings.ai.proxyUrl || '/api/ai/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: state.settings.ai.provider,
        model: state.settings.ai.model,
        text,
        photoDataUrl: aiPhotoDataUrl
      })
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload?.error || 'AI 估算失败');
    applyAiEstimate(payload.result);
  } catch (error) {
    console.error(error);
    if (els.aiEstimateStatus) els.aiEstimateStatus.textContent = error.message || 'AI 估算失败';
    toast(error.message || 'AI 估算失败');
  } finally {
    estimatingInFlight = false;
    if (els.aiEstimateBtn) els.aiEstimateBtn.disabled = false;
  }
}

function applyAiEstimate(result) {
  if (els.intakeText && !els.intakeText.value.trim()) els.intakeText.value = result.foodName || (els.aiEstimateText?.value || '').trim();
  if (els.intakeCalories) els.intakeCalories.value = result.estimatedCalories || '';
  if (els.aiEstimateStatus) els.aiEstimateStatus.textContent = `已从 ${getProviderLabel(state.settings.ai.provider)} · ${state.settings.ai.model} 填入估算结果`;
  if (els.aiEstimateResult) {
    els.aiEstimateResult.innerHTML = `
      <strong>${escapeHtml(result.foodName || '食物')}</strong>
      <p>${escapeHtml(`${result.estimatedCalories} kcal · 置信度 ${getConfidenceLabel(result.confidence)}`)}</p>
      <p class="subtle">${escapeHtml(result.portionNote || result.reasoning || '可继续手动微调后保存。')}</p>
    `;
  }
  toast('AI 估算已填入 ✨');
}


function bindChartControls() {
  els.chartRange7Btn?.addEventListener('click', () => {
    chartRangeDays = 7;
    renderChart();
  });
  els.chartRange30Btn?.addEventListener('click', () => {
    chartRangeDays = 30;
    renderChart();
  });
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
  renderQuickAdd();
  renderChart();
  renderEditorState();
}

function renderStats() {
  const today = localDateKey();
  const entries = sortedEntries();
  const todayTotal = entries.filter(e => toLocalDateKey(e.createdAt) === today).reduce((sum, e) => sum + e.calories, 0);
  const daily = getChartDailyTotals(entries, 7);
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
  const filtered = entries.filter((entry) => matchesHistoryFilters(entry));
  const visible = filtered.slice(0, 20);

  if (!entries.length) {
    els.historyList.innerHTML = '<div class="history-item empty-history"><div class="history-meta"><strong>还没有记录</strong><p class="subtle">先去添加今天吃的第一样东西吧 ♡</p></div></div>';
    return;
  }

  if (!visible.length) {
    els.historyList.innerHTML = `<div class="history-item empty-history"><div class="history-meta"><strong>没有找到匹配记录</strong><p class="subtle">${escapeHtml(buildEmptyHistoryHint())}</p></div></div>`;
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
          <button type="button" class="mini-ghost-btn" data-duplicate-id="${entry.id}" aria-label="再记一次这条记录">再记一次</button>
          <button type="button" class="mini-ghost-btn" data-favorite-id="${entry.id}" aria-label="${isEntryFavorite(entry) ? '取消收藏这条记录' : '收藏这条记录'}">${isEntryFavorite(entry) ? '已收藏' : '收藏'}</button>
          <button type="button" class="mini-danger-btn" data-delete-id="${entry.id}" aria-label="删除这条记录">删除</button>
        </div>
      </div>
    </article>
  `).join('');
}

function renderSettings() {
  if (els.goalInput) els.goalInput.value = state.settings.goal;
  if (els.aiProviderSelect) els.aiProviderSelect.value = normalizeProvider(state.settings.ai.provider);
  if (els.aiModelInput) els.aiModelInput.value = state.settings.ai.model || '';
  if (els.aiProxyUrlInput) els.aiProxyUrlInput.value = state.settings.ai.proxyUrl || '';
  if (els.aiConfigSource) {
    els.aiConfigSource.textContent = `${getProviderLabel(state.settings.ai.provider)} · ${state.settings.ai.model} · ${state.settings.ai.proxyUrl}`;
  }
  if (els.aiProviderStatus) {
    const provider = normalizeProvider(state.settings.ai.provider);
    const info = aiConfig.providers?.[provider];
    const availableText = info?.available ? '本机已检测到密钥，可直接估算。' : '本机还没检测到对应密钥。';
    els.aiProviderStatus.textContent = `${getProviderLabel(provider)}：${availableText}`;
  }
}

function renderQuickAdd() {
  if (!els.quickAddList) return;
  els.quickAddList.innerHTML = renderQuickAddButtons(QUICK_ADD_TEMPLATES, 'default');
  if (els.favoriteQuickAddList && els.favoriteQuickAddWrap) {
    const hasFavorites = state.settings.favorites.length > 0;
    els.favoriteQuickAddWrap.classList.toggle('hidden', !hasFavorites);
    els.favoriteQuickAddList.innerHTML = hasFavorites ? renderQuickAddButtons(state.settings.favorites, 'favorite') : '';
  }
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

  const data = getChartDailyTotals(state.entries, chartRangeDays);
  const max = Math.max(...data.map(d => d.total), state.settings.goal || 1, 100);
  const pad = { top: 16, right: 8, bottom: 28, left: 8 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
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

  const dynamicGap = chartRangeDays === 30 ? 4 : 10;
  const barW = Math.max(4, chartW / data.length - dynamicGap);

  data.forEach((item, i) => {
    const x = pad.left + i * (barW + dynamicGap) + dynamicGap / 2;
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

      if (chartRangeDays <= 7) {
        ctx.fillStyle = isToday ? '#3f9f63' : '#6f9981';
        ctx.font = '11px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(`${item.total}`, x + barW / 2, Math.max(pad.top + 10, y - 6));
      }
    }

    if (chartRangeDays <= 7 || item.showLabel) {
      ctx.fillStyle = isToday ? '#4fbe78' : '#6f9981';
      ctx.font = isToday ? '700 12px system-ui' : '12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(item.label, x + barW / 2, height - 8);
    }
  });

  renderChartMeta(data);
}

function renderChartMeta(data) {
  const average = data.length ? Math.round(data.reduce((sum, item) => sum + item.total, 0) / data.length) : 0;
  if (els.chartTitle) els.chartTitle.textContent = chartRangeDays === 30 ? '30 天趋势' : '每周图表';
  if (els.chartSummary) els.chartSummary.textContent = chartRangeDays === 30
    ? `最近 30 天平均摄入 ${average} kcal`
    : `最近 7 天平均摄入 ${average} kcal`;
  if (els.chartRange7Btn) {
    els.chartRange7Btn.setAttribute('aria-pressed', String(chartRangeDays === 7));
    els.chartRange7Btn.classList.toggle('active-pill', chartRangeDays === 7);
  }
  if (els.chartRange30Btn) {
    els.chartRange30Btn.setAttribute('aria-pressed', String(chartRangeDays === 30));
    els.chartRange30Btn.classList.toggle('active-pill', chartRangeDays === 30);
  }
}

function getChartDailyTotals(entries, days) {
  const items = [];
  const byDay = Object.create(null);
  const todayKey = localDateKey();
  entries.forEach(entry => {
    const key = toLocalDateKey(entry.createdAt);
    byDay[key] = (byDay[key] || 0) + Number(entry.calories || 0);
  });
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = toLocalDateKey(d);
    items.push({
      label: days === 30 ? `${d.getMonth() + 1}/${d.getDate()}` : d.toLocaleDateString('zh-CN', { weekday: 'short' }).replace('周', ''),
      total: byDay[key] || 0,
      isToday: key === todayKey,
      showLabel: days === 30 ? (i % 5 === 0 || i === 0) : true
    });
  }
  return items;
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
    const exportedAt = new Date();
    const payload = {
      version: 1,
      exportedAt: exportedAt.toISOString(),
      app: 'kawaii-calorie-tracker',
      data: state
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kawaii-calorie-backup-${formatTimestampForFilename(exportedAt)}.json`;
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
    const summary = buildImportSummary(incoming, file.name);
    if (!incoming.entries.length && !confirm(`${summary}

这个备份里没有记录，仍然要覆盖当前数据吗？`)) {
      e.target.value = '';
      return;
    }
    const ok = confirm(`${summary}

导入备份会覆盖当前这台设备上的数据，确定继续吗？`);
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


function matchesHistoryFilters(entry) {
  const matchesQuery = !historyQuery || (() => {
    const query = historyQuery.toLowerCase();
    return entry.text.toLowerCase().includes(query) || getMealTypeLabel(entry.mealType).toLowerCase().includes(query);
  })();

  const matchesDate = !historyDateFilter || toLocalDateKey(entry.createdAt) === historyDateFilter;
  const matchesMeal = !historyMealFilter || sanitizeMealType(entry.mealType) === historyMealFilter;
  return matchesQuery && matchesDate && matchesMeal;
}

function buildEmptyHistoryHint() {
  const parts = [];
  if (historyQuery) parts.push(`关键词：${historyQuery}`);
  if (historyDateFilter) parts.push(`日期：${historyDateFilter}`);
  if (historyMealFilter) parts.push(`餐别：${getMealTypeLabel(historyMealFilter)}`);
  return parts.length
    ? `当前筛选条件下没有记录（${parts.join('，')}）。试试清空筛选吧。`
    : '试试别的关键词，或者清空搜索词吧。';
}

function buildImportSummary(incoming, fileName) {
  const entries = sortedEntriesFrom(incoming.entries);
  const first = entries[entries.length - 1];
  const last = entries[0];
  const range = entries.length
    ? `${formatDate(first.createdAt)} ～ ${formatDate(last.createdAt)}`
    : '无记录';
  return `准备导入备份：${fileName}\n记录数：${incoming.entries.length}\n每日目标：${incoming.settings.goal} kcal\n时间范围：${range}`;
}

function sortedEntriesFrom(entries) {
  return [...entries].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function renderQuickAddButtons(templates, source) {
  return templates.map((template, index) => `
    <button type="button" class="quick-add-btn" data-template-source="${source}" data-template-index="${index}" aria-label="快捷填入 ${template.text}">
      <span class="quick-add-emoji" aria-hidden="true">${template.emoji || '🍽️'}</span>
      <span class="quick-add-copy">
        <strong>${template.text}</strong>
        <small>${template.calories} kcal · ${getMealTypeLabel(template.mealType)}</small>
      </span>
    </button>
  `).join('');
}

function sanitizeFavorites(favorites) {
  return Array.isArray(favorites)
    ? favorites
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          text: String(item.text || '').trim().slice(0, 120),
          calories: Math.max(0, Number(item.calories) || 0),
          mealType: sanitizeMealType(item.mealType),
          emoji: String(item.emoji || '⭐️').trim().slice(0, 4) || '⭐️'
        }))
        .filter((item) => item.text)
    : [];
}

function sanitizeAiSettings(ai) {
  const provider = normalizeProvider(ai?.provider);
  return {
    provider,
    model: sanitizeModel(ai?.model || (provider === 'z-ai' ? 'glm-4.5v' : DEFAULT_AI_SETTINGS.model)),
    proxyUrl: sanitizeProxyUrl(ai?.proxyUrl || DEFAULT_AI_SETTINGS.proxyUrl)
  };
}

function normalizeProvider(value) {
  return value === 'z-ai' ? 'z-ai' : 'openrouter';
}

function sanitizeModel(value) {
  return String(value || '').trim().slice(0, 120);
}

function sanitizeProxyUrl(value) {
  const trimmed = String(value || '').trim();
  return trimmed || DEFAULT_AI_SETTINGS.proxyUrl;
}

function getProviderLabel(provider) {
  return provider === 'z-ai' ? 'z.ai' : 'OpenRouter';
}

function getConfidenceLabel(confidence) {
  return ({ low: '低', medium: '中', high: '高' })[confidence] || '中';
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

function toggleFavoriteFromEntry(entryId) {
  const entry = state.entries.find((item) => item.id === entryId);
  if (!entry) {
    toast('找不到这条记录');
    return;
  }

  const key = makeFavoriteKey(entry);
  const existingIndex = state.settings.favorites.findIndex((item) => makeFavoriteKey(item) === key);

  if (existingIndex >= 0) {
    state.settings.favorites.splice(existingIndex, 1);
    saveState();
    renderAll();
    toast(`已取消收藏 ${entry.text}`);
    return;
  }

  state.settings.favorites.unshift({
    text: entry.text,
    calories: entry.calories,
    mealType: entry.mealType,
    emoji: '⭐️'
  });
  state.settings.favorites = state.settings.favorites.slice(0, 8);
  saveState();
  renderAll();
  toast(`已收藏 ${entry.text}`);
}

function makeFavoriteKey(item) {
  return `${String(item.text).trim().toLowerCase()}::${Number(item.calories) || 0}::${sanitizeMealType(item.mealType)}`;
}

function isEntryFavorite(entry) {
  const key = makeFavoriteKey(entry);
  return state.settings.favorites.some((item) => makeFavoriteKey(item) === key);
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

function resolveEntryTimestamp(value) {
  return normalizeIsoDate(value) || new Date().toISOString();
}

function normalizeIsoDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toDatetimeLocalValue(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const tzOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - tzOffset).toISOString().slice(0, 16);
}

function formatTimestampForFilename(value) {
  const date = value instanceof Date ? value : new Date(value);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}-${hh}${mm}`;
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
