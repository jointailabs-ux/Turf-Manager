'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { submitOnlineBookingAction } from '@/modules/booking/customer.actions'
import { format } from 'date-fns'

interface Slot {
  start: string
  end: string
  status: string
}

export function ClientBookingForm({
  venue,
  field,
  slots,
  currentDateStr
}: {
  venue: { id: string, slug: string }
  field: { id: string, base_price_minor: number }
  slots: Slot[]
  currentDateStr: string
}) {
  const router = useRouter()
  const [selectedIndices, setSelectedIndices] = useState<number[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSlotClick = (index: number) => {
    if (slots[index].status !== 'AVAILABLE') return

    setSelectedIndices(prev => {
      if (prev.includes(index)) {
        return prev.filter(i => i !== index)
      }
      
      // Enforce contiguous selection
      const newSelection = [...prev, index].sort((a, b) => a - b)
      const isContiguous = newSelection.every((val, i, arr) => i === 0 || val === arr[i - 1] + 1)
      
      if (!isContiguous) {
        // If they click non-contiguous, reset to just this new slot
        return [index]
      }
      return newSelection
    })
  }

  const handleSubmit = async () => {
    setError('')
    if (selectedIndices.length < 2) {
      setError('Minimum booking duration is 60 minutes (2 slots).')
      return
    }

    setLoading(true)
    const startIndex = selectedIndices[0]
    const endIndex = selectedIndices[selectedIndices.length - 1]

    const startAt = slots[startIndex].start
    const endAt = slots[endIndex].end
    const durationMinutes = selectedIndices.length * 30

    const res = await submitOnlineBookingAction(venue.id, field.id, startAt, endAt, durationMinutes)
    
    if (res.success && res.bookingId) {
      router.push(`/checkout/${res.bookingId}`)
    } else {
      setError(res.error || 'Failed to create booking.')
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-4 items-center">
        <input 
          type="date" 
          value={currentDateStr}
          onChange={(e) => router.push(`/book/${venue.slug}/${field.id}?date=${e.target.value}`)}
          className="p-2 border border-gray-300 rounded-md"
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {slots.map((slot, index) => {
          const isSelected = selectedIndices.includes(index)
          let bgColor = 'bg-gray-100 hover:bg-gray-200 cursor-pointer'
          if (slot.status !== 'AVAILABLE') bgColor = 'bg-red-50 text-red-300 cursor-not-allowed'
          if (isSelected) bgColor = 'bg-black text-white'

          return (
            <div 
              key={slot.start} 
              onClick={() => handleSlotClick(index)}
              className={`p-3 rounded-md text-center text-sm font-medium transition-colors ${bgColor}`}
            >
              {format(new Date(slot.start), 'HH:mm')}
            </div>
          )
        })}
      </div>

      {error && <div className="p-3 bg-red-100 text-red-800 rounded-md text-sm">{error}</div>}

      <div className="border-t border-gray-200 pt-4 flex justify-between items-center">
        <div>
          <p className="text-sm font-medium">Selected Duration: {selectedIndices.length * 30} mins</p>
          <p className="text-lg font-bold">Total: ₹{((selectedIndices.length * field.base_price_minor) / 100).toFixed(2)}</p>
        </div>
        <button 
          onClick={handleSubmit}
          disabled={loading || selectedIndices.length < 2}
          className="px-6 py-2 bg-black text-white font-medium rounded-md disabled:bg-gray-400"
        >
          {loading ? 'Processing...' : 'Proceed to Checkout'}
        </button>
      </div>
    </div>
  )
}
