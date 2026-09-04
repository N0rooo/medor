/* Palette officielle Gmail (fonds autorisés par l'API) — partagée. */
export const PALETTE = [
  '#fb4c2f',
  '#ffad47',
  '#fad165',
  '#16a766',
  '#43d692',
  '#4a86e8',
  '#285bac',
  '#a479e2',
  '#f691b3',
  '#e66550',
  '#999999',
  '#2da2bb'
]

const COULEURS_DEFAUT: Record<string, string> = {
  Finances: '#16a766',
  Factures: '#ffad47',
  Shopping: '#e66550',
  Voyages: '#2da2bb',
  Sport: '#43d692',
  Santé: '#f691b3',
  Loisirs: '#a479e2',
  'Réseaux sociaux': '#4a86e8',
  Newsletters: '#fad165',
  Sécurité: '#fb4c2f',
  Administratif: '#285bac',
  Dev: '#999999'
}

export function couleurAuto(nom: string): string {
  if (COULEURS_DEFAUT[nom]) return COULEURS_DEFAUT[nom]
  let h = 0
  for (const c of nom) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}
