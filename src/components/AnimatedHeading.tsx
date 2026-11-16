import { useEffect, useState } from 'react'

interface AnimatedHeadingProps {
  text: string
  charDelay?: number
  initialDelay?: number
  className?: string
}

export default function AnimatedHeading({
  text,
  charDelay = 30,
  initialDelay = 200,
  className = '',
}: AnimatedHeadingProps) {
  const chars = Array.from(text)
  const [shown, setShown] = useState<boolean[]>(() => chars.map(() => false))

  useEffect(() => {
    const timers = chars.map((_, i) =>
      window.setTimeout(() => {
        setShown((prev) => {
          const next = [...prev]
          next[i] = true
          return next
        })
      }, initialDelay + i * charDelay),
    )
    return () => timers.forEach((t) => window.clearTimeout(t))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  return (
    <h1 className={className} aria-label={text}>
      {chars.map((ch, i) => (
        <span
          key={i}
          className="char"
          style={{
            opacity: shown[i] ? 1 : 0,
            transform: shown[i] ? 'translateX(0)' : 'translateX(-14px)',
          }}
        >
          {ch === ' ' ? '\u00A0' : ch}
        </span>
      ))}
    </h1>
  )
}
