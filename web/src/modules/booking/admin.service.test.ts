import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BookingAdminService } from './admin.service'
import { MembershipService } from '@/modules/membership/service'
import { AuthService } from '@/modules/auth/service'
import { BookingService } from './service'
import { createClient } from '@supabase/supabase-js'

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/modules/membership/service', () => ({
  MembershipService: { hasPermission: vi.fn(), hasAccess: vi.fn() }
}))
vi.mock('@/modules/notification/service', () => ({
  NotificationService: {
    enqueueEvent: vi.fn().mockResolvedValue(undefined)
  }
}))
vi.mock('@/modules/auth/service', () => ({
  AuthService: { requireUser: vi.fn() }
}))
vi.mock('./service', () => ({
  BookingService: { createBooking: vi.fn(), approveBooking: vi.fn(), rejectBooking: vi.fn() }
}))
vi.mock('@/modules/audit/service', () => ({
  AuditService: { emit: vi.fn().mockResolvedValue(undefined) }
}))

function makeMock(tables: Record<string, unknown> = {}) {
  const defaultChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    limit: vi.fn().mockReturnThis(),
    rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
  }
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table in tables) return tables[table]
      return defaultChain
    }),
    rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
  }
}

describe('BookingAdminService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(AuthService.requireUser).mockResolvedValue({ id: 'staff-profile' } as never)
    vi.mocked(MembershipService.hasPermission).mockResolvedValue(true)
    vi.mocked(MembershipService.hasAccess).mockResolvedValue(true)
  })

  describe('listBookings()', () => {
    it('requires booking.view permission', async () => {
      vi.mocked(MembershipService.hasPermission).mockResolvedValue(false)
      vi.mocked(createClient).mockReturnValue(makeMock() as never)

      await expect(BookingAdminService.listBookings('comp-1', 'venue-1'))
        .rejects.toThrow('Unauthorized: booking.view permission required.')
    })
  })

  describe('cancelBooking()', () => {
    it('requires booking.cancel permission', async () => {
      vi.mocked(MembershipService.hasPermission).mockResolvedValue(false)
      vi.mocked(createClient).mockReturnValue(makeMock() as never)

      await expect(BookingAdminService.cancelBooking('comp-1', 'venue-1', 'bk-1', 'reason'))
        .rejects.toThrow('Unauthorized: booking.cancel permission required.')
    })

    it('rejects cancellation when booking not in this venue scope', async () => {
      vi.mocked(createClient).mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
        rpc: vi.fn(),
      } as never)

      await expect(BookingAdminService.cancelBooking('comp-1', 'venue-1', 'bk-1', 'reason'))
        .rejects.toThrow('Booking not found in this venue scope.')
    })

    it('calls cancel_booking_transaction RPC with correct args', async () => {
      const mockRpc = vi.fn().mockResolvedValue({ data: true, error: null })
      vi.mocked(createClient).mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { id: 'bk-1', status: 'CONFIRMED' }, error: null }),
        }),
        rpc: mockRpc,
      } as never)

      await BookingAdminService.cancelBooking('comp-1', 'venue-1', 'bk-1', 'Closed early')

      expect(mockRpc).toHaveBeenCalledWith('cancel_booking_transaction', {
        p_booking_id: 'bk-1',
        p_cancelled_by: 'staff-profile',
        p_reason: 'Closed early',
      })
    })

    it('does not call RPC if not authorized', async () => {
      vi.mocked(MembershipService.hasPermission).mockResolvedValue(false)
      const mockRpc = vi.fn()
      vi.mocked(createClient).mockReturnValue({ from: vi.fn(), rpc: mockRpc } as never)

      await expect(BookingAdminService.cancelBooking('comp-1', 'venue-1', 'bk-1', 'reason'))
        .rejects.toThrow()
      expect(mockRpc).not.toHaveBeenCalled()
    })
  })

  describe('completeBooking()', () => {
    it('requires booking.complete permission', async () => {
      vi.mocked(MembershipService.hasPermission).mockResolvedValue(false)
      vi.mocked(createClient).mockReturnValue(makeMock() as never)

      await expect(BookingAdminService.completeBooking('comp-1', 'venue-1', 'bk-1'))
        .rejects.toThrow('Unauthorized: booking.complete permission required.')
    })

    it('calls complete_booking_transaction RPC', async () => {
      const mockRpc = vi.fn().mockResolvedValue({ data: true, error: null })
      vi.mocked(createClient).mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { id: 'bk-1', status: 'CONFIRMED' }, error: null }),
        }),
        rpc: mockRpc,
      } as never)

      await BookingAdminService.completeBooking('comp-1', 'venue-1', 'bk-1')

      expect(mockRpc).toHaveBeenCalledWith('complete_booking_transaction', {
        p_booking_id: 'bk-1',
        p_completed_by: 'staff-profile',
      })
    })
  })

  describe('recordBalancePayment()', () => {
    it('requires payment.record_balance permission', async () => {
      vi.mocked(MembershipService.hasPermission).mockResolvedValue(false)
      vi.mocked(createClient).mockReturnValue(makeMock() as never)

      await expect(BookingAdminService.recordBalancePayment('comp-1', 'venue-1', 'bk-1', {
        paymentMethod: 'CASH', amountMinor: 5000
      })).rejects.toThrow('Unauthorized: payment.record_balance permission required.')
    })

    it('rejects if booking not in venue scope', async () => {
      vi.mocked(createClient).mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
        rpc: vi.fn(),
      } as never)

      await expect(BookingAdminService.recordBalancePayment('comp-1', 'venue-1', 'bk-1', {
        paymentMethod: 'CASH', amountMinor: 5000
      })).rejects.toThrow('Booking not found in this venue scope.')
    })

    it('calls record_balance_payment_transaction RPC with correct args', async () => {
      const mockRpc = vi.fn().mockResolvedValue({ data: 'payment-uuid', error: null })
      vi.mocked(createClient).mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { id: 'bk-1', status: 'CONFIRMED' }, error: null }),
        }),
        rpc: mockRpc,
      } as never)

      const result = await BookingAdminService.recordBalancePayment('comp-1', 'venue-1', 'bk-1', {
        paymentMethod: 'CASH', amountMinor: 10000, transactionReference: 'ref-123'
      })

      expect(result.paymentId).toBe('payment-uuid')
      expect(mockRpc).toHaveBeenCalledWith('record_balance_payment_transaction', {
        p_booking_id: 'bk-1',
        p_recorded_by: 'staff-profile',
        p_amount_minor: 10000,
        p_payment_method: 'CASH',
        p_transaction_reference: 'ref-123',
      })
    })
  })

  describe('createManualBooking()', () => {
    it('requires booking.create_manual permission', async () => {
      vi.mocked(MembershipService.hasPermission).mockResolvedValue(false)

      await expect(BookingAdminService.createManualBooking('comp-1', 'venue-1', {
        fieldId: 'field-1', source: 'WALK_IN', startAt: '2026-10-10T10:00:00Z',
        durationMinutes: 60, idempotencyKey: 'key-1'
      })).rejects.toThrow('Unauthorized: booking.create_manual permission required.')
    })

    it('delegates to BookingService.createBooking with WALK_IN source', async () => {
      vi.mocked(BookingService.createBooking).mockResolvedValue({ id: 'bk-new', status: 'PAYMENT_PENDING' })

      const result = await BookingAdminService.createManualBooking('comp-1', 'venue-1', {
        fieldId: 'field-1', source: 'WALK_IN', startAt: '2026-10-10T10:00:00Z',
        durationMinutes: 60, idempotencyKey: 'key-1'
      })

      expect(result.bookingId).toBe('bk-new')
      expect(BookingService.createBooking).toHaveBeenCalledWith(expect.objectContaining({
        source: 'WALK_IN',
        fieldId: 'field-1',
      }))
    })

    it('uses same booking engine — unavailable slot causes concurrency error', async () => {
      vi.mocked(BookingService.createBooking).mockRejectedValue(new Error('Slot unavailable: Concurrency conflict.'))

      await expect(BookingAdminService.createManualBooking('comp-1', 'venue-1', {
        fieldId: 'field-1', source: 'WALK_IN', startAt: '2026-10-10T10:00:00Z',
        durationMinutes: 60, idempotencyKey: 'key-1'
      })).rejects.toThrow('Slot unavailable: Concurrency conflict.')
    })

    it('uses same booking engine — minimum duration enforced', async () => {
      vi.mocked(BookingService.createBooking).mockRejectedValue(new Error('Minimum booking duration is 60 minutes.'))

      await expect(BookingAdminService.createManualBooking('comp-1', 'venue-1', {
        fieldId: 'field-1', source: 'PHONE', startAt: '2026-10-10T10:00:00Z',
        durationMinutes: 30, idempotencyKey: 'key-2'
      })).rejects.toThrow('Minimum booking duration is 60 minutes.')
    })
  })

  describe('submitStaffPayment()', () => {
    it('requires payment.approve permission', async () => {
      vi.mocked(MembershipService.hasPermission).mockResolvedValue(false)
      vi.mocked(createClient).mockReturnValue(makeMock() as never)

      await expect(BookingAdminService.submitStaffPayment('comp-1', 'venue-1', 'bk-1', {
        paymentMethod: 'CASH', amountMinor: 5000
      })).rejects.toThrow('Unauthorized: payment.approve permission required.')
    })

    it('rejects if payment amount less than advance required', async () => {
      vi.mocked(createClient).mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: 'bk-1', status: 'PAYMENT_PENDING', advance_required_minor: 10000 },
            error: null
          }),
        }),
        rpc: vi.fn(),
      } as never)

      await expect(BookingAdminService.submitStaffPayment('comp-1', 'venue-1', 'bk-1', {
        paymentMethod: 'CASH', amountMinor: 5000
      })).rejects.toThrow('Payment amount is insufficient.')
    })
  })
})
