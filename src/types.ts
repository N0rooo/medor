// Types miroir des structures Rust (serde camelCase).

export type ProviderId = 'gmail' | 'outlook' | 'icloud' | 'imap'
export type AuthKind = 'password' | 'oauth-google' | 'oauth-microsoft'

export interface ImapEndpoint {
  host: string
  port: number
}

export interface AccountConfig {
  id: string
  provider: ProviderId
  email: string
  authKind: AuthKind
  imap: ImapEndpoint
  createdAt: string
}

export interface OnboardingAnswers {
  usage: 'perso' | 'pro' | 'mixte'
  categories: string[]
  granularity: 'large' | 'fin'
  horizonMonths: number
  archiveReadNewsletters: boolean
  notes: string
}

export interface Settings {
  model: string
  googleClientId: string
  googleClientSecret: string
  msClientId: string
}

export interface AppBootstrap {
  accounts: AccountConfig[]
  onboarding: OnboardingAnswers | null
  settings: Settings
  hasAnthropicKey: boolean
  /** Connexion « Se connecter avec Google » disponible (identifiant embarqué ou renseigné). */
  googleOauthReady: boolean
  /** Connexion Microsoft disponible. */
  msOauthReady: boolean
}

export interface SenderGroup {
  key: string
  name: string
  address: string
  domain: string
  total: number
  read: number
  unread: number
  lastDate: string
  isNewsletter: boolean
  oneClick: boolean
  unsubscribeHttp?: string | null
  unsubscribeMailto?: string | null
  sampleSubjects: string[]
  label: string
  spamSuspect: boolean
}

export interface PlanLabel {
  name: string
  senderKeys: string[]
  readCount: number
  totalCount: number
}

export interface Plan {
  accountId: string
  scanned: number
  inboxTotal: number
  senders: SenderGroup[]
  labels: PlanLabel[]
  newsletters: string[]
  spamSuspects: string[]
  generatedBy: 'ia' | 'heuristique'
  aiNote?: string | null
}

export interface ScanProgress {
  phase: 'connexion' | 'liste' | 'lecture' | 'classement' | 'ia'
  done: number
  total: number
  note?: string | null
}

export interface ApplySelection {
  labels: { name: string; senderKeys: string[] }[]
  junkSenderKeys: string[]
}

export interface ApplyProgress {
  done: number
  total: number
  label: string
}

export interface ApplyResult {
  archived: number
  labelsCreated: number
  junked: number
  errors: string[]
}

export interface MsDeviceCodeInfo {
  userCode: string
  verificationUri: string
  message: string
}

export interface UnsubscribeResult {
  ok: boolean
  method: 'one-click' | 'lien' | 'mailto' | 'aucun'
  detail: string
}

export interface AddAccountInput {
  provider: ProviderId
  email: string
  authKind: AuthKind
  password?: string
  imap?: ImapEndpoint
}

export interface SettingsPatch {
  model?: string
  googleClientId?: string
  googleClientSecret?: string
  msClientId?: string
  anthropicKey?: string
}

export const DEFAULT_CATEGORIES = [
  'Factures & reçus',
  'Banque & finance',
  'Shopping & livraisons',
  'Voyages & réservations',
  'Réseaux sociaux',
  'Newsletters',
  'Sécurité & comptes',
  'Administratif',
  'Travail',
  'Dev & outils'
]
