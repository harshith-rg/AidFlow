import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../../middleware/auth'
import { validate } from '../../middleware/validate'
import { loginUser, registerPatient, getUserById } from './auth.service'

export const authRouter = Router()

const registerSchema = z.object({
  email: z.string().email('Valid email address is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  phone: z.string().optional(),
})

const loginSchema = z.object({
  email: z.string().email('Valid email address is required'),
  password: z.string().min(1, 'Password is required'),
})

authRouter.post('/auth/register', validate({ body: registerSchema }), async (req, res, next) => {
  try {
    const result = await registerPatient(req.body)
    res.status(201).json(result)
  } catch (err) {
    next(err)
  }
})

authRouter.post('/auth/login', validate({ body: loginSchema }), async (req, res, next) => {
  try {
    const result = await loginUser(req.body)
    res.status(200).json(result)
  } catch (err) {
    next(err)
  }
})

authRouter.get('/auth/me', requireAuth, async (req, res, next) => {
  try {
    const user = await getUserById(req.user!.id)
    res.status(200).json({ user })
  } catch (err) {
    next(err)
  }
})
