import type { Server as HttpServer } from 'node:http'
import { Server, Socket } from 'socket.io'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'
import { pool } from '../db/pool'
import { logger } from '../utils/logger'
import { setIoInstance } from './events'
import type { AuthUser } from '../middleware/auth'

export function setupSocketIO(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean),
      methods: ['GET', 'POST'],
      credentials: true,
    },
  })

  setIoInstance(io)

  // Authentication Middleware
  io.use(async (socket: Socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '')
    if (!token) {
      // Unauthenticated admin-room access is intentionally enabled for this local academic demo.
      // Disable this branch before any public/production deployment.
      socket.data.user = { id: 'demo-control-room', role: 'admin', hospitalId: null } as AuthUser
      return next()
    }

    try {
      const decoded = jwt.verify(token, env.JWT_SECRET) as AuthUser
      socket.data.user = decoded
      next()
    } catch (_err) {
      next(new Error('Authentication error: invalid or expired token'))
    }
  })

  io.on('connection', async (socket: Socket) => {
    const user = socket.data.user as AuthUser
    logger.info({ userId: user.id, role: user.role, socketId: socket.id }, 'Socket connected')

    // 1. Auto-join role room
    socket.join(`role:${user.role}`)

    // 2. Driver-specific room
    if (user.role === 'driver') {
      try {
        const ambRes = await pool.query('SELECT id FROM ambulances WHERE driver_id = $1 LIMIT 1', [user.id])
        if (ambRes.rows.length > 0) {
          const ambId = ambRes.rows[0].id
          socket.join(`driver:${ambId}`)
          logger.info({ userId: user.id, ambulanceId: ambId }, 'Driver joined ambulance room')
        }
      } catch (err) {
        logger.error({ err, userId: user.id }, 'Failed to lookup driver ambulance')
      }
    }

    // 3. Hospital-specific room
    if (user.role === 'hospital' && user.hospitalId) {
      socket.join(`hospital:${user.hospitalId}`)
      logger.info({ userId: user.id, hospitalId: user.hospitalId }, 'Hospital joined room')
    }

    // Dynamic case room join/leave
    socket.on('case:join', async (data: { caseId: string }) => {
      try {
        const { caseId } = data
        if (!caseId) return

        // Check permission
        const caseRes = await pool.query(
          `SELECT e.id, e.case_code, e.reporter_id, e.hospital_id, a.driver_id
           FROM emergencies e
           LEFT JOIN ambulances a ON e.assigned_ambulance_id = a.id
           WHERE e.case_code = $1 OR e.id::text = $1`,
          [caseId]
        )

        if (caseRes.rows.length === 0) {
          socket.emit('error', { message: 'Case not found' })
          return
        }

        const c = caseRes.rows[0]
        const isAdmin = user.role === 'admin'
        const isOwner = user.id && c.reporter_id === user.id
        const isDriver = user.id && c.driver_id === user.id
        const isHospital = user.hospitalId && c.hospital_id === user.hospitalId

        if (isAdmin || isOwner || isDriver || isHospital) {
          socket.join(`case:${c.case_code}`)
          socket.join(`case:${c.id}`)
          socket.emit('case:joined', { caseId })
        } else {
          socket.emit('error', { message: 'Forbidden: you cannot join this case room' })
        }
      } catch (err) {
        logger.error({ err }, 'Error joining case room')
      }
    })

    socket.on('case:leave', (data: { caseId: string }) => {
      if (data?.caseId) {
        socket.leave(`case:${data.caseId}`)
        socket.emit('case:left', { caseId: data.caseId })
      }
    })

    socket.on('disconnect', () => {
      logger.info({ socketId: socket.id, userId: user.id }, 'Socket disconnected')
    })
  })

  return io
}
