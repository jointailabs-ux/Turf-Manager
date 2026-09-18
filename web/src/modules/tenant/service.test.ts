import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TenantService } from './service'
import { createClient } from '@/lib/supabase/server'
import { AuthService } from '@/modules/auth/service'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/modules/auth/service', () => ({
  AuthService: {
    requireUser: vi.fn(),
  }
}))

describe('TenantService (Phase 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should fetch assigned companies for authenticated user', async () => {
    vi.mocked(AuthService.requireUser).mockResolvedValue({ id: 'user-1' } as never)
    
    const mockCompanies = [{ id: 'comp-1', name: 'Test Co' }]
    
    const mockSelect = vi.fn().mockReturnThis()
    const mockEq = vi.fn().mockResolvedValue({ data: mockCompanies, error: null })
    
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: mockSelect,
        eq: mockEq,
      })
    }
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never)

    const companies = await TenantService.getAssignedCompanies()
    
    expect(AuthService.requireUser).toHaveBeenCalled()
    expect(mockSupabase.from).toHaveBeenCalledWith('companies')
    expect(companies).toEqual(mockCompanies)
  })

  it('should fetch assigned venues for a specific company', async () => {
    vi.mocked(AuthService.requireUser).mockResolvedValue({ id: 'user-1' } as never)
    
    const mockVenues = [{ id: 'venue-1', name: 'Test Venue' }]
    
    const mockSelect = vi.fn().mockReturnThis()
    const mockEq2 = vi.fn().mockResolvedValue({ data: mockVenues, error: null })
    
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: mockSelect,
        eq: vi.fn().mockImplementation((field) => {
          if (field === 'company_id') return { eq: mockEq2 }
          return { eq: mockEq2 }
        })
      })
    }
    // We override the chaining specifically for the test
    mockSupabase.from = vi.fn().mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () => Promise.resolve({ data: mockVenues, error: null })
        })
      })
    })

    vi.mocked(createClient).mockResolvedValue(mockSupabase as never)

    const venues = await TenantService.getAssignedVenues('comp-1')
    
    expect(AuthService.requireUser).toHaveBeenCalled()
    expect(mockSupabase.from).toHaveBeenCalledWith('venues')
    expect(venues).toEqual(mockVenues)
  })
})
