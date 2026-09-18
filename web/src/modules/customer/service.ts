import { createClient as createAdminClient } from '@supabase/supabase-js'
import { MembershipService } from '@/modules/membership/service'
import { AuthService } from '@/modules/auth/service'
import { AuditService } from '@/modules/audit/service'

export interface CustomerProfile {
  customerId: string
  profileId: string
  fullName: string | null
  email: string
  phone: string | null
  isActive: boolean
  createdAt: string
}

export interface CustomerWithBookingSummary extends CustomerProfile {
  totalBookings: number
  recentBookingStatus: string | null
}

export interface CustomerDetail extends CustomerProfile {
  bookings: Array<{
    id: string
    status: string
    startAt: string
    endAt: string
    grossAmountMinor: number
    fieldId: string
    venueId: string
    createdAt: string
  }>
}

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  )
}

export class CustomerService {
  /**
   * Lists customers who have made bookings at the given venue/company.
   * Tenant-scoped: only returns customers with bookings in this company.
   * Requires customer.view permission.
   */
  static async listCustomers(
    companyId: string,
    venueId: string,
    options: { page?: number; search?: string; pageSize?: number } = {}
  ): Promise<{ customers: CustomerWithBookingSummary[]; total: number }> {
    const hasAccess = await MembershipService.hasPermission(companyId, venueId, 'customer.view')
    if (!hasAccess) throw new Error('Unauthorized: customer.view permission required.')

    const { page = 1, pageSize = 20, search } = options
    const offset = (page - 1) * pageSize
    const adminClient = getAdminClient()

    // Fetch bookings for this company/venue and get unique customer_ids
    const bookingQuery = adminClient
      .from('bookings')
      .select('customer_id')
      .eq('company_id', companyId)
      .eq('venue_id', venueId)
      .not('customer_id', 'is', null)

    const { data: bookingRows, error: bookingError } = await bookingQuery
    if (bookingError) throw new Error(`Failed to fetch bookings: ${bookingError.message}`)

    const customerIds = [...new Set((bookingRows ?? []).map(b => b.customer_id as string))]
    if (customerIds.length === 0) return { customers: [], total: 0 }

    // Fetch customers + profiles for those IDs
    let customerQuery = adminClient
      .from('customers')
      .select('id, profile_id, created_at, profiles!inner(full_name, email, phone, is_active)')
      .in('id', customerIds)

    if (search) {
      customerQuery = adminClient
        .from('customers')
        .select('id, profile_id, created_at, profiles!inner(full_name, email, phone, is_active)')
        .in('id', customerIds)
        .or(`full_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`, { foreignTable: 'profiles' })
    }

    const { data: customers, error: custError } = await customerQuery
      .range(offset, offset + pageSize - 1)
    if (custError) throw new Error(`Failed to fetch customers: ${custError.message}`)

    // Booking counts per customer
    const { data: countRows } = await adminClient
      .from('bookings')
      .select('customer_id, status')
      .eq('company_id', companyId)
      .in('customer_id', customerIds)

    const bookingCountMap: Record<string, { count: number; recentStatus: string }> = {}
    for (const row of (countRows ?? [])) {
      if (!row.customer_id) continue
      const existing = bookingCountMap[row.customer_id]
      if (!existing) {
        bookingCountMap[row.customer_id] = { count: 1, recentStatus: row.status }
      } else {
        existing.count++
      }
    }

    const result: CustomerWithBookingSummary[] = (customers ?? []).map(c => {
      const profile = c.profiles as unknown as { full_name: string | null; email: string; phone: string | null; is_active: boolean }
      const stats = bookingCountMap[c.id] ?? { count: 0, recentStatus: null }
      return {
        customerId: c.id,
        profileId: c.profile_id,
        fullName: profile.full_name,
        email: profile.email,
        phone: profile.phone,
        isActive: profile.is_active,
        createdAt: c.created_at,
        totalBookings: stats.count,
        recentBookingStatus: stats.recentStatus,
      }
    })

    return { customers: result, total: customerIds.length }
  }

  /**
   * Returns full customer profile plus booking history at this venue.
   * Requires customer.view permission.
   */
  static async getCustomerDetail(
    companyId: string,
    venueId: string,
    customerId: string
  ): Promise<CustomerDetail> {
    const hasAccess = await MembershipService.hasPermission(companyId, venueId, 'customer.view')
    if (!hasAccess) throw new Error('Unauthorized: customer.view permission required.')

    const adminClient = getAdminClient()

    const { data: customer, error: custError } = await adminClient
      .from('customers')
      .select('id, profile_id, created_at, profiles!inner(full_name, email, phone, is_active)')
      .eq('id', customerId)
      .single()

    if (custError || !customer) throw new Error('Customer not found.')

    // Verify customer has bookings in this company (tenant isolation)
    const { data: tenantCheck } = await adminClient
      .from('bookings')
      .select('id')
      .eq('customer_id', customerId)
      .eq('company_id', companyId)
      .limit(1)

    if (!tenantCheck || tenantCheck.length === 0) {
      throw new Error('Customer not found in this company scope.')
    }

    const { data: bookings } = await adminClient
      .from('bookings')
      .select('id, status, start_at, end_at, gross_amount_minor, field_id, venue_id, created_at')
      .eq('customer_id', customerId)
      .eq('company_id', companyId)
      .order('start_at', { ascending: false })
      .limit(50)

    const profile = customer.profiles as unknown as { full_name: string | null; email: string; phone: string | null; is_active: boolean }

    return {
      customerId: customer.id,
      profileId: customer.profile_id,
      fullName: profile.full_name,
      email: profile.email,
      phone: profile.phone,
      isActive: profile.is_active,
      createdAt: customer.created_at,
      bookings: (bookings ?? []).map(b => ({
        id: b.id,
        status: b.status,
        startAt: b.start_at,
        endAt: b.end_at,
        grossAmountMinor: b.gross_amount_minor,
        fieldId: b.field_id,
        venueId: b.venue_id,
        createdAt: b.created_at,
      })),
    }
  }

