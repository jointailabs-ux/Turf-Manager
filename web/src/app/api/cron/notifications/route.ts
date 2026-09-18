import { NextResponse } from 'next/server'
import { NotificationService } from '@/modules/notification/service'
import { env } from '@/env'
import { Observability } from '@/lib/observability'

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    // Step 1: Process outbox to create delivery records
    await NotificationService.processOutboxEvents()

    // Step 2: Process delivery records to send/simulate notifications
    await NotificationService.processDeliveries()

    return NextResponse.json({ success: true })
  } catch (err) {
    Observability.captureError(err, { module: 'CRON', action: 'notifications' })
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}
