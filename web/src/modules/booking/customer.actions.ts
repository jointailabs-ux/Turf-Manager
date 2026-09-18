'use server'

import { BookingService } from './service'
import { v4 as uuidv4 } from 'uuid'
import { StorageService } from '../storage/service'
import { createClient } from '@/lib/supabase/server'
import { AuthService } from '../auth/service'

export async function submitOnlineBookingAction(
  venueId: string,
  fieldId: string,
  startAt: string,
  endAt: string,
  durationMinutes: number
) {
  try {
    const profile = await AuthService.getProfile()
    if (!profile) throw new Error('User profile not found.')
    const supabase = await createClient()

    // Resolve customer ID using admin client to bypass RLS quirks
    const { createClient: createAdminClient } = await import('@supabase/supabase-js')
    const adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
      
    const { data: customer } = await adminClient
      .from('customers')
      .select('id')
      .eq('profile_id', profile.id)
      .maybeSingle()
      
    let customerId = customer?.id
    if (!customerId) {
      const { data: newCustomer, error } = await adminClient
        .from('customers')
        .insert({ profile_id: profile.id })
        .select('id')
        .maybeSingle()
      if (error) {
        if (error.code === '23505') {
          const { data: existing } = await adminClient.from('customers').select('id').eq('profile_id', profile.id).single()
          if (!existing) throw new Error('Failed to establish customer identity after race condition.')
          customerId = existing.id
        } else {
          console.error('Failed to establish customer identity.', error)
          throw new Error('Failed to establish customer identity.')
        }
      } else {
        customerId = newCustomer!.id
      }
    }

    const { data: venueData } = await adminClient
      .from('venues')
      .select('company_id')
      .eq('id', venueId)
      .maybeSingle()
      
    if (!venueData) throw new Error('Venue not found.')

    const idempotencyKey = uuidv4()

    const booking = await BookingService.createBooking({
      companyId: venueData.company_id,
      venueId: venueId,
      source: 'ONLINE',
      fieldId,
      customerId,
      startAt: new Date(startAt).toISOString(),
      durationMinutes,
      idempotencyKey
    })

    return { success: true, bookingId: booking.id }
  } catch (error: unknown) {
    console.error('Submit Online Booking Error:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function submitPaymentAction(
  bookingId: string,
  paymentAccountId: string,
  transactionReference: string,
  amountMinor: number
) {
  try {
    const payment = await BookingService.submitPayment(
      bookingId,
      paymentAccountId,
      'UPI_QR',
      amountMinor,
      transactionReference
    )
    return { success: true, paymentId: payment.id }
  } catch (error: unknown) {
    console.error('Submit Payment Error:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function createPaymentProofUploadUrlAction(paymentId: string, mimeType: string) {
  try {
    const result = await StorageService.createPaymentProofUploadUrl(paymentId, mimeType)
    return { success: true, ...result }
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}
