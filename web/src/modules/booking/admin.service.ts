import { createClient as createAdminClient } from '@supabase/supabase-js'
import { MembershipService } from '@/modules/membership/service'
import { NotificationService } from '@/modules/notification/service'
import { AuthService } from '@/modules/auth/service'
import { AuditService } from '@/modules/audit/service'
import { BookingService } from '@/modules/booking/service'
import type { CreateBookingRequest } from '@/modules/booking/service'

/**
 * V1 Payment Method Mapping:
 * Database value 'OTHER' represents the business concept OTHER_OFFLINE (cash/offline/unclassified).
 * The CHECK constraint on payments is frozen; we document this mapping here explicitly.
 */
export type StaffPaymentMethod = 'CASH' | 'UPI_MANUAL' | 'OTHER'

export interface BookingListItem {
  id: string
  status: string
  source: string
  startAt: string
  endAt: string
  durationMinutes: number
  grossAmountMinor: number
  advanceRequiredMinor: number
  balanceDueMinor: number
  customerName: string | null
  fieldId: string
  createdAt: string
}

export interface BookingDetail {
  id: string
  companyId: string
  venueId: string
  fieldId: string
  customerId: string | null
  customerName: string | null
  customerEmail: string | null
  createdByProfileId: string
  source: string
  status: string
  startAt: string
  endAt: string
  durationMinutes: number
  grossAmountMinor: number
  advanceRequiredMinor: number
  balanceDueMinor: number
  pricingSnapshot: Record<string, unknown>
  expiresAt: string | null
  cancellationReason: string | null
  createdAt: string
  payments: Array<{
    id: string
    paymentMethod: string
    status: string
    amountMinor: number
    paymentType: string
    transactionReference: string | null
    submittedAt: string
    verifiedAt: string | null
  }>
}

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  )
}

export class BookingAdminService {
  /**
   * Lists bookings for a venue with optional filters.
   * Requires booking.view permission.
   */
  static async listBookings(
    companyId: string,
    venueId: string,
    filters: { status?: string; date?: string; fieldId?: string; page?: number; pageSize?: number } = {}
  ): Promise<{ bookings: BookingListItem[]; total: number }> {
    const hasAccess = await MembershipService.hasPermission(companyId, venueId, 'booking.view')
    if (!hasAccess) throw new Error('Unauthorized: booking.view permission required.')

    const { page = 1, pageSize = 20, status, date, fieldId } = filters
    const offset = (page - 1) * pageSize
    const adminClient = getAdminClient()

    let query = adminClient
      .from('bookings')
      .select(
        'id, status, source, start_at, end_at, duration_minutes, gross_amount_minor, advance_required_minor, balance_due_minor, field_id, created_at, customers(profiles!inner(full_name))',
        { count: 'exact' }
      )
      .eq('company_id', companyId)
      .eq('venue_id', venueId)
      .order('start_at', { ascending: false })

    if (status) query = query.eq('status', status)
    if (fieldId) query = query.eq('field_id', fieldId)
    if (date) {
      const dayStart = `${date}T00:00:00.000Z`
      const dayEnd = `${date}T23:59:59.999Z`
      query = query.gte('start_at', dayStart).lte('start_at', dayEnd)
    }

    const { data, error, count } = await query.range(offset, offset + pageSize - 1)
    if (error) throw new Error(`Failed to fetch bookings: ${error.message}`)

    const items: BookingListItem[] = (data ?? []).map(b => {
      const cust = b.customers as unknown as { profiles: { full_name: string | null } } | null
      return {
        id: b.id,
        status: b.status,
        source: b.source,
        startAt: b.start_at,
        endAt: b.end_at,
        durationMinutes: b.duration_minutes,
        grossAmountMinor: b.gross_amount_minor,
        advanceRequiredMinor: b.advance_required_minor,
        balanceDueMinor: b.balance_due_minor,
        customerName: cust?.profiles?.full_name ?? null,
        fieldId: b.field_id,
        createdAt: b.created_at,
      }
    })

    return { bookings: items, total: count ?? 0 }
  }

