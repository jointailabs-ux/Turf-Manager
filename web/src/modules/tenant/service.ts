import { createClient } from '@/lib/supabase/server'
import { AuthService } from '@/modules/auth/service'

export interface Company {
  id: string
  name: string
  slug: string
  currency: string
  default_timezone: string
  is_active: boolean
}

export interface Venue {
  id: string
  company_id: string
  name: string
  slug: string
  timezone: string
  is_active: boolean
}

export class TenantService {
  /**
   * Retrieves all companies the authenticated user is authorized to access.
   * Relies on the database RLS policies for enforcement.
   */
  static async getAssignedCompanies(): Promise<Company[]> {
    await AuthService.requireUser()
    const supabase = await createClient()
    
    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .eq('is_active', true)
      
    if (error) {
      throw new Error(`Failed to fetch companies: ${error.message}`)
    }
    
    return data as Company[]
  }

  /**
   * Retrieves all venues the authenticated user is authorized to access within a specific company.
   * Rejects if the user does not have access.
   */
  static async getAssignedVenues(companyId: string): Promise<Venue[]> {
    await AuthService.requireUser()
    const supabase = await createClient()
    
    const { data, error } = await supabase
      .from('venues')
      .select('*')
      .eq('company_id', companyId)
      .eq('is_active', true)
      
    if (error) {
      throw new Error(`Failed to fetch venues: ${error.message}`)
    }
    
    return data as Venue[]
  }
}
