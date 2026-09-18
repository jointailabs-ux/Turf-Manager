import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StaffService } from './service'
import { MembershipService } from '@/modules/membership/service'
import { AuthService } from '@/modules/auth/service'
import { createClient } from '@supabase/supabase-js'

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
vi.mock('@/modules/membership/service', () => ({
  MembershipService: { hasPermission: vi.fn() }
}))
vi.mock('@/modules/auth/service', () => ({
  AuthService: { requireUser: vi.fn() }
}))
vi.mock('@/modules/audit/service', () => ({
  AuditService: { emit: vi.fn().mockResolvedValue(undefined) }
}))

// Admin client mock builder
function makeMock(tables: Record<string, unknown> = {}) {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table in tables) return tables[table]
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
      }
    })
  }
}


describe('StaffService — RBAC Anti-Escalation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(AuthService.requireUser).mockResolvedValue({ id: 'actor-profile' } as never)
    vi.mocked(MembershipService.hasPermission).mockResolvedValue(true)
  })

  describe('addStaffMembership()', () => {
    it('requires staff.manage permission', async () => {
      vi.mocked(MembershipService.hasPermission).mockResolvedValue(false)
      vi.mocked(createClient).mockReturnValue(makeMock() as never)

      await expect(StaffService.addStaffMembership('comp-1', 'venue-1', 'target', 'role-1'))
        .rejects.toThrow('Unauthorized: staff.manage permission required.')
    })

    it('blocks sub-manager from managing staff (privilege escalation)', async () => {
      // Actor is sub_manager (level 1), target role is also sub_manager (level 1) — equal, blocked
      vi.mocked(createClient).mockReturnValue({
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'user_memberships') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              // Actor has sub_manager role
              then: (cb: (v: unknown) => void) => cb({ data: [{ role_id: 'r1', venue_id: 'venue-1', roles: { code: 'sub_manager' } }], error: null }),
            }
          }
          if (table === 'roles') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: { code: 'sub_manager' }, error: null }),
            }
          }
          return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
        })
      } as never)

      await expect(StaffService.addStaffMembership('comp-1', 'venue-1', 'target-profile', 'r1'))
        .rejects.toThrow('Insufficient privileges: sub-managers cannot manage staff.')
    })

    it('blocks manager from granting admin role (escalation prevention)', async () => {
      vi.mocked(createClient).mockReturnValue({
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'user_memberships') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              // Actor is manager (level 2)
              then: (cb: (v: unknown) => void) => cb({ data: [{ role_id: 'r-manager', venue_id: 'venue-1', roles: { code: 'manager' } }], error: null }),
            }
          }
          if (table === 'roles') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              // Target role is admin (level 3) — ABOVE manager level
              single: vi.fn().mockResolvedValue({ data: { code: 'admin' }, error: null }),
            }
          }
          return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
        })
      } as never)

      await expect(StaffService.addStaffMembership('comp-1', 'venue-1', 'target-profile', 'r-admin'))
        .rejects.toThrow('Privilege escalation denied: cannot grant a role at or above your own level.')
    })

    it('blocks manager from granting manager role to another (same-level escalation)', async () => {
      vi.mocked(createClient).mockReturnValue({
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'user_memberships') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              then: (cb: (v: unknown) => void) => cb({ data: [{ role_id: 'r-manager', venue_id: 'venue-1', roles: { code: 'manager' } }], error: null }),
            }
          }
          if (table === 'roles') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              // Target role is also manager (level 2) — same level, blocked
              single: vi.fn().mockResolvedValue({ data: { code: 'manager' }, error: null }),
            }
          }
          return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
        })
      } as never)

      await expect(StaffService.addStaffMembership('comp-1', 'venue-1', 'target-profile', 'r-manager'))
        .rejects.toThrow('Privilege escalation denied')
    })
  })

  describe('updateMembershipRole()', () => {
    it('requires staff.manage permission', async () => {
      vi.mocked(MembershipService.hasPermission).mockResolvedValue(false)
      vi.mocked(createClient).mockReturnValue(makeMock() as never)

      await expect(StaffService.updateMembershipRole('comp-1', 'venue-1', 'm-1', 'r-1'))
        .rejects.toThrow('Unauthorized: staff.manage permission required.')
    })

    it('prevents self-promotion (actor modifying own role)', async () => {
      vi.mocked(createClient).mockReturnValue({
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'user_memberships') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              // Target membership belongs to the actor themselves
              single: vi.fn().mockResolvedValue({
                data: { id: 'm-1', profile_id: 'actor-profile', role_id: 'r-old', venue_id: 'venue-1' },
                error: null
              }),
            }
          }
          return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
        })
      } as never)

      await expect(StaffService.updateMembershipRole('comp-1', 'venue-1', 'm-1', 'r-new'))
        .rejects.toThrow('Cannot change your own role via staff management.')
    })

    it('blocks cross-venue staff role modification', async () => {
      vi.mocked(createClient).mockReturnValue({
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'user_memberships') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              // Target membership is for venue-2, but actor is managing venue-1
              single: vi.fn().mockResolvedValue({
                data: { id: 'm-1', profile_id: 'other-profile', role_id: 'r-old', venue_id: 'venue-2' },
                error: null
              }),
            }
          }
          return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
        })
      } as never)

      await expect(StaffService.updateMembershipRole('comp-1', 'venue-1', 'm-1', 'r-new'))
        .rejects.toThrow('Cross-venue staff role modification is not permitted.')
    })
  })

  describe('setMembershipActive()', () => {
    it('requires staff.manage permission', async () => {
      vi.mocked(MembershipService.hasPermission).mockResolvedValue(false)
      vi.mocked(createClient).mockReturnValue(makeMock() as never)

      await expect(StaffService.setMembershipActive('comp-1', 'venue-1', 'm-1', false))
        .rejects.toThrow('Unauthorized: staff.manage permission required.')
    })

    it('prevents deactivating own membership', async () => {
      vi.mocked(createClient).mockReturnValue({
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'user_memberships') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { id: 'm-1', profile_id: 'actor-profile', venue_id: 'venue-1' },
                error: null
              }),
            }
          }
          return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
        })
      } as never)

      await expect(StaffService.setMembershipActive('comp-1', 'venue-1', 'm-1', false))
        .rejects.toThrow('Cannot modify your own membership active status.')
    })

    it('blocks cross-venue membership deactivation', async () => {
      vi.mocked(createClient).mockReturnValue({
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'user_memberships') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { id: 'm-1', profile_id: 'other-profile', venue_id: 'venue-2' },
                error: null
              }),
            }
          }
          return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
        })
      } as never)

      await expect(StaffService.setMembershipActive('comp-1', 'venue-1', 'm-1', false))
        .rejects.toThrow('Cross-venue staff modification is not permitted.')
    })
  })

  describe('revokeMembership()', () => {
    it('requires staff.manage permission', async () => {
      vi.mocked(MembershipService.hasPermission).mockResolvedValue(false)
      vi.mocked(createClient).mockReturnValue(makeMock() as never)

      await expect(StaffService.revokeMembership('comp-1', 'venue-1', 'm-1'))
        .rejects.toThrow('Unauthorized: staff.manage permission required.')
    })

    it('cannot revoke own membership', async () => {
      vi.mocked(createClient).mockReturnValue({
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'user_memberships') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { id: 'm-1', profile_id: 'actor-profile', venue_id: null },
                error: null
              }),
            }
          }
          return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
        })
      } as never)

      await expect(StaffService.revokeMembership('comp-1', 'venue-1', 'm-1'))
        .rejects.toThrow('Cannot revoke your own membership.')
    })
  })

  describe('listStaff()', () => {
    it('requires staff.view permission', async () => {
      vi.mocked(MembershipService.hasPermission).mockResolvedValue(false)
      vi.mocked(createClient).mockReturnValue(makeMock() as never)

      await expect(StaffService.listStaff('comp-1', 'venue-1'))
        .rejects.toThrow('Unauthorized: staff.view permission required.')
    })
  })
})
