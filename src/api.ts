import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { openUrl } from '@tauri-apps/plugin-opener'
import type {
  AccountConfig,
  AddAccountInput,
  AppBootstrap,
  ApplyProgress,
  ApplyResult,
  ApplySelection,
  MsDeviceCodeInfo,
  OnboardingAnswers,
  Plan,
  ScanProgress,
  SettingsPatch,
  UnsubscribeResult
} from './types'

export const api = {
  getState: () => invoke<AppBootstrap>('get_state'),
  setOnboarding: (answers: OnboardingAnswers) => invoke<void>('set_onboarding', { answers }),
  setSettings: (patch: SettingsPatch) => invoke<AppBootstrap>('set_settings', { patch }),

  addAccount: (input: AddAccountInput) => invoke<AccountConfig>('add_account', { input }),
  removeAccount: (id: string) => invoke<void>('remove_account', { id }),

  googleConnect: () => invoke<AccountConfig>('google_connect'),
  msDeviceStart: () => invoke<MsDeviceCodeInfo>('ms_device_start'),
  msDeviceFinish: () => invoke<AccountConfig>('ms_device_finish'),

  scanAccount: (accountId: string) => invoke<Plan>('scan_account', { accountId }),
  applyPlan: (accountId: string, selection: ApplySelection) =>
    invoke<ApplyResult>('apply_plan', { accountId, selection }),
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
