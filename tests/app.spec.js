const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    indexedDB.deleteDatabase('kawaii-calorie-tracker-db');
  });
  await page.reload();
});

async function seedEntries(page) {
  const now = new Date();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  await page.getByRole('button', { name: '记录' }).click();
  await page.locator('#intakeText').fill('今天的午餐');
  await page.locator('#intakeCalories').fill('450');
  await page.locator('#intakeMealType').selectOption('lunch');
  await page.locator('#intakeLoggedAt').fill(fmt(now));
  await page.getByRole('button', { name: '保存记录' }).click();

  await page.locator('.nav-btn[data-target="log"]').click();
  await page.locator('#intakeText').fill('昨天的奶茶');
  await page.locator('#intakeCalories').fill('300');
  await page.locator('#intakeMealType').selectOption('snack');
  await page.locator('#intakeLoggedAt').fill(fmt(yesterday));
  await page.getByRole('button', { name: '保存记录' }).click();
  await page.getByRole('button', { name: '主页' }).click();

  return { now, yesterday };
}

test('quick-add is collapsed by default and can be expanded with touch', async ({ page }) => {
  await page.getByRole('button', { name: '记录' }).click();

  const toggle = page.locator('#quickAddToggleBtn');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#quickAddPanel')).toBeHidden();

  await toggle.tap();

  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#quickAddPanel')).toBeVisible();
  await expect(page.getByRole('button', { name: /快捷填入 拿铁/ })).toBeVisible();
});

test('quick-add touch toggle does not immediately double-toggle from the follow-up click', async ({ page }) => {
  await page.getByRole('button', { name: '记录' }).click();

  const toggle = page.locator('#quickAddToggleBtn');
  await toggle.tap();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  await toggle.tap();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#quickAddPanel')).toBeHidden();
});

test('quick-add fills the form and saves an entry for today', async ({ page }) => {
  await page.getByRole('button', { name: '记录' }).click();
  await page.getByRole('button', { name: '展开' }).click();
  await page.getByRole('button', { name: /快捷填入 拿铁/ }).click();

  await expect(page.locator('#intakeText')).toHaveValue('拿铁');
  await expect(page.locator('#intakeCalories')).toHaveValue('180');
  await expect(page.locator('#intakeMealType')).toHaveValue('breakfast');
  await expect(page.locator('#intakeLoggedAt')).toHaveValue('');

  await page.getByRole('button', { name: '保存记录' }).click();
  await expect(page.locator('.view[data-view="log"]')).toHaveClass(/active/);
  await expect(page.locator('#intakeText')).toHaveValue('');
  await expect(page.locator('#intakeCalories')).toHaveValue('');
  await expect(page.locator('#intakeMealType')).toHaveValue('breakfast');
  await expect(page.locator('#intakeLoggedAt')).toHaveValue('');
  await expect(page.locator('#todayTotal')).toHaveText('180');
  await expect(page.locator('#historyList')).toContainText('拿铁');
});

test('saving a new entry clears the log screen for the next intake', async ({ page }) => {
  await page.getByRole('button', { name: '记录' }).click();
  await page.locator('#intakeText').fill('红豆面包');
  await page.locator('#intakeCalories').fill('260');
  await page.locator('#intakeMealType').selectOption('snack');
  await page.locator('#intakeLoggedAt').fill('2026-03-21');
  await page.locator('#aiEstimateText').fill('刚刚估算过的内容');
  await page.evaluate(() => {
    document.getElementById('aiEstimateStatus').textContent = 'OpenRouter · model';
    document.getElementById('aiEstimateResult').textContent = '上一条估算结果';
  });

  await page.getByRole('button', { name: '保存记录' }).click();

  await expect(page.locator('.view[data-view="log"]')).toHaveClass(/active/);
  await expect(page.locator('#intakeText')).toHaveValue('');
  await expect(page.locator('#intakeCalories')).toHaveValue('');
  await expect(page.locator('#intakeMealType')).toHaveValue('breakfast');
  await expect(page.locator('#intakeLoggedAt')).toHaveValue('');
  await expect(page.locator('#aiEstimateText')).toHaveValue('');
  await expect(page.locator('#aiEstimateStatus')).toHaveText('');
  await expect(page.locator('#aiEstimateResult')).toHaveText('');
  await expect(page.locator('#intakeText')).toBeFocused();
});

