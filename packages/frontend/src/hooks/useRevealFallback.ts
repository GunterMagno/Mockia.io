import { useEffect, type RefObject } from 'react'

/**
 * Fallback ligero para navegadores sin `animation-timeline` (Safari < 26, Firefox).
 * El marcado (CSS scroll-driven) hace todo el trabajo donde esta soportado;
 * aqui solo se marca `data-in` con IntersectionObserver en los elementos `[data-reveal]`.
 * El CSS oculta los elementos solo si `data-io` esta presente, asi que sin JS
 * (o con reduced-motion) el contenido siempre es visible.
 */
export function useRevealFallback(rootRef: RefObject<HTMLElement>) {
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    if (typeof CSS !== 'undefined' && CSS.supports('animation-timeline: view()')) return
    if (typeof IntersectionObserver === 'undefined') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const targets = root.querySelectorAll<HTMLElement>('[data-reveal]')
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.setAttribute('data-in', 'true')
            io.unobserve(e.target)
          }
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
    )
    root.setAttribute('data-io', '')
    targets.forEach((t) => io.observe(t))
    return () => {
      io.disconnect()
      root.removeAttribute('data-io')
    }
  }, [rootRef])
}
