import medor from './assets/medor.png'

/**
 * La mascotte Médor.
 * - fixe : posée, avec un petit frétillement au survol
 * - renifle : cherche des mails (écrans de progression)
 * - joie : contente du travail accompli (succès)
 */
export default function Mascotte({
  taille = 32,
  humeur = 'fixe',
  style
}: {
  taille?: number
  humeur?: 'fixe' | 'renifle' | 'joie'
  style?: React.CSSProperties
}) {
  return (
    <img
      src={medor}
      alt=""
      width={taille}
      height={taille}
      className={`mascotte ${humeur}`}
      draggable={false}
      style={style}
    />
  )
}
