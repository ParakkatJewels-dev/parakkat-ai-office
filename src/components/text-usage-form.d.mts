import type { AiBudgetSettings } from './TextUsageLimits';
export function sameTextUsageSettings(a:AiBudgetSettings|null|undefined,b:AiBudgetSettings|null|undefined): boolean;
export function mergeTextUsageDraft(draft:AiBudgetSettings|null,previousSaved:AiBudgetSettings|null,incomingSaved:AiBudgetSettings): AiBudgetSettings;
