import { createClient } from '@/lib/supabase/server'
import { AuthService } from '../auth/service'
import { MembershipService } from '../membership/service'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export class StorageService {
  /**
   * Generates a signed URL for a customer to upload a payment proof.
   */
  static async createPaymentProofUploadUrl(paymentId: string, mimeType: string): Promise<{ signedUrl: string, path: string }> {
    const user = await AuthService.requireUser()
    const supabase = await createClient()

    if (!mimeType.startsWith('image/')) {
      throw new Error('Only image files are allowed for payment proofs.')
    }

    // Validate payment & booking ownership
    const { data: payment, error } = await supabase
      .from('payments')
      .select('id, status, booking_id, bookings(customer_id, company_id, venue_id, customers(profile_id))')
      .eq('id', paymentId)
      .single()

    if (error || !payment || !payment.bookings) {
      throw new Error('Payment not found or unauthorized.')
    }

    const bookingData = payment.bookings as unknown as { company_id: string, venue_id: string, customers: { profile_id: string } }

    if (!bookingData.customers) {
      throw new Error('Payment not found or unauthorized.')
    }

    if (bookingData.customers.profile_id !== user.id) {
      throw new Error('Unauthorized: You do not own this booking.')
    }

    // Use service role to bypass RLS for generating the signed URL, but we have validated ownership above
    const adminClient = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    })

    const uniqueFileName = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${mimeType.split('/')[1]}`
    const filePath = `${bookingData.company_id}/${bookingData.venue_id}/${paymentId}/${uniqueFileName}`

    const { data, error: uploadError } = await adminClient
      .storage
      .from('payment_proofs')
      .createSignedUploadUrl(filePath)

    if (uploadError || !data?.signedUrl) {
      throw new Error(`Failed to create upload URL: ${uploadError?.message}`)
    }

    // Update payment record with the path
    const { error: updateError } = await adminClient
      .from('payments')
      .update({ proof_object_path: filePath })
      .eq('id', paymentId)
    
    if (updateError) {
      throw new Error('Failed to attach proof path to payment.')
    }

    return { signedUrl: data.signedUrl, path: filePath }
  }

  /**
   * Generates a signed URL for a user to view a payment proof.
   * Customers can view their own, Staff can view if they have payment.view
   */
  static async getPaymentProofSignedUrl(paymentId: string): Promise<string | null> {
    const user = await AuthService.requireUser()
    const supabase = await createClient()

    const { data: payment } = await supabase
      .from('payments')
      .select('proof_object_path, bookings(company_id, venue_id, customers(profile_id))')
      .eq('id', paymentId)
      .single()

    if (!payment || !payment.proof_object_path) return null

    const bookingData = payment.bookings as unknown as { company_id: string, venue_id: string, customers: { profile_id: string } }
    let isAuthorized = false

    if (bookingData.customers.profile_id === user.id) {
      isAuthorized = true
    } else {
      isAuthorized = await MembershipService.hasPermission(bookingData.company_id, bookingData.venue_id, 'payment.view')
    }

    if (!isAuthorized) {
      throw new Error('Unauthorized to view this payment proof.')
    }

    const adminClient = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    })

    const { data, error } = await adminClient
      .storage
      .from('payment_proofs')
      .createSignedUrl(payment.proof_object_path, 3600)

    if (error || !data?.signedUrl) {
      throw new Error(`Failed to generate signed URL: ${error?.message}`)
    }

    return data.signedUrl
  }

  /**
   * Generates a signed URL for Staff to upload a QR asset
   */
  static async createVenueAssetUploadUrl(companyId: string, venueId: string, paymentAccountId: string, mimeType: string): Promise<{ signedUrl: string, path: string }> {
    const hasAccess = await MembershipService.hasPermission(companyId, venueId, 'settings.manage')
    if (!hasAccess) {
      throw new Error('Unauthorized: settings.manage required to upload venue assets.')
    }

    if (!mimeType.startsWith('image/')) {
      throw new Error('Only image files are allowed for QR codes.')
    }

    const adminClient = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    })

    const uniqueFileName = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${mimeType.split('/')[1]}`
    const filePath = `${companyId}/${venueId}/payment-accounts/${paymentAccountId}/${uniqueFileName}`

    const { data, error: uploadError } = await adminClient
      .storage
      .from('venue_assets')
      .createSignedUploadUrl(filePath)

    if (uploadError || !data?.signedUrl) {
      throw new Error(`Failed to create upload URL: ${uploadError?.message}`)
    }

    return { signedUrl: data.signedUrl, path: filePath }
  }

  /**
   * Gets a signed URL for a QR asset.
   * We allow this publicly (using service role) assuming the client holds the payment account ID during checkout,
   * but we validate the payment account is active and belongs to the venue.
   */
  static async getVenueAssetSignedUrl(paymentAccountId: string): Promise<string | null> {
    const adminClient = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    })

    const { data: account } = await adminClient
      .from('payment_accounts')
      .select('qr_object_path')
      .eq('id', paymentAccountId)
      .eq('is_active', true)
      .single()
      
    if (!account || !account.qr_object_path) return null

    const { data, error } = await adminClient
      .storage
      .from('venue_assets')
      .createSignedUrl(account.qr_object_path, 3600)

    if (error || !data?.signedUrl) {
      throw new Error(`Failed to generate signed URL: ${error?.message}`)
    }

    return data.signedUrl
  }
}
