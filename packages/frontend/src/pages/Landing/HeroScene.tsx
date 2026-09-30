import React, { useMemo, useRef, useState, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Float, Points, PointMaterial } from '@react-three/drei'

/** Nube de puntos determinista (sin Math.random: render estable y testeable). */
function buildPoints(count: number): Float32Array {
  const arr = new Float32Array(count * 3)
  let seed = 1337
  const rnd = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  for (let i = 0; i < count; i++) {
    const r = 2.2 + rnd() * 2.6
    const theta = rnd() * Math.PI * 2
    const phi = Math.acos(2 * rnd() - 1)
    arr[i * 3] = r * Math.sin(phi) * Math.cos(theta)
    arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
    arr[i * 3 + 2] = r * Math.cos(phi)
  }
  return arr
}

const Scene: React.FC<{ count: number }> = ({ count }) => {
  const group = useRef<React.ElementRef<'group'>>(null)
  const positions = useMemo(() => buildPoints(count), [count])
  useFrame((_, dt) => {
    if (group.current) {
      group.current.rotation.y += dt * 0.08
      group.current.rotation.x += dt * 0.02
    }
  })
  return (
    <group ref={group}>
      {/* key: un buffer de three.js no puede cambiar de tamano; si cambia count se crea geometria nueva */}
      <Points key={count} positions={positions} stride={3} frustumCulled={false}>
        <PointMaterial transparent color="#10b981" size={0.035} sizeAttenuation depthWrite={false} />
      </Points>
      <Float speed={1.2} rotationIntensity={0.6} floatIntensity={0.8}>
        <mesh>
          <icosahedronGeometry args={[1.35, 1]} />
          <meshBasicMaterial color="#6366f1" wireframe transparent opacity={0.55} />
        </mesh>
      </Float>
    </group>
  )
}

/**
 * Heroe three.js (JSX de @react-three/fiber). Se carga con React.lazy desde la landing.
 * - dpr limitado a [1, 1.5]
 * - frameloop "never" cuando el heroe sale de pantalla o la pestana esta oculta
 */
const HeroScene: React.FC = () => {
  const wrap = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(true)
  // Densidad fijada al montar: recalcularla en cada render cambiaba el tamano del buffer al cruzar 640px
  // y three.js lanzaba "Resizing buffer attributes is not supported" en cada frame
  const [count] = useState(() => (typeof window !== 'undefined' && window.innerWidth < 640 ? 500 : 1400))

  useEffect(() => {
    const el = wrap.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    let visible = true
    const update = () => setActive(visible && !document.hidden)
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting
      update()
    })
    io.observe(el)
    document.addEventListener('visibilitychange', update)
    return () => {
      io.disconnect()
      document.removeEventListener('visibilitychange', update)
    }
  }, [])

  return (
    <div ref={wrap} style={{ position: 'absolute', inset: 0 }} aria-hidden="true">
      <Canvas
        dpr={[1, 1.5]}
        frameloop={active ? 'always' : 'never'}
        camera={{ position: [0, 0, 6], fov: 50 }}
        gl={{ antialias: false, alpha: true, powerPreference: 'low-power' }}
      >
        <Scene count={count} />
      </Canvas>
    </div>
  )
}

export default HeroScene
