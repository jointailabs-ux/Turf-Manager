import { describe, it, expect, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

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

describe.skipIf(!isDbAvailable)('Audit Logs Append-Only Integration Tests', () => {
  type TestUser = { id: string; email: string }
  let userA: TestUser
  let companyId: string

  beforeAll(async () => {
    // 1. Setup mock user and company
    const emailA = `audit_user_${Date.now()}@test.com`
    const { data: authA } = await adminClient.auth.admin.createUser({ email: emailA, password: 'password123', email_confirm: true })
    
    // Give triggers time to create profiles
    await new Promise(resolve => setTimeout(resolve, 500))

    const { data: profA } = await adminClient.from('profiles').select('*').eq('auth_user_id', authA.user!.id).single()
    userA = profA as unknown as TestUser

    const { data: company } = await adminClient.from('companies').insert({ name: 'Audit Test Company', slug: `audit-comp-${Date.now()}` } as never).select().single()
    companyId = (company as unknown as { id: string }).id

    // Give user an admin role in the company to pass RLS for selection
    const { data: role } = await adminClient.from('roles').insert({ code: `ADMIN_${Date.now()}`, name: 'Admin' } as never).select().single()
    await adminClient.from('user_memberships').insert({
      profile_id: userA.id,
      company_id: companyId,
      venue_id: null,
      role_id: (role as unknown as { id: string }).id
    } as never)
  })

  const getAuthClient = async (email: string) => {
    const client = createClient(supabaseUrl, supabaseAnonKey)
    await client.auth.signInWithPassword({ email, password: 'password123' })
    return client
  }

  it('1. Legitimate application path (service_role via RPC/backend) can INSERT audit logs', async () => {
    const { data, error } = await adminClient.from('audit_logs').insert({
      company_id: companyId,
      actor_profile_id: userA.id,
      event_type: 'TEST_EVENT',
      entity_type: 'test',
    } as never).select().single()

    expect(error).toBeNull()
    expect(data).toBeDefined()
    expect((data as unknown as { event_type: string })!.event_type).toBe('TEST_EVENT')
  })

  it('2. Normal application role CANNOT UPDATE audit_logs (Trigger enforces append-only)', async () => {
    const client = await getAuthClient(userA.email)
    
    // Get the log we just inserted (RLS allows select because of membership)
    const { data: logs } = await client.from('audit_logs').select('*').eq('company_id', companyId).limit(1)
    expect(logs?.length).toBe(1)
    const logId = logs![0].id

    // Attempt to update
    const { error } = await client.from('audit_logs').update({ event_type: 'HACKED_EVENT' } as never).eq('id', logId)
    
    if (error) {
      expect(['42501', 'P0001']).toContain(error.code)
    }

    // Verify row was NOT modified in the database
    const { data: checkLog } = await adminClient.from('audit_logs').select('*').eq('id', logId).single()
    expect((checkLog as unknown as { event_type: string })!.event_type).toBe('TEST_EVENT')
  })

  it('3. Normal application role CANNOT DELETE audit_logs', async () => {
    const client = await getAuthClient(userA.email)
    
    const { data: logs } = await client.from('audit_logs').select('*').eq('company_id', companyId).limit(1)
    const logId = logs![0].id

    // Attempt to delete
    const { error } = await client.from('audit_logs').delete().eq('id', logId)
    
    if (error) {
      expect(['42501', 'P0001']).toContain(error.code)
    }

    // Verify log STILL exists in DB
    const { data: checkLog } = await adminClient.from('audit_logs').select('*').eq('id', logId).single()
    expect(checkLog).not.toBeNull()
  })

  it('4. Privileged service_role CAN DELETE audit_logs for maintenance/cleanup', async () => {
    // Insert a dummy log
    const { data: newLog } = await adminClient.from('audit_logs').insert({
      company_id: companyId,
      actor_profile_id: userA.id,
      event_type: 'TO_BE_DELETED',
      entity_type: 'test',
    } as never).select().single()

    // Delete using service_role
    const { error } = await adminClient.from('audit_logs').delete().eq('id', (newLog as unknown as { id: string })!.id)
    expect(error).toBeNull()

    const { data: check } = await adminClient.from('audit_logs').select('*').eq('id', (newLog as unknown as { id: string })!.id)
    expect(check?.length).toBe(0)
  })
})
