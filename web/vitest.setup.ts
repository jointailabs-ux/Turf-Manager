import '@testing-library/jest-dom'
import WebSocket from 'ws'

if (typeof globalThis.WebSocket === 'undefined') {
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = WebSocket
}


