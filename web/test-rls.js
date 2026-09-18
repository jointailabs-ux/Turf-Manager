const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.test' });

async function run() {
  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // 1. Get the customer email from db
  const { data: users, error: errUsers } = await adminClient.auth.admin.listUsers();
  const customerA = users.users.find(u => u.email === 'customer_a@example.com');
  
  if (!customerA) {
    console.log('Customer A not found');
    return;
  }

  console.log('Customer A ID:', customerA.id);

  // 2. Login as Customer A
  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  
  const { data: authData, error: authError } = await anonClient.auth.signInWithPassword({
    email: 'customer_a@example.com',
    password: 'password123'
  });

  if (authError) {
    console.error('Login failed:', authError);
    return;
  }

  console.log('Logged in as Customer A');

  // 3. Try to fetch bookings
  const { data: bookings, error: fetchError } = await anonClient
    .from('bookings')
    .select('id, status, expires_at, advance_required_minor, gross_amount_minor, company_id, venue_id, customers(profile_id)');

  console.log('Bookings fetch result:', { bookings, error: fetchError });
  
  if (fetchError) {
    console.error('Fetch error:', fetchError);
  }
}

run();