  /**
   * Creates a new customer by inviting them via email.
   * Creates an auth user (triggering profile auto-creation) then updates profile with name/phone.
   * Requires customer.manage permission.
   */
  static async createCustomer(
    companyId: string,
    venueId: string,
    data: { email: string; fullName: string; phone?: string }
  ): Promise<{ customerId: string }> {
    const actor = await AuthService.requireUser()
    const hasAccess = await MembershipService.hasPermission(companyId, venueId, 'customer.manage')
    if (!hasAccess) throw new Error('Unauthorized: customer.manage permission required.')

    const adminClient = getAdminClient()

    // Invite user via Supabase Auth admin API — triggers handle_new_user to create profile
    const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
      data.email,
      { data: { full_name: data.fullName } }
    )
    if (inviteError) throw new Error(`Failed to create customer account: ${inviteError.message}`)

    const authUserId = inviteData.user.id

    // Find the auto-created profile
    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .select('id')
      .eq('auth_user_id', authUserId)
      .single()

    if (profileError || !profile) throw new Error('Profile auto-creation failed after invite.')

    // Update profile with additional fields
    if (data.phone) {
      await adminClient
        .from('profiles')
        .update({ full_name: data.fullName, phone: data.phone })
        .eq('id', profile.id)
    }

    // Create customer record
    const { data: customer, error: custError } = await adminClient
      .from('customers')
      .insert({ profile_id: profile.id })
      .select('id')
      .single()

    if (custError) throw new Error(`Failed to create customer record: ${custError.message}`)

    await AuditService.emitSafe({
      company_id: companyId,
      venue_id: venueId,
      actor_profile_id: actor.id,
      event_type: 'CUSTOMER_CREATED',
      entity_type: 'customer',
      entity_id: customer.id,
      metadata: { email: data.email, full_name: data.fullName },
    })

    return { customerId: customer.id }
  }

  /**
   * Updates permitted profile fields for a customer.
   * Does NOT allow modifying: auth credentials, bookings, roles, tenant ownership.
   * Requires customer.manage permission.
   */
  static async updateCustomer(
    companyId: string,
    venueId: string,
    customerId: string,
    data: { fullName?: string; phone?: string }
  ): Promise<void> {
    const actor = await AuthService.requireUser()
    const hasAccess = await MembershipService.hasPermission(companyId, venueId, 'customer.manage')
    if (!hasAccess) throw new Error('Unauthorized: customer.manage permission required.')

    const adminClient = getAdminClient()

    // Verify customer belongs to this company's scope
    const { data: booking } = await adminClient
      .from('bookings')
      .select('id')
      .eq('customer_id', customerId)
      .eq('company_id', companyId)
      .limit(1)
      .single()

    if (!booking) throw new Error('Customer not found in this company scope.')

    // Resolve profile
    const { data: customer } = await adminClient
      .from('customers')
      .select('profile_id')
      .eq('id', customerId)
      .single()

    if (!customer) throw new Error('Customer record not found.')

    const updates: Record<string, string> = {}
    if (data.fullName !== undefined) updates.full_name = data.fullName
    if (data.phone !== undefined) updates.phone = data.phone

    if (Object.keys(updates).length > 0) {
      const { error } = await adminClient
        .from('profiles')
        .update(updates)
        .eq('id', customer.profile_id)

      if (error) throw new Error(`Failed to update customer profile: ${error.message}`)
    }

    await AuditService.emitSafe({
      company_id: companyId,
      venue_id: venueId,
      actor_profile_id: actor.id,
      event_type: 'CUSTOMER_UPDATED',
      entity_type: 'customer',
      entity_id: customerId,
      metadata: { updated_fields: Object.keys(updates) },
    })
  }

  /**
   * Searches for an existing customer by email, phone, or name within company scope.
   * Used for manual booking customer selection.
   * Requires customer.view permission.
   */
  static async searchCustomers(
    companyId: string,
    venueId: string,
    search: string
  ): Promise<CustomerProfile[]> {
    const hasAccess = await MembershipService.hasPermission(companyId, venueId, 'customer.view')
    if (!hasAccess) throw new Error('Unauthorized: customer.view permission required.')

    // Search profiles that are linked to customers with bookings in this company
    const adminClient = getAdminClient()
    const { data: bookingCustomers } = await adminClient
      .from('bookings')
      .select('customer_id')
      .eq('company_id', companyId)
      .not('customer_id', 'is', null)

    const customerIds = [...new Set((bookingCustomers ?? []).map(b => b.customer_id as string))]
    if (customerIds.length === 0) return []

    const term = search.toLowerCase()
    const { data: customers } = await adminClient
      .from('customers')
      .select('id, profile_id, created_at, profiles!inner(full_name, email, phone, is_active)')
      .in('id', customerIds)
      .or(`full_name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`, { foreignTable: 'profiles' })
      .limit(10)

    return (customers ?? []).map(c => {
      const p = c.profiles as unknown as { full_name: string | null; email: string; phone: string | null; is_active: boolean }
      return {
        customerId: c.id,
        profileId: c.profile_id,
        fullName: p.full_name,
        email: p.email,
        phone: p.phone,
        isActive: p.is_active,
        createdAt: c.created_at,
      }
    })
  }
}
