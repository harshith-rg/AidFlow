import { Router } from 'express'
import { pool } from '../../db/pool'
import { requireAuth } from '../../middleware/auth'
import { notFound, forbidden } from '../../utils/errors'

export const alertsRouter = Router()

// GET /alerts: list alerts scoped to role/hospital
alertsRouter.get('/alerts', requireAuth, async (req, res, next) => {
  try {
    const user = req.user!
    let query = 'SELECT * FROM alerts ORDER BY created_at DESC LIMIT 100'
    let values: any[] = []

    if (user.role === 'hospital') {
      query = `SELECT * FROM alerts
               WHERE hospital_id = $1 OR target_role = 'hospital'
               ORDER BY created_at DESC LIMIT 100`
      values = [user.hospitalId]
    } else if (user.role !== 'admin') {
      query = `SELECT * FROM alerts WHERE target_role = $1 ORDER BY created_at DESC LIMIT 100`
      values = [user.role]
    }

    const { rows } = await pool.query(query, values)
    res.json(
      rows.map((r) => ({
        id: r.id,
        type: r.type,
        message: r.message,
        emergencyId: r.emergency_id,
        targetRole: r.target_role,
        hospitalId: r.hospital_id,
        acknowledged: r.acknowledged,
        createdAt: r.created_at,
      }))
    )
  } catch (err) {
    next(err)
  }
})

// PATCH /alerts/:id/acknowledge
alertsRouter.patch('/alerts/:id/acknowledge', requireAuth, async (req, res, next) => {
  try {
    const user = req.user!
    const alertRes = await pool.query('SELECT * FROM alerts WHERE id = $1', [req.params.id])
    if (alertRes.rows.length === 0) {
      throw notFound('Alert')
    }

    const alert = alertRes.rows[0]
    if (user.role === 'hospital' && alert.hospital_id && alert.hospital_id !== user.hospitalId) {
      throw forbidden('You can only acknowledge alerts for your assigned hospital.')
    }

    const updateRes = await pool.query(
      'UPDATE alerts SET acknowledged = TRUE WHERE id = $1 RETURNING *',
      [req.params.id]
    )

    const r = updateRes.rows[0]
    res.json({
      id: r.id,
      type: r.type,
      message: r.message,
      emergencyId: r.emergency_id,
      targetRole: r.target_role,
      hospitalId: r.hospital_id,
      acknowledged: r.acknowledged,
      createdAt: r.created_at,
    })
  } catch (err) {
    next(err)
  }
})
