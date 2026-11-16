import { io, Socket } from 'socket.io-client'
import type { EventPayloads } from '../types/contract'

const SERVER_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

let socket: Socket | null = null
let currentToken: string | null = null

export type ConnectionState = 'connected' | 'connecting' | 'disconnected'

type ConnectionListener = (state: ConnectionState) => void
const stateListeners = new Set<ConnectionListener>()
let currentState: ConnectionState = 'disconnected'

function setState(state: ConnectionState) {
  currentState = state
  stateListeners.forEach((l) => l(state))
}

export function subscribeConnectionState(listener: ConnectionListener): () => void {
  stateListeners.add(listener)
  listener(currentState)
  return () => stateListeners.delete(listener)
}

export function getSocket(token?: string | null): Socket {
  const explicitToken = arguments.length > 0
  const effectiveToken = explicitToken ? token ?? null : currentToken ?? localStorage.getItem('aidflow_token')

  if (socket && effectiveToken === currentToken) {
    return socket
  }

  if (socket) {
    socket.disconnect()
    socket = null
  }

  currentToken = effectiveToken

  setState('connecting')

  socket = io(SERVER_URL, {
    auth: effectiveToken ? { token: effectiveToken } : {},
    transports: ['websocket', 'polling'],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
  })

  socket.on('connect', () => {
    setState('connected')
  })

  socket.on('disconnect', () => {
    setState('disconnected')
  })

  socket.on('connect_error', () => {
    setState('disconnected')
  })

  return socket
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect()
    socket = null
  }
  currentToken = null
  setState('disconnected')
}

export function joinCaseRoom(caseId: string): void {
  const s = getSocket()
  s.emit('case:join', { caseId })
}

export function leaveCaseRoom(caseId: string): void {
  const s = getSocket()
  s.emit('case:leave', { caseId })
}

export function onSocketEvent<K extends keyof EventPayloads>(
  event: K,
  callback: (payload: EventPayloads[K]) => void,
  token?: string | null
): () => void {
  const s = arguments.length > 2 ? getSocket(token) : getSocket()
  const handler = (payload: any) => callback(payload)
  s.on(event as any, handler)
  return () => {
    s.off(event as any, handler)
  }
}
