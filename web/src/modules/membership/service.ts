import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { AuthService } from '@/modules/auth/service'

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  )
}

export interface UserMembership {
  id: string
  profile_id: string
  company_id: string
  venue_id: string | null
  role_id: string
  is_active: boolean
}

export class MembershipService {
  /**
   * Retrieves all active memberships for the authenticated user.
   */
  static async getMyMemberships(): Promise<UserMembership[]> {
    await AuthService.requireUser()
    const supabase = await createClient()
    
    const { data, error } = await supabase
      .from('user_memberships')
      .select('*')
      .eq('is_active', true)
      
    if (error) {
      throw new Error(`Failed to retrieve memberships: ${error.message}`)
    }

    return (data || []) as UserMembership[]
  }

  /**
   * Checks if user has a specific role in a company or venue scope.
   */
  static async hasAccess(companyId: string, venueId: string, allowedRoles?: string[]): Promise<boolean> {
    const memberships = await this.getMyMemberships()
    
    // An active membership on the company (with venue_id NULL) or exact venue_id match is required
    const relevant = memberships.filter(m => m.company_id === companyId && (!m.venue_id || m.venue_id === venueId))
    if (relevant.length === 0) return false

    if (!allowedRoles || allowedRoles.length === 0) return true

    // Look up the roles from the DB for these role_ids
    const supabase = await createClient()
    const roleIds = relevant.map(m => m.role_id)
    
    const { data: roles } = await supabase
      .from('roles')
      .select('code')
      .in('id', roleIds)

    if (!roles) return false

    return roles.some(r => allowedRoles.includes(r.code))
  }

  /**
   * Specifically checks for a granular permission, falling back to true if the user is an admin or manager.
   */
  static async hasPermission(companyId: string, venueId: string, permissionCode: string): Promise<boolean> {
    const user = await AuthService.requireUser()
    const adminClient = getAdminClient()

    // Look up the profile by auth_user_id first (profile.id != user.id)
    const { data: profile } = await adminClient
      .from('profiles')
      .select('id')
      .eq('auth_user_id', user.id)
      .single()

    if (!profile) {
      return false
    }

    // Query memberships joined with roles
    const { data: memberships } = await adminClient
      .from('user_memberships')
      .select(`
        company_id, venue_id, role_id,
        roles!inner(code)
      `)
      .eq('profile_id', profile.id)
      .eq('is_active', true)
      .eq('company_id', companyId)
    
    if (!memberships || memberships.length === 0) return false

    // Find applicable membership (venue specific or company wide)
    const membership = memberships.find(m => !m.venue_id || m.venue_id === venueId)
    if (!membership) return false

    const rolesData = membership.roles as unknown
    const roleCode = Array.isArray(rolesData)
      ? (rolesData[0] as { code?: string } | null)?.code
      : (rolesData as { code?: string } | null)?.code
    
    // Admin/Manager inherently have all permissions per V1 requirements
    if (roleCode === 'admin' || roleCode === 'manager') return true

    // We fetch role_permissions separately to avoid inner join issues
    const { data: rolePerms } = await adminClient
      .from('role_permissions')
      .select('permissions!inner(code)')
      .in('role_id', memberships.map(m => m.role_id))

    // Check specific permission
    if (rolePerms && Array.isArray(rolePerms)) {
      return rolePerms.some(p => {
        const perm = p.permissions as unknown
        if (Array.isArray(perm)) {
          return perm.some((item: { code?: string }) => item?.code === permissionCode)
        }
        return (perm as { code?: string } | null)?.code === permissionCode
      })
    }

    return false
  }
}
