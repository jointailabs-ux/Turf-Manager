import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';

if (typeof globalThis.WebSocket === 'undefined') {
  (globalThis as any).WebSocket = WebSocket;
}

export default async function globalSetup() {
  console.log('--- Starting Playwright Global Setup ---');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase credentials in .env.test');
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceKey);

  const timestamp = Date.now();
  
  // 1. Create Staff User
  const staffEmail = `staff_${timestamp}@e2e.test`;
  const { data: authStaff, error: errAuth1 } = await adminClient.auth.admin.createUser({
    email: staffEmail,
    password: 'password123',
    email_confirm: true,
  });
  if (errAuth1) throw errAuth1;

  // 2. Create Customers
  const customerAEmail = `customerA_${timestamp}@e2e.test`;
  const { data: authCustA, error: errAuth2 } = await adminClient.auth.admin.createUser({
    email: customerAEmail,
    password: 'password123',
    email_confirm: true,
  });
  if (errAuth2) throw errAuth2;

  const customerBEmail = `customerB_${timestamp}@e2e.test`;
  const { data: authCustB, error: errAuth3 } = await adminClient.auth.admin.createUser({
    email: customerBEmail,
    password: 'password123',
    email_confirm: true,
  });
  if (errAuth3) throw errAuth3;

  // Wait for triggers to create profiles
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // 3. Create Company and Venue
  const { data: company, error: errComp } = await adminClient.from('companies')
    .insert({ name: `E2E Company ${timestamp}`, slug: `e2e-comp-${timestamp}` })
    .select().single();
  if (errComp) throw errComp;

  const { data: venue, error: errVenue } = await adminClient.from('venues')
    .insert({
      company_id: company.id,
      name: `E2E Venue ${timestamp}`,
      slug: `e2e-venue-${timestamp}`,
      timezone: 'Asia/Kolkata',
      is_active: true
    })
    .select().single();
  if (errVenue) throw errVenue;

  // 4. Create Role and Membership for Staff
  let { data: role, error: errRole } = await adminClient.from('roles').select().eq('code', 'admin').single();
  if (!role) {
    const res = await adminClient.from('roles').insert({ code: 'admin', name: 'E2E Admin' }).select().single();
    role = res.data;
    errRole = res.error;
  }
  if (errRole) throw errRole;

  // Give staff full permissions for tests
  const perms = ['settings.manage', 'field.manage', 'payment.view', 'payment.approve', 'booking.view', 'booking.manage'];
  for (const code of perms) {
    const { data: perm } = await adminClient.from('permissions').select('id').eq('code', code).single();
    if (perm) {
      await adminClient.from('role_permissions').insert({ role_id: role.id, permission_id: perm.id });
    }
  }

  const { data: staffProf } = await adminClient.from('profiles').select('id').eq('auth_user_id', authStaff.user.id).single();
  if (!staffProf) throw new Error('Staff profile not found');
  
  await adminClient.from('user_memberships').insert({
    profile_id: staffProf.id,
    company_id: company.id,
    venue_id: venue.id,
    role_id: role.id,
  });

  // 5. Create Sport & Field
  const { data: sport } = await adminClient.from('sports').select('id').limit(1).single();
  
  let sportId = sport?.id;
  if (!sportId) {
    const { data: newSport, error: errSport } = await adminClient.from('sports').insert({ name: 'Football', slug: 'football' }).select().single();
    if (errSport) throw errSport;
    sportId = newSport.id;
  }

  // Insert venue_sports
  const { data: venueSport, error: errVenueSport } = await adminClient.from('venue_sports')
    .insert({
      venue_id: venue.id,
      sport_id: sportId,
      is_active: true
    })
    .select().single();
  if (errVenueSport) throw errVenueSport;

  const { data: field, error: errField } = await adminClient.from('fields')
    .insert({
      venue_id: venue.id,
      venue_sport_id: venueSport.id,
      name: 'Field A',
      base_price_minor: 100000,
      is_active: true
    })
    .select().single();
  if (errField) throw errField;

  // 6. Create Operating Hours
  const days = [0, 1, 2, 3, 4, 5, 6];
  const opHours = days.map(d => ({
    company_id: company.id,
    venue_id: venue.id,
    field_id: field.id,
    weekday: d,
    open_time: '06:00:00',
    close_time: '23:00:00',
    is_closed: false
  }));
  await adminClient.from('operating_hours').insert(opHours);

  // 6.5 Create Pricing Rule
  const { error: errPricing } = await adminClient.from('pricing_rules').insert({
    company_id: company.id,
    venue_id: venue.id,
    field_id: field.id,
    rule_type: 'BASE',
    amount_minor: 100000,
    is_active: true
  });
  if (errPricing) throw errPricing;

  // 7. Create Payment Account
  const { data: acc, error: errAcc } = await adminClient.from('payment_accounts')
    .insert({
      company_id: company.id,
      venue_id: venue.id,
      display_name: 'E2E UPI',
      upi_id: 'e2e@upi',
      is_active: true,
      qr_object_path: null
    })
    .select().single();
  if (errAcc) throw errAcc;

  const state = {
    staffEmail,
    staffPassword: 'password123',
    customerAEmail,
    customerAPassword: 'password123',
    customerBEmail,
    customerBPassword: 'password123',
    companyId: company.id,
    venueId: venue.id,
    venueSlug: venue.slug,
    fieldId: field.id,
    paymentAccountId: acc.id
  };

  fs.writeFileSync(
    path.join(__dirname, 'e2e-state.json'),
    JSON.stringify(state, null, 2)
  );

  console.log('--- Playwright Global Setup Complete ---');
}
