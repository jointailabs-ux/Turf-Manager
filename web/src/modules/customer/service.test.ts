import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CustomerService } from './service'
import { MembershipService } from '@/modules/membership/service'
import { AuthService } from '@/modules/auth/service'
import { createClient } from '@supabase/supabase-js'

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/modules/membership/service', () => ({
  MembershipService: { hasPermission: vi.fn() }
}))
vi.mock('@/modules/auth/service', () => ({
  AuthService: { requireUser: vi.fn() }
}))
vi.mock('@/modules/audit/service', () => ({
  AuditService: { emitSafe: vi.fn().mockResolvedValue(undefined) }
}))

function makeAdminMock(overrides: Record<string, ReturnType<typeof vi.fn>> = {}) {
  const defaultChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue({ data: [], error: null }),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    limit: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
  }
  return { from: vi.fn().mockReturnValue({ ...defaultChain, ...overrides }) }
}

describe('CustomerService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(MembershipService.hasPermission).mockResolvedValue(true)
    vi.mocked(AuthService.requireUser).mockResolvedValue({ id: 'staff-1' } as never)
  })

  describe('listCustomers()', () => {
    it('requires customer.view permission', async () => {
      vi.mocked(MembershipService.hasPermission).mockResolvedValue(false)
      vi.mocked(createClient).mockReturnValue(makeAdminMock() as never)

      await expect(CustomerService.listCustomers('comp-1', 'venue-1'))
        .rejects.toThrow('Unauthorized: customer.view permission required.')
    })

    it('returns empty when no bookings exist for venue', async () => {
      vi.mocked(createClient).mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          // bookings returns empty
          range: vi.fn().mockResolvedValue({ data: [], error: null }),
        })
      } as never)

      const result = await CustomerService.listCustomers('comp-1', 'venue-1')
      expect(result).toEqual({ customers: [], total: 0 })
    })

    it('does not expose customers from a different company', async () => {
      // If hasPermission for comp-2 fails, cross-company access is blocked at authorization layer
      vi.mocked(MembershipService.hasPermission).mockImplementation(async (companyId) => {
        return companyId === 'comp-1'
      })

      vi.mocked(createClient).mockReturnValue(makeAdminMock() as never)

      await expect(CustomerService.listCustomers('comp-2', 'venue-1'))
        .rejects.toThrow('Unauthorized')
    })
  })

  describe('getCustomerDetail()', () => {
    it('requires customer.view permission', async () => {
      vi.mocked(MembershipService.hasPermission).mockResolvedValue(false)
      vi.mocked(createClient).mockReturnValue(makeAdminMock() as never)

      await expect(CustomerService.getCustomerDetail('comp-1', 'venue-1', 'cust-1'))
        .rejects.toThrow('Unauthorized: customer.view permission required.')
    })

    it('enforces tenant isolation — rejects customer with no bookings in this company', async () => {
      const mockAdmin = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'customers') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { id: 'cust-1', profile_id: 'prof-1', created_at: '2026-01-01', profiles: { full_name: 'Test', email: 't@t.com', phone: null, is_active: true } },
                error: null
              })
            }
          }
          if (table === 'bookings') {
            // No booking for this company
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } })
            }
          }
          return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
        })
      }
      vi.mocked(createClient).mockReturnValue(mockAdmin as never)

      await expect(CustomerService.getCustomerDetail('comp-1', 'venue-1', 'cust-1'))
        .rejects.toThrow('Customer not found in this company scope.')
    })
  })

  describe('updateCustomer()', () => {
    it('requires customer.manage permission', async () => {
      vi.mocked(MembershipService.hasPermission).mockResolvedValue(false)
      vi.mocked(createClient).mockReturnValue(makeAdminMock() as never)

      await expect(CustomerService.updateCustomer('comp-1', 'venue-1', 'cust-1', { fullName: 'New Name' }))
        .rejects.toThrow('Unauthorized: customer.manage permission required.')
    })

    it('enforces tenant scope — rejects if customer has no bookings in company', async () => {
      vi.mocked(createClient).mockReturnValue({
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'bookings') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: null, error: null })
            }
          }
          return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
        })
      } as never)

      await expect(CustomerService.updateCustomer('comp-1', 'venue-1', 'cust-99', { fullName: 'X' }))
        .rejects.toThrow('Customer not found in this company scope.')
    })
  })
})