test('saving with an empty date uses today when you reopen the entry', async ({ page }) => {
  await page.getByRole('button', { name: '记录' }).click();
  await page.locator('#intakeText').fill('延迟保存测试');
  await page.locator('#intakeCalories').fill('123');
  await expect(page.locator('#intakeLoggedAt')).toHaveValue('');

  const expectedDate = await page.evaluate(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  await page.getByRole('button', { name: '保存记录' }).click();

  await page.getByRole('button', { name: '主页' }).click();
  await page.getByRole('button', { name: '编辑这条记录' }).click();
  await expect(page.locator('#intakeLoggedAt')).toHaveValue(expectedDate);
});

test('history cards no longer offer duplicate action', async ({ page }) => {
  await page.getByRole('button', { name: '记录' }).click();
  await page.locator('#intakeText').fill('奶茶');
  await page.locator('#intakeCalories').fill('300');
  await page.getByRole('button', { name: '保存记录' }).click();

  await expect(page.getByRole('button', { name: '再记一次这条记录' })).toHaveCount(0);
  await expect(page.locator('#todayTotal')).toHaveText('300');
  await expect(page.locator('#entryCount')).toHaveText('1');
});

test('backfilled entries keep history but do not affect today total', async ({ page }) => {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const yyyy = yesterday.getFullYear();
  const mm = String(yesterday.getMonth() + 1).padStart(2, '0');
  const dd = String(yesterday.getDate()).padStart(2, '0');
  const localValue = `${yyyy}-${mm}-${dd}`;

  await page.getByRole('button', { name: '记录' }).click();
  await page.locator('#intakeText').fill('昨晚宵夜');
  await page.locator('#intakeCalories').fill('250');
  await page.locator('#intakeLoggedAt').fill(localValue);
  await page.getByRole('button', { name: '保存记录' }).click();

  await expect(page.locator('#todayTotal')).toHaveText('0');
  await expect(page.locator('#entryCount')).toHaveText('1');
  await expect(page.locator('#historyList')).toContainText('昨晚宵夜');
});

test('history date filter shows only matching day entries', async ({ page }) => {
  const { yesterday } = await seedEntries(page);

  const yyyy = yesterday.getFullYear();
  const mm = String(yesterday.getMonth() + 1).padStart(2, '0');
  const dd = String(yesterday.getDate()).padStart(2, '0');
  await page.locator('#historyDateFilter').fill(`${yyyy}-${mm}-${dd}`);

  await expect(page.locator('#historyList')).toContainText('昨天的奶茶');
  await expect(page.locator('#historyList')).not.toContainText('今天的午餐');
});

test('import asks with backup summary before overwrite', async ({ page }) => {
  await page.getByRole('button', { name: '设置' }).click();
  page.on('dialog', async (dialog) => {
    expect(dialog.message()).toContain('准备导入备份：demo-backup.json');
    expect(dialog.message()).toContain('记录数：1');
    expect(dialog.message()).toContain('每日目标：1888 kcal');
    await dialog.dismiss();
  });

  await page.locator('#importDataInput').evaluate((input) => {
    const file = new File([
      JSON.stringify({
        data: {
          entries: [{ text: '测试导入', calories: 222, mealType: 'snack', createdAt: new Date().toISOString() }],
          settings: { goal: 1888 }
        }
      })
    ], 'demo-backup.json', { type: 'application/json' });
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await expect(page.locator('#entryCount')).toHaveText('0');
});

test('mobile dashboard layout stays within viewport and matches visual baseline', async ({ page }) => {
  await seedEntries(page);

  const viewport = page.viewportSize();
  const appShellBox = await page.locator('.app-shell').boundingBox();
  const historyDateBox = await page.locator('#historyDateFilter').boundingBox();
  const bottomNavBox = await page.locator('.bottom-nav').boundingBox();

  expect(appShellBox).not.toBeNull();
  expect(historyDateBox).not.toBeNull();
  expect(bottomNavBox).not.toBeNull();

  expect(appShellBox.x).toBeGreaterThanOrEqual(0);
  expect(appShellBox.x + appShellBox.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(historyDateBox.x + historyDateBox.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(bottomNavBox.x).toBeGreaterThanOrEqual(0);
  expect(bottomNavBox.x + bottomNavBox.width).toBeLessThanOrEqual(viewport.width + 1);

  await expect(page).toHaveScreenshot('mobile-dashboard.png', {
    fullPage: true,
    animations: 'disabled',
    maxDiffPixelRatio: 0.03,
  });
});

test('mobile log view matches visual baseline', async ({ page }) => {
  await page.getByRole('button', { name: '记录' }).click();

  await expect(page).toHaveScreenshot('mobile-log-view.png', {
    fullPage: true,
    animations: 'disabled',
    maxDiffPixelRatio: 0.03,
  });
});

test('mobile history cards keep metadata and actions in a stable stacked layout', async ({ page }) => {
  await page.getByRole('button', { name: '记录' }).click();
  await page.locator('#intakeText').fill('超长名字测试超级豪华双层芝士牛肉汉堡配薯条');
  await page.locator('#intakeCalories').fill('780');
  await page.locator('#intakeMealType').selectOption('dinner');
  await page.getByRole('button', { name: '保存记录' }).click();
  await page.getByRole('button', { name: '主页' }).click();

  const card = page.locator('.history-item').first();
  const meta = card.locator('.history-meta');
  const actions = card.locator('.history-actions');
  const buttonRows = card.locator('.history-btn-row');
  const favoriteButton = card.locator('[data-favorite-id]').first();
  const editButton = card.locator('[data-edit-id]').first();
  const deleteButton = card.locator('[data-delete-id]').first();

  await expect(card.locator('.history-date')).toBeVisible();
  await expect(card.locator('.meal-badge')).toBeVisible();
  await expect(card.locator('.history-calories')).toBeVisible();
  await expect(buttonRows).toHaveCount(2);
  await expect(favoriteButton).toHaveText('☆ 收藏');
  await expect(editButton).toHaveText('编辑');
  await expect(deleteButton).toHaveText('删除');

  const cardBox = await card.boundingBox();
  const metaBox = await meta.boundingBox();
  const actionsBox = await actions.boundingBox();
  const firstRowBox = await buttonRows.nth(0).boundingBox();
  const secondRowBox = await buttonRows.nth(1).boundingBox();
  const favoriteButtonBox = await favoriteButton.boundingBox();
  const editButtonBox = await editButton.boundingBox();
  const deleteButtonBox = await deleteButton.boundingBox();

  expect(cardBox).not.toBeNull();
  expect(metaBox).not.toBeNull();
  expect(actionsBox).not.toBeNull();
  expect(firstRowBox).not.toBeNull();
  expect(secondRowBox).not.toBeNull();
  expect(favoriteButtonBox).not.toBeNull();
  expect(editButtonBox).not.toBeNull();
  expect(deleteButtonBox).not.toBeNull();

  expect(actionsBox.y).toBeGreaterThan(metaBox.y + metaBox.height - 1);
  expect(firstRowBox.y).toBeLessThan(secondRowBox.y);
  expect(favoriteButtonBox.y).toBeLessThan(editButtonBox.y);
  expect(Math.abs(editButtonBox.y - deleteButtonBox.y)).toBeLessThan(2);
  expect(favoriteButtonBox.x + favoriteButtonBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
  expect(editButtonBox.x + editButtonBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
  expect(deleteButtonBox.x + deleteButtonBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
});


test('history meal filter shows only matching meal type entries', async ({ page }) => {
  await seedEntries(page);
  await page.locator('#historyMealFilter').selectOption('lunch');

  await expect(page.locator('#historyList')).toContainText('今天的午餐');
  await expect(page.locator('#historyList')).not.toContainText('昨天的奶茶');
});

test('favorite entry appears in favorite quick-add section and can be reused', async ({ page }) => {
  await page.getByRole('button', { name: '记录' }).click();
  await page.locator('#intakeText').fill('希腊酸奶');
  await page.locator('#intakeCalories').fill('160');
  await page.locator('#intakeMealType').selectOption('breakfast');
  await page.getByRole('button', { name: '保存记录' }).click();
  await page.getByRole('button', { name: '主页' }).click();

  await page.getByRole('button', { name: '收藏这条记录' }).click();
  await expect(page.getByRole('button', { name: '取消收藏这条记录' })).toHaveText('⭐️ 已收藏');
  await page.locator('.nav-btn[data-target="log"]').click();
  await page.getByRole('button', { name: '展开' }).click();

  await expect(page.locator('#favoriteQuickAddWrap')).toBeVisible();
  await expect(page.locator('#favoriteQuickAddList')).toContainText('希腊酸奶');

  await page.locator('#intakeText').fill('');
  await page.locator('#intakeCalories').fill('');
  await page.getByRole('button', { name: /快捷填入 希腊酸奶/ }).click();

  await expect(page.locator('#intakeText')).toHaveValue('希腊酸奶');
  await expect(page.locator('#intakeCalories')).toHaveValue('160');
  await expect(page.locator('#intakeMealType')).toHaveValue('breakfast');
  await expect(page.locator('#intakeLoggedAt')).toHaveValue('');
});


test('chart can switch between 7-day and 30-day modes', async ({ page }) => {
  await seedEntries(page);

  await expect(page.locator('#chartTitle')).toHaveText('每周图表');
  await expect(page.locator('#chartSummary')).toContainText('最近 7 天平均摄入');
  await expect(page.locator('#chartRange7Btn')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('#chartRange30Btn').click();

  await expect(page.locator('#chartTitle')).toHaveText('30 天趋势');
  await expect(page.locator('#chartSummary')).toContainText('最近 30 天平均摄入');
  await expect(page.locator('#chartRange30Btn')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#chartRange7Btn')).toHaveAttribute('aria-pressed', 'false');
});

test('ai estimate uses OpenRouter as the only built-in browser-direct provider', async ({ page }) => {
  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    const request = route.request();
    const payload = JSON.parse(request.postData() || '{}');
    expect(request.headers().authorization).toBe('Bearer browser-key');
    expect(request.headers()['x-openrouter-title']).toBe('kawaii-calorie-tracker');
    expect(payload.model).toBe('arcee-ai/trinity-large-preview:free');
    expect(payload.messages[0].content[0].text).toContain('牛肉面');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                foodName: '牛肉面',
                estimatedCalories: 640,
                confidence: 'medium',
                reasoning: '按一大碗汤面估算',
                portionNote: '包含面条、牛肉与汤底',
                mealType: 'lunch'
              })
            }
          }
        ]
      })
    });
  });

  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.locator('#aiProviderSelect')).toHaveCount(0);
  await expect(page.locator('.settings-fixed-provider')).toContainText('OpenRouter');
  await expect(page.locator('#aiModelInput')).toHaveValue('arcee-ai/trinity-large-preview:free');
  await page.locator('#aiApiKeyInput').fill('browser-key');
  await page.locator('#aiApiKeyInput').dispatchEvent('change');
  await page.locator('.nav-btn[data-target="log"]').click();

  await page.locator('#aiEstimateText').fill('一碗牛肉面，加半颗卤蛋');
  await page.getByRole('button', { name: 'AI 估算并填入' }).click();

  await expect(page.locator('#intakeText')).toHaveValue('牛肉面');
  await expect(page.locator('#intakeCalories')).toHaveValue('640');
  await expect(page.locator('#intakeMealType')).toHaveValue('lunch');
  await expect(page.locator('#aiEstimateStatus')).toContainText('OpenRouter · arcee-ai/trinity-large-preview:free');
  await expect(page.locator('#aiEstimateResult')).toContainText('包含面条、牛肉与汤底');
});