  /**
   * Returns full booking detail with payments.
   * Validates booking belongs to this company/venue.
   * Requires booking.view permission.
   */
  static async getBookingDetail(
    companyId: string,
    venueId: string,
    bookingId: string
  ): Promise<BookingDetail> {
    const hasAccess = await MembershipService.hasPermission(companyId, venueId, 'booking.view')
    if (!hasAccess) throw new Error('Unauthorized: booking.view permission required.')

    const adminClient = getAdminClient()
    const { data: b, error } = await adminClient
      .from('bookings')
      .select('*, customers(profiles!inner(full_name, email))')
      .eq('id', bookingId)
      .eq('company_id', companyId)
      .eq('venue_id', venueId)
      .single()

    if (error || !b) throw new Error('Booking not found in this venue scope.')

    const { data: payments } = await adminClient
      .from('payments')
      .select('id, payment_method, status, amount_minor, payment_type, transaction_reference, submitted_at, verified_at')
      .eq('booking_id', bookingId)
      .order('submitted_at', { ascending: false })

    const cust = b.customers as unknown as { profiles: { full_name: string | null; email: string } } | null

    return {
      id: b.id,
      companyId: b.company_id,
      venueId: b.venue_id,
      fieldId: b.field_id,
      customerId: b.customer_id,
      customerName: cust?.profiles?.full_name ?? null,
      customerEmail: cust?.profiles?.email ?? null,
      createdByProfileId: b.created_by_profile_id,
      source: b.source,
      status: b.status,
      startAt: b.start_at,
      endAt: b.end_at,
      durationMinutes: b.duration_minutes,
      grossAmountMinor: b.gross_amount_minor,
      advanceRequiredMinor: b.advance_required_minor,
      balanceDueMinor: b.balance_due_minor,
      pricingSnapshot: b.pricing_snapshot as Record<string, unknown>,
      expiresAt: b.expires_at,
      cancellationReason: b.cancellation_reason,
      createdAt: b.created_at,
      payments: (payments ?? []).map(p => ({
        id: p.id,
        paymentMethod: p.payment_method,
        status: p.status,
        amountMinor: p.amount_minor,
        paymentType: p.payment_type,
        transactionReference: p.transaction_reference,
        submittedAt: p.submitted_at,
        verifiedAt: p.verified_at,
      })),
    }
  }

  /**
   * Cancels a booking (PAYMENT_PENDING or CONFIRMED → CANCELLED).
   * Releases active_slot_reservations, preserves booking_slots and payment history.
   * Audit log embedded in the SQL RPC — transactional.
   * Requires booking.cancel permission.
   */
  static async cancelBooking(
    companyId: string,
    venueId: string,
    bookingId: string,
    reason: string
  ): Promise<void> {
    const user = await AuthService.requireUser()
    const hasAccess = await MembershipService.hasPermission(companyId, venueId, 'booking.cancel')
    if (!hasAccess) throw new Error('Unauthorized: booking.cancel permission required.')

    // Validate booking scope
    const adminClient = getAdminClient()
    const { data: booking } = await adminClient
      .from('bookings')
      .select('id, status')
      .eq('id', bookingId)
      .eq('company_id', companyId)
      .eq('venue_id', venueId)
      .single()

    if (!booking) throw new Error('Booking not found in this venue scope.')

    const { data: success, error } = await adminClient.rpc('cancel_booking_transaction', {
      p_booking_id: bookingId,
      p_cancelled_by: user.id,
      p_reason: reason,
    })

    if (error || !success) {
      throw new Error(`Cannot cancel booking: ${error?.message ?? 'Invalid state transition.'}`)
    }

    await NotificationService.enqueueEvent({
      company_id: companyId,
      venue_id: venueId,
      event_type: 'BOOKING_CANCELLED',
      entity_type: 'booking',
      entity_id: bookingId,
      payload: { reason }
    })
  }

  /**
   * Completes a booking (CONFIRMED → COMPLETED).
   * Audit log embedded in the SQL RPC — transactional.
   * Requires booking.complete permission.
   */
  static async completeBooking(
    companyId: string,
    venueId: string,
    bookingId: string
  ): Promise<void> {
    const user = await AuthService.requireUser()
    const hasAccess = await MembershipService.hasPermission(companyId, venueId, 'booking.complete')
    if (!hasAccess) throw new Error('Unauthorized: booking.complete permission required.')

    const adminClient = getAdminClient()
    const { data: booking } = await adminClient
      .from('bookings')
      .select('id, status')
      .eq('id', bookingId)
      .eq('company_id', companyId)
      .eq('venue_id', venueId)
      .single()

    if (!booking) throw new Error('Booking not found in this venue scope.')

    const { data: success, error } = await adminClient.rpc('complete_booking_transaction', {
      p_booking_id: bookingId,
      p_completed_by: user.id,
    })

    if (error || !success) {
      throw new Error(`Cannot complete booking: ${error?.message ?? 'Invalid state transition.'}`)
    }
  }

