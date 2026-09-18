'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { submitPaymentAction, createPaymentProofUploadUrlAction } from '@/modules/booking/customer.actions'

export function ClientCheckoutForm({
  bookingId,
  advanceRequired,
  paymentAccounts
}: {
  bookingId: string
  advanceRequired: number
  paymentAccounts: { id: string, display_name: string, upi_id: string, qrUrl: string | null }[]
}) {
  const router = useRouter()
  const [selectedAccount, setSelectedAccount] = useState<string>(paymentAccounts[0]?.id || '')
  const [utr, setUtr] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const account = paymentAccounts.find(a => a.id === selectedAccount)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!utr) return setError('UTR / Transaction Reference is required.')
    
    setLoading(true)
    setError('')

    // 1. Submit Payment record to DB
    const res = await submitPaymentAction(bookingId, selectedAccount, utr, advanceRequired)
    
    if (!res.success || !res.paymentId) {
      setError(res.error || 'Failed to submit payment.')
      setLoading(false)
      return
    }

    // 2. Upload proof if provided
    if (file) {
      try {
        const uploadRes = await createPaymentProofUploadUrlAction(res.paymentId, file.type)
        if (uploadRes.success && 'signedUrl' in uploadRes && uploadRes.signedUrl) {
          await fetch(uploadRes.signedUrl as string, {
            method: 'PUT',
            body: file,
            headers: { 'Content-Type': file.type }
          })
        }
      } catch (err) {
        console.error('Failed to upload proof, but payment was submitted', err)
      }
    }

    // Redirect to account bookings
    router.push(`/account/bookings/${bookingId}`)
  }

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-lg border border-gray-200">
        <h2 className="text-lg font-bold mb-4">Payment Instructions</h2>
        
        {paymentAccounts.length > 0 ? (
          <div className="space-y-4">
            <select 
              value={selectedAccount} 
              onChange={e => setSelectedAccount(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md"
            >
              {paymentAccounts.map(a => (
                <option key={a.id} value={a.id}>{a.display_name} ({a.upi_id})</option>
              ))}
            </select>

            {account?.qrUrl && (
              <div className="flex justify-center p-4 border border-gray-100 rounded-md bg-gray-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={account.qrUrl} alt="Payment QR" className="max-w-[200px] h-auto" />
              </div>
            )}
            
            {account?.upi_id && (
              <div className="text-center font-medium bg-gray-100 p-2 rounded-md">
                UPI: {account.upi_id}
              </div>
            )}
          </div>
        ) : (
          <p className="text-gray-500">No payment accounts configured for this venue.</p>
        )}
      </div>

      <form onSubmit={handleSubmit} className="bg-white p-6 rounded-lg border border-gray-200 space-y-4">
        <h2 className="text-lg font-bold mb-4">Submit Payment Details</h2>
        
        <div className="space-y-2">
          <label className="text-sm font-medium">UTR / Transaction Reference *</label>
          <input 
            type="text" 
            name="transactionReference"
            value={utr}
            onChange={e => setUtr(e.target.value)}
            required
            className="w-full p-2 border border-gray-300 rounded-md"
            placeholder="Enter the 12-digit UPI reference number"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Payment Screenshot (Optional)</label>
          <input 
            type="file" 
            accept="image/jpeg, image/png, image/webp"
            onChange={e => setFile(e.target.files?.[0] || null)}
            className="w-full p-2 border border-gray-300 rounded-md text-sm"
          />
          <p className="text-xs text-gray-500">Max 5MB. Images only.</p>
        </div>

        {error && <div className="p-3 bg-red-100 text-red-800 rounded-md text-sm">{error}</div>}

        <button 
          type="submit" 
          disabled={loading || !utr || !selectedAccount}
          className="w-full py-2 bg-black text-white font-medium rounded-md disabled:bg-gray-400"
        >
          {loading ? 'Submitting...' : 'Submit Payment'}
        </button>
      </form>
    </div>
  )
}