test('ai estimate accepts markdown-fenced JSON from OpenRouter', async ({ page }) => {
  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [
          {
            message: {
              content: [
                {
                  type: 'text',
                  text: '```json\n{\n  "foodName": "照烧鸡腿饭",\n  "estimatedCalories": 720,\n  "confidence": "high",\n  "reasoning": "按常见外卖份量估算",\n  "portionNote": "含米饭、鸡腿和酱汁",\n  "mealType": "dinner"\n}\n```'
                }
              ]
            }
          }
        ]
      })
    });
  });

  await page.getByRole('button', { name: '设置' }).click();
  await page.locator('#aiApiKeyInput').fill('browser-key');
  await page.locator('#aiApiKeyInput').dispatchEvent('change');
  await page.locator('.nav-btn[data-target="log"]').click();

  await page.locator('#aiEstimateText').fill('一份照烧鸡腿饭');
  await page.getByRole('button', { name: 'AI 估算并填入' }).click();

  await expect(page.locator('#intakeText')).toHaveValue('照烧鸡腿饭');
  await expect(page.locator('#intakeCalories')).toHaveValue('720');
  await expect(page.locator('#intakeMealType')).toHaveValue('dinner');
  await expect(page.locator('#aiEstimateResult')).toContainText('含米饭、鸡腿和酱汁');
});

