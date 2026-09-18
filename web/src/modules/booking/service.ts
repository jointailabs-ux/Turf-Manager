import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { AuthService } from '@/modules/auth/service'
import { MembershipService } from '@/modules/membership/service'
import { NotificationService } from '@/modules/notification/service'
import crypto from 'crypto'

export interface CreateBookingRequest {
  idempotencyKey: string
  companyId: string
  venueId: string
  fieldId: string
  customerId?: string // null for walk-ins
  source: 'ONLINE' | 'WALK_IN' | 'PHONE'
  startAt: string // ISO string
  durationMinutes: number
}

export class BookingService {
  /**
   * Generates a request hash for idempotency checking.
   */
  private static hashRequest(request: unknown): string {
    return crypto.createHash('sha256').update(JSON.stringify(request)).digest('hex')
  }

  /**
   * Validates duration rules. ALL bookings require a 60 minute minimum.
   */
  private static validateDuration(durationMinutes: number) {
    if (durationMinutes % 30 !== 0) {
      throw new Error('Duration must be a multiple of 30 minutes.')
    }
    if (durationMinutes < 60) {
      throw new Error('Minimum booking duration is 60 minutes.')
    }
  }

  /**
   * Computes exact 30-minute slots.
   */
  private static computeSlots(startAt: Date, durationMinutes: number, fieldId: string) {
    const slots = []
    const numSlots = durationMinutes / 30
    
    for (let i = 0; i < numSlots; i++) {
      const slotStart = new Date(startAt.getTime() + i * 30 * 60000)
      const slotEnd = new Date(slotStart.getTime() + 30 * 60000)
      slots.push({
        id: crypto.randomUUID(),
        field_id: fieldId,
        slot_start: slotStart.toISOString(),
        slot_end: slotEnd.toISOString()
      })
    }
    
    return slots
  }