  /**
   * Records a staff-submitted payment for a PAYMENT_PENDING booking.
   * Used in manual booking flows where staff collects payment offline.
   * Does NOT use customer ownership checks (staff-submitted, not customer-submitted).
   * Requires payment.approve permission.
   */
  static async submitStaffPayment(
    companyId: string,
    venueId: string,
    bookingId: string,
    data: { paymentMethod: StaffPaymentMethod; amountMinor: number; transactionReference?: string }
  ): Promise<{ paymentId: string }> {
    await AuthService.requireUser()
    const hasAccess = await MembershipService.hasPermission(companyId, venueId, 'payment.approve')
    if (!hasAccess) throw new Error('Unauthorized: payment.approve permission required.')

    const adminClient = getAdminClient()
    const { data: booking } = await adminClient
      .from('bookings')
      .select('id, status, advance_required_minor')
      .eq('id', bookingId)
      .eq('company_id', companyId)
      .eq('venue_id', venueId)
      .single()

    if (!booking) throw new Error('Booking not found in this venue scope.')
    if (booking.status !== 'PAYMENT_PENDING') throw new Error('Booking is not pending payment.')
    if (data.amountMinor < booking.advance_required_minor) {
      throw new Error(`Payment amount is insufficient. Advance required: ${booking.advance_required_minor} minor units.`)
    }

    const { data: payment, error } = await adminClient
      .from('payments')
      .insert({
        booking_id: bookingId,
        payment_method: data.paymentMethod,
        status: 'PENDING_VERIFICATION',
        amount_minor: data.amountMinor,
        payment_type: 'ADVANCE',
        transaction_reference: data.transactionReference ?? null,
        submitted_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (error) throw new Error(`Failed to submit payment: ${error.message}`)
    return { paymentId: payment.id }
  }

  /**
   * Records a balance payment on a CONFIRMED booking.
   * Audit log embedded in the SQL RPC — transactional.
   * V1 note: paymentMethod 'OTHER' = OTHER_OFFLINE in business domain.
   * Requires payment.record_balance permission.
   */
  static async recordBalancePayment(
    companyId: string,
    venueId: string,
    bookingId: string,
    data: { paymentMethod: StaffPaymentMethod; amountMinor: number; transactionReference?: string }
  ): Promise<{ paymentId: string }> {
    const user = await AuthService.requireUser()
    const hasAccess = await MembershipService.hasPermission(companyId, venueId, 'payment.record_balance')
    if (!hasAccess) throw new Error('Unauthorized: payment.record_balance permission required.')

    const adminClient = getAdminClient()

    // Verify booking scope
    const { data: booking } = await adminClient
      .from('bookings')
      .select('id, status')
      .eq('id', bookingId)
      .eq('company_id', companyId)
      .eq('venue_id', venueId)
      .single()

    if (!booking) throw new Error('Booking not found in this venue scope.')

    const { data: paymentId, error } = await adminClient.rpc('record_balance_payment_transaction', {
      p_booking_id: bookingId,
      p_recorded_by: user.id,
      p_amount_minor: data.amountMinor,
      p_payment_method: data.paymentMethod,
      p_transaction_reference: data.transactionReference ?? '',
    })

    if (error) throw new Error(`Failed to record balance payment: ${error.message}`)
    return { paymentId: paymentId as string }
  }

  /**
   * Creates a manual booking (WALK_IN or PHONE source).
   * Delegates to the existing BookingService.createBooking which uses the same atomic engine.
   * Emits BOOKING_MANUAL_CREATED audit event via Node.js layer (observable failure).
   * Requires booking.create_manual permission.
   */
  static async createManualBooking(
    companyId: string,
    venueId: string,
    request: {
      fieldId: string
      customerId?: string
      source: 'WALK_IN' | 'PHONE'
      startAt: string
      durationMinutes: number
      idempotencyKey: string
    }
  ): Promise<{ bookingId: string }> {
    const user = await AuthService.requireUser()
    const hasAccess = await MembershipService.hasPermission(companyId, venueId, 'booking.create_manual')
    if (!hasAccess) throw new Error('Unauthorized: booking.create_manual permission required.')

    // Delegate to existing atomic booking engine — same validations apply
    const bookingRequest: CreateBookingRequest = {
      idempotencyKey: request.idempotencyKey,
      companyId,
      venueId,
      fieldId: request.fieldId,
      customerId: request.customerId,
      source: request.source,
      startAt: request.startAt,
      durationMinutes: request.durationMinutes,
    }

    const result = await BookingService.createBooking(bookingRequest)

    // Emit audit event — observable failure, does not silently disappear
    try {
      await AuditService.emit({
        company_id: companyId,
        venue_id: venueId,
        actor_profile_id: user.id,
        event_type: 'BOOKING_MANUAL_CREATED',
        entity_type: 'booking',
        entity_id: result.id,
        metadata: {
          source: request.source,
          field_id: request.fieldId,
          start_at: request.startAt,
          duration_minutes: request.durationMinutes,
          customer_id: request.customerId ?? null,
        },
      })
    } catch (auditErr) {
      console.error('[AUDIT CRITICAL] BOOKING_MANUAL_CREATED audit write failed. Booking was created successfully:', {
        booking_id: result.id,
        error: auditErr instanceof Error ? auditErr.message : String(auditErr),
      })
    }

    return { bookingId: result.id }
  }
}
