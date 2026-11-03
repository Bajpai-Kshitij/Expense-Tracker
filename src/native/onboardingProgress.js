/**
 * Onboarding progress manager and logger.
 * Tracks step start/finish/error without logging personal data.
 */

let progressListener = null;

/**
 * Registers a listener for onboarding step state changes.
 * 
 * @param {(update: { step: string, status: 'running'|'completed'|'failed', error?: string }) => void} listener 
 */
export function setOnboardingProgressListener(listener) {
  progressListener = listener;
}

export function logStepStart(stepName) {
  console.log(`[Onboarding] Step started: ${stepName}`);
  if (progressListener) {
    try {
      progressListener({ step: stepName, status: 'running' });
    } catch (e) {}
  }
}

export function logStepFinish(stepName) {
  console.log(`[Onboarding] Step finished: ${stepName}`);
  if (progressListener) {
    try {
      progressListener({ step: stepName, status: 'completed' });
    } catch (e) {}
  }
}

export function logStepError(stepName, error) {
  const msg = error?.message || String(error);
  console.log(`[Onboarding] Step failed: ${stepName} - ${msg}`);
  if (progressListener) {
    try {
      progressListener({ step: stepName, status: 'failed', error: msg });
    } catch (e) {}
  }
}

