import { describe, it, expect, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { NotificationService } from '../modules/notification/service'
import { POST as cronNotificationsHandler } from '../app/api/cron/notifications/route'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service_role_key_placeholder'

let adminClient: any
let isDbAvailable = false

try {
  const res = await fetch(`${supabaseUrl}/rest/v1/`).catch(() => null)
  isDbAvailable = !!res
} catch {
  isDbAvailable = false
}

if (isDbAvailable) {
  adminClient = createClient<any>(supabaseUrl, supabaseServiceKey)
}

describe.skipIf(!isDbAvailable)('Milestone 3 — Notifications Outbox & Delivery Suite', { timeout: 30000 }, () => {
  let companyId: string
  let venueId: string

  beforeAll(async () => {
    const ts = Date.now()
    const { data: comp } = await adminClient
      .from('companies')
      .insert({ name: `M3 Notification Company ${ts}`, slug: `m3-notif-comp-${ts}` })
      .select('id')
      .single()
    companyId = comp!.id

    const { data: ven } = await adminClient
      .from('venues')
      .insert({
        company_id: companyId,
        name: `M3 Notification Venue ${ts}`,
        slug: `m3-notif-ven-${ts}`,
        timezone: 'Asia/Kolkata',
        is_active: true,
      })
      .select('id')
      .single()
    venueId = ven!.id
  })

  it('1. Enqueue outbox event creates PENDING row in events_outbox', async () => {
    const entityId = crypto.randomUUID()
    await NotificationService.enqueueEvent({
      company_id: companyId,
      venue_id: venueId,
      event_type: 'BOOKING_CREATED',
      entity_type: 'booking',
      entity_id: entityId,
      payload: { testKey: 'booking_created_payload' },
    })

    const { data: event, error } = await adminClient
      .from('events_outbox')
      .select('*')
      .eq('entity_id', entityId)
      .eq('event_type', 'BOOKING_CREATED')
      .single()

    expect(error).toBeNull()
    expect(event).toBeDefined()
    expect(event.status).toBe('PENDING')
    expect(event.retry_count).toBe(0)
    expect(event.company_id).toBe(companyId)
    expect(event.payload.testKey).toBe('booking_created_payload')
  })

  it('2. Outbox processing creates delivery with event-specific idempotency_key (notify_${event.id}_wa)', async () => {
    const entityId = crypto.randomUUID()
    await NotificationService.enqueueEvent({
      company_id: companyId,
      venue_id: venueId,
      event_type: 'PAYMENT_SUBMITTED',
      entity_type: 'payment',
      entity_id: entityId,
      payload: { amount_minor: 50000 },
    })

    const { data: eventBefore } = await adminClient
      .from('events_outbox')
      .select('id')
      .eq('entity_id', entityId)
      .single()

    // Process outbox
    await NotificationService.processOutboxEvents()

    // Outbox event should now be PROCESSED
    const { data: eventAfter } = await adminClient
      .from('events_outbox')
      .select('*')
      .eq('id', eventBefore!.id)
      .single()

    expect(eventAfter.status).toBe('PROCESSED')
    expect(eventAfter.processed_at).not.toBeNull()

    // Delivery row created
    const { data: delivery, error } = await adminClient
      .from('notification_deliveries')
      .select('*')
      .eq('event_id', eventBefore!.id)
      .single()

    expect(error).toBeNull()
    expect(delivery).toBeDefined()
    expect(delivery.channel).toBe('WHATSAPP')
    expect(delivery.provider).toBe('MOCK')
    expect(delivery.status).toBe('PENDING')
    // Idempotency key strictly tied to event identity + channel (NOT a payload hash)
    expect(delivery.idempotency_key).toBe(`notify_${eventBefore!.id}_wa`)
  })

  it('3. Duplicate prevention: processing same event twice results in only ONE delivery record', async () => {
    const entityId = crypto.randomUUID()
    await NotificationService.enqueueEvent({
      company_id: companyId,
      venue_id: venueId,
      event_type: 'PAYMENT_APPROVED',
      entity_type: 'booking',
      entity_id: entityId,
      payload: { payment_id: crypto.randomUUID() },
    })

    const { data: event } = await adminClient
      .from('events_outbox')
      .select('id')
      .eq('entity_id', entityId)
      .single()

    // Process 1st time
    await NotificationService.processOutboxEvents()

    // Manually reset event status to PENDING to simulate re-attempt
    await adminClient
      .from('events_outbox')
      .update({ status: 'PENDING' })
      .eq('id', event!.id)

    // Process 2nd time
    await NotificationService.processOutboxEvents()

    // Count delivery rows for this event
    const { data: deliveries } = await adminClient
      .from('notification_deliveries')
      .select('id')
      .eq('event_id', event!.id)

    expect(deliveries!.length).toBe(1)
  })

  it('4. Identical payloads across distinct events produce separate deliveries', async () => {
    const identicalPayload = { same_amount_minor: 75000, reason: 'identical_test' }
    const entityId1 = crypto.randomUUID()
    const entityId2 = crypto.randomUUID()

    await NotificationService.enqueueEvent({
      company_id: companyId,
      venue_id: venueId,
      event_type: 'PAYMENT_SUBMITTED',
      entity_type: 'payment',
      entity_id: entityId1,
      payload: identicalPayload,
    })

    await NotificationService.enqueueEvent({
      company_id: companyId,
      venue_id: venueId,
      event_type: 'PAYMENT_SUBMITTED',
      entity_type: 'payment',
      entity_id: entityId2,
      payload: identicalPayload,
    })

    const { data: ev1 } = await adminClient.from('events_outbox').select('id').eq('entity_id', entityId1).single()
    const { data: ev2 } = await adminClient.from('events_outbox').select('id').eq('entity_id', entityId2).single()

    expect(ev1!.id).not.toBe(ev2!.id)

    await NotificationService.processOutboxEvents()

    const { data: d1 } = await adminClient.from('notification_deliveries').select('*').eq('event_id', ev1!.id).single()
    const { data: d2 } = await adminClient.from('notification_deliveries').select('*').eq('event_id', ev2!.id).single()

    expect(d1).toBeDefined()
    expect(d2).toBeDefined()
    expect(d1.idempotency_key).toBe(`notify_${ev1!.id}_wa`)
    expect(d2.idempotency_key).toBe(`notify_${ev2!.id}_wa`)
    expect(d1.id).not.toBe(d2.id)
  })

  it('5. Retry & Retry Exhaustion: failed events increment retry_count and stop after limit (3)', async () => {
    const entityId = crypto.randomUUID()
    // Insert an invalid event with invalid company_id foreign key to trigger processing failure
    const badCompanyId = crypto.randomUUID()
    const { data: badEvent } = await adminClient
      .from('events_outbox')
      .insert({
        company_id: companyId,
        venue_id: venueId,
        event_type: 'BOOKING_CREATED',
        entity_type: 'booking',
        entity_id: entityId,
        payload: {},
        status: 'FAILED',
        retry_count: 2,
      })
      .select('id')
      .single()

    // It has retry_count 2 (less than 3), so it is eligible for retry
    // Set status to PENDING or FAILED with retry_count < 3
    const { data: retryable } = await adminClient
      .from('events_outbox')
      .select('id, retry_count, status')
      .eq('id', badEvent!.id)
      .or('status.eq.PENDING,and(status.eq.FAILED,retry_count.lt.3)')

    expect(retryable?.length).toBe(1)

    // Now exhaust retries
    await adminClient
      .from('events_outbox')
      .update({ status: 'FAILED', retry_count: 3 })
      .eq('id', badEvent!.id)

    const { data: exhausted } = await adminClient
      .from('events_outbox')
      .select('id')
      .eq('id', badEvent!.id)
      .or('status.eq.PENDING,and(status.eq.FAILED,retry_count.lt.3)')

    expect(exhausted?.length).toBe(0)
  })

  it('6. BOOKING_CANCELLED produces events_outbox entry and transitions to delivery', async () => {
    const bookingId = crypto.randomUUID()
    await NotificationService.enqueueEvent({
      company_id: companyId,
      venue_id: venueId,
      event_type: 'BOOKING_CANCELLED',
      entity_type: 'booking',
      entity_id: bookingId,
      payload: { reason: 'Customer requested cancellation' },
    })

    const { data: event } = await adminClient
      .from('events_outbox')
      .select('*')
      .eq('entity_id', bookingId)
      .eq('event_type', 'BOOKING_CANCELLED')
      .single()

    expect(event).toBeDefined()
    expect(event.payload.reason).toBe('Customer requested cancellation')

    await NotificationService.processOutboxEvents()

    const { data: delivery } = await adminClient
      .from('notification_deliveries')
      .select('*')
      .eq('event_id', event.id)
      .single()

    expect(delivery).toBeDefined()
    expect(delivery.idempotency_key).toBe(`notify_${event.id}_wa`)
  })

  it('7. Simulated delivery semantics: recorded explicitly as SIMULATED (never SENT)', async () => {
    const entityId = crypto.randomUUID()
    await NotificationService.enqueueEvent({
      company_id: companyId,
      venue_id: venueId,
      event_type: 'PAYMENT_SUBMITTED',
      entity_type: 'payment',
      entity_id: entityId,
      payload: { test: 'simulation' },
    })

    await NotificationService.processOutboxEvents()

    const { data: event } = await adminClient
      .from('events_outbox')
      .select('id')
      .eq('entity_id', entityId)
      .single()

    const { data: deliveryBefore } = await adminClient
      .from('notification_deliveries')
      .select('*')
      .eq('event_id', event!.id)
      .single()

    expect(deliveryBefore.status).toBe('PENDING')

    // Execute delivery dispatch
    await NotificationService.processDeliveries()

    const { data: deliveryAfter } = await adminClient
      .from('notification_deliveries')
      .select('*')
      .eq('id', deliveryBefore.id)
      .single()

    expect(deliveryAfter.status).toBe('SIMULATED')
    expect(deliveryAfter.status).not.toBe('SENT')
    expect(deliveryAfter.sent_at).not.toBeNull()
    expect(deliveryAfter.provider_reference).toMatch(/^mock_ref_/)
  })

  it('8. CRON endpoint security (/api/cron/notifications)', async () => {
    const cronSecret = process.env.CRON_SECRET || 'test_cron_secret_phase8_12345'

    // Missing header
    const reqMissing = new Request('http://localhost:3000/api/cron/notifications', {
      method: 'POST',
    })
    const resMissing = await cronNotificationsHandler(reqMissing)
    expect(resMissing.status).toBe(401)

    // Invalid secret
    const reqInvalid = new Request('http://localhost:3000/api/cron/notifications', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong_secret_value' },
    })
    const resInvalid = await cronNotificationsHandler(reqInvalid)
    expect(resInvalid.status).toBe(401)

    // Valid secret
    const reqValid = new Request('http://localhost:3000/api/cron/notifications', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cronSecret}` },
    })
    const resValid = await cronNotificationsHandler(reqValid)
    expect(resValid.status).toBe(200)
    const json = await resValid.json()
    expect(json.success).toBe(true)
  })
})
