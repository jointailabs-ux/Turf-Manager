import { CustomerService } from '@/modules/customer/service'
import { redirect } from 'next/navigation'

export default async function CustomersPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string; venueId: string }>
  searchParams: Promise<{ search?: string; page?: string }>
}) {
  const { companyId, venueId } = await params
  const sp = await searchParams
  const search = sp.search ?? ''
  const page = parseInt(sp.page ?? '1')

  let result: Awaited<ReturnType<typeof CustomerService.listCustomers>> = { customers: [], total: 0 }
  let error: string | null = null

  try {
    result = await CustomerService.listCustomers(companyId, venueId, { page, search: search || undefined })
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to load customers.'
    if (error.includes('Unauthorized')) redirect('/')
  }

  const { customers, total } = result
  const pageSize = 20
  const totalPages = Math.ceil(total / pageSize)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
          <p className="text-sm text-gray-500">{total} customer{total !== 1 ? 's' : ''} found</p>
        </div>
        <a href={`/admin/${companyId}/venues/${venueId}/customers/new`} className="px-4 py-2 bg-black text-white text-sm font-medium rounded-md hover:bg-gray-800">
          + Invite Customer
        </a>
      </div>

      <form method="GET" className="flex gap-2">
        <input
          type="text"
          name="search"
          defaultValue={search}
          placeholder="Search by name, email, or phone…"
          className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-black"
        />
        <button type="submit" className="px-4 py-2 bg-gray-100 text-sm font-medium rounded-md hover:bg-gray-200">Search</button>
        {search && <a href={`/admin/${companyId}/venues/${venueId}/customers`} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 rounded-md">Clear</a>}
      </form>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">{error}</div>}

      {customers.length === 0 && !error ? (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center text-gray-500 text-sm">
          {search ? `No customers found matching "${search}".` : 'No customers yet. Customers appear here after their first booking.'}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
          {customers.map(c => (
            <a key={c.customerId} href={`/admin/${companyId}/venues/${venueId}/customers/${c.customerId}`} className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors">
              <div>
                <p className="text-sm font-medium text-gray-900">{c.fullName ?? '—'}</p>
                <p className="text-xs text-gray-500">{c.email}{c.phone ? ` · ${c.phone}` : ''}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-600">{c.totalBookings} booking{c.totalBookings !== 1 ? 's' : ''}</p>
                {c.recentBookingStatus && (
                  <p className="text-xs text-gray-400">{c.recentBookingStatus}</p>
                )}
              </div>
            </a>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex gap-2 items-center justify-center">
          {page > 1 && (
            <a href={`?page=${page - 1}${search ? `&search=${encodeURIComponent(search)}` : ''}`} className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50">
              ← Previous
            </a>
          )}
          <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
          {page < totalPages && (
            <a href={`?page=${page + 1}${search ? `&search=${encodeURIComponent(search)}` : ''}`} className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50">
              Next →
            </a>
          )}
        </div>
      )}
    </div>
  )
}
