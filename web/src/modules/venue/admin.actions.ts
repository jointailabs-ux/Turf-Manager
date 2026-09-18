'use server'

import { AdminVenueService } from './admin.service'

export async function updateVenueSettingsAction(
  companyId: string,
  venueId: string,
  data: {
    timezone?: string
    address?: string
    advance_payment_type?: string
    advance_payment_value?: number
  }
) {
  try {
    await AdminVenueService.updateVenueSettings(companyId, venueId, data)
    return { success: true }
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function upsertFieldAction(
  companyId: string,
  venueId: string,
  fieldId: string | null,
  data: {
    name: string
    description?: string
    base_price_minor: number
    is_active: boolean
    venue_sport_id?: string
  }
) {
  try {
    const id = await AdminVenueService.upsertField(companyId, venueId, fieldId, data)
    return { success: true, id }
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function setOperatingHoursAction(
  companyId: string,
  venueId: string,
  fieldId: string | null,
  hours: Array<{ weekday: number, opens_at: string | null, closes_at: string | null, is_closed: boolean }>
) {
  try {
    await AdminVenueService.setOperatingHours(companyId, venueId, fieldId, hours)
    return { success: true }
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function upsertPaymentAccountAction(
  companyId: string,
  venueId: string | null,
  accountId: string | null,
  data: { display_name: string, upi_id?: string, is_active: boolean }
) {
  try {
    const id = await AdminVenueService.upsertPaymentAccount(companyId, venueId, accountId, data)
    return { success: true, id }
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}
