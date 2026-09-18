import { test, expect } from '@playwright/test';
import { getE2EState, loginAs } from './e2e-utils';
import path from 'path';
// Supabase client import removed (using direct REST API)
import { MembershipService } from '@/modules/membership/service';
test.describe('Staff Approval Journey', () => {
  let state: any;

  test.beforeAll(() => {
    state = getE2EState();
  });

  test('Staff approves a customer payment and booking becomes CONFIRMED', async ({ browser }) => {
    // We use isolated contexts for customer and staff
    const customerContext = await browser.newContext();
    const customerPage = await customerContext.newPage();
    
    await loginAs(customerPage, state.customerBEmail, state.customerBPassword);

    // Book for day after tomorrow + 1 to avoid slot collisions
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 3);
    const dateStr = targetDate.toISOString().split('T')[0];
    
    await customerPage.goto(`/book/${state.venueSlug}/${state.fieldId}?date=${dateStr}`);
    
    // Select 12:00 and 12:30 slots
    await customerPage.getByText('12:00', { exact: true }).click();
    await customerPage.getByText('12:30', { exact: true }).click();
    
    await customerPage.click('button:has-text("Proceed to Checkout")');
    await customerPage.waitForURL(/\/checkout\/.+/);

    const checkoutUrl = new URL(customerPage.url());
    const bookingId = checkoutUrl.pathname.split('/').pop();
    expect(bookingId).toBeDefined();

    // Submit payment
    const utr = `UTR-STAFF-${Date.now()}`;
    await customerPage.fill('input[name="transactionReference"]', utr);
    await customerPage.click('button:has-text("Submit Payment")');
    await customerPage.waitForURL(/\/account\/bookings\/.+/);
    await expect(customerPage.locator('text=PENDING_VERIFICATION')).toBeVisible();

    await customerContext.close();

    // Now switch to Staff Context
    const staffContext = await browser.newContext();
    const staffPage = await staffContext.newPage();

    await loginAs(staffPage, state.staffEmail, state.staffPassword);

    // Navigate to Admin Booking Detail Page
    const adminUrl = `/admin/${state.companyId}/venues/${state.venueId}/bookings/${bookingId}`;
    console.log("Navigating to ADMIN URL:", adminUrl);
    
    // Log cookies before navigation
    const cookies = await staffPage.context().cookies();
    console.log("STAFF PAGE COOKIES BEFORE GOTO:", cookies.map(c => `${c.name}=${c.value.substring(0, 10)}...`));
    
    const response = await staffPage.goto(adminUrl);
    console.log("GOTO RESPONSE STATUS:", response?.status());
    console.log("CURRENT STAFF PAGE URL:", staffPage.url());

    if (response?.status() === 404) {
      console.log("404 PAGE HTML:", await staffPage.content());
    }

    // Verify it says PAYMENT_PENDING or PENDING_VERIFICATION
    await expect(staffPage.getByText(/PAYMENT_PENDING|PENDING_VERIFICATION/).first()).toBeVisible();

    // Click Approve Payment and wait for page to update
    await Promise.all([
      staffPage.waitForLoadState('networkidle'),
      staffPage.click('button:has-text("✓ Approve Payment")')
    ]);
    // Reload page to fetch updated booking status
    await staffPage.reload();

    // Query booking and payment status directly via Supabase REST API using Playwright request
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const bookingResp = await staffPage.request.get(
      `${supabaseUrl}/rest/v1/bookings?id=eq.${bookingId}`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Prefer: 'return=representation',
          Accept: 'application/json'
        }
      }
    )
    const bookings = await bookingResp.json()
    const booking = bookings[0] || {}
    const paymentResp = await staffPage.request.get(
      `${supabaseUrl}/rest/v1/payments?booking_id=eq.${bookingId}`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Prefer: 'return=representation',
          Accept: 'application/json'
        }
      }
    )
    const payments = await paymentResp.json()
    const payment = payments[0] || {}
    expect(booking.status).toBe('CONFIRMED');
    expect(payment.status).toBe('VERIFIED');

    // Verify staff permissions


    // Wait for the status to change to CONFIRMED
    await expect(staffPage.getByText('CONFIRMED').first()).toBeVisible({ timeout: 15000 });

    // Verify payment record shows VERIFIED
    await expect(staffPage.locator('text=VERIFIED').first()).toBeVisible();

    await staffContext.close();
  });
});
