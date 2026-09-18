import { createClient as createAdminClient } from '@supabase/supabase-js'
import { MembershipService } from '@/modules/membership/service'
import { AuthService } from '@/modules/auth/service'
import { AuditService } from '@/modules/audit/service'

/**
 * Role hierarchy for anti-escalation enforcement.
 * A staff member may only grant roles with a LOWER level than their own.
 * Admin (3) > Manager (2) > Sub-manager (1).
 * Unknown roles default to level 0 (cannot manage any staff).
 */
const ROLE_HIERARCHY: Record<string, number> = {
  admin: 3,
  manager: 2,
  sub_manager: 1,
}

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  )
}

export interface StaffMember {
  membershipId: string
  profileId: string
  fullName: string | null
  email: string
  phone: string | null
  roleId: string
  roleCode: string
  roleName: string
  companyId: string
  venueId: string | null
  isActive: boolean
  createdAt: string
}

export class StaffService {
  /**
   * Resolves the role code for the actor's membership in the given company/venue.
   * Used for anti-escalation checks.
   */
  private static async getActorRoleLevel(
    actorProfileId: string,
    companyId: string,
    venueId: string
  ): Promise<number> {
    const adminClient = getAdminClient()
    // Try venue-scoped membership first, fallback to company-wide
    const { data: memberships } = await adminClient
      .from('user_memberships')
      .select('role_id, venue_id, roles!inner(code)')
      .eq('profile_id', actorProfileId)
      .eq('company_id', companyId)
      .eq('is_active', true)

    if (!memberships || memberships.length === 0) return 0

    let bestLevel = 0
    for (const m of memberships) {
      const isCompanyWide = m.venue_id === null
      const isVenueMatch = m.venue_id === venueId
      if (isCompanyWide || isVenueMatch) {
        const role = m.roles as unknown as { code: string }
        const level = ROLE_HIERARCHY[role.code] ?? 0
        if (level > bestLevel) bestLevel = level
      }
    }
    return bestLevel
  }

  /**
   * Resolves the role level for a specific role ID.
   */
  private static async getRoleLevelById(roleId: string): Promise<number> {
    const adminClient = getAdminClient()
    const { data: role } = await adminClient
      .from('roles')
      .select('code')
      .eq('id', roleId)
      .single()
    if (!role) return 0
    const r = role as { code: string }
    return ROLE_HIERARCHY[r.code] ?? 0
  }

  /**
   * Anti-escalation check: Actor can only grant roles strictly below their own level.
   * Admin (3) can grant any. Manager (2) can grant sub_manager (1) only.
   * Sub-manager (1) cannot manage staff at all.
   */
  private static async assertCanGrantRole(
    actorProfileId: string,
    companyId: string,
    venueId: string,
    targetRoleId: string
  ): Promise<void> {
    const actorLevel = await StaffService.getActorRoleLevel(actorProfileId, companyId, venueId)
    if (actorLevel <= 1) {
      throw new Error('Insufficient privileges: sub-managers cannot manage staff.')
    }
    const targetLevel = await StaffService.getRoleLevelById(targetRoleId)
    if (targetLevel === 0) throw new Error('Invalid target role.')
    if (targetLevel >= actorLevel) {
      throw new Error('Privilege escalation denied: cannot grant a role at or above your own level.')
    }
  }

  /**
   * Lists staff for a company/venue. Uses service_role to bypass RLS.
   * Requires staff.view permission.
   */
  static async listStaff(
    companyId: string,
    venueId: string,
    options: { page?: number; pageSize?: number } = {}
  ): Promise<{ staff: StaffMember[]; total: number }> {
    const hasAccess = await MembershipService.hasPermission(companyId, venueId, 'staff.view')
    if (!hasAccess) throw new Error('Unauthorized: staff.view permission required.')

    const { page = 1, pageSize = 20 } = options
    const offset = (page - 1) * pageSize
    const adminClient = getAdminClient()

    const { data: memberships, error, count } = await adminClient
      .from('user_memberships')
      .select(
        'id, profile_id, company_id, venue_id, role_id, is_active, created_at, roles!inner(code, name), profiles!inner(full_name, email, phone)',
        { count: 'exact' }
      )
      .eq('company_id', companyId)
      .or(`venue_id.eq.${venueId},venue_id.is.null`)
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1)

    if (error) throw new Error(`Failed to fetch staff: ${error.message}`)

    const result: StaffMember[] = (memberships ?? []).map(m => {
      const role = m.roles as unknown as { code: string; name: string }
      const profile = m.profiles as unknown as { full_name: string | null; email: string; phone: string | null }
      return {
        membershipId: m.id,
        profileId: m.profile_id,
        fullName: profile.full_name,
        email: profile.email,
        phone: profile.phone,
        roleId: m.role_id,
        roleCode: role.code,
        roleName: role.name,
        companyId: m.company_id,
        venueId: m.venue_id,
        isActive: m.is_active,
        createdAt: m.created_at,
      }
    })

