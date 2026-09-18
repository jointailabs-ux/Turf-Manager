import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BookingService, CreateBookingRequest } from '@/modules/booking/service'
import { AuthService } from '@/modules/auth/service'
import { MembershipService } from '@/modules/membership/service'
import { createClient as createAnonClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/modules/auth/service', () => ({
  AuthService: {
    requireUser: vi.fn(),
    getProfile: vi.fn().mockResolvedValue({ id: 'user-1' }),
  }
}))

vi.mock('@/modules/notification/service', () => ({
  NotificationService: {
    enqueueEvent: vi.fn().mockResolvedValue(undefined)
  }
}))

vi.mock('@/modules/membership/service', () => ({
  MembershipService: {
    hasAccess: vi.fn(),
    hasPermission: vi.fn(),
  }
}))

describe('Booking Engine Verification (Phase 4 Corrected)', () => {
  let mockRpc: ReturnType<typeof vi.fn>
  let mockSelect: ReturnType<typeof vi.fn>
  let mockSupabase: { from: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.mocked(AuthService.requireUser).mockResolvedValue({ id: 'user-1' } as never)
    vi.mocked(MembershipService.hasAccess).mockResolvedValue(true)
    vi.mocked(MembershipService.hasPermission).mockResolvedValue(true)

    mockSelect = vi.fn().mockImplementation(() => {
        return {
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
            lt: vi.fn().mockReturnThis(),
            gt: vi.fn().mockResolvedValue({ data: [], error: null }) 
        }
    })

    mockSupabase = {
      from: vi.fn().mockImplementation((table) => {
        if (table === 'idempotency_keys') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: null, error: null }) 
            })
          }
        }
        if (table === 'customers') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: { profile_id: 'user-1' }, error: null })
            })
          }
        }
        if (table === 'blocked_periods') {
            return {
                select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnThis(), lt: vi.fn().mockReturnThis(), gt: vi.fn().mockResolvedValue({ data: [], error: null }) })
            }
        }
        if (table === 'operating_hours') {
            return {
                select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ then: (cb: (arg: unknown) => void) => cb({ data: [{ field_id: null, opens_at: '06:00:00', closes_at: '23:00:00', is_closed: false }], error: null }) }) }) })
            }
        }
        if (table === 'fields') {
            return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { venue_id: 'venue-1', base_price_minor: 1000, is_active: true, venues: { company_id: 'comp-1', advance_payment_type: 'PERCENTAGE', advance_payment_value: 30, timezone: 'Asia/Kolkata' } }, error: null }) }) }
        }
        if (table === 'bookings') {
            return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { company_id: 'c1', venue_id: 'v1' }, error: null }) }) }
        }
        return { select: mockSelect }
      })
    }
    vi.mocked(createAnonClient).mockResolvedValue(mockSupabase as never)

    mockRpc = vi.fn()
    vi.mocked(createAdminClient).mockReturnValue({
      rpc: mockRpc,
    } as never)
  })

  it('rejects online bookings without valid customer identity', async () => {
    const request: CreateBookingRequest = {
      idempotencyKey: 'key-1', companyId: 'comp-1', venueId: 'venue-1', fieldId: 'field-1',
      source: 'ONLINE', startAt: '2026-10-10T10:00:00Z', durationMinutes: 60
    }
    // no customerId
    await expect(BookingService.createBooking(request)).rejects.toThrow('ONLINE bookings require a customer ID.')

    request.customerId = 'cust-99'
    // Mock customer to belong to different user
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'customers') return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { profile_id: 'hacker' }, error: null }) }) }) }
      if (table === 'fields') return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { venue_id: 'venue-1', base_price_minor: 1000, is_active: true, venues: { company_id: 'comp-1', advance_payment_type: 'PERCENTAGE', advance_payment_value: 30, timezone: 'Asia/Kolkata' } }, error: null }) }) }
      return { select: mockSelect }
    })
    
    await expect(BookingService.createBooking(request)).rejects.toThrow('Customer identity mismatch.')
  })

  it('rejects booking outside operating hours', async () => {
    // mock operating hours closed
    mockSupabase.from = vi.fn().mockImplementation((table) => {
        if (table === 'operating_hours') {
            return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ then: (cb: (arg: unknown) => void) => cb({ data: [{ field_id: null, is_closed: true }] }) }) }) }) }
        }
        if (table === 'customers') return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { profile_id: 'user-1' } }) }) }
        if (table === 'fields') return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { venue_id: 'venue-1', base_price_minor: 1000, is_active: true, venues: { company_id: 'comp-1', advance_payment_type: 'PERCENTAGE', advance_payment_value: 30, timezone: 'Asia/Kolkata' } } }) }) }
        if (table === 'blocked_periods') return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnThis(), lt: vi.fn().mockReturnThis(), gt: vi.fn().mockResolvedValue({ data: [] }) }) }
        if (table === 'idempotency_keys') return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: null }) }) }
        return { select: mockSelect }
    })

    const request: CreateBookingRequest = {
      idempotencyKey: 'key-2', companyId: 'comp-1', venueId: 'venue-1', fieldId: 'field-1', customerId: 'cust-1',
      source: 'ONLINE', startAt: '2026-10-10T10:00:00Z', durationMinutes: 60
    }
    
    await expect(BookingService.createBooking(request)).rejects.toThrow('Venue/Field is closed on this day.')
  })

  it('rejects bookings less than 60 minutes for ANY source', async () => {
    const request: CreateBookingRequest = {
      idempotencyKey: 'key-3', companyId: 'comp-1', venueId: 'venue-1', fieldId: 'field-1',
      source: 'WALK_IN', startAt: '2026-10-10T10:00:00Z', durationMinutes: 30
    }
    await expect(BookingService.createBooking(request)).rejects.toThrow('Minimum booking duration is 60 minutes.')
  })

  it('atomically calls approveBooking RPC on payment verify', async () => {
    mockRpc.mockResolvedValue({ data: true, error: null })
    const result = await BookingService.approveBooking('bk-1', 'pay-1')
    expect(result).toBe(true)
    expect(mockRpc).toHaveBeenCalledWith('approve_booking_transaction', {
      p_booking_id: 'bk-1', p_payment_id: 'pay-1', p_verified_by: 'user-1'
    })
  })

  it('rejects approveBooking if actor lacks financial permission', async () => {
    vi.mocked(MembershipService.hasPermission).mockResolvedValueOnce(false)
    await expect(BookingService.approveBooking('bk-1', 'pay-1')).rejects.toThrow('Unauthorized to approve payments for this venue.')
  })

  it('atomically calls rejectBooking RPC on payment rejection', async () => {
    mockRpc.mockResolvedValue({ data: true, error: null })
    const result = await BookingService.rejectBooking('bk-1', 'pay-1', 'Fake UTR')
    expect(result).toBe(true)
    expect(mockRpc).toHaveBeenCalledWith('reject_booking_transaction', {
      p_booking_id: 'bk-1', p_payment_id: 'pay-1', p_verified_by: 'user-1', p_reason: 'Fake UTR'
    })
  })
})