  /**
   * Main orchestrator for creating a booking transaction.
   */
  static async createBooking(request: CreateBookingRequest): Promise<{ id: string, status: string }> {
    const user = await AuthService.requireUser()
    const profile = (await AuthService.getProfile()) ?? user
    if (!profile) throw new Error('Profile not found.')
    const supabase = await createClient()

    const { createClient: createAdminClient } = await import('@supabase/supabase-js')
    const adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    // Helper to use adminClient.from if available, otherwise fall back to anon supabase client
    const adminFrom = (table: string) => (adminClient.from?.(table) ?? supabase.from(table))

    // 2. Fetch Venue Configuration and Field Pricing (Derived Server-Side)
    const [{ data: field, error: fieldError }] = await Promise.all([
      adminFrom('fields')
        .select('venue_id, base_price_minor, is_active, venues(company_id, advance_payment_type, advance_payment_value, timezone)')
        .eq('id', request.fieldId)
        .single()
    ])

    if (fieldError || !field || !field.venues) throw new Error('Field or venue configuration not found.')
    if (!field.is_active) throw new Error('Field is currently inactive.')

    const fieldData = field as unknown as { venue_id: string, base_price_minor: number, is_active: boolean, venues: { company_id: string, advance_payment_type: string, advance_payment_value: number, timezone: string } }
    const derivedVenueId = fieldData.venue_id
    const derivedCompanyId = fieldData.venues.company_id
    const venueTz = fieldData.venues.timezone
    if (!venueTz) throw new Error('Venue timezone is not configured.')

    // 3. Authorization (using server-derived IDs)
    if (request.source === 'ONLINE') {
      if (!request.customerId) {
        throw new Error('ONLINE bookings require a customer ID.')
      }
      // Verify customer identity
      const { data: customer } = await supabase.from('customers').select('profile_id').eq('id', request.customerId).single()
      if (!customer || customer.profile_id !== profile.id) {
        throw new Error('Customer identity mismatch.')
      }
    } else {
      // WALK_IN or PHONE requires Staff Membership
      const hasAccess = await MembershipService.hasAccess(derivedCompanyId, derivedVenueId)
      if (!hasAccess) {
        throw new Error('Unauthorized to create staff bookings for this venue.')
      }
    }

    // 4. Validation (Minimum Duration)
    this.validateDuration(request.durationMinutes)
    const startDate = new Date(request.startAt)
    if (isNaN(startDate.getTime())) throw new Error('Invalid start date.')
    const endDate = new Date(startDate.getTime() + request.durationMinutes * 60000)

    // 5. Validate Blocked Periods
    const { data: blocks } = await adminFrom('blocked_periods')
      .select('id')
      .eq('field_id', request.fieldId)
      .lt('starts_at', endDate.toISOString())
      .gt('ends_at', startDate.toISOString())
    
    if (blocks && blocks.length > 0) {
      throw new Error('The requested time falls within a blocked period.')
    }

    // 6. Validate Operating Hours (Inheritance: Field overrides Venue)
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: venueTz, weekday: 'short' })
    const weekdayStr = formatter.format(startDate)
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const weekdayNum = days.indexOf(weekdayStr)

    const { data: opHoursRows } = await adminFrom('operating_hours')
      .select('field_id, opens_at, closes_at, is_closed')
      .eq('venue_id', derivedVenueId)
      .eq('weekday', weekdayNum)

    if (opHoursRows && opHoursRows.length > 0) {
      // Find field-specific override first, else fallback to venue
      let opHours = opHoursRows.find(row => row.field_id === request.fieldId)
      if (!opHours) opHours = opHoursRows.find(row => row.field_id === null)

      if (opHours) {
        if (opHours.is_closed) throw new Error('Venue/Field is closed on this day.')
        
        const timeStr = startDate.toLocaleTimeString('en-US', { timeZone: venueTz, hour12: false }) // e.g. "14:30:00"
        const endTimeStr = endDate.toLocaleTimeString('en-US', { timeZone: venueTz, hour12: false })

        if (opHours.opens_at && timeStr < opHours.opens_at) {
          throw new Error(`Booking starts before opening time (${opHours.opens_at}).`)
        }
        if (opHours.closes_at && endTimeStr > opHours.closes_at) {
          throw new Error(`Booking ends after closing time (${opHours.closes_at}).`)
        }
      }
    }

    // 6. Pricing Calculation
    const slotsRequired = request.durationMinutes / 30
    const grossAmountMinor = field.base_price_minor * slotsRequired
    
    let advanceRequiredMinor = 0
    const advanceType = fieldData.venues.advance_payment_type
    const advanceVal = fieldData.venues.advance_payment_value

    if (advanceType === 'PERCENTAGE') {
      advanceRequiredMinor = Math.floor(grossAmountMinor * (advanceVal / 100))
    } else if (advanceType === 'FIXED') {
      advanceRequiredMinor = Math.min(advanceVal, grossAmountMinor)
    }
    
    // 7. Check Idempotency
    const requestHash = this.hashRequest(request)
    
    const { data: existingKey } = await supabase
      .from('idempotency_keys')
      .select('*')
      .eq('actor_id', user.id)
      .eq('scope_key', 'create_booking')
      .eq('idempotency_key', request.idempotencyKey)
      .single()

    if (existingKey) {
      if (existingKey.request_hash !== requestHash) {
        throw new Error('Idempotency conflict: Key reused with different payload.')
      }
      if (existingKey.result_status === 'SUCCESS' && existingKey.result_resource_id) {
        return { id: existingKey.result_resource_id, status: 'CACHED' }
      }
      throw new Error(`Previous request with this key is currently: ${existingKey.result_status}`)
    }

    // 8. Build Transaction Payload
    const bookingId = crypto.randomUUID()
    
    const slots = this.computeSlots(startDate, request.durationMinutes, request.fieldId)
    const activeReservations = slots.map(s => ({
      id: crypto.randomUUID(),
      field_id: s.field_id,
      slot_start: s.slot_start
    }))

    const rpcPayload = {
      p_idempotency_key: {
        actor_id: profile.id,
        scope_key: 'create_booking',
        idempotency_key: request.idempotencyKey,
        request_hash: requestHash
      },
      p_booking: {
        id: bookingId,
        company_id: derivedCompanyId,
        venue_id: derivedVenueId,
        field_id: request.fieldId,
        customer_id: request.customerId || null,
        created_by_profile_id: profile.id,
        source: request.source,
        status: 'PAYMENT_PENDING',
        start_at: startDate.toISOString(),
        end_at: endDate.toISOString(),
        duration_minutes: request.durationMinutes,
        gross_amount_minor: grossAmountMinor,
        advance_required_minor: advanceRequiredMinor,
        balance_due_minor: grossAmountMinor,
        currency: 'INR',
        pricing_snapshot: { base_price_minor: field.base_price_minor, slots: slotsRequired },
        expires_at: new Date(Date.now() + 20 * 60000).toISOString() // 20 mins expiry
      },
      p_slots: slots,
      p_active_reservations: activeReservations
    }

    // 9. Execute RPC using service_role
    const { data: resultId, error: rpcError } = await adminClient.rpc('execute_booking_transaction', rpcPayload)

    if (rpcError) {
      if (rpcError.code === '23505') { // Postgres Unique Violation
        if (rpcError.message.includes('idempotency_keys')) {
          throw new Error('Idempotency race condition detected.')
        }
        if (rpcError.message.includes('active_slot_reservations')) {
          throw new Error('Slot unavailable: Concurrency conflict.')
        }
      }
      throw new Error(`Booking transaction failed: ${rpcError.message}`)
    }

    // Trigger notification
    await NotificationService.enqueueEvent({
      company_id: derivedCompanyId,
      venue_id: derivedVenueId,
      event_type: 'BOOKING_CREATED',
      entity_type: 'booking',
      entity_id: resultId,
      payload: { status: 'PAYMENT_PENDING' }
    })

    return { id: resultId, status: 'PAYMENT_PENDING' }
  }

  /**
   * Transitions booking to EXPIRED and releases inventory atomically via RPC.
   */
  static async expireBooking(bookingId: string) {
    await AuthService.requireUser()
    const adminClient = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    })

    const { data: success, error } = await adminClient.rpc('expire_booking_transaction', { p_booking_id: bookingId })
    
    if (error || !success) {
      throw new Error('Cannot expire booking: Not pending, already processed, or not yet expired.')
    }

    // Get venue_id, company_id to enqueue notification
    const supabase = await createClient()
    const { data: booking } = await supabase.from('bookings').select('company_id, venue_id').eq('id', bookingId).single()
    if (booking) {
      await NotificationService.enqueueEvent({
        company_id: booking.company_id,
        venue_id: booking.venue_id,
        event_type: 'BOOKING_EXPIRED',
        entity_type: 'booking',
        entity_id: bookingId,
        payload: {}
      })
    }

    return true
  }

  /**
   * Submits a payment for a booking.
   */
  static async submitPayment(
    bookingId: string,
    paymentAccountId: string,
    paymentMethod: string,
    amountMinor: number,
    transactionReference: string
  ) {
    const user = await AuthService.requireUser()
    const supabase = await createClient()

    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('id, status, company_id, venue_id, customers(profiles(auth_user_id))')
      .eq('id', bookingId)
      .single()

    if (fetchError || !booking) throw new Error('Booking not found.')

    // Must be PAYMENT_PENDING
    if (booking.status !== 'PAYMENT_PENDING') {
      throw new Error('Booking is not pending payment.')
    }

    // Must be the owner
    const customerData = booking.customers as unknown as { profiles: { auth_user_id: string } }
    if (customerData?.profiles?.auth_user_id !== user.id) {
      throw new Error('Unauthorized to submit payment for this booking.')
    }

    const { createClient: createAdminClient } = await import('@supabase/supabase-js')
    const adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    // Helper to use adminClient.from if available, otherwise fall back to anon supabase client
    const adminFrom = (table: string) => (adminClient.from?.(table) ?? supabase.from(table))

    const { data: payment, error } = await adminFrom('payments')
      .insert({
        booking_id: bookingId,
        payment_account_id: paymentAccountId,
        payment_method: paymentMethod,
        status: 'PENDING_VERIFICATION',
        amount_minor: amountMinor,
        payment_type: 'ADVANCE',
        submitted_at: new Date().toISOString(),
        transaction_reference: transactionReference
      })
      .select('id')
      .single()

    if (error) {
      if (error.code === '23505') throw new Error('Duplicate transaction reference.')
      throw new Error(`Failed to submit payment: ${error.message}`)
    }

    // 3. Update booking status
    // Booking status remains PAYMENT_PENDING while the payment is PENDING_VERIFICATION

    await NotificationService.enqueueEvent({
      company_id: booking.company_id,
      venue_id: booking.venue_id,
      event_type: 'PAYMENT_SUBMITTED',
      entity_type: 'payment',
      entity_id: payment.id,
      payload: { booking_id: bookingId, amount_minor: amountMinor }
    })

    return { id: payment.id }
  }

  /**
   * Transitions booking to CONFIRMED based on verified payment atomically via RPC.
   */
  static async approveBooking(bookingId: string, paymentId: string) {
    const user = await AuthService.requireUser()
    const adminClient = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    })

    // Staff needs authorization check to approve booking. We must verify tenant access.
    // To do this, we need the companyId and venueId of the booking.
    const supabase = await createClient()
    const { data: booking } = await supabase.from('bookings').select('company_id, venue_id').eq('id', bookingId).single()
    if (!booking) throw new Error('Booking not found.')
    
    // Explicit financial approval permission check
    const hasAccess = await MembershipService.hasPermission(booking.company_id, booking.venue_id, 'payment.approve')
    if (!hasAccess) throw new Error('Unauthorized to approve payments for this venue.')

    // The payments.verified_by FK references profiles.id (not auth.uid)
    // Resolve staff profile ID from auth UID
    const adminFrom = (table: string) => (adminClient.from?.(table) ?? supabase.from(table));
    const { data: staffProfile } = await adminFrom('profiles')
      .select('id')
      .eq('auth_user_id', user.id)
      .single();
    const staffProfileId = staffProfile?.id ?? user.id;
    
    const { data: success, error } = await adminClient.rpc('approve_booking_transaction', { 
      p_booking_id: bookingId,
      p_payment_id: paymentId,
      p_verified_by: staffProfileId
    })

    if (error || !success) {
      console.error('[approveBooking] RPC error:', error?.message, '| success:', success);
      throw new Error(`Cannot approve booking: ${error?.message ?? 'Invalid state, expired, payment mismatch, or amount insufficient.'}`)
    }

    await NotificationService.enqueueEvent({
      company_id: booking.company_id,
      venue_id: booking.venue_id,
      event_type: 'PAYMENT_APPROVED',
      entity_type: 'booking',
      entity_id: bookingId,
      payload: { payment_id: paymentId }
    })

    return true
  }

  /**
   * Transitions booking to PAYMENT_REJECTED based on failed payment atomically via RPC.
   */
  static async rejectBooking(bookingId: string, paymentId: string, reason: string) {
    const user = await AuthService.requireUser()
    const adminClient = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    })

    const supabase = await createClient()
    const { data: booking } = await supabase.from('bookings').select('company_id, venue_id').eq('id', bookingId).single()
    if (!booking) throw new Error('Booking not found.')
    
    // Explicit financial approval permission check
    const hasAccess = await MembershipService.hasPermission(booking.company_id, booking.venue_id, 'payment.approve')
    if (!hasAccess) throw new Error('Unauthorized to reject payments for this venue.')
    
    const { data: success, error } = await adminClient.rpc('reject_booking_transaction', { 
      p_booking_id: bookingId,
      p_payment_id: paymentId,
      p_verified_by: user.id,
      p_reason: reason
    })

    if (error || !success) {
      throw new Error('Cannot reject booking: Invalid state or payment mismatch.')
    }

    await NotificationService.enqueueEvent({
      company_id: booking.company_id,
      venue_id: booking.venue_id,
      event_type: 'PAYMENT_REJECTED',
      entity_type: 'booking',
      entity_id: bookingId,
      payload: { payment_id: paymentId, reason }
    })

    return true
  }
}
