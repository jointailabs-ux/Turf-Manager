import { test, expect } from '@playwright/test';
import { getE2EState, loginAs } from './e2e-utils';

test.describe('Concurrency E2E', () => {
  let state: any;

  test.beforeAll(() => {
    state = getE2EState();
  });

  test('Concurrent booking attempt for the same slot results in exactly one success', async ({ browser }) => {
    // We use isolated contexts for customer A and B
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();

    await loginAs(pageA, state.customerAEmail, state.customerAPassword);
    await loginAs(pageB, state.customerBEmail, state.customerBPassword);

    // Pick a highly contentious date (e.g. today + 4 days)
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 4);
    const dateStr = targetDate.toISOString().split('T')[0];
    
    await pageA.goto(`/book/${state.venueSlug}/${state.fieldId}?date=${dateStr}`);
    await pageB.goto(`/book/${state.venueSlug}/${state.fieldId}?date=${dateStr}`);
    
    // Select 14:00 and 14:30 slots on both pages
    await pageA.getByText('14:00', { exact: true }).click();
    await pageA.getByText('14:30', { exact: true }).click();
    
    await pageB.getByText('14:00', { exact: true }).click();
    await pageB.getByText('14:30', { exact: true }).click();

    // Click Proceed to Checkout on both AT THE EXACT SAME TIME
    const promiseA = pageA.click('button:has-text("Proceed to Checkout")');
    const promiseB = pageB.click('button:has-text("Proceed to Checkout")');

    await Promise.all([promiseA, promiseB]);

    // Now, one should redirect to /checkout/... and one should show an error
    let successCount = 0;
    let failureCount = 0;

    // Check Page A outcome
    try {
      await pageA.waitForURL(/\/checkout\/.+/, { timeout: 10000 });
      successCount++;
    } catch (e) {
      // Must have failed, let's verify error is visible
      await expect(pageA.locator('text=Failed to create booking').or(pageA.locator('.bg-red-100'))).toBeVisible({ timeout: 5000 });
      failureCount++;
    }

    // Check Page B outcome
    try {
      await pageB.waitForURL(/\/checkout\/.+/, { timeout: 10000 });
      successCount++;
    } catch (e) {
      await expect(pageB.locator('text=Failed to create booking').or(pageB.locator('.bg-red-100'))).toBeVisible({ timeout: 5000 });
      failureCount++;
    }

    expect(successCount).toBe(1);
    expect(failureCount).toBe(1);

    await contextA.close();
    await contextB.close();
  });
});
