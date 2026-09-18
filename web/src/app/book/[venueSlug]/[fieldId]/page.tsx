import { BookingUIService } from '@/modules/booking/ui.service'
import { ClientBookingForm } from './ClientBookingForm'

export default async function BookingPage({
  params,
  searchParams
}: {
  params: Promise<{ venueSlug: string, fieldId: string }>
  searchParams: Promise<{ date?: string }>
}) {
  const { venueSlug, fieldId } = await params
  const { date } = await searchParams
  const { venue, field } = await BookingUIService.getVenueAndField(venueSlug, fieldId)
  
  // Default to today if no date provided
  const targetDateStr = date || new Date().toISOString().split('T')[0]
  const targetDate = new Date(targetDateStr)
  
  const slots = await BookingUIService.getAvailabilityGrid(venue.id, field.id, targetDate, venue.timezone || 'UTC')

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{venue.name} - {field.name}</h1>
        <p className="text-gray-500">Select your slots below. Minimum duration is 60 minutes.</p>
        <p className="text-sm font-medium mt-1">Price: ₹{(field.base_price_minor / 100).toFixed(2)} / 30m</p>
      </div>

      <ClientBookingForm 
        venue={venue} 
        field={field} 
        slots={slots} 
        currentDateStr={targetDateStr}
      />
    </div>
  )
}
