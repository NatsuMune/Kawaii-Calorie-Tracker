const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    indexedDB.deleteDatabase('kawaii-calorie-tracker-db');
  });
  await page.reload();
});

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
  const now = new Date();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const fmt = (d, hh, mm) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${hh}:${mm}`;

  await page.getByRole('button', { name: '记录' }).click();
  await page.locator('#intakeText').fill('今天的午餐');
  await page.locator('#intakeCalories').fill('450');
  await page.locator('#intakeLoggedAt').fill(fmt(now, '12', '00'));
  await page.getByRole('button', { name: '保存记录' }).click();

  await page.locator('.nav-btn[data-target="log"]').click();
  await page.locator('#intakeText').fill('昨天的奶茶');
  await page.locator('#intakeCalories').fill('300');
  await page.locator('#intakeLoggedAt').fill(fmt(yesterday, '15', '20'));
  await page.getByRole('button', { name: '保存记录' }).click();

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
