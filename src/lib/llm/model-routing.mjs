// An explicit workload policy. The caller names the work; routing never guesses
// from prompt text, and a missing specialist provider keeps the ChatGPT path.
export const MODEL_USE_CASES = Object.freeze({
  decision: { label: 'Planning, analysis and final decisions', preferred: 'chatgpt' },
  review: { label: 'Head and quality review', preferred: 'chatgpt' },
  reviewed_draft: { label: 'Drafts checked by a head or QC reviewer', preferred: 'nim' },
  reviewed_specialist: { label: 'Specialist work with a ChatGPT final review', preferred: 'nim' },
});

export function preferredTextProvider(useCase, { chatReady = true, nimReady = false } = {}) {
  if (!chatReady) return 'wait';
  const preferred = MODEL_USE_CASES[useCase]?.preferred || 'chatgpt';
  if (preferred === 'nim' && nimReady) return 'nim';
  return 'chatgpt';
}
