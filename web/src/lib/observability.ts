/**
 * Production Observability & Error Tracking Module
 * 
 * Provides fail-safe, structured error tracking and logging with automatic
 * sanitization of sensitive fields (passwords, tokens, UTRs, proof URLs).
 * Designed to integrate cleanly with external APMs (e.g. Sentry) without
 * blocking server request processing or exposing credentials.
 */

const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'secret',
  'authorization',
  'apikey',
  'service_role_key',
  'supabase_service_role_key',
  'transactionreference',
  'transaction_reference',
  'utr',
  'proofurl',
  'signedurl',
  'cookie',
])

/**
 * Recursively scrubs sensitive values from log metadata.
 */
export function scrubSensitiveData(data: unknown, depth = 0): unknown {
  if (depth > 5 || data === null || data === undefined) return data
  if (typeof data !== 'object') return data

  if (Array.isArray(data)) {
    return data.map(item => scrubSensitiveData(item, depth + 1))
  }

  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase()
    if (SENSITIVE_KEYS.has(lowerKey) || lowerKey.includes('secret') || lowerKey.includes('password')) {
      sanitized[key] = '[REDACTED]'
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = scrubSensitiveData(value, depth + 1)
    } else {
      sanitized[key] = value
    }
  }
  return sanitized
}

export interface ErrorContext {
  module?: string
  action?: string
  companyId?: string
  venueId?: string
  bookingId?: string
  userId?: string
  metadata?: Record<string, unknown>
}

export class Observability {
  /**
   * Captures and logs application errors with sanitized diagnostic context.
   */
  static captureError(error: unknown, context: ErrorContext = {}): void {
    try {
      const sanitizedContext = scrubSensitiveData(context)
      const errorMessage = error instanceof Error ? error.message : String(error)
      const errorStack = error instanceof Error ? error.stack : undefined

      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'ERROR',
        message: errorMessage,
        stack: process.env.NODE_ENV === 'production' ? undefined : errorStack,
        context: sanitizedContext,
      }))

      // External APM Hook (e.g. Sentry.captureException) can be mounted here non-blockingly:
      // if (process.env.SENTRY_DSN) { Sentry.captureException(error, { extra: sanitizedContext }) }
    } catch {
      // Fail-safe: error tracking must never crash the request flow
      console.error('[Observability Fallback]', error)
    }
  }

  /**
   * Logs structured informational events with sensitive data scrubbing.
   */
  static logInfo(message: string, context: Record<string, unknown> = {}): void {
    try {
      const sanitized = scrubSensitiveData(context)
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'INFO',
        message,
        context: sanitized,
      }))
    } catch {
      console.log(message)
    }
  }
}
