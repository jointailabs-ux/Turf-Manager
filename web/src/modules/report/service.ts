import { createClient as createAdminClient } from '@supabase/supabase-js'
import { MembershipService } from '@/modules/membership/service'
import { fromZonedTime } from 'date-fns-tz'

export interface ReportFilter {
  companyId: string
  venueId: string
  startDate: string
  endDate: string
  fieldId?: string
  sportId?: string
}

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  )
}

export class ReportService {
  /**
   * Converts a venue-local calendar date string (e.g. '2026-09-20') into exact UTC ISO boundaries
   * based on the venue's authoritative timezone.
   */
  static getVenueDayBounds(localDateString: string, timezone: string): { startDate: string; endDate: string } {
    const startUtc = fromZonedTime(`${localDateString} 00:00:00.000`, timezone)
    const endUtc = fromZonedTime(`${localDateString} 23:59:59.999`, timezone)
    return {
      startDate: startUtc.toISOString(),
      endDate: endUtc.toISOString(),
    }
  }
  /**
   * Booking Report: Total bookings by status, and aggregated durations.
   * Requires 'report.view' permission.
   */
  static async getBookingReport(filter: ReportFilter) {
    const hasAccess = await MembershipService.hasPermission(filter.companyId, filter.venueId, 'report.view')
    if (!hasAccess) throw new Error('Unauthorized: report.view permission required.')

    const adminClient = getAdminClient()
    
    let query = adminClient
      .from('bookings')
      .select('status, duration_minutes')
      .eq('company_id', filter.companyId)
      .eq('venue_id', filter.venueId)
      .gte('start_at', filter.startDate)
      .lte('start_at', filter.endDate)

    if (filter.fieldId) query = query.eq('field_id', filter.fieldId)
    // Note: If sport filtering is needed, it would require joining fields -> venue_sports, omitted for simplicity unless requested

    const { data, error } = await query
    if (error) throw new Error(`[REPORT] Failed to fetch booking report: ${error.message}`)

    const summary = {
      totalBookings: 0,
      totalDurationMinutes: 0,
      byStatus: {} as Record<string, number>
    }

    for (const b of data ?? []) {
      summary.totalBookings++
      summary.totalDurationMinutes += b.duration_minutes
      summary.byStatus[b.status] = (summary.byStatus[b.status] || 0) + 1
    }

    return summary
  }

  /**
   * Financial Report: Gross booking value, verified collections (advance), and remaining balance.
   * Requires 'report.view' permission.
   */
  static async getFinancialReport(filter: ReportFilter) {
    const hasAccess = await MembershipService.hasPermission(filter.companyId, filter.venueId, 'report.view')
    if (!hasAccess) throw new Error('Unauthorized: report.view permission required.')

    const adminClient = getAdminClient()
    
    let query = adminClient
      .from('bookings')
      .select('status, gross_amount_minor, advance_required_minor, balance_due_minor')
      .eq('company_id', filter.companyId)
      .eq('venue_id', filter.venueId)
      .gte('start_at', filter.startDate)
      .lte('start_at', filter.endDate)

    if (filter.fieldId) query = query.eq('field_id', filter.fieldId)

    const { data, error } = await query
    if (error) throw new Error(`[REPORT] Failed to fetch financial report: ${error.message}`)

    const summary = {
      totalGrossValueMinor: 0,
      verifiedCollectionsAdvanceMinor: 0,
      remainingBalanceDueMinor: 0,
    }

    for (const b of data ?? []) {
      if (!['CANCELLED', 'EXPIRED', 'PAYMENT_REJECTED'].includes(b.status)) {
        summary.totalGrossValueMinor += b.gross_amount_minor
        summary.remainingBalanceDueMinor += b.balance_due_minor
      }
      
      // Verified advance collections apply to CONFIRMED and COMPLETED
      if (b.status === 'CONFIRMED' || b.status === 'COMPLETED') {
        summary.verifiedCollectionsAdvanceMinor += b.advance_required_minor
      }
    }

    return summary
  }

  /**
   * Field Utilisation Report: Occupancy rates
   * Requires 'report.view' permission.
   */
  static async getUtilisationReport(filter: ReportFilter) {
    const hasAccess = await MembershipService.hasPermission(filter.companyId, filter.venueId, 'report.view')
    if (!hasAccess) throw new Error('Unauthorized: report.view permission required.')

    const adminClient = getAdminClient()
    
    // We count occupied slots vs total available slots.
    // For simplicity, we just aggregate the total minutes booked for CONFIRMED/COMPLETED.
    let query = adminClient
      .from('bookings')
      .select('duration_minutes, field_id')
      .eq('company_id', filter.companyId)
      .eq('venue_id', filter.venueId)
      .gte('start_at', filter.startDate)
      .lte('start_at', filter.endDate)
      .in('status', ['CONFIRMED', 'COMPLETED'])

    if (filter.fieldId) query = query.eq('field_id', filter.fieldId)

    const { data, error } = await query
    if (error) throw new Error(`[REPORT] Failed to fetch utilisation report: ${error.message}`)

    const byField: Record<string, number> = {}
    let totalBookedMinutes = 0

    for (const b of data ?? []) {
      totalBookedMinutes += b.duration_minutes
      byField[b.field_id] = (byField[b.field_id] || 0) + b.duration_minutes
    }

    return {
      totalBookedMinutes,
      byField
    }
  }
}
