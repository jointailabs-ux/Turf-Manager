import Link from 'next/link'
import { ReactNode } from 'react'

export default async function AdminVenueLayout({
  children,
  params
}: {
  children: ReactNode
  params: Promise<{ companyId: string, venueId: string }>
}) {
  const { companyId, venueId } = await params

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex flex-col md:flex-row">
      <aside className="w-full md:w-64 bg-white border-r border-gray-200 p-6 flex flex-col gap-4 shrink-0">
        <h2 className="text-xl font-bold tracking-tight">Venue Admin</h2>
        <nav className="flex flex-col gap-1 mt-4">
          <p className="px-3 pt-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Operations</p>
          <Link href={`/admin/${companyId}/venues/${venueId}/dashboard`} className="px-3 py-2 rounded-md hover:bg-gray-100 font-medium text-sm">
            Dashboard
          </Link>
          <Link href={`/admin/${companyId}/venues/${venueId}/bookings`} className="px-3 py-2 rounded-md hover:bg-gray-100 font-medium text-sm">
            Bookings
          </Link>
          <Link href={`/admin/${companyId}/venues/${venueId}/customers`} className="px-3 py-2 rounded-md hover:bg-gray-100 font-medium text-sm">
            Customers
          </Link>
          <Link href={`/admin/${companyId}/venues/${venueId}/staff`} className="px-3 py-2 rounded-md hover:bg-gray-100 font-medium text-sm">
            Staff
          </Link>
          <p className="px-3 pt-4 text-xs font-semibold text-gray-400 uppercase tracking-wide">Configuration</p>
          <Link href={`/admin/${companyId}/venues/${venueId}/settings`} className="px-3 py-2 rounded-md hover:bg-gray-100 font-medium text-sm">
            Settings
          </Link>
          <Link href={`/admin/${companyId}/venues/${venueId}/fields`} className="px-3 py-2 rounded-md hover:bg-gray-100 font-medium text-sm">
            Sports & Fields
          </Link>
          <Link href={`/admin/${companyId}/venues/${venueId}/finance`} className="px-3 py-2 rounded-md hover:bg-gray-100 font-medium text-sm">
            Finance & Payments
          </Link>
        </nav>
      </aside>
      
      <main className="flex-1 p-6 md:p-12 overflow-auto">
        <div className="max-w-4xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  )
}
