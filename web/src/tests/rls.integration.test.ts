import { describe, it, expect, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

// These tests require a LIVE local Supabase instance running.
// They use the ANON key to test RLS as authenticated users, and the SERVICE_ROLE key to setup data.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'anon_key_placeholder'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service_role_key_placeholder'

let adminClient: ReturnType<typeof createClient>

let isDbAvailable = false;
try {
  const res = await fetch(`${supabaseUrl}/rest/v1/`).catch(() => null)
  isDbAvailable = !!res
} catch {
  isDbAvailable = false;
}

if (isDbAvailable) {
  adminClient = createClient(supabaseUrl, supabaseServiceKey)
}

describe.skipIf(!isDbAvailable)('RLS Integration Tests (Phase 3)', () => {
  type TestUser = { id: string; email: string }
  type TestEntity = { id: string }
  
  let userA: TestUser
  let userB: TestUser
  let userC: TestUser
  let companyA: TestEntity
  let companyB: TestEntity
  let venueA: TestEntity
  let venueB: TestEntity
  let roleAdmin: TestEntity

  beforeAll(async () => {
    // 1. Setup mock users
    const emailA = `usera_${Date.now()}@test.com`
    const emailB = `userb_${Date.now()}@test.com`
    const emailC = `userc_${Date.now()}@test.com`

    const { data: authA } = await adminClient.auth.admin.createUser({ email: emailA, password: 'password123', email_confirm: true })
    const { data: authB } = await adminClient.auth.admin.createUser({ email: emailB, password: 'password123', email_confirm: true })
    const { data: authC } = await adminClient.auth.admin.createUser({ email: emailC, password: 'password123', email_confirm: true })

    // Give triggers time to create profiles
    await new Promise(resolve => setTimeout(resolve, 500))

    const { data: profA } = await adminClient.from('profiles').select('*').eq('auth_user_id', authA.user!.id).single()
    const { data: profB } = await adminClient.from('profiles').select('*').eq('auth_user_id', authB.user!.id).single()
    const { data: profC } = await adminClient.from('profiles').select('*').eq('auth_user_id', authC.user!.id).single()

    userA = profA as unknown as TestUser
    userB = profB as unknown as TestUser
    userC = profC as unknown as TestUser

    // 2. Setup Base Data
    const { data: role } = await adminClient.from('roles').insert({ code: `ADMIN_${Date.now()}`, name: 'Admin' } as never).select().single()
    roleAdmin = role as unknown as TestEntity

    const { data: cA } = await adminClient.from('companies').insert({ name: 'Company A', slug: `comp-a-${Date.now()}` } as never).select().single()
    const { data: cB } = await adminClient.from('companies').insert({ name: 'Company B', slug: `comp-b-${Date.now()}` } as never).select().single()
    companyA = cA as unknown as TestEntity
    companyB = cB as unknown as TestEntity

    const { data: vA } = await adminClient.from('venues').insert({ company_id: companyA.id, name: 'Venue A', slug: `venue-a-${Date.now()}` } as never).select().single()
    const { data: vB } = await adminClient.from('venues').insert({ company_id: companyB.id, name: 'Venue B', slug: `venue-b-${Date.now()}` } as never).select().single()
    venueA = vA as unknown as TestEntity
    venueB = vB as unknown as TestEntity

    // 3. Assign Memberships
    // User A -> Company A (Admin, Company Wide)
    await adminClient.from('user_memberships').insert({
      profile_id: userA.id,
      company_id: companyA.id,
      venue_id: null,
      role_id: roleAdmin.id
    } as never)

    // User B -> Company B (Admin, Company Wide)
    await adminClient.from('user_memberships').insert({
      profile_id: userB.id,
      company_id: companyB.id,
      venue_id: null,
      role_id: roleAdmin.id
    } as never)

    // User C -> Company A (Venue A only)
    await adminClient.from('user_memberships').insert({
      profile_id: userC.id,
      company_id: companyA.id,
      venue_id: venueA.id,
      role_id: roleAdmin.id
    } as never)
  })

  // Helper to get authenticated client
  const getAuthClient = async (email: string) => {
    const client = createClient(supabaseUrl, supabaseAnonKey)
    await client.auth.signInWithPassword({ email, password: 'password123' })
    return client
  }

  it('1. Company A user SELECT Company A -> ALLOWED', async () => {
    const clientA = await getAuthClient(userA.email)
    const { data, error } = await clientA.from('companies').select('*').eq('id', companyA.id)
    expect(error).toBeNull()
    expect(data?.length).toBe(1)
  })

  it('2. Company A user SELECT Company B -> DENIED (returns empty array)', async () => {
    const clientA = await getAuthClient(userA.email)
    const { data, error } = await clientA.from('companies').select('*').eq('id', companyB.id)
    expect(error).toBeNull() // RLS doesn't error on select, it just returns empty
    expect(data?.length).toBe(0)
  })

  it('3. Company A user INSERT into Company B -> DENIED', async () => {
    const clientA = await getAuthClient(userA.email)
    const { error } = await clientA.from('venues').insert({
      company_id: companyB.id, 
      name: 'Hacked Venue',
      slug: `hacked-${Date.now()}`
    })
    expect(error).not.toBeNull()
    // 42501 is the standard postgres insufficient privilege / RLS failure code
    expect(error?.code).toBe('42501')
  })

  it('6. Venue-scoped member for Venue A cannot access Venue B -> DENIED', async () => {
    const clientC = await getAuthClient(userC.email)
    
    // Can access venue A
    const { data: allowedData } = await clientC.from('venues').select('*').eq('id', venueA.id)
    expect(allowedData?.length).toBe(1)

    // Cannot access venue B
    const { data: deniedData } = await clientC.from('venues').select('*').eq('id', venueB.id)
    expect(deniedData?.length).toBe(0)
  })

  it('12. Membership whose venue belongs to another company is rejected at DB level', async () => {
    // Attempt to create a membership for User A in Company A, but pointing to Venue B (which belongs to Company B)
    const { error } = await adminClient.from('user_memberships').insert({
      profile_id: userA.id,
      company_id: companyA.id,
      venue_id: venueB.id,
      role_id: roleAdmin.id
    } as never)
    
    expect(error).not.toBeNull()
    // Fails the new composite foreign key constraint: memberships_venue_fkey
    expect(error?.message).toContain('memberships_venue_fkey')
  })

  it('13. A normal authenticated user cannot self-assign Admin', async () => {
    const clientA = await getAuthClient(userA.email)
    
    const { error } = await clientA.from('user_memberships').insert({
      profile_id: userA.id,
      company_id: companyA.id,
      venue_id: null,
      role_id: roleAdmin.id
    } as never)
    
    // Insert by client should fail via RLS
    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
  })
})
