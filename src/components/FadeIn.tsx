import { useEffect, useState, type ElementType, type ReactNode } from 'react'

interface FadeInProps {
  delay?: number
  duration?: number
  className?: string
  as?: ElementType
  id?: string
  children: ReactNode
}

export default function FadeIn({
  delay = 0,
  duration = 1000,
  className = '',
  as: Tag = 'div',
  id,
  children,
}: FadeInProps) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setShow(true), delay)
    return () => window.clearTimeout(timer)
  }, [delay])

  return (
    <Tag
      id={id}
      className={className}
      style={{ opacity: show ? 1 : 0, transition: `opacity ${duration}ms ease` }}
    >
      {children}
    </Tag>
  )
}
