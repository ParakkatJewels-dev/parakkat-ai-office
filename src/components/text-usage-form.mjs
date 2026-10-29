const keys=['daily_call_limit','weekly_call_limit','daily_token_limit','weekly_token_limit','max_input_chars','max_output_tokens'];

export function sameTextUsageSettings(a,b) {
  return !!a&&!!b&&a.enabled===b.enabled&&keys.every(key=>a[key]===b[key]);
}

/** Live counters/settings refresh without replacing a manager's unsaved limit edits. */
export function mergeTextUsageDraft(draft,previousSaved,incomingSaved) {
  return !draft||sameTextUsageSettings(draft,previousSaved)?{...incomingSaved}:draft;
}
