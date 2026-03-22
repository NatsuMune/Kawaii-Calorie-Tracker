const STORAGE_KEY = 'kawaii-calorie-tracker-v3';
const LEGACY_STORAGE_KEY = 'kawaii-calorie-tracker-v2';
const DB_NAME = 'kawaii-calorie-tracker-db';
const DB_STORE = 'state';
const DB_RECORD_KEY = 'primary';
const PROVIDER_CONFIG = Object.freeze({
  openrouter: {
    label: 'OpenRouter',
    defaultModel: 'openai/gpt-4o-mini',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    apiKeyPlaceholder: 'sk-or-v1-...',
    authDocs: 'Authorization: Bearer <OPENROUTER_API_KEY> + HTTP-Referer / X-OpenRouter-Title'
  }
});
const DEFAULT_AI_SETTINGS = Object.freeze({
  provider: 'openrouter',
  model: PROVIDER_CONFIG.openrouter.defaultModel,
  apiKey: ''
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
let estimatingInFlight = false;
let quickAddExpanded = false;
let quickAddLastPointerToggleAt = 0;

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
  aiEstimateBtn: document.getElementById('aiEstimateBtn'),
  aiEstimateStatus: document.getElementById('aiEstimateStatus'),
  aiEstimateResult: document.getElementById('aiEstimateResult'),
  aiModelInput: document.getElementById('aiModelInput'),
  aiApiKeyInput: document.getElementById('aiApiKeyInput'),
  aiConfigSource: document.getElementById('aiConfigSource'),
  aiProviderStatus: document.getElementById('aiProviderStatus'),
  aiDirectHint: document.getElementById('aiDirectHint'),
  goalInput: document.getElementById('goalInput'),
  clearDataBtn: document.getElementById('clearDataBtn'),
  exportDataBtn: document.getElementById('exportDataBtn'),
  importDataInput: document.getElementById('importDataInput'),
  installBtn: document.getElementById('installBtn'),
  quickAddList: document.getElementById('quickAddList'),
  favoriteQuickAddWrap: document.getElementById('favoriteQuickAddWrap'),
  favoriteQuickAddList: document.getElementById('favoriteQuickAddList'),
  quickAddToggleBtn: document.getElementById('quickAddToggleBtn'),
  quickAddPanel: document.getElementById('quickAddPanel'),
  chartTitle: document.getElementById('chartTitle'),
  chartSummary: document.getElementById('chartSummary'),
  chartRange7Btn: document.getElementById('chartRange7Btn'),
  chartRange30Btn: document.getElementById('chartRange30Btn'),
  weeklyChart: document.getElementById('weeklyChart')
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
    try {
      saveStateToLocalStorage(local);
    } catch (err) {
      reportStorageIssue('本地存储读取不稳定，暂时改用备用存储。', err);
    }
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
  }
}

function loadStateFromLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY) || localStorage.getItem('kawaii-calorie-tracker-v1');
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
          .map((entry) => sanitizeEntry(entry))
          .filter((entry) => entry.text)
      : [],
    settings: {
      goal: Math.max(0, Number(parsed.settings?.goal || 2000)),
      favorites: sanitizeFavorites(parsed.settings?.favorites),
      ai: sanitizeAiSettings(parsed.settings?.ai)
    }
  };
}

function sanitizeEntry(entry) {
  const createdAt = normalizeIsoDate(entry.createdAt) || new Date().toISOString();
  const date = deriveEntryDate(entry, createdAt);
  return {
    id: String(entry.id || makeEntryId()),
    text: String(entry.text || '').trim().slice(0, 120),
    calories: Math.max(0, Number(entry.calories) || 0),
    mealType: sanitizeMealType(entry.mealType),
    date,
    createdAt
  };
}