    return { staff: result, total: count ?? 0 }
  }

  /**
   * Returns full detail for a single membership.
   * Validates it belongs to the requested company scope.
   * Requires staff.view permission.
   */
  static async getStaffDetail(
    companyId: string,
    venueId: string,
    membershipId: string
  ): Promise<StaffMember> {
    const hasAccess = await MembershipService.hasPermission(companyId, venueId, 'staff.view')
    if (!hasAccess) throw new Error('Unauthorized: staff.view permission required.')

    const adminClient = getAdminClient()
    const { data: m, error } = await adminClient
      .from('user_memberships')
      .select('id, profile_id, company_id, venue_id, role_id, is_active, created_at, roles!inner(code, name), profiles!inner(full_name, email, phone)')
      .eq('id', membershipId)
      .eq('company_id', companyId)
      .single()

    if (error || !m) throw new Error('Staff member not found in this company scope.')

    const role = m.roles as unknown as { code: string; name: string }
    const profile = m.profiles as unknown as { full_name: string | null; email: string; phone: string | null }
    return {
      membershipId: m.id,
      profileId: m.profile_id,
      fullName: profile.full_name,
      email: profile.email,
      phone: profile.phone,
      roleId: m.role_id,
      roleCode: role.code,
      roleName: role.name,
      companyId: m.company_id,
      venueId: m.venue_id,
      isActive: m.is_active,
      createdAt: m.created_at,
    }
  }

  /**
   * Adds a staff membership for an existing profile.
   * Anti-escalation: actor cannot grant a role >= their own level.
   * Requires staff.manage permission.
   */
  static async addStaffMembership(
    companyId: string,
    venueId: string | null,
    targetProfileId: string,
    roleId: string
  ): Promise<{ membershipId: string }> {
    const actor = await AuthService.requireUser()
    const scopeVenueId = venueId ?? ''
    const hasAccess = await MembershipService.hasPermission(companyId, scopeVenueId, 'staff.manage')
    if (!hasAccess) throw new Error('Unauthorized: staff.manage permission required.')

    // Anti-escalation: cannot grant roles at or above own level
    await StaffService.assertCanGrantRole(actor.id, companyId, scopeVenueId, roleId)

    // Cannot add self
    const actorProfile = await AuthService.requireUser()
    if (targetProfileId === actorProfile.id) {
      throw new Error('Cannot create a membership for yourself via staff management.')
    }

    const adminClient = getAdminClient()
    const { data: membership, error } = await adminClient
      .from('user_memberships')
      .insert({
        profile_id: targetProfileId,
        company_id: companyId,
        venue_id: venueId,
        role_id: roleId,
        is_active: true,
      })
      .select('id')
      .single()

    if (error) {
      if (error.code === '23505') throw new Error('This profile already has a membership for this scope.')
      throw new Error(`Failed to create staff membership: ${error.message}`)
    }

    try {
      await AuditService.emit({
        company_id: companyId,
        venue_id: venueId,
        actor_profile_id: actor.id,
        event_type: 'STAFF_CREATED',
        entity_type: 'staff',
        entity_id: membership.id,
        metadata: { target_profile_id: targetProfileId, role_id: roleId, venue_id: venueId },
      })
    } catch (auditErr) {
      console.error('[AUDIT CRITICAL] STAFF_CREATED audit write failed:', auditErr)
    }

    return { membershipId: membership.id }
  }

  /**
   * Changes the role of an existing membership.
   * Anti-escalation: cannot promote to a role >= actor's own level.
   * Cannot change own membership role (self-promotion prevention).
   * Requires staff.manage permission.
   */
  static async updateMembershipRole(
    companyId: string,
    venueId: string,
    membershipId: string,
    newRoleId: string
  ): Promise<void> {
    const actor = await AuthService.requireUser()
    const hasAccess = await MembershipService.hasPermission(companyId, venueId, 'staff.manage')
    if (!hasAccess) throw new Error('Unauthorized: staff.manage permission required.')

    const adminClient = getAdminClient()

    // Validate target membership belongs to this company
    const { data: target, error: fetchErr } = await adminClient
      .from('user_memberships')
      .select('id, profile_id, role_id, venue_id')
      .eq('id', membershipId)
      .eq('company_id', companyId)
      .single()

    if (fetchErr || !target) throw new Error('Staff membership not found in this company scope.')

    // Self-promotion prevention
    if (target.profile_id === actor.id) {
      throw new Error('Cannot change your own role via staff management.')
    }

    // Venue scope check: if target is venue-scoped, must match or actor must have company-wide scope
    if (target.venue_id && target.venue_id !== venueId) {
      throw new Error('Cross-venue staff role modification is not permitted.')
    }

    // Anti-escalation
    await StaffService.assertCanGrantRole(actor.id, companyId, venueId, newRoleId)

    const { error } = await adminClient
      .from('user_memberships')
      .update({ role_id: newRoleId })
      .eq('id', membershipId)
      .eq('company_id', companyId)

    if (error) throw new Error(`Failed to update role: ${error.message}`)

    try {
      await AuditService.emit({
        company_id: companyId,
        venue_id: venueId,
        actor_profile_id: actor.id,
        event_type: 'STAFF_ROLE_CHANGED',
        entity_type: 'staff',
        entity_id: membershipId,
        metadata: { previous_role_id: target.role_id, new_role_id: newRoleId, target_profile_id: target.profile_id },
      })
    } catch (auditErr) {
      console.error('[AUDIT CRITICAL] STAFF_ROLE_CHANGED audit write failed:', auditErr)
    }
  }

  /**
   * Activates or deactivates a staff membership.
   * Active membership check is re-evaluated on every protected request.
   * Cannot deactivate own membership.
   * Requires staff.manage permission.
   */
  static async setMembershipActive(
    companyId: string,
    venueId: string,
    membershipId: string,
    isActive: boolean
  ): Promise<void> {
    const actor = await AuthService.requireUser()
    const hasAccess = await MembershipService.hasPermission(companyId, venueId, 'staff.manage')
    if (!hasAccess) throw new Error('Unauthorized: staff.manage permission required.')

    const adminClient = getAdminClient()

    const { data: target, error: fetchErr } = await adminClient
      .from('user_memberships')
      .select('id, profile_id, venue_id')
      .eq('id', membershipId)
      .eq('company_id', companyId)
      .single()

    if (fetchErr || !target) throw new Error('Staff membership not found in this company scope.')

    // Cannot deactivate own membership
    if (target.profile_id === actor.id) {
      throw new Error('Cannot modify your own membership active status.')
    }

    // Venue scope check
    if (target.venue_id && target.venue_id !== venueId) {
      throw new Error('Cross-venue staff modification is not permitted.')
    }

    const { error } = await adminClient
      .from('user_memberships')
      .update({ is_active: isActive })
      .eq('id', membershipId)
      .eq('company_id', companyId)

    if (error) throw new Error(`Failed to update membership status: ${error.message}`)

    try {
      await AuditService.emit({
        company_id: companyId,
        venue_id: venueId,
        actor_profile_id: actor.id,
        event_type: isActive ? 'STAFF_ACTIVATED' : 'STAFF_DEACTIVATED',
        entity_type: 'staff',
        entity_id: membershipId,
        metadata: { target_profile_id: target.profile_id, is_active: isActive },
      })
    } catch (auditErr) {
      console.error('[AUDIT CRITICAL] STAFF_ACTIVATED/DEACTIVATED audit write failed:', auditErr)
    }
  }

  /**
   * Permanently revokes (deactivates) a staff membership.
   * Alias for setMembershipActive(false) with a REVOKED audit event.
   * Requires staff.manage permission.
   */
  static async revokeMembership(
    companyId: string,
    venueId: string,
    membershipId: string
  ): Promise<void> {
    const actor = await AuthService.requireUser()
    const hasAccess = await MembershipService.hasPermission(companyId, venueId, 'staff.manage')
    if (!hasAccess) throw new Error('Unauthorized: staff.manage permission required.')

    const adminClient = getAdminClient()

    const { data: target, error: fetchErr } = await adminClient
      .from('user_memberships')
      .select('id, profile_id, venue_id')
      .eq('id', membershipId)
      .eq('company_id', companyId)
      .single()

    if (fetchErr || !target) throw new Error('Staff membership not found in this company scope.')

    if (target.profile_id === actor.id) {
      throw new Error('Cannot revoke your own membership.')
    }

    if (target.venue_id && target.venue_id !== venueId) {
      throw new Error('Cross-venue staff modification is not permitted.')
    }

    const { error } = await adminClient
      .from('user_memberships')
      .update({ is_active: false })
      .eq('id', membershipId)
      .eq('company_id', companyId)

    if (error) throw new Error(`Failed to revoke membership: ${error.message}`)

    try {
      await AuditService.emit({
        company_id: companyId,
        venue_id: venueId,
        actor_profile_id: actor.id,
        event_type: 'STAFF_REVOKED',
        entity_type: 'staff',
        entity_id: membershipId,
        metadata: { target_profile_id: target.profile_id },
      })
    } catch (auditErr) {
      console.error('[AUDIT CRITICAL] STAFF_REVOKED audit write failed:', auditErr)
    }
  }

  /**
   * Returns all available roles for role assignment UI.
   */
  static async listRoles(): Promise<Array<{ id: string; code: string; name: string }>> {
    const adminClient = getAdminClient()
    const { data: roles, error } = await adminClient
      .from('roles')
      .select('id, code, name')
      .order('name')

    if (error) throw new Error(`Failed to fetch roles: ${error.message}`)
    return roles ?? []
  }
}
