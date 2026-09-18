import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { startOfDay, endOfDay, addMinutes, isBefore, isAfter } from 'date-fns'
import { toZonedTime, format } from 'date-fns-tz'

export class BookingUIService {
  static async getVenueAndField(venueSlug: string, fieldId: string) {
    const adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
    )
    
    const { data: venue } = await adminClient
      .from('venues')
      .select('id, company_id, name, slug, timezone, is_active')
      .eq('slug', venueSlug)
      .single()

    if (!venue || !venue.is_active) throw new Error('Venue not found or inactive.')

    const { data: field } = await adminClient
      .from('fields')
      .select('id, name, base_price_minor, is_active')
      .eq('id', fieldId)
      .eq('venue_id', venue.id)
      .single()

    if (!field || !field.is_active) throw new Error('Field not found or inactive.')

    return { venue, field }
  }

  static async getAvailabilityGrid(venueId: string, fieldId: string, date: Date, timezone: string) {
    const adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
    )
    
    // date must be resolved in venue timezone
    const zonedDate = toZonedTime(date, timezone)
    const dayStart = startOfDay(zonedDate)
    const dayEnd = endOfDay(zonedDate)

    const weekdayNum = parseInt(format(zonedDate, 'w', { timeZone: timezone })) - 1 // 0-6 (Sun-Sat)

    // Fetch hours
    const { data: hours } = await adminClient
      .from('operating_hours')
      .select('*')
      .eq('venue_id', venueId)
      .eq('weekday', weekdayNum)

    let operatingHour = hours?.find(h => h.field_id === fieldId)
    if (!operatingHour) operatingHour = hours?.find(h => h.field_id === null)

    // Generate 30-min slots
    const slots = []
    let current = dayStart

    // If we have hours, respect opens_at / closes_at
    const opensAtTime = operatingHour?.opens_at || '00:00:00'
    const closesAtTime = operatingHour?.closes_at || '23:59:59'
    
    // Simplistic parsing: assumes 'HH:mm:ss' format from DB
    const opensHour = parseInt(opensAtTime.split(':')[0])
    const opensMin = parseInt(opensAtTime.split(':')[1])
    const closesHour = parseInt(closesAtTime.split(':')[0])
    const closesMin = parseInt(closesAtTime.split(':')[1])

    current.setHours(opensHour, opensMin, 0, 0)
    const endTime = new Date(dayStart)
    endTime.setHours(closesHour, closesMin, 0, 0)

    // Fetch active reservations
    const { data: reservations } = await adminClient
      .from('active_slot_reservations')
      .select('slot_start')
      .eq('field_id', fieldId)
      .gte('slot_start', dayStart.toISOString())
      .lte('slot_start', dayEnd.toISOString())

    const reservedTimes = new Set(reservations?.map(r => new Date(r.slot_start).getTime()) || [])

    // Fetch blocked periods
    const { data: blocks } = await adminClient
      .from('blocked_periods')
      .select('starts_at, ends_at')
      .eq('field_id', fieldId)
      .lte('starts_at', dayEnd.toISOString())
      .gte('ends_at', dayStart.toISOString())

    const now = new Date()

    while (isBefore(current, endTime)) {
      const slotStart = new Date(current)
      const slotEnd = addMinutes(current, 30)

      const isPast = isBefore(slotStart, now)
      const isReserved = reservedTimes.has(slotStart.getTime())
      const isBlocked = blocks?.some(b => {
        const bStart = new Date(b.starts_at)
        const bEnd = new Date(b.ends_at)
        // Block overlap logic
        return isBefore(slotStart, bEnd) && isAfter(slotEnd, bStart)
      }) || false

      let status = 'AVAILABLE'
      if (operatingHour?.is_closed) status = 'CLOSED'
      else if (isPast) status = 'PAST'
      else if (isBlocked) status = 'BLOCKED'
      else if (isReserved) status = 'RESERVED'

      slots.push({
        start: slotStart.toISOString(),
        end: slotEnd.toISOString(),
        status
      })

      current = slotEnd
    }

    return slots
  }
}
