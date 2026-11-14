import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { env } from '../../config/env'
import { pool } from '../../db/pool'
import type { Role } from '../../types/contract'
import { conflict, unauthorized, notFound } from '../../utils/errors'

export interface UserSummary {
  id: string
  email: string
  role: Role
  name: string
  phone?: string | null
  hospitalId?: string | null
}

export function generateToken(user: UserSummary): string {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      hospitalId: user.hospitalId ?? null,
    },
    env.JWT_SECRET,
    { expiresIn: '12h' }
  )
}

export async function registerPatient(input: {
  email: string
  password: string
  name: string
  phone?: string
}): Promise<{ user: UserSummary; token: string }> {
  const normalizedEmail = input.email.trim().toLowerCase()
  const existing = await pool.query('SELECT id FROM users WHERE lower(email) = $1', [normalizedEmail])
  if (existing.rows.length > 0) {
    throw conflict('An account with this email address already exists.')
  }

  const passwordHash = await bcrypt.hash(input.password, 10)
  const res = await pool.query(
    `INSERT INTO users (email, password_hash, role, name, phone)
     VALUES ($1, $2, 'patient', $3, $4)
     RETURNING id, email, role, name, phone, hospital_id`,
    [normalizedEmail, passwordHash, input.name.trim(), input.phone?.trim() || null]
  )

  const row = res.rows[0]
  const user: UserSummary = {
    id: row.id,
    email: row.email,
    role: row.role as Role,
    name: row.name,
    phone: row.phone,
    hospitalId: row.hospital_id,
  }

  const token = generateToken(user)
  return { user, token }
}

export async function loginUser(input: {
  email: string
  password: string
}): Promise<{ user: UserSummary; token: string }> {
  const normalizedEmail = input.email.trim().toLowerCase()
  const res = await pool.query(
    `SELECT id, email, password_hash, role, name, phone, hospital_id
     FROM users WHERE lower(email) = $1`,
    [normalizedEmail]
  )

  if (res.rows.length === 0) {
    throw unauthorized('Invalid email or password.')
  }

  const row = res.rows[0]
  const valid = await bcrypt.compare(input.password, row.password_hash)
  if (!valid) {
    throw unauthorized('Invalid email or password.')
  }

  const user: UserSummary = {
    id: row.id,
    email: row.email,
    role: row.role as Role,
    name: row.name,
    phone: row.phone,
    hospitalId: row.hospital_id,
  }

  const token = generateToken(user)
  return { user, token }
}

export async function getUserById(id: string): Promise<UserSummary> {
  const res = await pool.query(
    `SELECT id, email, role, name, phone, hospital_id
     FROM users WHERE id = $1`,
    [id]
  )
  if (res.rows.length === 0) {
    throw notFound('User')
  }

  const row = res.rows[0]
  return {
    id: row.id,
    email: row.email,
    role: row.role as Role,
    name: row.name,
    phone: row.phone,
    hospitalId: row.hospital_id,
  }
}
