import { createClient as createAdminClient } from '@supabase/supabase-js'

export type OutboxEventType =
  | 'BOOKING_CREATED'
  | 'PAYMENT_SUBMITTED'
  | 'PAYMENT_APPROVED'
  | 'PAYMENT_REJECTED'
  | 'BOOKING_EXPIRED'
  | 'BOOKING_CANCELLED'

export interface NotificationEvent {
  company_id: string
  venue_id?: string | null
  event_type: OutboxEventType
  entity_type: string
  entity_id: string
  payload: Record<string, unknown>
}

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  )
}

export class NotificationService {
  /**
   * Enqueues a business event into the outbox for asynchronous notification processing.
   */
  static async enqueueEvent(event: NotificationEvent): Promise<void> {
    const adminClient = getAdminClient()
    const { error } = await adminClient.from('events_outbox').insert({
      company_id: event.company_id,
      venue_id: event.venue_id ?? null,
      event_type: event.event_type,
      entity_type: event.entity_type,
      entity_id: event.entity_id,
      payload: event.payload,
      status: 'PENDING',
    })
    
    if (error) {
      console.error('[NOTIFICATION] Failed to enqueue event:', error.message)
      // We don't throw here to avoid blocking the main transaction if outbox fails,
      // but in a fully transactional system, this insert would be part of the SQL RPC.
    }
  }

  /**
   * Processes pending events from the outbox and stages delivery records.
   */
  static async processOutboxEvents(): Promise<void> {
    const adminClient = getAdminClient()
    
    // Fetch pending or failed (retryable) events
    const { data: events, error } = await adminClient
      .from('events_outbox')
      .select('*')
      .or('status.eq.PENDING,and(status.eq.FAILED,retry_count.lt.3)')
      .order('created_at', { ascending: true })
      .limit(50)

    if (error || !events || events.length === 0) return

    await Promise.all(
      events.map(async (event) => {
        try {
          // Stage a delivery record (MOCKED for now)
          // In a real system, we'd look up customer preferences/phone/email
          const { error: deliveryError } = await adminClient.from('notification_deliveries').insert({
            event_id: event.id,
            company_id: event.company_id,
            venue_id: event.venue_id,
            channel: 'WHATSAPP',
            provider: 'MOCK',
            status: 'PENDING',
            idempotency_key: `notify_${event.id}_wa`,
          })

          if (deliveryError && deliveryError.code !== '23505') {
            throw new Error(deliveryError.message)
          }

          // Mark event as processed
          await adminClient.from('events_outbox')
            .update({ status: 'PROCESSED', processed_at: new Date().toISOString() })
            .eq('id', event.id)

        } catch (err) {
          console.error(`[NOTIFICATION] Failed to process event ${event.id}:`, err)
          await adminClient.from('events_outbox')
            .update({ 
              status: 'FAILED', 
              error_message: err instanceof Error ? err.message : String(err),
              retry_count: event.retry_count + 1
            })
            .eq('id', event.id)
        }
      })
    )
  }

  /**
   * Processes pending deliveries via Mock provider
   */
  static async processDeliveries(): Promise<void> {
    const adminClient = getAdminClient()
    
    // Fetch pending or failed (retryable) deliveries
    const { data: deliveries, error } = await adminClient
      .from('notification_deliveries')
      .select('*')
      .or('status.eq.PENDING,status.eq.FAILED')
      .limit(50)

    if (error || !deliveries || deliveries.length === 0) return

    await Promise.all(
      deliveries.map(async (delivery) => {
        try {
          // Mock provider: simulate network request
          await new Promise(resolve => setTimeout(resolve, 20))
          
          // Mark as SIMULATED (do not use SENT as per user instructions)
          await adminClient.from('notification_deliveries')
            .update({ 
              status: 'SIMULATED', 
              sent_at: new Date().toISOString(),
              provider_reference: `mock_ref_${Date.now()}`
            })
            .eq('id', delivery.id)

        } catch (err) {
          console.error(`[NOTIFICATION] Failed to deliver ${delivery.id}:`, err)
          await adminClient.from('notification_deliveries')
            .update({ 
              status: 'FAILED', 
              error_message: err instanceof Error ? err.message : String(err)
            })
            .eq('id', delivery.id)
        }
      })
    )
  }
}
