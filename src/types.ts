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
  autoEnabled: boolean
  /** 1h | 6h | jour */
  autoFrequency: string
  autoHour: number
  autoScope: string
  autoJunk: boolean
  /** Nombre maximal de mails par analyse (0 = sans limite). */
  scanLimit: number
  /** Notification quand une opération se termine. */
  notifyDone: boolean
  /** Jouer un son avec la notification. */
  notifySound: boolean
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
  /** Claude Code détecté : classement IA possible via l'abonnement Claude, sans clé API. */
  claudeCliAvailable: boolean
  /** Résumé du dernier rangement automatique, s'il y en a eu un. */
  lastAuto?: string | null
  /** Médor se lance à l'ouverture de session. */
  autostartEnabled: boolean
  /** Mails rangés depuis l'adoption. */
  totalArchived: number
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
  lastTs: number
  unsubscribedAt?: number | null
  stillMailing: boolean
}

export interface ApercuMail {
  subject: string
  date: string
  seen: boolean
  from?: string
}

export interface DossierCompte {
  name: string
  total: number
  unseen: number
}

export interface VidageResult {
  trashed: number
  folderDeleted: boolean
}

export interface VidageMultiple {
  trashed: number
  deleted: string[]
}

export interface ArbreCompte {
  dossiers: DossierCompte[]
  updatedAt: number
}

export interface JournalEntry {
  id: string
  accountId: string
  accountEmail: string
  ts: number
  kind: 'rangement' | 'auto' | 'corbeille' | 'restauration'
  archived: number
  junked: number
  trashed: number
  restored: number
  labelsCreated: number
  labels: string[]
}

export interface BoucleProgress {
  passe: number
  archivesCumules: number
}

export interface PlanLabel {
  name: string
  senderKeys: string[]
  readCount: number
  totalCount: number
}

export interface Plan {
  scannedAt?: number
  accountId: string
  scanned: number
  inboxTotal: number
  senders: SenderGroup[]
  labels: PlanLabel[]
  newsletters: string[]
  spamSuspects: string[]
  generatedBy: 'ia' | 'heuristique'
  aiNote?: string | null
  scope: ScanScope
  /** Libellés déjà présents sur le serveur (pour afficher créé vs complété). */
  existingLabels: string[]
}

export interface ScanProgress {
  phase: 'connexion' | 'liste' | 'lecture' | 'classement' | 'ia'
  done: number
  total: number
  note?: string | null
}

export type ScanScope = 'tous' | 'lus' | 'nonlus'

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

export interface DeleteLabelsResult {
  deleted: number
  errors: string[]
}

export interface RestoreResult {
  restored: number
  foldersDeleted: number
  errors: string[]
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
  autoEnabled?: boolean
  autoFrequency?: string
  autoHour?: number
  autoScope?: string
  autoJunk?: boolean
  scanLimit?: number
  notifyDone?: boolean
  notifySound?: boolean
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
