/** Icônes maison de Médor — dessinées au trait dans le style de l'app,
 * en SVG inline : ni emojis système, ni dépendance externe. */

export function IconePoubelle({ taille = 15 }: { taille?: number }) {
  return (
    <svg
      width={taille}
      height={taille}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ verticalAlign: -2 }}
    >
      <path d="M2.5 4h11" />
      <path d="M6.5 4V2.6a.6.6 0 0 1 .6-.6h1.8a.6.6 0 0 1 .6.6V4" />
      <path d="M4 4l.8 9.2a1 1 0 0 0 1 .8h4.4a1 1 0 0 0 1-.8L12 4" />
      <path d="M6.5 7v4.5M9.5 7v4.5" />
    </svg>
  )
}

export function IconeOeil({ taille = 15 }: { taille?: number }) {
  return (
    <svg
      width={taille}
      height={taille}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ verticalAlign: -2 }}
    >
      <path d="M1.5 8s2.4-4.2 6.5-4.2S14.5 8 14.5 8s-2.4 4.2-6.5 4.2S1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="1.9" />
    </svg>
  )
}
