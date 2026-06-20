import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import type { PropagationTick } from '../types'

const WS_URL = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/^http/, 'ws')

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const [lastTick, setLastTick] = useState<PropagationTick | null>(null)
  const [lastFleetLocation, setLastFleetLocation] = useState<any>(null)

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false

    function connect() {
      if (cancelled) return
      if (wsRef.current?.readyState === WebSocket.OPEN) return

      try {
        const ws = new WebSocket(WS_URL)
        wsRef.current = ws

        ws.onopen = () => setConnected(true)
        ws.onerror = () => {
          /* swallow — onclose will handle reconnect */
        }
        ws.onclose = () => {
          setConnected(false)
          if (!cancelled) reconnectTimer = setTimeout(connect, 5000)
        }
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data)
            if (msg.event === 'propagation:tick') {
              setLastTick(msg.data)
            } else if (msg.event === 'controller:fleet_locations') {
              setLastFleetLocation(msg.data)
            } else if (msg.event === 'fleet:status_updated') {
              const { user_name, junctionName, status } = msg.data
              if (status === 'on_site') {
                toast.success(
                  `${user_name || 'Officer'} is On Site at ${junctionName || 'their location'}`,
                  {
                    description: 'Live Fleet Update',
                    duration: 5000,
                  },
                )
              } else if (status === 'en_route') {
                toast.info(
                  `${user_name || 'Officer'} is En Route to ${junctionName || 'their location'}`,
                  {
                    description: 'Live Fleet Update',
                    duration: 5000,
                  },
                )
              }
            }
          } catch {
            /* ignore parse errors */
          }
        }
      } catch {
        // WebSocket constructor can throw if URL is invalid
        setConnected(false)
      }
    }

    connect()

    return () => {
      cancelled = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      wsRef.current?.close()
    }
  }, [])

  const sendMessage = useCallback((type: string, payload: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }))
    }
  }, [])

  return { connected, lastTick, lastFleetLocation, sendMessage }
}
