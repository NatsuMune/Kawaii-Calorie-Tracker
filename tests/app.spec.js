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
  const fmt = (d, hh, mm) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${hh}:${mm}`;

  await page.getByRole('button', { name: '记录' }).click();
  await page.locator('#intakeText').fill('今天的午餐');
  await page.locator('#intakeCalories').fill('450');
  await page.locator('#intakeMealType').selectOption('lunch');
  await page.locator('#intakeLoggedAt').fill(fmt(now, '12', '00'));
  await page.getByRole('button', { name: '保存记录' }).click();

  await page.locator('.nav-btn[data-target="log"]').click();
  await page.locator('#intakeText').fill('昨天的奶茶');
  await page.locator('#intakeCalories').fill('300');
  await page.locator('#intakeMealType').selectOption('snack');
  await page.locator('#intakeLoggedAt').fill(fmt(yesterday, '15', '20'));
  await page.getByRole('button', { name: '保存记录' }).click();

  return { now, yesterday };
}

test('quick-add fills the form and saves an entry for today', async ({ page }) => {
  await page.getByRole('button', { name: '记录' }).click();
  await page.getByRole('button', { name: /快捷填入 拿铁/ }).click();

  await expect(page.locator('#intakeText')).toHaveValue('拿铁');
  await expect(page.locator('#intakeCalories')).toHaveValue('180');
  await expect(page.locator('#intakeMealType')).toHaveValue('breakfast');

  await page.getByRole('button', { name: '保存记录' }).click();
  await expect(page.locator('#todayTotal')).toHaveText('180');
  await expect(page.locator('#historyList')).toContainText('拿铁');
});

test('duplicate entry creates another record and updates totals', async ({ page }) => {
  await page.getByRole('button', { name: '记录' }).click();
  await page.locator('#intakeText').fill('奶茶');
  await page.locator('#intakeCalories').fill('300');
  await page.getByRole('button', { name: '保存记录' }).click();

  await page.getByRole('button', { name: '再记一次这条记录' }).click();

  await expect(page.locator('#todayTotal')).toHaveText('600');
  await expect(page.locator('#entryCount')).toHaveText('2');
});

test('backfilled entries keep history but do not affect today total', async ({ page }) => {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const yyyy = yesterday.getFullYear();
  const mm = String(yesterday.getMonth() + 1).padStart(2, '0');
  const dd = String(yesterday.getDate()).padStart(2, '0');
  const hh = '08';
  const min = '30';
  const localValue = `${yyyy}-${mm}-${dd}T${hh}:${min}`;

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
  await page.getByRole('button', { name: /快捷填入 拿铁/ }).click();

  await expect(page).toHaveScreenshot('mobile-log-view.png', {
    fullPage: true,
    animations: 'disabled',
    maxDiffPixelRatio: 0.03,
  });
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

  await page.getByRole('button', { name: '收藏这条记录' }).click();
  await page.locator('.nav-btn[data-target="log"]').click();

  await expect(page.locator('#favoriteQuickAddWrap')).toBeVisible();
  await expect(page.locator('#favoriteQuickAddList')).toContainText('希腊酸奶');

  await page.locator('#intakeText').fill('');
  await page.locator('#intakeCalories').fill('');
  await page.getByRole('button', { name: /快捷填入 希腊酸奶/ }).click();

  await expect(page.locator('#intakeText')).toHaveValue('希腊酸奶');
  await expect(page.locator('#intakeCalories')).toHaveValue('160');
  await expect(page.locator('#intakeMealType')).toHaveValue('breakfast');
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

test('ai estimate fills the intake form through a direct browser provider call', async ({ page }) => {
  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    const request = route.request();
    const payload = JSON.parse(request.postData() || '{}');
    expect(request.headers().authorization).toBe('Bearer browser-key');
    expect(payload.model).toBe('openai/gpt-4o-mini');
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
  await page.locator('#aiProviderSelect').selectOption('openrouter');
  await page.locator('#aiModelInput').fill('openai/gpt-4o-mini');
  await page.locator('#aiApiKeyInput').fill('browser-key');
  await page.locator('#aiApiKeyInput').dispatchEvent('change');
  await page.locator('.nav-btn[data-target="log"]').click();

  await page.locator('#aiEstimateText').fill('一碗牛肉面，加半颗卤蛋');
  await page.getByRole('button', { name: 'AI 估算并填入' }).click();

  await expect(page.locator('#intakeText')).toHaveValue('牛肉面');
  await expect(page.locator('#intakeCalories')).toHaveValue('640');
  await expect(page.locator('#intakeMealType')).toHaveValue('lunch');
  await expect(page.locator('#aiEstimateStatus')).toContainText('OpenRouter · openai/gpt-4o-mini');
  await expect(page.locator('#aiEstimateResult')).toContainText('包含面条、牛肉与汤底');
});

test('z.ai Coding Plan uses its dedicated browser-direct endpoint', async ({ page }) => {
  await page.route('https://api.z.ai/api/coding/paas/v4/chat/completions', async (route) => {
    const request = route.request();
    const payload = JSON.parse(request.postData() || '{}');
    expect(request.headers().authorization).toBe('Bearer coding-plan-key');
    expect(payload.model).toBe('glm-4.5');
    expect(payload.messages[0].content[0].text).toContain('鸡腿饭');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                foodName: '鸡腿饭',
                estimatedCalories: 720,
                confidence: 'medium',
                reasoning: '按一份常见套餐估算',
                portionNote: '含米饭、鸡腿和配菜',
                mealType: 'lunch'
              })
            }
          }
        ]
      })
    });
  });

  await page.getByRole('button', { name: '设置' }).click();
  await page.locator('#aiProviderSelect').selectOption('z-ai-coding');
  await page.locator('#aiModelInput').fill('glm-4.5');
  await page.locator('#aiApiKeyInput').fill('coding-plan-key');
  await page.locator('#aiApiKeyInput').dispatchEvent('change');
  await page.locator('.nav-btn[data-target="log"]').click();

  await page.locator('#aiEstimateText').fill('一份鸡腿饭，带一点青菜');
  await page.getByRole('button', { name: 'AI 估算并填入' }).click();

  await expect(page.locator('#intakeText')).toHaveValue('鸡腿饭');
  await expect(page.locator('#intakeCalories')).toHaveValue('720');
  await expect(page.locator('#intakeMealType')).toHaveValue('lunch');
  await expect(page.locator('#aiEstimateStatus')).toContainText('z.ai Coding Plan · glm-4.5');
  await expect(page.locator('#aiEstimateResult')).toContainText('含米饭、鸡腿和配菜');
});

test('ai settings stay in browser storage and explain the z.ai Coding Plan direct path', async ({ page }) => {
  await page.getByRole('button', { name: '设置' }).click();
  await page.locator('#aiProviderSelect').selectOption('z-ai-coding');
  await page.locator('#aiApiKeyInput').fill('z-key-123');
  await page.locator('#aiApiKeyInput').dispatchEvent('change');
  await page.reload();
  await page.getByRole('button', { name: '设置' }).click();

  await expect(page.locator('#aiProviderSelect')).toHaveValue('z-ai-coding');
  await expect(page.locator('#aiApiKeyInput')).toHaveValue('z-key-123');
  await expect(page.locator('#aiProviderStatus')).toContainText('不会经过本地服务代理');
  await expect(page.locator('#aiDirectHint')).toContainText('Coding API');
  await expect(page.locator('#aiConfigSource')).toContainText('z.ai Coding Plan');
});
