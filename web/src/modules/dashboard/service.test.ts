import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DashboardService } from './service'
import { MembershipService } from '@/modules/membership/service'
import { createClient } from '@supabase/supabase-js'

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
vi.mock('@/modules/membership/service', () => ({
  MembershipService: { hasPermission: vi.fn() }
}))

function makeAdminMock(bookings: unknown[] = [], payments: unknown[] = [], reservations: unknown[] = [], blocks: unknown[] = []) {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        gt: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
      }
      if (table === 'bookings') return { ...chain, then: (cb: (v: unknown) => void) => cb({ data: bookings, error: null, count: bookings.length }) }
      if (table === 'payments') return { ...chain, then: (cb: (v: unknown) => void) => cb({ data: payments, error: null, count: payments.length }) }
      if (table === 'active_slot_reservations') return { ...chain, then: (cb: (v: unknown) => void) => cb({ data: reservations, error: null }) }
      if (table === 'blocked_periods') return { ...chain, then: (cb: (v: unknown) => void) => cb({ data: blocks, error: null }) }
      return { ...chain, then: (cb: (v: unknown) => void) => cb({ data: [], error: null }) }
    })
  }
}

describe('DashboardService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(MembershipService.hasPermission).mockResolvedValue(true)
  })

  describe('getTodaySummary()', () => {
    it('requires booking.view permission', async () => {
      vi.mocked(MembershipService.hasPermission).mockResolvedValue(false)
      vi.mocked(createClient).mockReturnValue(makeAdminMock() as never)

      await expect(DashboardService.getTodaySummary('comp-1', 'venue-1', '2026-09-06', 'Asia/Kolkata'))
        .rejects.toThrow('Unauthorized: booking.view permission required.')
    })

    it('correctly aggregates booking statuses', async () => {
      const bookings = [
        { status: 'CONFIRMED', gross_amount_minor: 20000, advance_required_minor: 6000 },
        { status: 'CONFIRMED', gross_amount_minor: 30000, advance_required_minor: 9000 },
        { status: 'PAYMENT_PENDING', gross_amount_minor: 15000, advance_required_minor: 4500 },
        { status: 'CANCELLED', gross_amount_minor: 10000, advance_required_minor: 3000 },
        { status: 'EXPIRED', gross_amount_minor: 10000, advance_required_minor: 3000 },
        { status: 'COMPLETED', gross_amount_minor: 25000, advance_required_minor: 7500 },
      ]
      vi.mocked(createClient).mockReturnValue(makeAdminMock(bookings) as never)

      const summary = await DashboardService.getTodaySummary('comp-1', 'venue-1', '2026-09-06', 'Asia/Kolkata')

      expect(summary.totalBookings).toBe(6)
      expect(summary.confirmedCount).toBe(2)
      expect(summary.pendingCount).toBe(1)
      expect(summary.cancelledCount).toBe(1)
      expect(summary.expiredCount).toBe(1)
      expect(summary.completedCount).toBe(1)
    })

    it('does not add CANCELLED/EXPIRED to gross value (financial metric separation)', async () => {
      const bookings = [
        { status: 'CONFIRMED', gross_amount_minor: 20000, advance_required_minor: 6000 },
        { status: 'CANCELLED', gross_amount_minor: 10000, advance_required_minor: 3000 },
        { status: 'EXPIRED', gross_amount_minor: 10000, advance_required_minor: 3000 },
      ]
      vi.mocked(createClient).mockReturnValue(makeAdminMock(bookings) as never)

      const summary = await DashboardService.getTodaySummary('comp-1', 'venue-1', '2026-09-06', 'Asia/Kolkata')

      // Only CONFIRMED booking's gross value counted — not CANCELLED or EXPIRED
      expect(summary.grossValueMinor).toBe(20000)
    })

    it('does not mix verifiedAdvance with grossValue (metric separation)', async () => {
      const bookings = [
        { status: 'CONFIRMED', gross_amount_minor: 20000, advance_required_minor: 6000 },
        { status: 'PAYMENT_PENDING', gross_amount_minor: 15000, advance_required_minor: 4500 },
      ]
      vi.mocked(createClient).mockReturnValue(makeAdminMock(bookings) as never)

      const summary = await DashboardService.getTodaySummary('comp-1', 'venue-1', '2026-09-06', 'Asia/Kolkata')

      // verifiedAdvance only from CONFIRMED, not from PENDING
      expect(summary.verifiedAdvanceMinor).toBe(6000)
      // grossValue includes both (PENDING is not excluded until it expires/cancels)
      expect(summary.grossValueMinor).toBe(35000)
    })

    it('enforces tenant isolation — only queries scoped company/venue', async () => {
      vi.mocked(MembershipService.hasPermission).mockImplementation(async (companyId) => {
        return companyId === 'comp-1'
      })
      vi.mocked(createClient).mockReturnValue(makeAdminMock() as never)

      await expect(DashboardService.getTodaySummary('comp-2', 'venue-1', '2026-09-06', 'Asia/Kolkata'))
        .rejects.toThrow('Unauthorized')
    })
  })

  describe('getRevenueSummary()', () => {
    it('requires booking.view permission', async () => {
      vi.mocked(MembershipService.hasPermission).mockResolvedValue(false)
      vi.mocked(createClient).mockReturnValue(makeAdminMock() as never)

      await expect(DashboardService.getRevenueSummary('comp-1', 'venue-1', 'weekly'))
        .rejects.toThrow('Unauthorized: booking.view permission required.')
    })

    it('sums gross value for confirmed and completed bookings only', async () => {
      const bookings = [
        { status: 'CONFIRMED', gross_amount_minor: 20000 },
        { status: 'COMPLETED', gross_amount_minor: 30000 },
      ]
      vi.mocked(createClient).mockReturnValue(makeAdminMock(bookings) as never)

      const summary = await DashboardService.getRevenueSummary('comp-1', 'venue-1', 'weekly')
      expect(summary.grossValueMinor).toBe(50000)
      expect(summary.confirmedCount).toBe(1)
      expect(summary.completedCount).toBe(1)
    })
  })

  describe('getPendingPaymentQueue()', () => {
    it('requires payment.view permission', async () => {
      vi.mocked(MembershipService.hasPermission).mockResolvedValue(false)
      vi.mocked(createClient).mockReturnValue(makeAdminMock() as never)

      await expect(DashboardService.getPendingPaymentQueue('comp-1', 'venue-1'))
        .rejects.toThrow('Unauthorized: payment.view permission required.')
    })
  })

  describe('getFieldCalendar()', () => {
    it('requires booking.view permission', async () => {
      vi.mocked(MembershipService.hasPermission).mockResolvedValue(false)
      vi.mocked(createClient).mockReturnValue(makeAdminMock() as never)

      await expect(DashboardService.getFieldCalendar('comp-1', 'venue-1', 'field-1', '2026-09-06'))
        .rejects.toThrow('Unauthorized: booking.view permission required.')
    })

    it('generates 48 slots for a full day', async () => {
      vi.mocked(createClient).mockReturnValue(makeAdminMock() as never)

      const slots = await DashboardService.getFieldCalendar('comp-1', 'venue-1', 'field-1', '2026-09-06')

      expect(slots).toHaveLength(48)
    })

    it('marks occupied slots from active_slot_reservations', async () => {
      const reservations = [{
        slot_start: '2026-09-06T10:00:00.000Z',
        booking_id: 'bk-1',
        bookings: { status: 'CONFIRMED' }
      }]
      vi.mocked(createClient).mockReturnValue(makeAdminMock([], [], reservations) as never)

      const slots = await DashboardService.getFieldCalendar('comp-1', 'venue-1', 'field-1', '2026-09-06')
      const occupied = slots.find(s => s.slotStart === '2026-09-06T10:00:00.000Z')

      expect(occupied?.status).toBe('booked_confirmed')
      expect(occupied?.bookingId).toBe('bk-1')
    })

    it('marks blocked slots from blocked_periods', async () => {
      const blocks = [{
        starts_at: '2026-09-06T08:00:00.000Z',
        ends_at: '2026-09-06T09:00:00.000Z',
      }]
      vi.mocked(createClient).mockReturnValue(makeAdminMock([], [], [], blocks) as never)

      const slots = await DashboardService.getFieldCalendar('comp-1', 'venue-1', 'field-1', '2026-09-06')
      const blocked = slots.find(s => s.slotStart === '2026-09-06T08:00:00.000Z')

      expect(blocked?.status).toBe('blocked')
    })
  })
})
