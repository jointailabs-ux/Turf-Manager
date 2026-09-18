import { createClient as createAdminClient } from '@supabase/supabase-js'
import { MembershipService } from '@/modules/membership/service'

export interface DashboardSummary {
  totalBookings: number
  confirmedCount: number
  pendingCount: number
  cancelledCount: number
  expiredCount: number
  completedCount: number
  grossValueMinor: number
  verifiedAdvanceMinor: number
}

export interface RevenueSummary {
  period: 'weekly' | 'monthly'
  grossValueMinor: number
  confirmedCount: number
  completedCount: number
}

export interface PendingPaymentItem {
  bookingId: string
  paymentId: string
  customerName: string | null
  amountMinor: number
  paymentMethod: string
  submittedAt: string
  fieldId: string
  startAt: string
}

export interface FieldCalendarSlot {
  slotStart: string
  slotEnd: string
  status: 'available' | 'booked_confirmed' | 'booked_pending' | 'blocked'
  bookingId: string | null
  bookingStatus: string | null
}

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  )
}

export class DashboardService {
  /**
   * Returns aggregated metrics for today at the given venue.
   * Requires booking.view permission.
   * Uses server-side aggregation — does not load all bookings into browser.
   */
  static async getTodaySummary(
    companyId: string,
    venueId: string,
    date: string,
    _timezone?: string
  ): Promise<DashboardSummary> {
    const hasAccess = await MembershipService.hasPermission(companyId, venueId, 'booking.view')
    if (!hasAccess) throw new Error('Unauthorized: booking.view permission required.')

    const adminClient = getAdminClient()
    const dayStart = new Date(`${date}T00:00:00`).toISOString()
    const dayEnd = new Date(`${date}T23:59:59.999`).toISOString()

    const { data: bookings, error } = await adminClient
      .from('bookings')
      .select('status, gross_amount_minor, advance_required_minor')
      .eq('company_id', companyId)
      .eq('venue_id', venueId)
      .gte('start_at', dayStart)
      .lte('start_at', dayEnd)

    if (error) throw new Error(`Failed to fetch dashboard data: ${error.message}`)

    const rows = bookings ?? []
    const summary: DashboardSummary = {
      totalBookings: rows.length,
      confirmedCount: 0,
      pendingCount: 0,
      cancelledCount: 0,
      expiredCount: 0,
      completedCount: 0,
      grossValueMinor: 0,
      verifiedAdvanceMinor: 0,
    }

    for (const b of rows) {
      switch (b.status) {
        case 'CONFIRMED': summary.confirmedCount++; break
        case 'PAYMENT_PENDING': summary.pendingCount++; break
        case 'CANCELLED': summary.cancelledCount++; break
        case 'EXPIRED': summary.expiredCount++; break
        case 'COMPLETED': summary.completedCount++; break
      }
      if (!['CANCELLED', 'EXPIRED', 'PAYMENT_REJECTED'].includes(b.status)) {
        summary.grossValueMinor += b.gross_amount_minor
      }
      if (b.status === 'CONFIRMED' || b.status === 'COMPLETED') {
        summary.verifiedAdvanceMinor += b.advance_required_minor
      }
    }

    return summary
  }

  /**
   * Returns revenue summary for a given period (weekly or monthly).
   * Requires booking.view permission.
   */
  static async getRevenueSummary(
    companyId: string,
    venueId: string,
    period: 'weekly' | 'monthly'
  ): Promise<RevenueSummary> {
    const hasAccess = await MembershipService.hasPermission(companyId, venueId, 'booking.view')
    if (!hasAccess) throw new Error('Unauthorized: booking.view permission required.')

    const adminClient = getAdminClient()
    const now = new Date()
    const periodStart = new Date(now)

    if (period === 'weekly') {
      periodStart.setDate(now.getDate() - 7)
    } else {
      periodStart.setDate(now.getDate() - 30)
    }

    const { data: bookings, error } = await adminClient
      .from('bookings')
      .select('status, gross_amount_minor')
      .eq('company_id', companyId)
      .eq('venue_id', venueId)
      .gte('start_at', periodStart.toISOString())
      .lte('start_at', now.toISOString())
      .in('status', ['CONFIRMED', 'COMPLETED'])

    if (error) throw new Error(`Failed to fetch revenue data: ${error.message}`)

    const rows = bookings ?? []
    return {
      period,
      grossValueMinor: rows.reduce((sum, b) => sum + b.gross_amount_minor, 0),
      confirmedCount: rows.filter(b => b.status === 'CONFIRMED').length,
      completedCount: rows.filter(b => b.status === 'COMPLETED').length,
    }
  }

  /**
   * Returns paginated list of bookings with pending payment approval.
   * Requires payment.view permission.
   */
  static async getPendingPaymentQueue(
    companyId: string,
    venueId: string,
    options: { page?: number; pageSize?: number } = {}
  ): Promise<{ items: PendingPaymentItem[]; total: number }> {
    const hasAccess = await MembershipService.hasPermission(companyId, venueId, 'payment.view')
    if (!hasAccess) throw new Error('Unauthorized: payment.view permission required.')

    const { page = 1, pageSize = 20 } = options
    const offset = (page - 1) * pageSize
    const adminClient = getAdminClient()

    const { data: payments, error, count } = await adminClient
      .from('payments')
      .select(
        'id, amount_minor, payment_method, submitted_at, booking_id, bookings!inner(status, field_id, start_at, company_id, venue_id, customers(profiles!inner(full_name)))',
        { count: 'exact' }
      )
      .eq('status', 'PENDING_VERIFICATION')
      .eq('bookings.company_id', companyId)
      .eq('bookings.venue_id', venueId)
      .eq('bookings.status', 'PAYMENT_PENDING')
      .order('submitted_at', { ascending: true })
      .range(offset, offset + pageSize - 1)

    if (error) throw new Error(`Failed to fetch payment queue: ${error.message}`)

    const items: PendingPaymentItem[] = (payments ?? []).map(p => {
      const booking = p.bookings as unknown as {
        field_id: string; start_at: string;
        customers: { profiles: { full_name: string | null } } | null
      }
      return {
        bookingId: p.booking_id,
        paymentId: p.id,
        customerName: booking.customers?.profiles?.full_name ?? null,
        amountMinor: p.amount_minor,
        paymentMethod: p.payment_method,
        submittedAt: p.submitted_at,
        fieldId: booking.field_id,
        startAt: booking.start_at,
      }
    })

    return { items, total: count ?? 0 }
  }

