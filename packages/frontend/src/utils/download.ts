/** Guarda un Blob en el equipo del usuario con el nombre dado (enlace <a download> temporal). */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/** Nombre de archivo de una cabecera Content-Disposition (`attachment; filename="x"`), o el de respaldo. */
export function filenameFromDisposition(disposition: unknown, fallback: string): string {
  return /filename="([^"]+)"/.exec(String(disposition ?? ''))?.[1] ?? fallback
}
