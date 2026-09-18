import { createClient } from '@/lib/supabase/server'
import { upsertFieldAction } from '@/modules/venue/admin.actions'

export default async function VenueFieldsPage({
  params
}: {
  params: Promise<{ companyId: string, venueId: string }>
}) {
  const { companyId, venueId } = await params
  const supabase = await createClient()
  const { data: fields } = await supabase
    .from('fields')
    .select('*')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: true })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Sports & Fields</h1>
        <p className="text-sm text-gray-500">Manage bookable fields and base pricing.</p>
      </div>

      <div className="bg-white p-6 rounded-lg border border-gray-200">
        <h2 className="text-lg font-semibold mb-4">Add Field</h2>
        <form action={async (formData) => {
          'use server'
          await upsertFieldAction(companyId, venueId, null, {
            name: formData.get('name') as string,
            base_price_minor: parseInt(formData.get('base_price_minor') as string),
            is_active: true
          })
        }} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Field Name</label>
              <input type="text" name="name" required className="w-full p-2 border border-gray-300 rounded-md" placeholder="e.g. Turf A" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Base Price (Paise)</label>
              <input type="number" name="base_price_minor" required className="w-full p-2 border border-gray-300 rounded-md" placeholder="e.g. 150000 for ₹1500" />
            </div>
          </div>
          <button type="submit" className="px-4 py-2 bg-black text-white font-medium rounded-md hover:bg-gray-800">
            Create Field
          </button>
        </form>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Existing Fields</h2>
        {fields?.map((field) => (
          <div key={field.id} className="p-4 bg-white rounded-lg border border-gray-200 flex justify-between items-center">
            <div>
              <p className="font-medium">{field.name}</p>
              <p className="text-sm text-gray-500">Base Price: ₹{(field.base_price_minor / 100).toFixed(2)} / 30m</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`px-2 py-1 text-xs font-medium rounded-full ${field.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                {field.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>
        ))}
        {fields?.length === 0 && <p className="text-sm text-gray-500">No fields configured.</p>}
      </div>
    </div>
  )
}