test('ai settings stay in browser storage for OpenRouter', async ({ page }) => {
  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.locator('.settings-fixed-provider')).toContainText('OpenRouter');
  await page.locator('#aiApiKeyInput').fill('or-key-123');
  await page.locator('#aiApiKeyInput').dispatchEvent('change');
  await page.reload();
  await page.getByRole('button', { name: '设置' }).click();

  await expect(page.locator('#aiApiKeyInput')).toHaveValue('or-key-123');
  await expect(page.locator('#aiModelInput')).toHaveValue('arcee-ai/trinity-large-preview:free');
  await expect(page.locator('.settings-fixed-provider')).toHaveText('OpenRouter');
});

test('clearing the ai model snaps back to the default model and persists it', async ({ page }) => {
  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.locator('#aiModelInput')).toHaveValue('arcee-ai/trinity-large-preview:free');

  await page.locator('#aiModelInput').fill('openai/gpt-4o-mini');
  await page.locator('#aiModelInput').dispatchEvent('change');
  await expect(page.locator('#aiModelInput')).toHaveValue('openai/gpt-4o-mini');

  await page.locator('#aiModelInput').fill('');
  await page.locator('#aiModelInput').dispatchEvent('change');
  await expect(page.locator('#aiModelInput')).toHaveValue('arcee-ai/trinity-large-preview:free');

  await page.reload();
  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.locator('#aiModelInput')).toHaveValue('arcee-ai/trinity-large-preview:free');

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('kawaii-calorie-tracker-v3')));
  expect(stored.settings.ai.model).toBe('arcee-ai/trinity-large-preview:free');
});

