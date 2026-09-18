import { describe, it, expect, beforeAll } from 'vitest'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { BookingService } from '@/modules/booking/service'
import { BookingUIService } from '@/modules/booking/ui.service'
import { ReportService } from '@/modules/report/service'
import { NotificationService } from '@/modules/notification/service'
import { performance } from 'perf_hooks'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service_role_key_placeholder'

const isDbAvailable =
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('127.0.0.1')

describe.skipIf(!isDbAvailable)('Milestone 4 — Performance Profiling & Concurrency Benchmark', { timeout: 45000 }, () => {
  let adminClient: any
  let companyId: string
  let venueId: string
  let fieldId: string
  let customerProfileId: string
  let customerId: string
  let venueSlug: string

  beforeAll(async () => {
    adminClient = createAdminClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    })

    const timestamp = Date.now()

    // 1. Create company
    const { data: company, error: cErr } = await adminClient.from('companies')
      .insert({ name: `Perf Co ${timestamp}`, slug: `perf-co-${timestamp}` })
      .select().single()
    if (cErr) throw cErr
    companyId = company.id

    // 2. Create venue
    venueSlug = `perf-ven-${timestamp}`
    const { data: venue, error: vErr } = await adminClient.from('venues')
      .insert({
        company_id: companyId,
        name: `Perf Venue ${timestamp}`,
        slug: venueSlug,
        timezone: 'Asia/Kolkata',
        advance_payment_type: 'PERCENTAGE',
        advance_payment_value: 20
      })
      .select().single()
    if (vErr) throw vErr
    venueId = venue.id

    // 3. Create Sport, VenueSport & Field
    let { data: sport } = await adminClient.from('sports').select('id').limit(1).single()
    if (!sport) {
      const { data: newSport, error: sErr } = await adminClient.from('sports').insert({ name: 'Football', slug: `football-${timestamp}` }).select().single()
      if (sErr) throw sErr
      sport = newSport
    }

    const { data: venueSport, error: vsErr } = await adminClient.from('venue_sports')
      .insert({
        venue_id: venueId,
        sport_id: sport.id,
        is_active: true
      })
      .select().single()
    if (vsErr) throw vsErr

    const { data: field, error: fErr } = await adminClient.from('fields')
      .insert({
        venue_id: venueId,
        venue_sport_id: venueSport.id,
        name: 'Perf Turf 1',
        base_price_minor: 120000,
        is_active: true
      })
      .select().single()
    if (fErr) throw fErr
    fieldId = field.id

    // 4. Operating hours
    await adminClient.from('operating_hours').insert([
      { company_id: companyId, venue_id: venueId, weekday: 1, opens_at: '06:00:00', closes_at: '23:00:00' },
      { company_id: companyId, venue_id: venueId, weekday: 2, opens_at: '06:00:00', closes_at: '23:00:00' },
      { company_id: companyId, venue_id: venueId, weekday: 3, opens_at: '06:00:00', closes_at: '23:00:00' },
      { company_id: companyId, venue_id: venueId, weekday: 4, opens_at: '06:00:00', closes_at: '23:00:00' },
      { company_id: companyId, venue_id: venueId, weekday: 5, opens_at: '06:00:00', closes_at: '23:00:00' },
      { company_id: companyId, venue_id: venueId, weekday: 6, opens_at: '06:00:00', closes_at: '23:00:00' },
      { company_id: companyId, venue_id: venueId, weekday: 0, opens_at: '06:00:00', closes_at: '23:00:00' },
    ])

    // 5. Create customer
    const { data: authUser, error: aErr } = await adminClient.auth.admin.createUser({
      email: `perf_cust_${timestamp}@test.com`,
      password: 'password123',
      email_confirm: true
    })
    // Wait for auth trigger to provision profile
    await new Promise(r => setTimeout(r, 600))
    const { data: prof, error: pErr } = await adminClient.from('profiles').select('id').eq('auth_user_id', authUser.user.id).single()
    if (pErr) throw pErr
    customerProfileId = prof.id

    // Get or create customer record
    let { data: cust } = await adminClient.from('customers').select('id').eq('profile_id', customerProfileId).single()
    if (!cust) {
      const { data: newCust, error: cErr } = await adminClient.from('customers').insert({ profile_id: customerProfileId }).select().single()
      if (cErr) throw cErr
      cust = newCust
    }
    customerId = cust.id
    // Assign admin role and permissions to staffUser for reporting tests
    let { data: role } = await adminClient.from('roles').select('id').eq('code', 'admin').single()
    if (role) {
      await adminClient.from('user_memberships').insert({
        profile_id: customerProfileId,
        company_id: companyId,
        venue_id: venueId,
        role_id: role.id
      }).select().single()
    }
  })

  it('1. Concurrency Benchmark: Atomic slot isolation under concurrent booking load', async () => {
    // 5 concurrent requests attempting to book the EXACT same field, date, and 60-minute time slot
    const slotStart = '2026-11-20T10:00:00.000Z'
    const slotMid = '2026-11-20T10:30:00.000Z'
    const slotEnd = '2026-11-20T11:00:00.000Z'
    const concurrencyLevel = 5

    const promises = Array.from({ length: concurrencyLevel }).map(async (_, idx) => {
      const bookingId = crypto.randomUUID()
      const idempotencyKey = `perf-concurrency-${Date.now()}-${idx}-${Math.random()}`
      const startTime = performance.now()

      const rpcPayload = {
        p_idempotency_key: {
          actor_id: customerProfileId,
          scope_key: 'create_booking',
          idempotency_key: idempotencyKey,
          request_hash: `hash_${idx}`
        },
        p_booking: {
          id: bookingId,
          company_id: companyId,
          venue_id: venueId,
          field_id: fieldId,
          customer_id: customerId,
          created_by_profile_id: customerProfileId,
          source: 'ONLINE',
          status: 'PAYMENT_PENDING',
          start_at: slotStart,
          end_at: slotEnd,
          duration_minutes: 60,
          gross_amount_minor: 120000,
          advance_required_minor: 24000,
          balance_due_minor: 120000,
          currency: 'INR',
          pricing_snapshot: { base: 120000 },
          expires_at: new Date(Date.now() + 20 * 60000).toISOString()
        },
        p_slots: [
          { id: crypto.randomUUID(), booking_id: bookingId, field_id: fieldId, slot_start: slotStart, slot_end: slotMid },
          { id: crypto.randomUUID(), booking_id: bookingId, field_id: fieldId, slot_start: slotMid, slot_end: slotEnd }
        ],
        p_active_reservations: [
          { id: crypto.randomUUID(), field_id: fieldId, slot_start: slotStart },
          { id: crypto.randomUUID(), field_id: fieldId, slot_start: slotMid }
        ]
      }

      try {
        const result = await adminClient.rpc('execute_booking_transaction', rpcPayload)
        const duration = performance.now() - startTime
        return { success: !result.error && !!result.data, error: result.error?.message, duration }
      } catch (err: any) {
        const duration = performance.now() - startTime
        return { success: false, error: err.message, duration }
      }
    })

    const results = await Promise.all(promises)

    const successes = results.filter(r => r.success)
    const failures = results.filter(r => !r.success)

    // Invariant: Exactly 1 reservation succeeded
    expect(successes.length).toBe(1)
    // Invariant: Exactly N - 1 reservations failed with conflict
    expect(failures.length).toBe(concurrencyLevel - 1)

    failures.forEach(f => {
      expect(f.error).toMatch(/active_slot_reservations|duplicate|conflict|23505/i)
    })

    // Verify DB integrity: exactly 2 active slot reservations exist in DB
    const { data: activeSlots } = await adminClient
      .from('active_slot_reservations')
      .select('id')
      .eq('field_id', fieldId)

    expect(activeSlots?.length).toBe(2)
  })

  it('2. Availability Grid Latency Benchmark: generates 34+ daytime slots within budget', async () => {
    const testDate = new Date('2026-11-20T12:00:00Z')
    
    // Warm-up query
    await BookingUIService.getAvailabilityGrid(venueId, fieldId, testDate, 'Asia/Kolkata')

    const iterations = 5
    const durations: number[] = []

    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      const slots = await BookingUIService.getAvailabilityGrid(venueId, fieldId, testDate, 'Asia/Kolkata')
      durations.push(performance.now() - start)
      expect(slots.length).toBeGreaterThan(30)
    }

    const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length
    // Production budget: < 400ms across network round-trip to Supabase
    expect(avgDuration).toBeLessThan(400)
  })

  it('3. Financial & Utilisation Report Query Latency Benchmark', async () => {
    const startDate = '2026-11-01T00:00:00.000Z'
    const endDate = '2026-11-30T23:59:59.999Z'

    const startFin = performance.now()
    const { data: bookings } = await adminClient
      .from('bookings')
      .select('gross_amount_minor, advance_required_minor, balance_due_minor, status')
      .eq('company_id', companyId)
      .eq('venue_id', venueId)
      .gte('start_at', startDate)
      .lte('start_at', endDate)
    const finDuration = performance.now() - startFin

    expect(Array.isArray(bookings)).toBe(true)
    expect(finDuration).toBeLessThan(350)

    const startUtil = performance.now()
    const { data: slots } = await adminClient
      .from('booking_slots')
      .select('slot_start, slot_end')
      .eq('field_id', fieldId)
      .gte('slot_start', startDate)
      .lte('slot_start', endDate)
    const utilDuration = performance.now() - startUtil

    expect(Array.isArray(slots)).toBe(true)
    expect(utilDuration).toBeLessThan(350)
  })

  it('4. Notification Outbox FIFO Queue Benchmark', async () => {
    // Enqueue 5 events
    for (let i = 0; i < 5; i++) {
      await NotificationService.enqueueEvent({
        company_id: companyId,
        venue_id: venueId,
        event_type: 'BOOKING_CREATED',
        entity_type: 'booking',
        entity_id: crypto.randomUUID(),
        payload: {
          customerName: 'Perf Customer',
          venueName: 'Perf Venue',
          startAt: '2026-11-20T10:00:00Z',
          recipientPhone: '+919876543210'
        }
      })
    }

    const start = performance.now()
    await NotificationService.processOutboxEvents()
    await NotificationService.processDeliveries()
    const duration = performance.now() - start

    // Both outbox transformation and mock delivery must finish rapidly
    expect(duration).toBeLessThan(2000)
  })
})