  /**
   * Returns paginated list of today's bookings for operational view.
   * Requires booking.view permission.
   */
  static async getTodayBookingList(
    companyId: string,
    venueId: string,
    date: string,
    options: { page?: number; pageSize?: number } = {}
  ): Promise<{ bookings: Array<{
    id: string; status: string; source: string; startAt: string;
    endAt: string; customerName: string | null; fieldId: string; grossAmountMinor: number
  }>; total: number }> {
    const hasAccess = await MembershipService.hasPermission(companyId, venueId, 'booking.view')
    if (!hasAccess) throw new Error('Unauthorized: booking.view permission required.')

    const { page = 1, pageSize = 50 } = options
    const offset = (page - 1) * pageSize
    const adminClient = getAdminClient()

    const dayStart = `${date}T00:00:00.000Z`
    const dayEnd = `${date}T23:59:59.999Z`

    const { data, count, error } = await adminClient
      .from('bookings')
      .select('id, status, source, start_at, end_at, field_id, gross_amount_minor, customers(profiles!inner(full_name))', { count: 'exact' })
      .eq('company_id', companyId)
      .eq('venue_id', venueId)
      .gte('start_at', dayStart)
      .lte('start_at', dayEnd)
      .order('start_at', { ascending: true })
      .range(offset, offset + pageSize - 1)

    if (error) throw new Error(`Failed to fetch today's bookings: ${error.message}`)

    return {
      bookings: (data ?? []).map(b => {
        const cust = b.customers as unknown as { profiles: { full_name: string | null } } | null
        return {
          id: b.id,
          status: b.status,
          source: b.source,
          startAt: b.start_at,
          endAt: b.end_at,
          customerName: cust?.profiles?.full_name ?? null,
          fieldId: b.field_id,
          grossAmountMinor: b.gross_amount_minor,
        }
      }),
      total: count ?? 0,
    }
  }

  /**
   * Returns a field calendar for a given date showing slot occupancy.
   * Reuses existing slot reservation data — does not create a second availability engine.
   * Requires booking.view permission.
   */
  static async getFieldCalendar(
    companyId: string,
    venueId: string,
    fieldId: string,
    date: string
  ): Promise<FieldCalendarSlot[]> {
    const hasAccess = await MembershipService.hasPermission(companyId, venueId, 'booking.view')
    if (!hasAccess) throw new Error('Unauthorized: booking.view permission required.')

    const adminClient = getAdminClient()
    const dayStart = `${date}T00:00:00.000Z`
    const dayEnd = `${date}T23:59:59.999Z`

    // Fetch active reservations for the field on this date
    const { data: reservations } = await adminClient
      .from('active_slot_reservations')
      .select('slot_start, booking_id, bookings!inner(status)')
      .eq('field_id', fieldId)
      .gte('slot_start', dayStart)
      .lt('slot_start', dayEnd)

    // Fetch blocked periods
    const { data: blocks } = await adminClient
      .from('blocked_periods')
      .select('starts_at, ends_at')
      .eq('field_id', fieldId)
      .lt('starts_at', dayEnd)
      .gt('ends_at', dayStart)

    // Build occupied slot map
    const occupiedSlots: Map<string, { bookingId: string; status: string }> = new Map()
    for (const r of reservations ?? []) {
      const booking = r.bookings as unknown as { status: string }
      occupiedSlots.set(r.slot_start, { bookingId: r.booking_id, status: booking.status })
    }

    // Build 30-minute slots for the full day (00:00 → 23:30)
    const slots: FieldCalendarSlot[] = []
    const baseDate = new Date(`${date}T00:00:00.000Z`)

    for (let i = 0; i < 48; i++) {
      const slotStart = new Date(baseDate.getTime() + i * 30 * 60 * 1000)
      const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000)
      const slotStartStr = slotStart.toISOString()

      // Check blocked
      const isBlocked = (blocks ?? []).some(
        b => new Date(b.starts_at) <= slotStart && new Date(b.ends_at) >= slotEnd
      )

      if (isBlocked) {
        slots.push({ slotStart: slotStartStr, slotEnd: slotEnd.toISOString(), status: 'blocked', bookingId: null, bookingStatus: null })
        continue
      }

      const occupied = occupiedSlots.get(slotStartStr)
      if (occupied) {
        const status = occupied.status === 'CONFIRMED' ? 'booked_confirmed' : 'booked_pending'
        slots.push({ slotStart: slotStartStr, slotEnd: slotEnd.toISOString(), status, bookingId: occupied.bookingId, bookingStatus: occupied.status })
      } else {
        slots.push({ slotStart: slotStartStr, slotEnd: slotEnd.toISOString(), status: 'available', bookingId: null, bookingStatus: null })
      }
    }

    return slots
  }
}
