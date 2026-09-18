import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AuthService } from './service'
import { createClient } from '@/lib/supabase/server'

// Mock the Supabase server client
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

describe('AuthService (Phase 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return null when no user is authenticated', async () => {
    const mockSupabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error('Auth session missing') }),
      },
    }
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never)

    const user = await AuthService.getUser()
    expect(user).toBeNull()
  })

  it('should correctly resolve an authenticated user', async () => {
    const mockUser = { id: 'user-123', email: 'test@example.com' }
    const mockSupabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
      },
    }
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never)

    const user = await AuthService.getUser()
    expect(user).toEqual(mockUser)
  })

  it('should throw an error for requireUser when unauthenticated', async () => {
    const mockSupabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error('Missing') }),
      },
    }
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never)

    await expect(AuthService.requireUser()).rejects.toThrow('Unauthenticated')
  })

  it('should resolve a global profile for the authenticated user', async () => {
    const mockUser = { id: 'user-123' }
    const mockProfile = { id: 'prof-456', auth_user_id: 'user-123', email: 'test@example.com' }
    
    const mockSelect = vi.fn().mockReturnThis()
    const mockEq = vi.fn().mockReturnThis()
    const mockSingle = vi.fn().mockResolvedValue({ data: mockProfile, error: null })
    
    const mockSupabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
      },
      from: vi.fn().mockReturnValue({
        select: mockSelect,
        eq: mockEq,
        single: mockSingle,
      })
    }
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never)

    const profile = await AuthService.getProfile()
    expect(profile).toEqual(mockProfile)
    expect(mockSupabase.from).toHaveBeenCalledWith('profiles')
    expect(mockEq).toHaveBeenCalledWith('auth_user_id', 'user-123')
  })

  it('should ensure service-role secrets are not exposed to client NEXT_PUBLIC env', () => {
    // Tests that we don't accidentally prefix SERVICE_ROLE keys with NEXT_PUBLIC
    const publicKeys = Object.keys(process.env).filter(key => key.startsWith('NEXT_PUBLIC_'))
    const hasSecretKey = publicKeys.some(key => key.includes('SERVICE_ROLE') || key.includes('SECRET'))
    expect(hasSecretKey).toBe(false)
  })
})
