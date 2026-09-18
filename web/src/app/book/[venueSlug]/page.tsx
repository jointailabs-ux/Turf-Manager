import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { redirect } from 'next/navigation'

export default async function VenuePage({
  params
}: {
  params: Promise<{ venueSlug: string }>
}) {
  const { venueSlug } = await params
  const supabase = await createClient()
  const { data: venue } = await supabase
    .from('venues')
    .select('id, name, address, fields(id, name, base_price_minor, is_active)')
    .eq('slug', venueSlug)
    .eq('is_active', true)
    .single()

  if (!venue) redirect('/')

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
      <div className="bg-white p-8 rounded-lg shadow-sm border border-gray-100">
        <h1 className="text-3xl font-bold">{venue.name}</h1>
        <p className="text-gray-500 mt-2">{venue.address}</p>
      </div>

      <div>
        <h2 className="text-xl font-bold mb-4">Available Fields</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {venue.fields?.filter((f: { is_active: boolean }) => f.is_active).map((field: { id: string, name: string, base_price_minor: number }) => (
            <Link key={field.id} href={`/book/${venueSlug}/${field.id}`}>
              <div className="p-6 bg-white rounded-lg border border-gray-200 hover:border-black transition-colors cursor-pointer group">
                <h3 className="font-semibold text-lg group-hover:underline">{field.name}</h3>
                <p className="text-sm text-gray-500 mt-1">From ₹{(field.base_price_minor / 100).toFixed(2)} / 30m</p>
              </div>
            </Link>
          ))}
          {(!venue.fields || venue.fields.filter((f: { is_active: boolean }) => f.is_active).length === 0) && (
            <p className="text-gray-500">No active fields available for booking.</p>
          )}
        </div>
      </div>
    </div>
  )
}