test('ai settings section stays minimal without explanatory helper copy', async ({ page }) => {
  await page.getByRole('button', { name: '设置' }).click();

  await expect(page.locator('#aiProviderStatus')).toHaveCount(0);
  await expect(page.locator('#aiModelInput')).toHaveAttribute('placeholder', 'arcee-ai/trinity-large-preview:free');
  await expect(page.locator('#aiApiKeyInput')).toHaveAttribute('placeholder', 'sk-or-v1-...');
});

test('editing shows date-only input and preserves the explicit saved date', async ({ page }) => {
  await page.addInitScript(() => {
    const seeded = {
      entries: [
        {
          id: 'entry-1',
          text: '手动时间测试',
          calories: 250,
          mealType: 'lunch',
          createdAt: '2026-03-20T17:15:00.000Z'
        }
      ],
      settings: { goal: 2000, favorites: [], ai: { provider: 'openrouter', model: 'openai/gpt-4o-mini', apiKey: '' } }
    };
    localStorage.setItem('kawaii-calorie-tracker-v3', JSON.stringify(seeded));
    localStorage.setItem('kawaii-calorie-tracker-v2', JSON.stringify(seeded));
  });
  await page.reload();

  await page.getByRole('button', { name: '编辑这条记录' }).click();
  await expect(page.locator('#intakeLoggedAt')).toHaveAttribute('type', 'date');
  await expect(page.locator('#intakeLoggedAt')).toHaveValue('2026-03-20');

  await page.locator('#intakeCalories').fill('251');
  await page.getByRole('button', { name: '更新记录' }).click();

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('kawaii-calorie-tracker-v3')));
  expect(stored.entries[0].date).toBe('2026-03-20');
  expect(stored.entries[0].createdAt).toBe('2026-03-20T17:15:00.000Z');
});

test('saving with an empty date defaults to today locally', async ({ page }) => {
  await page.getByRole('button', { name: '记录' }).click();
  await page.locator('#intakeText').fill('没选日期的记录');
  await page.locator('#intakeCalories').fill('321');
  await page.locator('#intakeLoggedAt').fill('2026-03-01');
  await page.locator('#intakeLoggedAt').fill('');
  await page.getByRole('button', { name: '保存记录' }).click();

  const today = new Date();
  const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  await expect(page.locator('#historyList')).toContainText('没选日期的记录');

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('kawaii-calorie-tracker-v3')));
  expect(stored.entries[0].date).toBe(localDate);
});



