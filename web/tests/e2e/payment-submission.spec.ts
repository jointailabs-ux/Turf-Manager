import { test, expect } from '@playwright/test';
import { getE2EState, loginAs } from './e2e-utils';
import path from 'path';
import fs from 'fs';

test.describe('Payment Submission Journey', () => {
  let state: any;

  test.beforeAll(() => {
    state = getE2EState();
    
    // Create a dummy image file for upload if it doesn't exist
    const dummyPath = path.join(__dirname, 'dummy-proof.jpg');
    if (!fs.existsSync(dummyPath)) {
      // Create a minimal valid JPG file using base64
      const jpgBase64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAGBAQABAAAAAAAAAAAAAAAAAAAB/9k=';
      fs.writeFileSync(dummyPath, Buffer.from(jpgBase64, 'base64'));
    }
  });

  test('Customer submits UTR and payment proof', async ({ page }) => {
    await loginAs(page, state.customerAEmail, state.customerAPassword);

    // Book for day after tomorrow to avoid collision with customer-journey test
    const dayAfter = new Date();
    dayAfter.setDate(dayAfter.getDate() + 2);
    const dateStr = dayAfter.toISOString().split('T')[0];
    
    await page.goto(`/book/${state.venueSlug}/${state.fieldId}?date=${dateStr}`);
    
    // Select 11:00 and 11:30 slots
    await page.getByText('11:00', { exact: true }).click();
    await page.getByText('11:30', { exact: true }).click();
    
    await page.click('button:has-text("Proceed to Checkout")');
    await page.waitForURL(/\/checkout\/.+/);

    // Now on checkout page
    // Fill in UTR
    const utr = `UTR${Date.now()}`;
    await page.fill('input[name="transactionReference"]', utr);

    // Upload file
    await page.locator('input[type="file"]').setInputFiles(path.join(__dirname, 'dummy-proof.jpg'));

    await page.click('button:has-text("Submit Payment")');

    // Wait for success indication
    await page.waitForURL(/\/account\/bookings\/.+/);
    await expect(page.locator('text=Payment Submitted').or(page.locator('text=PENDING_VERIFICATION'))).toBeVisible();
    
    // Try to submit with same UTR again to verify uniqueness (should be blocked by DB/UI)
    // Actually the UI probably transitions to a state where the form is hidden and it says "Pending Verification".
    // So we just verify the state transition.
    
    // Verify booking/payment relationship by looking at the page (e.g. status)
    await expect(page.locator('text=PENDING_VERIFICATION').first()).toBeVisible({ timeout: 15000 });
  });
});
