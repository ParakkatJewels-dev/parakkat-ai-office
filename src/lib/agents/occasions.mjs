// The occasions a Kerala jeweller plans around. Fixed dates are exact; dates from the Malayalam and Hindu calendars were
// checked against the Kerala holiday list and panchang for these years (October 2026). Add the next year's as it is published.
export const OCCASIONS = [
  { name: 'Dhanteras', date: '2026-11-06', lead: 21, why: 'the biggest gold-buying day of the year' },
  { name: 'Diwali', date: '2026-11-08', lead: 21, why: 'gifting and gold coins' },
  { name: 'Kerala wedding season (November to February)', date: '2026-11-15', lead: 28, why: 'bridal sets, necklaces and bangles' },
  { name: 'Christmas', date: '2026-12-25', lead: 21, why: 'gifting, light jewellery and diamonds' },
  { name: 'New Year', date: '2027-01-01', lead: 14, why: 'self-gifting and lightweight gold' },
  { name: 'Valentine\'s Day', date: '2027-02-14', lead: 21, why: 'couple rings, diamond pendants' },
  { name: 'Women\'s Day', date: '2027-03-08', lead: 14, why: 'daily-wear jewellery for women buying for themselves' },
  { name: 'Eid ul-Fitr', date: '2027-03-09', lead: 21, why: 'gifting, Gulf and Malabar buyers' },
  { name: 'Easter', date: '2027-03-28', lead: 14, why: 'Christian family gifting in central Kerala' },
  { name: 'Vishu', date: '2027-04-15', lead: 21, why: 'Vishukkani gold and new beginnings' },
  { name: 'Akshaya Tritiya', date: '2027-05-08', lead: 21, why: 'the most auspicious day to buy gold (check the panchang; may fall on 9 May in India)' },
  { name: 'Kerala wedding season (April to May)', date: '2027-04-20', lead: 28, why: 'bridal and wedding gold' },
  { name: 'Bakrid', date: '2027-05-17', lead: 14, why: 'gifting, Gulf and Malabar buyers' },
  { name: 'Onam (Thiruvonam)', date: '2027-09-12', lead: 30, why: 'the biggest Kerala festival; kasavu, temple and traditional designs' },
  { name: 'Deepavali', date: '2027-10-29', lead: 21, why: 'gifting and gold coins' },
  { name: 'Christmas', date: '2027-12-25', lead: 21, why: 'gifting, light jewellery and diamonds' },
];

const DAY = 864e5;
/** Occasions from today up to `days` ahead, with days left and whether planning should already have started. */
export function upcoming(today = new Date(), days = 60) {
  const t0 = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return OCCASIONS.map(o => ({ ...o, left: Math.round((Date.parse(o.date) - t0) / DAY) }))
    .filter(o => o.left >= 0 && o.left <= days).sort((a, b) => a.left - b.left)
    .map(o => ({ ...o, due: o.left <= o.lead }));
}

/** True when an open or recent campaign already covers this occasion, so the planner does not open a second one. */
export function covered(occasion, existing) {
  const words = s => new Set(String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !['campaign', 'season', 'kerala', 'edit', 'collection'].includes(w)));
  const a = words(occasion);
  return existing.some(e => { const b = words(e); return [...a].some(w => b.has(w)); });
}
