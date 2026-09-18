import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { format } from 'date-fns'

export default async function CustomerBookingsPage() {
  const supabase = await createClient()

  // RLS will ensure they only see their own bookings
  const { data: bookings } = await supabase
    .from('bookings')
    .select('id, status, start_at, end_at, fields(name, venues(name))')
    .order('start_at', { ascending: false })

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">My Bookings</h1>

      <div className="space-y-4">
        {bookings?.map((booking: unknown) => {
          const b = booking as { id: string, start_at: string, end_at: string, status: string, fields: { name: string, venues: { name: string } } }
          const isUpcoming = new Date(b.start_at) > new Date()
          return (
            <Link key={b.id} href={`/account/bookings/${b.id}`} className="block">
              <div className="p-4 bg-white rounded-lg border border-gray-200 hover:border-black transition-colors flex justify-between items-center">
                <div>
                  <h3 className="font-semibold text-lg">{b.fields?.venues?.name} - {b.fields?.name}</h3>
                  <p className="text-sm text-gray-500">
                    {format(new Date(b.start_at), 'PPP p')} to {format(new Date(b.end_at), 'p')}
                  </p>
                </div>
                <div className="text-right">
                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                    b.status === 'CONFIRMED' ? 'bg-green-100 text-green-800' :
                    b.status === 'PAYMENT_PENDING' ? 'bg-yellow-100 text-yellow-800' :
                    b.status === 'EXPIRED' ? 'bg-gray-100 text-gray-800' :
                    'bg-red-100 text-red-800'
                  }`}>
                    {b.status}
                  </span>
                  {isUpcoming && b.status === 'CONFIRMED' && (
                    <p className="text-xs text-green-600 mt-2 font-medium">Upcoming</p>
                  )}
                </div>
              </div>
            </Link>
          )
        })}
        {(!bookings || bookings.length === 0) && (
          <div className="p-8 text-center text-gray-500 bg-white border border-gray-200 rounded-lg">
            You don&apos;t have any bookings yet.
          </div>
        )}
      </div>
    </div>
  )
}
