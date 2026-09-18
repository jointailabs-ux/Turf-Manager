import { describe, it, expect, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { AuditService } from '../modules/audit/service'
import { AuthService } from '../modules/auth/service'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'anon_key_placeholder'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service_role_key_placeholder'

let adminClient: any
let isDbAvailable = false

try {
  const res = await fetch(`${supabaseUrl}/rest/v1/`).catch(() => null)
  isDbAvailable = !!res
} catch {
  isDbAvailable = false
}

if (isDbAvailable) {
  adminClient = createClient<any>(supabaseUrl, supabaseServiceKey)
}

describe.skipIf(!isDbAvailable)('Milestone 3 — Audit RBAC, Scoping & Security Suite', { timeout: 30000 }, () => {
  let companyAId: string
  let venueAId: string
  let companyBId: string
  let venueBId: string

  let adminUser: { id: string; auth_user_id: string; email: string }
  let managerUser: { id: string; auth_user_id: string; email: string }
  let subManagerWithPerm: { id: string; auth_user_id: string; email: string }
  let subManagerWithoutPerm: { id: string; auth_user_id: string; email: string }
  let customerUser: { id: string; auth_user_id: string; email: string }

  beforeAll(async () => {
    const ts = Date.now()

    // 1. Setup Company A and Venue A
    const { data: compA } = await adminClient.from('companies').insert({ name: `Audit Comp A ${ts}`, slug: `audit-a-${ts}` }).select('id').single()
    companyAId = compA!.id

    const { data: venA } = await adminClient.from('venues').insert({ company_id: companyAId, name: `Audit Venue A ${ts}`, slug: `aud-a-${ts}`, timezone: 'Asia/Kolkata', is_active: true }).select('id').single()
    venueAId = venA!.id

    // 2. Setup Company B and Venue B (Foreign Tenant)
    const { data: compB } = await adminClient.from('companies').insert({ name: `Audit Comp B ${ts}`, slug: `audit-b-${ts}` }).select('id').single()
    companyBId = compB!.id

    const { data: venB } = await adminClient.from('venues').insert({ company_id: companyBId, name: `Audit Venue B ${ts}`, slug: `aud-b-${ts}`, timezone: 'Asia/Kolkata', is_active: true }).select('id').single()
    venueBId = venB!.id

    // Helper to create user & profile
    const createUser = async (prefix: string) => {
      const email = `${prefix}_${ts}@test.com`
      const { data: auth } = await adminClient.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
      await new Promise(r => setTimeout(r, 400))
      const { data: prof } = await adminClient.from('profiles').select('*').eq('auth_user_id', auth.user!.id).single()
      return { id: prof.id, auth_user_id: auth.user!.id, email }
    }

    adminUser = await createUser('aud_admin')
    managerUser = await createUser('aud_mgr')
    subManagerWithPerm = await createUser('aud_sub_with')
    subManagerWithoutPerm = await createUser('aud_sub_no')
    customerUser = await createUser('aud_cust')

    // Roles
    const { data: roleAdmin } = await adminClient.from('roles').insert({ code: `ADMIN_${ts}`, name: 'Admin' }).select('id').single()
    const { data: roleMgr } = await adminClient.from('roles').insert({ code: `MANAGER_${ts}`, name: 'Manager' }).select('id').single()
    const { data: roleSubWith } = await adminClient.from('roles').insert({ code: `SUB_WITH_${ts}`, name: 'SubManager' }).select('id').single()
    const { data: roleSubNo } = await adminClient.from('roles').insert({ code: `SUB_NO_${ts}`, name: 'SubManagerNo' }).select('id').single()

    const { data: permAudit } = await adminClient.from('permissions').select('id').eq('code', 'audit.view').single()

    // Assign audit.view to roleAdmin, roleMgr, and roleSubWith
    if (permAudit) {
      await adminClient.from('role_permissions').insert([
        { role_id: roleAdmin!.id, permission_id: permAudit.id },
        { role_id: roleMgr!.id, permission_id: permAudit.id },
        { role_id: roleSubWith!.id, permission_id: permAudit.id },
      ])
    }

    // Memberships for Company A / Venue A
    await adminClient.from('user_memberships').insert([
      { profile_id: adminUser.id, company_id: companyAId, venue_id: venueAId, role_id: roleAdmin!.id, is_active: true },
      { profile_id: managerUser.id, company_id: companyAId, venue_id: venueAId, role_id: roleMgr!.id, is_active: true },
      { profile_id: subManagerWithPerm.id, company_id: companyAId, venue_id: venueAId, role_id: roleSubWith!.id, is_active: true },
      { profile_id: subManagerWithoutPerm.id, company_id: companyAId, venue_id: venueAId, role_id: roleSubNo!.id, is_active: true },
    ])

    // Insert 10 synthetic audit events for Company A / Venue A
    const eventsA = []
    for (let i = 1; i <= 10; i++) {
      eventsA.push({
        company_id: companyAId,
        venue_id: venueAId,
        actor_profile_id: adminUser.id,
        event_type: i <= 5 ? 'BOOKING_CANCELLED' : 'BOOKING_COMPLETED',
        entity_type: 'booking',
        entity_id: crypto.randomUUID(),
        metadata: { index: i, note: `A log ${i}` },
      })
    }
    await adminClient.from('audit_logs').insert(eventsA)

    // Insert 3 synthetic audit events for Company B / Venue B
    const eventsB = []
    for (let i = 1; i <= 3; i++) {
      eventsB.push({
        company_id: companyBId,
        venue_id: venueBId,
        actor_profile_id: adminUser.id,
        event_type: 'STAFF_CREATED',
        entity_type: 'staff',
        entity_id: crypto.randomUUID(),
        metadata: { secretTenantBData: true },
      })
    }
    await adminClient.from('audit_logs').insert(eventsB)
  })

  it('1. Admin and Manager with audit.view are allowed access to audit logs', async () => {
    // Admin
    AuthService.getUser = async () => ({ id: adminUser.auth_user_id } as never)
    const adminLogs = await AuditService.getAuditLogs(companyAId, venueAId)
    expect(adminLogs.items.length).toBeGreaterThanOrEqual(10)
    expect(adminLogs.total).toBeGreaterThanOrEqual(10)

    // Manager
    AuthService.getUser = async () => ({ id: managerUser.auth_user_id } as never)
    const managerLogs = await AuditService.getAuditLogs(companyAId, venueAId)
    expect(managerLogs.items.length).toBeGreaterThanOrEqual(10)
    expect(managerLogs.total).toBeGreaterThanOrEqual(10)
  })

  it('2. Sub-manager with audit.view allowed, Sub-manager without audit.view denied', async () => {
    // Sub-manager with explicit audit.view granted
    AuthService.getUser = async () => ({ id: subManagerWithPerm.auth_user_id } as never)
    const allowedLogs = await AuditService.getAuditLogs(companyAId, venueAId)
    expect(allowedLogs.items.length).toBeGreaterThanOrEqual(10)

    // Sub-manager without audit.view
    AuthService.getUser = async () => ({ id: subManagerWithoutPerm.auth_user_id } as never)
    await expect(AuditService.getAuditLogs(companyAId, venueAId)).rejects.toThrow(/audit\.view permission required/)
  })

  it('3. Customer and unauthorized users outside company/venue scope are strictly denied', async () => {
    // Customer
    AuthService.getUser = async () => ({ id: customerUser.auth_user_id } as never)
    await expect(AuditService.getAuditLogs(companyAId, venueAId)).rejects.toThrow(/audit\.view permission required/)

    // Admin of Company A attempting to access Company B
    AuthService.getUser = async () => ({ id: adminUser.auth_user_id } as never)
    await expect(AuditService.getAuditLogs(companyBId, venueBId)).rejects.toThrow(/audit\.view permission required/)
  })

  it('4. Tenant isolation: logs from foreign tenant B are never returned for tenant A', async () => {
    AuthService.getUser = async () => ({ id: adminUser.auth_user_id } as never)
    const logs = await AuditService.getAuditLogs(companyAId, venueAId, { pageSize: 100 })
    
    // Check that none of the items belong to Company B or contain tenant B metadata
    for (const item of logs.items) {
      expect(item.metadata).not.toHaveProperty('secretTenantBData')
    }
  })

  it('5. Pagination and filtering by eventType and entityType', async () => {
    AuthService.getUser = async () => ({ id: adminUser.auth_user_id } as never)

    // Page 1 with pageSize 4
    const page1 = await AuditService.getAuditLogs(companyAId, venueAId, { page: 1, pageSize: 4 })
    expect(page1.items.length).toBe(4)

    // Page 2 with pageSize 4
    const page2 = await AuditService.getAuditLogs(companyAId, venueAId, { page: 2, pageSize: 4 })
    expect(page2.items.length).toBe(4)
    expect(page1.items[0].id).not.toBe(page2.items[0].id)

    // Filter by eventType 'BOOKING_CANCELLED'
    const cancelledLogs = await AuditService.getAuditLogs(companyAId, venueAId, { eventType: 'BOOKING_CANCELLED' })
    expect(cancelledLogs.items.length).toBe(5)
    expect(cancelledLogs.items.every(i => i.eventType === 'BOOKING_CANCELLED')).toBe(true)

    // Filter by entityType 'booking'
    const bookingLogs = await AuditService.getAuditLogs(companyAId, venueAId, { entityType: 'booking' })
    expect(bookingLogs.items.length).toBe(10)
    expect(bookingLogs.items.every(i => i.entityType === 'booking')).toBe(true)
  })

  it('6. Database security: Append-only triggers prevent UPDATE and DELETE on audit_logs', async () => {
    // Attempt UPDATE directly using standard client credentials
    const client = createClient(supabaseUrl, supabaseAnonKey)
    await client.auth.signInWithPassword({ email: adminUser.email, password: 'password123' })

    // Find one existing log
    const { data: existingLogs } = await client.from('audit_logs').select('*').eq('company_id', companyAId).limit(1)
    expect(existingLogs?.length).toBe(1)
    const logId = existingLogs![0].id
    const originalType = existingLogs![0].event_type

    // Attempt to update
    const { error: updateError } = await client.from('audit_logs').update({ event_type: 'TAMPERED_EVENT' }).eq('id', logId)
    if (updateError) {
      expect(['42501', 'P0001']).toContain(updateError.code)
    }

    // Verify row was NOT modified in the database
    const { data: checkLogAfterUpdate } = await adminClient.from('audit_logs').select('*').eq('id', logId).single()
    expect(checkLogAfterUpdate!.event_type).toBe(originalType)

    // Attempt to delete
    const { error: deleteError } = await client.from('audit_logs').delete().eq('id', logId)
    if (deleteError) {
      expect(['42501', 'P0001']).toContain(deleteError.code)
    }

    // Verify row STILL exists in the database
    const { data: checkLogAfterDelete } = await adminClient.from('audit_logs').select('*').eq('id', logId).single()
    expect(checkLogAfterDelete).not.toBeNull()
    expect(checkLogAfterDelete!.id).toBe(logId)
  })
})
