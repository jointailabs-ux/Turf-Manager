import { createClient } from '@/lib/supabase/server'
import { MembershipService } from '../membership/service'

export class AdminVenueService {
  static async updateVenueSettings(
    companyId: string, 
    venueId: string, 
    data: { 
      timezone?: string, 
      address?: string, 
      contacts?: Record<string, string>, 
      advance_payment_type?: string, 
      advance_payment_value?: number 
    }
  ) {
    const hasAccess = await MembershipService.hasPermission(companyId, venueId, 'settings.manage')
    if (!hasAccess) throw new Error('Unauthorized to manage venue settings.')

    const supabase = await createClient()
    const { error } = await supabase
      .from('venues')
      .update({
        ...data,
        updated_at: new Date().toISOString()
      })
      .eq('id', venueId)
      .eq('company_id', companyId)

    if (error) throw new Error(`Failed to update venue: ${error.message}`)
    return true
  }

  static async upsertField(
    companyId: string, 
    venueId: string, 
    fieldId: string | null,
    data: { 
      name: string, 
      description?: string, 
      base_price_minor: number, 
      is_active: boolean,
      venue_sport_id?: string
    }
  ) {
    const hasAccess = await MembershipService.hasPermission(companyId, venueId, 'field.manage')
    if (!hasAccess) throw new Error('Unauthorized to manage fields.')

    const supabase = await createClient()
    
    if (fieldId) {
      const { error } = await supabase
        .from('fields')
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq('id', fieldId)
        .eq('venue_id', venueId) // Enforces tenant safety
      if (error) throw new Error(`Failed to update field: ${error.message}`)
      return fieldId
    } else {
      const { data: newField, error } = await supabase
        .from('fields')
        .insert({ ...data, venue_id: venueId })
        .select('id')
        .single()
      if (error) throw new Error(`Failed to create field: ${error.message}`)
      return newField.id
    }
  }

  static async setOperatingHours(
    companyId: string, 
    venueId: string, 
    fieldId: string | null,
    hours: Array<{ weekday: number, opens_at: string | null, closes_at: string | null, is_closed: boolean }>
  ) {
    const hasAccess = await MembershipService.hasPermission(companyId, venueId, 'field.manage')
    if (!hasAccess) throw new Error('Unauthorized to manage operating hours.')

    const supabase = await createClient()
    
    // First, delete existing hours for this venue/field combination
    let query = supabase.from('operating_hours').delete().eq('venue_id', venueId)
    if (fieldId) {
      query = query.eq('field_id', fieldId)
    } else {
      query = query.is('field_id', null)
    }
    const { error: deleteError } = await query
    if (deleteError) throw new Error(`Failed to clear operating hours: ${deleteError.message}`)

    // Then, insert new ones
    if (hours.length > 0) {
      const insertData = hours.map(h => ({
        venue_id: venueId,
        field_id: fieldId,
        weekday: h.weekday,
        opens_at: h.opens_at,
        closes_at: h.closes_at,
        is_closed: h.is_closed
      }))
      const { error: insertError } = await supabase.from('operating_hours').insert(insertData)
      if (insertError) throw new Error(`Failed to save operating hours: ${insertError.message}`)
    }
    
    return true
  }

  static async upsertBlockedPeriod(
    companyId: string,
    venueId: string,
    fieldId: string | null,
    blockId: string | null,
    data: { starts_at: string, ends_at: string, reason?: string }
  ) {
    const hasAccess = await MembershipService.hasPermission(companyId, venueId, 'field.manage')
    if (!hasAccess) throw new Error('Unauthorized to manage blocked periods.')

    const supabase = await createClient()

    if (blockId) {
      const { error } = await supabase
        .from('blocked_periods')
        .update({ ...data })
        .eq('id', blockId)
        .eq('company_id', companyId)
        .eq('venue_id', venueId)
      if (error) throw new Error(`Failed to update blocked period: ${error.message}`)
      return blockId
    } else {
      const { data: newBlock, error } = await supabase
        .from('blocked_periods')
        .insert({
          company_id: companyId,
          venue_id: venueId,
          field_id: fieldId,
          ...data
        })
        .select('id')
        .single()
      if (error) throw new Error(`Failed to create blocked period: ${error.message}`)
      return newBlock.id
    }
  }

  static async upsertPaymentAccount(
    companyId: string,
    venueId: string | null,
    accountId: string | null,
    data: { display_name: string, upi_id?: string, is_active: boolean }
  ) {
    // If setting a venue-specific account, we check venue-level settings.manage
    // If setting a company-wide account, we check company-level settings.manage (venueId = null)
    const accessScopeVenue = venueId || companyId // Just a placeholder strategy
    const hasAccess = await MembershipService.hasPermission(companyId, accessScopeVenue, 'settings.manage')
    if (!hasAccess) throw new Error('Unauthorized to manage payment accounts.')

    const supabase = await createClient()

    if (accountId) {
      const { error } = await supabase
        .from('payment_accounts')
        .update({ ...data })
        .eq('id', accountId)
        .eq('company_id', companyId)
      if (error) throw new Error(`Failed to update payment account: ${error.message}`)
      return accountId
    } else {
      const { data: newAccount, error } = await supabase
        .from('payment_accounts')
        .insert({
          company_id: companyId,
          venue_id: venueId,
          ...data
        })
        .select('id')
        .single()
      if (error) throw new Error(`Failed to create payment account: ${error.message}`)
      return newAccount.id
    }
  }
}
