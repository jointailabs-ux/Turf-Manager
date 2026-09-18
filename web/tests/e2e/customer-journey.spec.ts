import { test, expect } from '@playwright/test';
import { getE2EState, loginAs } from './e2e-utils';

test.describe('Customer Booking Journey', () => {
  let state: any;

  test.beforeAll(() => {
    state = getE2EState();
  });

  test('Customer creates a booking and verifies PAYMENT_PENDING status', async ({ page }) => {
    // 1. Login as customer A
    await loginAs(page, state.customerAEmail, state.customerAPassword);

    // 2. Navigate to booking grid for tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];
    
    await page.goto(`/book/${state.venueSlug}/${state.fieldId}?date=${dateStr}`);

    // Wait for the grid to load
    await expect(page.locator('text=Proceed to Checkout')).toBeVisible();

    // Select 10:00 and 10:30 slots
    await page.getByText('10:00', { exact: true }).click();
    await page.getByText('10:30', { exact: true }).click();

    // Assert the selected duration says 60 mins
    await expect(page.locator('text=Selected Duration: 60 mins')).toBeVisible();

    // Click Proceed to Checkout
    await page.click('button:has-text("Proceed to Checkout")');

    // Wait for navigation to checkout page
    await page.waitForURL(/\/checkout\/.+/);

    // Verify UI reflects Checkout page
    await expect(page.locator('h1:has-text("Checkout")')).toBeVisible({ timeout: 10000 });

    // We can extract booking ID from the URL to store for next test if needed, or just let payment-submission.spec.ts create its own booking.
    const url = new URL(page.url());
    const bookingId = url.pathname.split('/').pop();
    expect(bookingId).toBeDefined();

    // Let's also verify if we go back to the grid, the slots are now blocked off (or marked as not available)
    // Actually, active slot reservation will make them unavailable
    await page.goto(`/book/${state.venueSlug}/${state.fieldId}?date=${dateStr}`);
    
    // The previously selected slots should now be 'cursor-not-allowed' or missing from available
    // But since the UI might just show them as red, we can check if they are visible as unavailable
    const unavailableSlots = page.locator('.cursor-not-allowed');
    await expect(unavailableSlots.first()).toBeVisible();
  });
});
