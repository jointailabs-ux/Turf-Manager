import { describe, it, expect, vi } from 'vitest'
import { Observability, scrubSensitiveData } from '@/lib/observability'

describe('Observability & Sensitive Data Sanitization', () => {
  it('redacts sensitive keys including password, token, UTR, and secrets', () => {
    const rawData = {
      user: {
        id: 'u-123',
        password: 'SuperSecretPassword!',
        email: 'user@example.com',
      },
      payment: {
        utr: 'UTR99887766',
        transactionReference: 'REF123456',
        amountMinor: 50000,
        proofUrl: 'https://example.com/signed-proof?token=abc',
      },
      secretKey: 'my-secret',
    }

    const sanitized = scrubSensitiveData(rawData) as Record<string, any>

    expect(sanitized.user.id).toBe('u-123')
    expect(sanitized.user.email).toBe('user@example.com')
    expect(sanitized.user.password).toBe('[REDACTED]')

    expect(sanitized.payment.amountMinor).toBe(50000)
    expect(sanitized.payment.utr).toBe('[REDACTED]')
    expect(sanitized.payment.transactionReference).toBe('[REDACTED]')
    expect(sanitized.payment.proofUrl).toBe('[REDACTED]')
    expect(sanitized.secretKey).toBe('[REDACTED]')
  })

  it('captures errors fail-safely without throwing', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    
    expect(() => {
      Observability.captureError(new Error('Test error'), {
        bookingId: 'bk-123',
        metadata: { password: 'leak-attempt' },
      })
    }).not.toThrow()

    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
