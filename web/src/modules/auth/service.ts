import { createClient } from '@/lib/supabase/server'
import { User } from '@supabase/supabase-js'

export interface Profile {
  id: string
  auth_user_id: string
  full_name: string | null
  email: string
  phone: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export class AuthService {
  /**
   * Retrieves the currently authenticated Supabase user.
   * Never trusts client-side state. Always resolves via the secure server client.
   */
  static async getUser(): Promise<User | null> {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    
    if (error || !user) {
      return null
    }
    
    return user
  }

  /**
   * Retrieves the global application profile for the authenticated user.
   * The profile bridges the auth identity to the application identity.
   */
  static async getProfile(): Promise<Profile | null> {
    const user = await this.getUser()
    if (!user) return null

    const supabase = await createClient()
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('auth_user_id', user.id)
      .single()

    if (error || !profile) {
      // Note: A trigger creates the profile on signup, so if it's missing here,
      // it indicates an anomaly or eventual consistency delay.
      return null
    }

    return profile as Profile
  }

  /**
   * Asserts that a user is authenticated, otherwise throws an error.
   * Useful for protecting API routes or server actions.
   */
  static async requireUser(): Promise<User> {
    const user = await this.getUser()
    if (!user) {
      throw new Error('Unauthenticated')
    }
    return user
  }
}
