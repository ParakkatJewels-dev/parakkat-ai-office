/** Count/display the same scoped initiatives, regardless of duplicate incidents or stale outcome labels. */
export function openIncidentInitiativeIds(initiatives,incidents) {
  const visible=new Set(initiatives.filter(row=>typeof row?.id==='string').map(row=>row.id));
  return new Set(incidents.filter(row=>row?.status==='open'&&visible.has(row.initiative_id)).map(row=>row.initiative_id));
}
