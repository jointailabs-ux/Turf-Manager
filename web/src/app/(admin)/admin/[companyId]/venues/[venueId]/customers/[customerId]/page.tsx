import { CustomerService } from '@/modules/customer/service'
import { redirect } from 'next/navigation'
import { updateCustomerAction } from '@/modules/customer/admin.actions'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatCurrency(minor: number) {
  return `₹${(minor / 100).toFixed(2)}`
}

const STATUS_STYLES: Record<string, string> = {
  CONFIRMED: 'bg-green-100 text-green-800',
  PAYMENT_PENDING: 'bg-yellow-100 text-yellow-800',
  CANCELLED: 'bg-red-100 text-red-800',
  EXPIRED: 'bg-gray-100 text-gray-600',
  COMPLETED: 'bg-blue-100 text-blue-800',
  PAYMENT_REJECTED: 'bg-orange-100 text-orange-800',
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ companyId: string; venueId: string; customerId: string }>
}) {
  const { companyId, venueId, customerId } = await params

  let customer: Awaited<ReturnType<typeof CustomerService.getCustomerDetail>> | null = null
  let error: string | null = null

  try {
    customer = await CustomerService.getCustomerDetail(companyId, venueId, customerId)
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to load customer.'
    if (error.includes('Unauthorized')) redirect('/')
  }

  if (!customer) {
    return <div className="text-red-600 text-sm">{error ?? 'Customer not found.'}</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <a href={`/admin/${companyId}/venues/${venueId}/customers`} className="hover:underline">Customers</a>
        <span>›</span>
        <span>{customer.fullName ?? customer.email}</span>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Profile */}
        <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
          <h2 className="text-base font-semibold">Profile</h2>
          <dl className="space-y-2 text-sm">
            <div><dt className="text-gray-500">Name</dt><dd className="font-medium">{customer.fullName ?? '—'}</dd></div>
            <div><dt className="text-gray-500">Email</dt><dd>{customer.email}</dd></div>
            <div><dt className="text-gray-500">Phone</dt><dd>{customer.phone ?? '—'}</dd></div>
            <div><dt className="text-gray-500">Customer since</dt><dd>{formatDate(customer.createdAt)}</dd></div>
            <div><dt className="text-gray-500">Status</dt><dd className={customer.isActive ? 'text-green-700' : 'text-red-600'}>{customer.isActive ? 'Active' : 'Inactive'}</dd></div>
          </dl>
        </div>

        {/* Edit */}
        <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
          <h2 className="text-base font-semibold">Edit Profile</h2>
          <form action={async (fd: FormData) => {
            'use server'
            await updateCustomerAction(companyId, venueId, customerId, {
              fullName: fd.get('fullName') as string,
              phone: fd.get('phone') as string || undefined,
            })
          }} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Full Name</label>
              <input type="text" name="fullName" defaultValue={customer.fullName ?? ''} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Phone</label>
              <input type="tel" name="phone" defaultValue={customer.phone ?? ''} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
            </div>
            <button type="submit" className="px-4 py-2 bg-black text-white text-sm font-medium rounded-md hover:bg-gray-800">
              Save Changes
            </button>
          </form>
        </div>
      </div>

      {/* Booking history */}
      <div>
        <h2 className="text-base font-semibold mb-3">Booking History ({customer.bookings.length})</h2>
        {customer.bookings.length === 0 ? (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center text-sm text-gray-500">No bookings yet.</div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
            {customer.bookings.map(b => (
              <a key={b.id} href={`/admin/${companyId}/venues/${venueId}/bookings/${b.id}`} className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors">
                <div>
                  <p className="text-sm font-medium">{formatDate(b.startAt)}</p>
                  <p className="text-xs text-gray-500">{formatCurrency(b.grossAmountMinor)}</p>
                </div>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[b.status] ?? 'bg-gray-100'}`}>{b.status}</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
