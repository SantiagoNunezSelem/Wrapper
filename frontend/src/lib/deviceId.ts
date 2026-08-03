const deviceIdKey = 'vistazo-device-id'

/**
 * A random id kept in localStorage, sent only with subscription calls so the backend can
 * tell "same browser, different Google account" apart from two genuinely different
 * people. It is not a fingerprint: nothing about the machine is measured, it carries no
 * meaning on its own, and clearing site data resets it.
 *
 * That resettability is why the backend treats it as one signal among several rather
 * than as proof — see TrialEligibilityService.
 */
export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(deviceIdKey)
    if (existing) {
      return existing
    }

    const created = crypto.randomUUID()
    localStorage.setItem(deviceIdKey, created)
    return created
  } catch {
    // Private mode or storage disabled. A per-session id still works for the rest of
    // the request; the account and IP rules are what carry the weight anyway.
    return crypto.randomUUID()
  }
}
