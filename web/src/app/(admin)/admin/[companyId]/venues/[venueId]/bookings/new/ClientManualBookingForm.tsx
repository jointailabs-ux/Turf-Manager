'use client'

import { useState } from 'react'
import { createManualBookingAction } from '@/modules/booking/admin.actions'

interface Field {
  id: string
  name: string
  base_price_minor: number
}

interface ClientManualBookingFormProps {
  companyId: string
  venueId: string
  fields: Field[]
}

export default function ClientManualBookingForm({ companyId, venueId, fields }: ClientManualBookingFormProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)

    const fd = new FormData(e.currentTarget)
    const fieldId = fd.get('fieldId') as string
    const source = fd.get('source') as 'WALK_IN' | 'PHONE'
    const startAt = fd.get('startAt') as string
    const durationMinutes = parseInt(fd.get('durationMinutes') as string)
    const customerId = (fd.get('customerId') as string) || undefined

    if (!fieldId || !source || !startAt || !durationMinutes) {
      setError('Please fill in all required fields.')
      setLoading(false)
      return
    }

    const idempotencyKey = `manual-${Date.now()}-${Math.random().toString(36).slice(2)}`

    try {
      const result = await createManualBookingAction(companyId, venueId, {
        fieldId,
        customerId,
        source,
        startAt: new Date(startAt).toISOString(),
        durationMinutes,
        idempotencyKey,
      })
      setSuccess(`Booking created! ID: ${result.bookingId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create booking.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-lg p-6 space-y-5 max-w-lg">
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>}
      {success && <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg p-3">{success}</div>}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Field *</label>
        <select name="fieldId" required className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
          <option value="">Select field…</option>
          {fields.map(f => (
            <option key={f.id} value={f.id}>{f.name} (₹{(f.base_price_minor / 100).toFixed(0)}/slot)</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Source *</label>
        <select name="source" required className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
          <option value="WALK_IN">Walk-in</option>
          <option value="PHONE">Phone</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Start Date &amp; Time *</label>
        <input type="datetime-local" name="startAt" required className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Duration (minutes) *</label>
        <select name="durationMinutes" required className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
          {[60, 90, 120, 150, 180, 210, 240].map(d => (
            <option key={d} value={d}>{d} minutes ({d / 60}h)</option>
          ))}
        </select>
        <p className="text-xs text-gray-400 mt-1">Minimum 60 minutes. Slots are 30 minutes each.</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Customer ID (optional)</label>
        <input type="text" name="customerId" placeholder="Leave blank for walk-in without account" className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
        <p className="text-xs text-gray-400 mt-1">If customer has an existing account, enter their customer UUID.</p>
      </div>

      <p className="text-xs text-gray-500 bg-gray-50 rounded p-3">
        All validations apply: operating hours, blocked periods, slot availability, and pricing are server-controlled.
        The same atomic booking engine is used as for online bookings — double-booking is prevented.
      </p>

      <button type="submit" disabled={loading} className="w-full py-2 bg-black text-white font-medium text-sm rounded-md hover:bg-gray-800 disabled:opacity-50">
        {loading ? 'Creating Booking…' : 'Create Manual Booking'}
      </button>
    </form>
  )
}
