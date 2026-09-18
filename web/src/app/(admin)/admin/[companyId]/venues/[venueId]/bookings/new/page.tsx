import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ClientManualBookingForm from './ClientManualBookingForm'

export default async function NewBookingPage({
  params,
}: {
  params: Promise<{ companyId: string; venueId: string }>
}) {
  const { companyId, venueId } = await params
  const supabase = await createClient()

  const { data: venue } = await supabase.from('venues').select('name, timezone').eq('id', venueId).eq('company_id', companyId).single()
  if (!venue) redirect('/')

  const { data: fields } = await supabase
    .from('fields')
    .select('id, name, base_price_minor')
    .eq('venue_id', venueId)
    .eq('is_active', true)
    .order('name')

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <a href={`/admin/${companyId}/venues/${venueId}/bookings`} className="hover:underline">Bookings</a>
        <span>›</span>
        <span>New Manual Booking</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">New Manual Booking</h1>
        <p className="text-sm text-gray-500">{venue.name} · {venue.timezone}</p>
      </div>

      <ClientManualBookingForm
        companyId={companyId}
        venueId={venueId}
        fields={fields ?? []}
      />
    </div>
  )
}
