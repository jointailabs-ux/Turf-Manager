import { createClient } from '@/lib/supabase/server'
import { updateVenueSettingsAction } from '@/modules/venue/admin.actions'
import { redirect } from 'next/navigation'

export default async function VenueSettingsPage({
  params
}: {
  params: Promise<{ companyId: string, venueId: string }>
}) {
  const { companyId, venueId } = await params
  const supabase = await createClient()
  const { data: venue } = await supabase
    .from('venues')
    .select('*')
    .eq('id', venueId)
    .eq('company_id', companyId)
    .single()

  if (!venue) redirect('/')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Venue Settings</h1>
        <p className="text-sm text-gray-500">Manage timezone, address, and advance payment configuration for {venue.name}.</p>
      </div>

      <form action={async (formData) => {
        'use server'
        const data = {
          timezone: formData.get('timezone') as string,
          address: formData.get('address') as string,
          advance_payment_type: formData.get('advance_payment_type') as string,
          advance_payment_value: parseInt(formData.get('advance_payment_value') as string)
        }
        await updateVenueSettingsAction(companyId, venueId, data)
      }} className="space-y-6 bg-white p-6 rounded-lg border border-gray-200">
        
        <div className="space-y-2">
          <label className="text-sm font-medium">Timezone</label>
          <input 
            type="text" 
            name="timezone" 
            defaultValue={venue.timezone || 'Asia/Kolkata'} 
            className="w-full p-2 border border-gray-300 rounded-md"
            required
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Address</label>
          <textarea 
            name="address" 
            defaultValue={venue.address || ''} 
            className="w-full p-2 border border-gray-300 rounded-md h-24"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Advance Payment Type</label>
            <select 
              name="advance_payment_type" 
              defaultValue={venue.advance_payment_type || 'PERCENTAGE'}
              className="w-full p-2 border border-gray-300 rounded-md"
            >
              <option value="PERCENTAGE">Percentage (%)</option>
              <option value="FIXED">Fixed Amount</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Advance Payment Value</label>
            <input 
              type="number" 
              name="advance_payment_value" 
              defaultValue={venue.advance_payment_value || 0} 
              className="w-full p-2 border border-gray-300 rounded-md"
              required
            />
            <p className="text-xs text-gray-500">Enter percentage (e.g. 30) or flat minor amount (e.g. 50000 for ₹500)</p>
          </div>
        </div>

        <button type="submit" className="px-4 py-2 bg-black text-white font-medium rounded-md hover:bg-gray-800">
          Save Settings
        </button>
      </form>
    </div>
  )
}
