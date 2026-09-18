import { createClient as createAdminClient } from '@supabase/supabase-js'
import { MembershipService } from '@/modules/membership/service'

/**
 * Audit event types for Phase 6 operations.
 * Embed in SQL RPCs where transactional guarantees are required.
 * For Node.js-layer events, AuditService.emit() throws on failure — never swallowed silently.
 */
export type AuditEventType =
  // Bookings (cancel/complete embedded in SQL RPCs — transactional)
  | 'BOOKING_CANCELLED'
  | 'BOOKING_COMPLETED'
  | 'BOOKING_MANUAL_CREATED'
  // Payments (balance-recording embedded in SQL RPC — transactional)
  | 'PAYMENT_BALANCE_RECORDED'
  // Staff management (Node.js layer — observable failures, never silent)
  | 'STAFF_CREATED'
  | 'STAFF_ROLE_CHANGED'
  | 'STAFF_ACTIVATED'
  | 'STAFF_DEACTIVATED'
  | 'STAFF_REVOKED'
  // Customer management (Node.js layer)
  | 'CUSTOMER_CREATED'
  | 'CUSTOMER_UPDATED'

export interface AuditEvent {
  company_id: string
  venue_id?: string | null
  actor_profile_id: string
  event_type: AuditEventType
  entity_type: string
  entity_id?: string | null
  metadata?: Record<string, unknown>
}

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  )
}

export class AuditService {
  /**
   * Emits an audit event and THROWS on failure.
   * Use for critical Node.js-layer events where the failure must be observable.
   * Callers should catch, log with console.error('[AUDIT CRITICAL]'), and decide whether to re-throw.
   *
   * NOTE: cancel/complete/balance-recording audit events are handled inside SQL RPCs
   * and do NOT need to call this method from Node.js.
   */
  static async emit(event: AuditEvent): Promise<void> {
    const adminClient = getAdminClient()
    const { error } = await adminClient.from('audit_logs').insert({
      company_id: event.company_id,
      venue_id: event.venue_id ?? null,
      actor_profile_id: event.actor_profile_id,
      event_type: event.event_type,
      entity_type: event.entity_type,
      entity_id: event.entity_id ?? null,
      metadata: event.metadata ?? null,
    })
    if (error) {
      // Failures are never silently swallowed — always throws
      throw new Error(`[AUDIT] Failed to write event ${event.event_type}: ${error.message}`)
    }
  }

  /**
   * Emits an audit event and logs but does NOT re-throw on failure.
   * Use only for lower-criticality events (e.g. CUSTOMER_CREATED) where the
   * primary operation should still succeed even if audit write fails.
   * Failures are logged prominently and never silently disappear.
   */
  static async emitSafe(event: AuditEvent): Promise<void> {
    try {
      await AuditService.emit(event)
    } catch (err) {
      console.error('[AUDIT CRITICAL] Audit event write failed — event NOT silently swallowed:', {
        event_type: event.event_type,
        entity_type: event.entity_type,
        entity_id: event.entity_id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /**
   * Fetches paginated audit logs for a given company and venue.
   * Requires 'audit.view' permission.
   */
  static async getAuditLogs(
    companyId: string,
    venueId: string,
    options: {
      page?: number
      pageSize?: number
      eventType?: string
      entityType?: string
    } = {}
  ) {
    const hasAccess = await MembershipService.hasPermission(companyId, venueId, 'audit.view')
    if (!hasAccess) throw new Error('Unauthorized: audit.view permission required.')

    const { page = 1, pageSize = 50, eventType, entityType } = options
    const offset = (page - 1) * pageSize

    const adminClient = getAdminClient()
    let query = adminClient
      .from('audit_logs')
      .select('id, event_type, entity_type, entity_id, metadata, created_at, profiles!audit_logs_actor_profile_id_fkey(full_name)', { count: 'exact' })
      .eq('company_id', companyId)

    // Optional filters
    if (venueId) query = query.eq('venue_id', venueId)
    if (eventType) query = query.eq('event_type', eventType)
    if (entityType) query = query.eq('entity_type', entityType)

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1)

    if (error) throw new Error(`[AUDIT] Failed to fetch audit logs: ${error.message}`)

    return {
      items: (data ?? []).map((row) => {
        const r = row as unknown as { id: string, event_type: AuditEventType, entity_type: string, entity_id: string | null, metadata: Record<string, unknown> | null, created_at: string, profiles: { full_name: string | null } | null }
        return {
          id: r.id,
          eventType: r.event_type,
          entityType: r.entity_type,
          entityId: r.entity_id,
          metadata: r.metadata,
          createdAt: r.created_at,
          actorName: r.profiles?.full_name ?? 'Unknown',
        }
      }),
      total: count ?? 0
    }
  }
}
