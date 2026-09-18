import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AuditService } from './service'
import { createClient } from '@supabase/supabase-js'

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}))

describe('AuditService', () => {
  let mockInsert: ReturnType<typeof vi.fn>
  let mockFrom: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockInsert = vi.fn()
    mockFrom = vi.fn().mockReturnValue({ insert: mockInsert })
    vi.mocked(createClient).mockReturnValue({ from: mockFrom } as never)
  })

  const baseEvent = {
    company_id: 'comp-1',
    venue_id: 'venue-1',
    actor_profile_id: 'profile-1',
    event_type: 'STAFF_CREATED' as const,
    entity_type: 'staff',
    entity_id: 'membership-1',
    metadata: { role_id: 'role-1' },
  }

  describe('emit()', () => {
    it('inserts an audit log record', async () => {
      mockInsert.mockResolvedValue({ error: null })

      await AuditService.emit(baseEvent)

      expect(mockFrom).toHaveBeenCalledWith('audit_logs')
      expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
        company_id: 'comp-1',
        actor_profile_id: 'profile-1',
        event_type: 'STAFF_CREATED',
        entity_type: 'staff',
      }))
    })

    it('throws on database error — never swallows silently', async () => {
      mockInsert.mockResolvedValue({ error: { message: 'DB connection failed' } })

      await expect(AuditService.emit(baseEvent)).rejects.toThrow('Failed to write event STAFF_CREATED')
    })

    it('includes metadata in the insert', async () => {
      mockInsert.mockResolvedValue({ error: null })

      await AuditService.emit({ ...baseEvent, metadata: { role_id: 'role-x', prev: 'role-y' } })

      expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
        metadata: { role_id: 'role-x', prev: 'role-y' },
      }))
    })
  })

  describe('emitSafe()', () => {
    it('does not throw on database error', async () => {
      mockInsert.mockResolvedValue({ error: { message: 'DB error' } })
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await expect(AuditService.emitSafe(baseEvent)).resolves.not.toThrow()

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[AUDIT CRITICAL]'),
        expect.anything()
      )
      consoleSpy.mockRestore()
    })

    it('succeeds when DB write succeeds', async () => {
      mockInsert.mockResolvedValue({ error: null })

      await expect(AuditService.emitSafe(baseEvent)).resolves.not.toThrow()
    })

    it('logs with AUDIT CRITICAL prefix on failure — never disappears silently', async () => {
      mockInsert.mockResolvedValue({ error: { message: 'Network timeout' } })
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await AuditService.emitSafe(baseEvent)

      expect(consoleSpy).toHaveBeenCalledWith(
        '[AUDIT CRITICAL] Audit event write failed — event NOT silently swallowed:',
        expect.objectContaining({ event_type: 'STAFF_CREATED' })
      )
      consoleSpy.mockRestore()
    })
  })
})
