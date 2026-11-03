/** Exact Odoo labels, kept separate from display names and never inferred from a warehouse code. */
export function odooBranchNames(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter(value => typeof value === 'string')
    .map(value => value.trim()).filter(value => value && value.length <= 200))].sort((a, b) => a.localeCompare(b));
}

export function includedOdooBranch(branch, excluded) {
  return !new Set(odooBranchNames(excluded)).has(String(branch || '').trim());
}

/** PostgREST's quoted in-list keeps spaces, commas and hyphens in exact Odoo labels. */
export function withoutOdooBranches(query, excluded, column = 'branch') {
  const names = odooBranchNames(excluded);
  return names.length ? query.not(column, 'in', `(${names.map(name => JSON.stringify(name)).join(',')})`) : query;
}

export function selectedOdooBranches(choices, included) {
  const available = odooBranchNames(choices), chosen = odooBranchNames(included);
  if (!available.length || !chosen.length || chosen.some(name => !available.includes(name))) throw new Error('Choose at least one listed Odoo branch. Refresh the branch list if a name is missing.');
  return available.filter(name => !chosen.includes(name));
}
