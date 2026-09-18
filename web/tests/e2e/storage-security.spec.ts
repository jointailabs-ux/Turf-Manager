import { test, expect } from '@playwright/test';
import { getE2EState } from './e2e-utils';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

if (typeof globalThis.WebSocket === 'undefined') {
  (globalThis as any).WebSocket = WebSocket;
}

test.describe('Storage Security E2E', () => {
  let state: any;
  let supabaseUrl: string;
  let supabaseAnonKey: string;
  let supabaseServiceKey: string;
  
  // Setup clients
  let clientA: any;
  let clientB: any;
  let adminClient: any;
  
  let paymentIdA: string;
  let proofPathA: string;

  test.beforeAll(async () => {
    state = getE2EState();
    supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    
    adminClient = createClient(supabaseUrl, supabaseServiceKey);
    clientA = createClient(supabaseUrl, supabaseAnonKey);
    clientB = createClient(supabaseUrl, supabaseAnonKey);

    await clientA.auth.signInWithPassword({ email: state.customerAEmail, password: state.customerAPassword });
    await clientB.auth.signInWithPassword({ email: state.customerBEmail, password: state.customerBPassword });
  });

  test('Customer B cannot access Customer A\'s payment proof', async () => {
    // 1. Find a payment made by Customer A
    // Since previous E2E tests run before this or in parallel, we use adminClient to find one
    // or we just create a mock booking and payment using adminClient for this specific test
    
    // Create a dummy customer A booking and payment to ensure isolation
    const authUserId = (await clientA.auth.getUser()).data.user.id;
    const { data: profile } = await adminClient.from('profiles').select('id').eq('auth_user_id', authUserId).single();
    let { data: customerA, error: errCustA } = await adminClient.from('customers')
      .select('id').eq('profile_id', profile.id).maybeSingle();
      
    if (!customerA) {
      const { data: newCust, error: errIns } = await adminClient.from('customers').insert({ profile_id: profile.id }).select('id').single();
      if (errIns) throw errIns;
      customerA = newCust;
    }
      
    const { data: booking, error: errBooking } = await adminClient.from('bookings').insert({
      company_id: state.companyId,
      venue_id: state.venueId,
      field_id: state.fieldId,
      customer_id: customerA.id,
      created_by_profile_id: profile.id,
      status: 'PAYMENT_PENDING',
      start_at: new Date().toISOString(),
      end_at: new Date(Date.now() + 60*60*1000).toISOString(),
      duration_minutes: 60,
      gross_amount_minor: 100000,
      advance_required_minor: 50000,
      balance_due_minor: 50000,
      pricing_snapshot: {},
      source: 'ONLINE'
    }).select().single();
    if (errBooking) throw errBooking;

    const paymentId = crypto.randomUUID();
    const proofPath = `${state.companyId}/${state.venueId}/${paymentId}/test-proof-${Date.now()}.jpg`;

    const { data: payment } = await adminClient.from('payments').insert({
      id: paymentId,
      booking_id: booking.id,
      payment_account_id: state.paymentAccountId,
      payment_type: 'ADVANCE',
      payment_method: 'UPI_QR',
      status: 'PENDING_VERIFICATION',
      amount_minor: 50000,
      transaction_reference: `UTR-SEC-${Date.now()}`,
      proof_object_path: proofPath
    }).select().single();

    paymentIdA = payment.id;
    proofPathA = proofPath;

    // Upload a dummy file via admin
    const dummyContent = Buffer.from('test image', 'utf-8');
    const { error: upErr } = await adminClient.storage.from('payment_proofs').upload(proofPathA, dummyContent, { contentType: 'image/jpeg' });
    if (upErr) throw upErr;

    // TEST: Customer A should be able to download their own proof
    const { data: dlA, error: errA } = await clientA.storage.from('payment_proofs').download(proofPathA);
    expect(errA).toBeNull();
    expect(dlA).not.toBeNull();

    // TEST: Customer B should NOT be able to download Customer A's proof
    const { data: dlB, error: errB } = await clientB.storage.from('payment_proofs').download(proofPathA);
    expect(errB).not.toBeNull(); // Should fail
    expect(errB!.message).toContain('Object not found'); // or similar RLS error

    // TEST: Unauthenticated user should NOT be able to download
    const anonClient = createClient(supabaseUrl, supabaseAnonKey);
    const { data: dlAnon, error: errAnon } = await anonClient.storage.from('payment_proofs').download(proofPathA);
    expect(errAnon).not.toBeNull();

    // TEST: Customer B cannot generate signed URL via RLS
    const { data: signedB, error: errSignedB } = await clientB.storage.from('payment_proofs').createSignedUrl(proofPathA, 60);
    expect(errSignedB).not.toBeNull();
  });
});