test('legacy entries without explicit date get migrated from createdAt for filtering and totals', async ({ page }) => {
  await page.addInitScript(() => {
    const seeded = {
      entries: [
        {
          id: 'legacy-1',
          text: '旧记录',
          calories: 222,
          mealType: 'snack',
          createdAt: '2026-03-20T17:15:00.000Z'
        }
      ],
      settings: { goal: 2000, favorites: [], ai: { provider: 'openrouter', model: 'openai/gpt-4o-mini', apiKey: '' } }
    };
    localStorage.setItem('kawaii-calorie-tracker-v3', JSON.stringify(seeded));
    localStorage.setItem('kawaii-calorie-tracker-v2', JSON.stringify(seeded));
  });
  await page.reload();

  await expect(page.locator('#historyList')).toContainText('旧记录');
  await expect(page.locator('#historyList')).toContainText('3月20日');
  await expect(page.locator('#historyList')).not.toContainText('17:15');
  await page.locator('#historyDateFilter').fill('2026-03-20');
  await expect(page.locator('#historyList')).toContainText('旧记录');

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('kawaii-calorie-tracker-v3')));
  expect(stored.entries[0].date).toBe('2026-03-20');
});

test('switching pages never submits the intake form in the background', async ({ page }) => {
  await page.getByRole('button', { name: '记录' }).click();
  await page.locator('#intakeText').fill('还没打算保存的奶昔');
  await page.locator('#intakeCalories').fill('333');
  await page.locator('#intakeMealType').selectOption('snack');

  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.locator('#entryCount')).toHaveText('0');
  await expect(page.locator('#historyList')).not.toContainText('还没打算保存的奶昔');

  await page.getByRole('button', { name: '主页' }).click();
  await expect(page.locator('#entryCount')).toHaveText('0');
  await expect(page.locator('#todayTotal')).toHaveText('0');
});

test('head and manifest wire the right icon sizes for browser chrome and installed PWA', async ({ page }) => {
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', 'icons/calorie-tracker-s.png');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('sizes', '256x256');
  await expect(page.locator('link[rel="shortcut icon"]')).toHaveAttribute('href', 'icons/calorie-tracker-s.png');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', 'icons/calorie-tracker-l.png');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('sizes', '894x894');
  await expect(page.locator('meta[name="msapplication-TileImage"]')).toHaveAttribute('content', 'icons/calorie-tracker-m.png');

  const manifest = await page.evaluate(async () => {
    const manifestHref = document.querySelector('link[rel="manifest"]')?.href;
    const response = await fetch(manifestHref);
    return response.json();
  });

  expect(manifest.icons).toEqual([
    {
      src: 'icons/calorie-tracker-l.png',
      sizes: '894x894',
      type: 'image/png',
      purpose: 'any'
    }
  ]);
});

test('topbar uses the banner image instead of the old text masthead', async ({ page }) => {
  await expect(page.locator('.topbar-banner')).toHaveAttribute('src', 'assets/banner.png');
  await expect(page.getByText('今天也一起努力呀 ✿')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '卡路里大作战' })).toHaveCount(0);

  const topbarBox = await page.locator('.topbar').boundingBox();
  const bannerBox = await page.locator('.topbar-banner').boundingBox();

  expect(topbarBox).not.toBeNull();
  expect(bannerBox).not.toBeNull();
  expect(bannerBox.width).toBeGreaterThan(bannerBox.height * 3);
  expect(bannerBox.width).toBeLessThanOrEqual(topbarBox.width + 1);
  expect(bannerBox.height).toBeLessThanOrEqual(topbarBox.height + 1);
});

test('app uses system font stacks instead of bundled custom fonts', async ({ page }) => {
  const fontInfo = await page.evaluate(() => {
    const bodyFamily = getComputedStyle(document.body).fontFamily;
    const fieldFamily = getComputedStyle(document.querySelector('#intakeText')).fontFamily;
    const sheetRules = [...document.styleSheets]
      .filter((sheet) => !sheet.href || sheet.href.startsWith(window.location.origin))
      .flatMap((sheet) => {
        try {
          return [...sheet.cssRules].map((rule) => rule.cssText);
        } catch {
          return [];
        }
      });

    return {
      bodyFamily,
      fieldFamily,
      hasCustomFontFace: sheetRules.some((rule) => rule.includes('@font-face') || rule.includes('Xingye Langman Yuzhou Wenrou'))
    };
  });

  expect(fontInfo.bodyFamily).not.toContain('Xingye Langman Yuzhou Wenrou');
  expect(fontInfo.fieldFamily).not.toContain('Xingye Langman Yuzhou Wenrou');
  expect(fontInfo.hasCustomFontFace).toBe(false);
});