function deriveEntryDate(entry, fallbackCreatedAt) {
  return normalizeDateInputValue(entry?.date)
    || normalizeDateInputValue(entry?.loggedAt)
    || dateKeyFromIso(entry?.createdAt)
    || dateKeyFromIso(fallbackCreatedAt)
    || localDateKey();
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
    btn.addEventListener('click', (e) => {
      e.preventDefault();
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
      const editingEntry = editingEntryId
        ? state.entries.find((item) => item.id === editingEntryId)
        : null;
      const date = resolveEntryDate(els.intakeLoggedAt?.value, editingEntry?.date);
      if (!text || !Number.isFinite(calories) || calories < 0) {
        toast('请输入有效的食物名称和热量 ✨');
        return false;
      }

      if (editingEntryId) {
        const entry = editingEntry;
        if (!entry) {
          stopEditing();
          toast('这条记录已经不存在了');
          return false;
        }
        entry.text = text;
        entry.calories = calories;
        entry.mealType = mealType;
        entry.date = date;
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
        date,
        createdAt: new Date().toISOString()
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

  els.aiModelInput?.addEventListener('change', () => {
    state.settings.ai.model = sanitizeModel(els.aiModelInput.value);
    saveState();
    renderSettings();
  });

  els.aiApiKeyInput?.addEventListener('change', () => {
    state.settings.ai.apiKey = sanitizeApiKey(els.aiApiKeyInput.value);
    saveState();
    renderSettings();
  });

  els.exportDataBtn?.addEventListener('click', exportBackup);
  els.importDataInput?.addEventListener('change', importBackup);
  els.clearDataBtn?.addEventListener('click', () => {
    const ok = confirm('确定要清空这台设备上的全部热量记录吗？');
    if (!ok) return;
    state.entries = [];
    state.settings = createDefaultState().settings;
    stopEditing();
    saveState();
    renderAll();
    toast('已经清空啦');
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
    const target = e.target instanceof Element ? e.target.closest('button') : null;
    if (!target) return;
    if (target.dataset.editId) return startEditing(target.dataset.editId);
    if (target.dataset.deleteId) return deleteEntry(target.dataset.deleteId);
    if (target.dataset.favoriteId) return toggleFavoriteFromEntry(target.dataset.favoriteId);
    if (target.dataset.duplicateId) return duplicateEntry(target.dataset.duplicateId);
  });
}

function bindQuickAdd() {
  const triggerToggle = () => {
    quickAddExpanded = !quickAddExpanded;
    renderQuickAdd();
  };

  els.quickAddToggleBtn?.addEventListener('pointerup', () => {
    quickAddLastPointerToggleAt = Date.now();
    triggerToggle();
  });

  els.quickAddToggleBtn?.addEventListener('click', () => {
    if (Date.now() - quickAddLastPointerToggleAt < 350) return;
    triggerToggle();
  });

  const clickHandler = (event) => {
    const button = event.target instanceof Element ? event.target.closest('.quick-add-btn') : null;
    if (!button) return;
    const index = Number(button.dataset.templateIndex);
    const source = button.dataset.templateSource;
    const templates = source === 'favorite' ? state.settings.favorites : QUICK_ADD_TEMPLATES;
    const template = templates[index];
    if (!template) return;
    applyTemplate(template);
  };

  els.quickAddList?.addEventListener('click', clickHandler);
  els.favoriteQuickAddList?.addEventListener('click', clickHandler);
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
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
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

function applyTemplate(template) {
  if (els.intakeText) els.intakeText.value = template.text;
  if (els.intakeCalories) els.intakeCalories.value = template.calories;
  if (els.intakeMealType) els.intakeMealType.value = sanitizeMealType(template.mealType);
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
    date: localDateKey(),
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
  if (els.intakeLoggedAt) els.intakeLoggedAt.value = entry.date || '';
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

function bindAi() {
  els.aiEstimateBtn?.addEventListener('click', estimateCaloriesWithAi);
}

async function estimateCaloriesWithAi() {
  if (estimatingInFlight) return;
  const text = (els.aiEstimateText?.value || '').trim();
  if (!text) {
    toast('先写点文字描述吧');
    return;
  }

  const aiSettings = getEffectiveAiSettings();
  if (!aiSettings.apiKey) {
    switchView('settings');
    toast('先去设置里填 API Key 才能用 AI 估算');
    return;
  }

  estimatingInFlight = true;
  if (els.aiEstimateBtn) els.aiEstimateBtn.disabled = true;
  if (els.aiEstimateStatus) els.aiEstimateStatus.textContent = `OpenRouter · ${aiSettings.model} · 正在估算…`;
  if (els.aiEstimateResult) els.aiEstimateResult.textContent = '正在请求 OpenRouter，稍等一下下 ✨';

  try {
    const prompt = [
      '你是一个食物热量估算助手。',
      '只返回 JSON，不要写解释。',
      '字段：foodName(string), estimatedCalories(number), confidence(low|medium|high), reasoning(string), portionNote(string), mealType(breakfast|lunch|dinner|snack|other)。',
      '如果描述中没有明确餐别，请合理猜测。',
      `待估算内容：${text}`
    ].join('\n');

    const response = await fetch(PROVIDER_CONFIG.openrouter.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aiSettings.apiKey}`,
        'HTTP-Referer': window.location.origin,
        'X-OpenRouter-Title': 'kawaii-calorie-tracker'
      },
      body: JSON.stringify({
        model: aiSettings.model,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }]
      })
    });

    if (!response.ok) throw new Error(`AI 请求失败：${response.status}`);
    const payload = await response.json();
    const rawContent = payload?.choices?.[0]?.message?.content;
    const content = Array.isArray(rawContent)
      ? rawContent.map((item) => item?.text || '').join('')
      : String(rawContent || '');
    const parsed = JSON.parse(content);
    if (els.intakeText) els.intakeText.value = String(parsed.foodName || text).trim();
    if (els.intakeCalories) els.intakeCalories.value = String(Math.max(0, Number(parsed.estimatedCalories) || 0));
    if (els.intakeMealType) els.intakeMealType.value = sanitizeMealType(parsed.mealType);
    if (els.aiEstimateStatus) els.aiEstimateStatus.textContent = `OpenRouter · ${aiSettings.model}`;
    if (els.aiEstimateResult) {
      const confidenceLabel = parsed.confidence === 'high' ? '高' : parsed.confidence === 'low' ? '低' : '中';
      els.aiEstimateResult.textContent = `${parsed.reasoning || '已完成估算'}｜份量：${parsed.portionNote || '未说明'}｜置信度：${confidenceLabel}`;
    }
    toast('AI 已帮你填好了 ✨');
    pulse([8, 16, 8]);
  } catch (err) {
    console.error(err);
    if (els.aiEstimateStatus) els.aiEstimateStatus.textContent = `OpenRouter · ${aiSettings.model} · 请求失败`;
    if (els.aiEstimateResult) els.aiEstimateResult.textContent = 'AI 估算失败了，检查一下模型或 API Key 再试。';
    toast('AI 估算失败');
  } finally {
    estimatingInFlight = false;
    if (els.aiEstimateBtn) els.aiEstimateBtn.disabled = false;
  }
}

function getEffectiveAiSettings() {
  const ai = sanitizeAiSettings(state.settings.ai);
  return {
    provider: 'openrouter',
    model: sanitizeModel(ai.model) || PROVIDER_CONFIG.openrouter.defaultModel,
    apiKey: sanitizeApiKey(ai.apiKey)
  };
}

function sanitizeAiSettings(ai) {
  return {
    provider: 'openrouter',
    model: sanitizeModel(ai?.model) || DEFAULT_AI_SETTINGS.model,
    apiKey: sanitizeApiKey(ai?.apiKey)
  };
}

function sanitizeModel(value) {
  const model = String(value || '').trim();
  return model.slice(0, 120);
}

function sanitizeApiKey(value) {
  return String(value || '').trim().slice(0, 240);
}

function sanitizeFavorites(list) {
  if (!Array.isArray(list)) return [];
  const deduped = [];
  const seen = new Set();
  list.forEach((item) => {
    const normalized = {
      text: String(item?.text || '').trim().slice(0, 120),
      calories: Math.max(0, Number(item?.calories) || 0),
      mealType: sanitizeMealType(item?.mealType),
      emoji: String(item?.emoji || '').trim().slice(0, 8)
    };
    if (!normalized.text) return;
    const key = makeFavoriteKey(normalized);
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(normalized);
  });
  return deduped.slice(0, 24);
}

function deleteEntry(entryId) {
  const entry = state.entries.find((item) => item.id === entryId);
  if (!entry) {
    toast('找不到这条记录');
    return;
  }
  const ok = confirm(`确定删除「${entry.text}」吗？`);
  if (!ok) return;
  state.entries = state.entries.filter((item) => item.id !== entryId);
  if (editingEntryId === entryId) stopEditing();
  saveState();
  renderAll();
  toast('已删除');
}

function toggleFavoriteFromEntry(entryId) {
  const entry = state.entries.find((item) => item.id === entryId);
  if (!entry) {
    toast('找不到这条记录');
    return;
  }
  const key = makeFavoriteKey(entry);
  const exists = state.settings.favorites.some((item) => makeFavoriteKey(item) === key);
  if (exists) {
    state.settings.favorites = state.settings.favorites.filter((item) => makeFavoriteKey(item) !== key);
    saveState();
    renderAll();
    toast('已取消收藏');
    return;
  }
  state.settings.favorites.unshift({
    text: entry.text,
    calories: entry.calories,
    mealType: entry.mealType,
    emoji: '⭐️'
  });
  state.settings.favorites = sanitizeFavorites(state.settings.favorites);
  saveState();
  renderAll();
  toast('已加入收藏');
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
  const todayTotal = entries.filter(e => e.date === today).reduce((sum, e) => sum + e.calories, 0);
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
  const ring = document.getElementById('goalRingProgress');
  if (!ring) return;
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  ring.style.strokeDasharray = `${circumference}`;
  ring.style.strokeDashoffset = `${circumference * (1 - percent / 100)}`;
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
        <p class="subtle history-meta-line"><span class="meal-badge">${highlightMatch(getMealTypeLabel(entry.mealType), historyQuery)}</span><span>${formatEntryDate(entry)}</span></p>
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
  const provider = 'openrouter';
  const info = PROVIDER_CONFIG[provider];
  if (els.goalInput) els.goalInput.value = state.settings.goal;
  if (els.aiModelInput) els.aiModelInput.value = state.settings.ai.model || '';
  if (els.aiModelInput) els.aiModelInput.placeholder = info.defaultModel;
  if (els.aiApiKeyInput) {
    els.aiApiKeyInput.value = state.settings.ai.apiKey || '';
    els.aiApiKeyInput.placeholder = info.apiKeyPlaceholder;
  }
  if (els.aiConfigSource) {
    els.aiConfigSource.textContent = `${info.label} · ${state.settings.ai.model || info.defaultModel} · 浏览器本地保存 API Key`;
  }
  if (els.aiProviderStatus) {
    els.aiProviderStatus.textContent = state.settings.ai.apiKey
      ? `OpenRouter · ${state.settings.ai.model || info.defaultModel} · API Key 仅保存在当前浏览器`
      : `OpenRouter · ${state.settings.ai.model || info.defaultModel} · 填入 API Key 后即可使用`;
  }
}

function renderQuickAdd() {
  if (!els.quickAddList) return;
  if (els.quickAddToggleBtn) {
    els.quickAddToggleBtn.textContent = quickAddExpanded ? '收起' : '展开';
    els.quickAddToggleBtn.setAttribute('aria-expanded', String(quickAddExpanded));
  }
  els.quickAddPanel?.classList.toggle('hidden', !quickAddExpanded);
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
    const key = entry.date;
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
  return sortedEntriesFrom(state.entries);
}

function localDateKey() {
  return toLocalDateKey(new Date());
}

function toLocalDateKey(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dateKeyFromIso(value) {
  const iso = normalizeIsoDate(value);
  return iso ? toLocalDateKey(iso) : null;
}

function formatDateKey(dateKey) {
  const clean = normalizeDateInputValue(dateKey);
  if (!clean) return '';
  const [year, month, day] = clean.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function formatEntryDate(entry) {
  return formatDateKey(entry?.date);
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
    if (!incoming.entries.length && !confirm(`${summary}\n\n这个备份里没有记录，仍然要覆盖当前数据吗？`)) {
      e.target.value = '';
      return;
    }
    const ok = confirm(`${summary}\n\n导入备份会覆盖当前这台设备上的数据，确定继续吗？`);
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

  const matchesDate = !historyDateFilter || entry.date === historyDateFilter;
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
    ? `${formatEntryDate(first)} ～ ${formatEntryDate(last)}`
    : '无记录';
  return `准备导入备份：${fileName}\n记录数：${incoming.entries.length}\n每日目标：${incoming.settings.goal} kcal\n时间范围：${range}`;
}

function sortedEntriesFrom(entries) {
  return [...entries].sort((a, b) => {
    const byDate = String(b.date || '').localeCompare(String(a.date || ''));
    if (byDate !== 0) return byDate;
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });
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

function resolveEntryDate(value, fallbackDate) {
  return normalizeDateInputValue(value)
    || normalizeDateInputValue(fallbackDate)
    || localDateKey();
}

function normalizeIsoDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeDateInputValue(value) {
  const clean = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(clean) ? clean : null;
}

function toDateInputValue(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return toLocalDateKey(date);
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
