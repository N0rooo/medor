import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { openUrl } from '@tauri-apps/plugin-opener'
import type {
  AccountConfig,
  AddAccountInput,
  ApercuMail,
  AppBootstrap,
  ApplyProgress,
  ArbreCompte,
  ApplyResult,
  ApplySelection,
  BoucleProgress,
  DeleteLabelsResult,
  DossierCompte,
  JournalEntry,
  MsDeviceCodeInfo,
  Plan,
  RestoreResult,
  ScanProgress,
  ScanScope,
  SettingsPatch,
  UnsubscribeResult,
  VidageMultiple,
  VidageResult
} from './types'

export const api = {
  getState: () => invoke<AppBootstrap>('get_state'),
  setSettings: (patch: SettingsPatch) => invoke<AppBootstrap>('set_settings', { patch }),
  setAutostart: (enabled: boolean) => invoke<void>('set_autostart', { enabled }),

  addAccount: (input: AddAccountInput) => invoke<AccountConfig>('add_account', { input }),
  removeAccount: (id: string) => invoke<void>('remove_account', { id }),

  googleConnect: () => invoke<AccountConfig>('google_connect'),
  msDeviceStart: () => invoke<MsDeviceCodeInfo>('ms_device_start'),
  msDeviceFinish: () => invoke<AccountConfig>('ms_device_finish'),
  oauthCancel: () => invoke<void>('oauth_cancel'),
  cancelOperation: (accountId: string) => invoke<void>('cancel_operation', { accountId }),
  opsActives: () => invoke<number>('ops_actives'),
  autoPending: () => invoke<boolean>('auto_pending'),
  autoRunNow: () => invoke<void>('auto_run_now'),
  autoDefer: () => invoke<void>('auto_defer'),
  autoNext: () => invoke<number | null>('auto_next'),

  getLastPlan: (accountId: string) => invoke<Plan | null>('get_last_plan', { accountId }),
  rescanOrganized: (accountId: string) => invoke<Plan>('rescan_organized', { accountId }),
  mailboxTree: (accountId: string) => invoke<DossierCompte[]>('mailbox_tree', { accountId }),
  getLastTree: (accountId: string) => invoke<ArbreCompte | null>('get_last_tree', { accountId }),
  folderPreview: (accountId: string, folder: string, offset = 0) =>
    invoke<ApercuMail[]>('folder_preview', { accountId, folder, offset }),
  trashFolder: (accountId: string, folder: string) =>
    invoke<VidageResult>('trash_folder', { accountId, folder }),
  trashFolders: (accountId: string, folders: string[]) =>
    invoke<VidageMultiple>('trash_folders', { accountId, folders }),
  scanAccount: (accountId: string, scope: ScanScope, fresh: boolean) =>
    invoke<Plan>('scan_account', { accountId, scope, fresh }),
  deleteLabels: (accountId: string, onlyRangemail: boolean) =>
    invoke<DeleteLabelsResult>('delete_labels', { accountId, onlyRangemail }),
  restoreInbox: (accountId: string) => invoke<RestoreResult>('restore_inbox', { accountId }),
  trashSenders: (accountId: string, senderKeys: string[]) =>
    invoke<number>('trash_senders', { accountId, senderKeys }),
  sortEverything: (accountId: string, scope: ScanScope, fresh: boolean) =>
    invoke<ApplyResult>('sort_everything', { accountId, scope, fresh }),
  getJournal: () => invoke<JournalEntry[]>('get_journal'),
  undoJournal: (entryId: string) => invoke<RestoreResult>('undo_journal_entry', { entryId }),
  getSenderPreview: (accountId: string, senderKey: string) =>
    invoke<ApercuMail[]>('get_sender_preview', { accountId, senderKey }),
  applyPlan: (accountId: string, selection: ApplySelection) =>
    invoke<ApplyResult>('apply_plan', { accountId, selection }),
  unsubscribeMany: (accountId: string, senderKeys: string[]) =>
    invoke<Record<string, string>>('unsubscribe_many', { accountId, senderKeys }),
  unsubscribeOneClick: (accountId: string, senderKey: string) =>
    invoke<UnsubscribeResult>('unsubscribe_one_click', { accountId, senderKey }),

  openUrl: (url: string) => openUrl(url)
}

export function onScanProgress(cb: (p: ScanProgress) => void): Promise<() => void> {
  return listen<ScanProgress>('scan-progress', (e) => cb(e.payload))
}

export function onApplyProgress(cb: (p: ApplyProgress) => void): Promise<() => void> {
  return listen<ApplyProgress>('apply-progress', (e) => cb(e.payload))
}

export function onBoucleProgress(cb: (p: BoucleProgress) => void): Promise<() => void> {
  return listen<BoucleProgress>('boucle-progress', (e) => cb(e.payload))
}

export interface OpEtat {
  accountId: string
  kind: string
  actif: boolean
}

/** Début/fin d'opération, annoncés par le backend au moment du verrou. */
export function onOpEtat(cb: (e: OpEtat) => void): Promise<() => void> {
  return listen<OpEtat>('op-etat', (e) => cb(e.payload))
}
