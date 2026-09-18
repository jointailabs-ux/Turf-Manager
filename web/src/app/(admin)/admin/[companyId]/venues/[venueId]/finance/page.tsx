import { createClient } from '@/lib/supabase/server'
import { upsertPaymentAccountAction } from '@/modules/venue/admin.actions'

export default async function VenueFinancePage({
  params
}: {
  params: Promise<{ companyId: string, venueId: string }>
}) {
  const { companyId, venueId } = await params
  const supabase = await createClient()
  const { data: accounts } = await supabase
    .from('payment_accounts')
    .select('*')
    .eq('company_id', companyId)
    .or(`venue_id.eq.${venueId},venue_id.is.null`)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Finance & Payments</h1>
        <p className="text-sm text-gray-500">Manage payment accounts and QR instructions.</p>
      </div>

      <div className="bg-white p-6 rounded-lg border border-gray-200">
        <h2 className="text-lg font-semibold mb-4">Add Payment Account</h2>
        <form action={async (formData) => {
          'use server'
          await upsertPaymentAccountAction(companyId, venueId, null, {
            display_name: formData.get('display_name') as string,
            upi_id: formData.get('upi_id') as string,
            is_active: true
          })
        }} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Display Name</label>
              <input type="text" name="display_name" required className="w-full p-2 border border-gray-300 rounded-md" placeholder="e.g. Venue UPI" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">UPI ID</label>
              <input type="text" name="upi_id" required className="w-full p-2 border border-gray-300 rounded-md" placeholder="venue@upi" />
            </div>
          </div>
          <button type="submit" className="px-4 py-2 bg-black text-white font-medium rounded-md hover:bg-gray-800">
            Add Account
          </button>
        </form>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Active Accounts</h2>
        {accounts?.map((acc) => (
          <div key={acc.id} className="p-4 bg-white rounded-lg border border-gray-200 flex justify-between items-center">
            <div>
              <p className="font-medium">{acc.display_name}</p>
              <p className="text-sm text-gray-500">{acc.upi_id}</p>
            </div>
            <div className="text-sm text-gray-500">
              {acc.venue_id ? 'Venue Specific' : 'Company Wide'}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
