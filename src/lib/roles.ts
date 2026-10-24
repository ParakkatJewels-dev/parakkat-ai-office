// The four people who sign off, as stored in the database and as named in the office roster.
export type AppRole = 'super_admin' | 'creative_head' | 'ecom_manager' | 'perf_marketer' | 'viewer';

export const ROLE_TO_PERSON: Record<Exclude<AppRole, 'viewer'>, string> = {
  super_admin: 'superAdmin', creative_head: 'creativeHead', ecom_manager: 'ecomManager', perf_marketer: 'perfMarketer',
};
export const ROLE_LABEL: Record<AppRole, string> = {
  super_admin: 'Super Admin', creative_head: 'Creative Head', ecom_manager: 'E-com Manager', perf_marketer: 'Performance Marketer', viewer: 'Viewer',
};
