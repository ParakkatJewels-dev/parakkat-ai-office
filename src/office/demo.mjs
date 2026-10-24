// Demo mode: a scripted campaign that walks through all three buildings, plus the approval chain.
// The real app swaps the script for agent_events from Supabase; the approval logic stays the same.
import { APPROVER_NAMES, HUMAN_HEAD, teamLead } from './roster.mjs';

export const STAGES = ['Analyse', 'Plan', 'Create', 'AI review', 'Dept heads', 'Super Admin', 'Live'];

export const CAMPAIGNS = [
  { name: 'Diwali Gold Edit', occasion: 'Dhanteras and Diwali', headline: 'Diwali Gold Edit', sub: 'Temple and antique gold', heads: ['creativeHead', 'ecomManager', 'perfMarketer'],
    insight: 'Temple necklaces sold best last Diwali. Reels drove the most saves.', competitor: 'Competitor A started a making-charge offer and doubled reel ads.',
    brief: 'Brief: 6 temple and antique pieces, reels plus carousels, 10 days.', split: 'Split: Meta 70%, Google Search and Shopping 30%.',
    budget: 'Up to ₹8,000 per day for 10 days', channels: 'Instagram and Facebook reels and carousels; Google Search and Shopping',
    products: ['Temple Lakshmi Necklace', 'Antique Jhumkas', 'Kerala Palakka Mala', 'Gold Coin 4g'],
    reasons: ['Temple necklaces were the top seller last Diwali (sample)', 'Competitor A began a making-charge offer this week (sample)', 'Jev scores the reel variant 0.71 likely to beat the carousel (sample)'] },
  { name: "Children's Day Light Gold", occasion: "Children's Day", headline: 'Little Treasures', sub: 'Light gold for little ones', heads: ['creativeHead', 'ecomManager'],
    insight: 'Kids bangles get many saves but few clicks. Price may be the blocker.', competitor: 'Competitor B shows prices upfront on kids posts.',
    brief: 'Brief: kids bangles and studs, show price, carousel ads.', split: 'Split: Meta 85%, Google Shopping 15%.',
    budget: 'Up to ₹3,000 per day for 6 days', channels: 'Instagram carousel; Google Shopping', products: ["Kids' Gold Bangles", 'Butterfly Studs', 'Name Pendant'],
    reasons: ['High saves but low clicks on kids posts (sample)', 'Competitors show the price in the creative (sample)', 'Small budget to test before scaling'] },
  { name: 'Bridal Season Collection', occasion: 'Wedding season', headline: 'The Bridal Edit', sub: 'Heirloom sets for the big day', heads: ['creativeHead', 'ecomManager', 'perfMarketer'],
    insight: 'Bridal enquiries peak from late November (sample).', competitor: 'Competitor C pushes WhatsApp booking for bridal visits.',
    brief: 'Brief: 4 bridal sets, store visits plus WhatsApp booking, 3 weeks.', split: 'Split: Meta 60%, Google Search 40%.',
    budget: 'Up to ₹12,000 per day for 21 days', channels: 'Instagram and Facebook lead ads; Google Search', products: ['Kasu Mala Bridal Set', 'Bridal Choker', 'Oddiyanam Waist Belt'],
    reasons: ['Bridal enquiries rise from late November (sample)', 'Rivals use WhatsApp booking for store visits (sample)', 'Search captures people already planning'] },
];

/**
 * @param {ReturnType<import('./engine.mjs').createOffice>} office
 * @param {{ log: (p: any, text: string, kind?: string, to?: any) => void, stage: (i: number, c: any, text?: string) => void, changed: () => void }} ui
 */
export function createDemo(office, ui) {
  const A = office.byId, sleep = office.sleep;
  const state = { items: [], stage: 0, camp: CAMPAIGNS[0], role: 'superAdmin' };
  let seq = 0;

  const say = (id, text, to, kind = 'talking', ms) => { ui.log(A[id], text, kind, to && A[to]); return office.say(id, text, kind, ms); };
  const think = (id, text, ms) => { ui.log(A[id], text, 'thinking'); return office.think(id, text, ms); };
  const walk = (id, to) => office.walkTo(id, to);
  const home = id => office.walkHome(id);
  // walk over, say it, maybe get a reply, walk back (without waiting for the walk back)
  async function visit(id, to, text, reply, kind) { await walk(id, to); await say(id, text, to, kind); if (reply) await say(to, reply, id); home(id); }
  const stage = (i, c, text) => { state.stage = i; if (c) state.camp = c; ui.stage(i, state.camp, text); };

  async function campaignCycle(c) {
    stage(0, c, 'Fresh data in from Shopify, Meta and Google');
    await Promise.all([think('shopifySync', 'Pulling yesterday’s orders and stock', 2000), think('metaSync', 'Pulling Meta ads and Instagram insights', 2200), think('googleSync', 'Pulling Google Ads and GA4', 2000)]);
    await Promise.all([think('sales', 'Reading Shopify orders and products', 2400), think('adsAnalyst', 'Scoring Meta and Google ads with Jev', 2600), think('igScout', 'Reading competitor reels', 2600)]);
    stage(0, null, 'Insights Lab and War Room are reading the numbers');
    await visit('sales', 'analyticsLead', c.insight, 'Good find. Adding it to the brief.');
    await visit('igScout', 'warLead', c.competitor, 'Logging it on the war board.');
    // the War Room Lead crosses from the Intelligence Centre to Marketing HQ
    stage(0, null, 'War Room Lead walks the competitor report to Marketing HQ');
    office.setCarry('warLead', true);
    await visit('warLead', 'intelLead', `${c.occasion}: competitor report from the War Room.`, 'Thanks. I will brief Strategy.');
    await visit('intelLead', 'strategist', `${c.occasion}: competitor brief is ready.`);
    await visit('goldAnalyst', 'strategist', 'Gold rate is steady this week. Price-led posts are safe.');
    await visit('analyticsLead', 'strategist', 'Insights brief: best products and audiences.');

    stage(1, null, 'Planning the campaign');
    await Promise.all([think('picker', 'Ranking in-stock products with Jev', 2300), think('forecaster', `Forecasting ${c.occasion} demand`, 2500)]);
    await think('strategist', `Drafting the ${c.name} plan`, 2400);
    await visit('strategist', 'creativeDirector', c.brief);

    stage(2, null, 'Making creatives in Creative House');
    await Promise.all([think('photoEditor', 'Cleaning the Shopify product photos', 2600), think('bgGen', 'Painting a festive background', 2800), think('scriptWriter', 'Writing a reel hook', 2400), think('copywriter', 'Writing English headlines', 2600)]);
    // the Studio Lead brings the photos across from Creative House
    stage(2, null, 'Studio Lead brings photos over from Creative House');
    office.setCarry('studioLead', true);
    await visit('studioLead', 'creativeDirector', 'Product photos and festive backgrounds are ready.', 'Perfect. Designer, over to you.');
    await Promise.all([visit('copywriter', 'malayalam', 'Please translate these headlines for Kerala.'), think('designer', 'Generating banners from the photos', 3000)]);
    stage(2, null, 'Language Desk translates while the reel is cut');
    await Promise.all([think('malayalam', 'Writing Malayalam headlines', 2200), think('tamil', 'Writing Tamil headlines', 2200), think('videoEditor', 'Cutting a 15 second reel', 2600)]);
    office.setCarry('designer', true);
    await walk('designer', 'creativeDirector'); await say('designer', 'First banner set is ready.', 'creativeDirector');
    await say('creativeDirector', 'Show the price and use the close-up photo.', 'designer', 'feedback'); await home('designer');
    await think('designer', 'Revising the banners', 2000);
    office.setCarry('designer', true);
    await visit('designer', 'brandGuardian', 'Revised set. Please check it.');
    await think('brandGuardian', 'Checking colours, logo and wording', 2000);

    stage(3, null, 'AI review in the Intelligence Centre');
    office.setCarry('brandGuardian', true);
    await visit('brandGuardian', 'compliance', 'Banners and reel for a compliance check.');
    await Promise.all([think('compliance', 'Checking hallmark and purity claims', 2200), think('priceAuditor', 'Matching ad prices to Shopify', 2200), think('policyChecker', 'Checking Meta and Google ad policies', 2200)]);
    await think('creativeScorer', 'Predicting which banner wins with Jev', 2000);
    await say('compliance', 'All checks pass. Reel variant scores highest.', 'brandGuardian');
    stage(3, null, 'Budget check in the Performance Bay');
    await visit('mediaPlanner', 'perfLead', c.split, 'Fits the daily cap. Budget Guard will watch pacing.');
    office.setCarry('creativeDirector', true);
    await visit('creativeDirector', 'cmo', `${c.name}: plan and creatives are ready.`);
    await think('cmo', 'Reviewing the plan against goals and budget', 2800);
    const first = c.heads[0];
    office.setCarry('cmo', true); await walk('cmo', first);
    await say('cmo', `${c.name} is ready for department heads.`, first);
    addItem(c); office.setCarry('cmo', false); await home('cmo');
  }

  // Staff reports. A report to the reporter's own team lead goes through review; anything else is a plain chat.
  const AMBIENT = [
    ['postAnalyst', 'Yesterday’s reel led to 9 product page visits (sample).', 'smm'], ['contentPlanner', 'Drafting next week’s Instagram grid.'],
    ['priceScout', 'Competitor A dropped making charges to 8% (sample).', 'warLead'], ['trend', 'Gold rate moved today. Flagging price-led posts.'],
    ['reviewAnalyst', 'Shoppers keep praising the finish on jhumkas (sample).', 'custLead'], ['festivalKeeper', 'Karthika Deepam is coming up. Adding it to the calendar.'],
    ['segmenter', 'Found 340 lapsed buyers for a festive email (sample).', 'crmLead'], ['googleSpec', 'Search terms pulled. Two negative keywords proposed.'],
    ['metaSpec', 'Frequency on the evergreen ad is high. Suggest a refresh.', 'perfLead'], ['moodCurator', 'New winter bridal moodboard is up.', 'brandManager'],
    ['googleSync', 'Triple Whale numbers match Shopify within 2% (sample).', 'dataLead'], ['community', 'Many DMs ask for kids bangle prices (sample).', 'smm'],
    ['searchAnalyst', 'Searches for "light weight necklace" are up (sample).', 'custLead'], ['hindi', 'Hindi captions ready for the North India audience.', 'malayalam'],
    ['budgetForecaster', '₹2.4L spend would reach the Diwali target (sample).', 'perfLead'], ['emailDesigner', 'Dhanteras email draft is ready.', 'crmLead'],
    ['voiceKeeper', 'Reminder: we say "handcrafted", not "cheap".', 'copywriter'], ['layoutDesigner', 'Bridal catalogue pages 1 to 8 are laid out.', 'catalogLead'],
    ['eventsWatcher', 'Thrissur Pooram dates are confirmed for next year.'], ['audience', 'Lookalike from repeat buyers is ready.', 'strategist'],
  ];
  const REVISE = ['Add where this number comes from.', 'Compare it with last year first.', 'Show it by product, not overall.'];
  const REJECT = ['This duplicates yesterday’s report.', 'Sample is too small to act on.'];
  let reviews = 0;
  // The AI team lead re-checks a staff report, then forwards it to the human head, sends it back, or rejects it.
  async function review(staff, lead, text) {
    const head = HUMAN_HEAD[A[staff].dept], k = reviews++ % 5;
    await think(lead, `Reviewing the report from ${A[staff].name}`, 2000);
    if (k === 1) { const why = REVISE[reviews % REVISE.length]; await say(lead, `Send back: ${why}`, staff, 'feedback'); await think(staff, 'Revising the report', 2400); return; }
    if (k === 4) { await say(lead, `Rejected. ${REJECT[reviews % REJECT.length]}`, staff, 'feedback'); return; }
    const open = state.items.filter(i => i.kind === 'report' && !i.done && i.head === head).length;
    if (open >= 2) { await say(lead, 'Checked. Adding it to the weekly summary.', staff); return; }
    await say(lead, `Checked. Forwarding to the ${APPROVER_NAMES[head]}.`, staff);
    addReport({ staff, lead, head, dept: A[staff].dept, text });
  }
  async function ambient(offset, gap) {
    await sleep(offset);
    for (let i = offset; ; i += 3) { await sleep(gap); const [a, t, to] = AMBIENT[i % AMBIENT.length], p = A[a];
      if (p.bubble || !p.sitting) continue;
      if (!to || !A[to].sitting || A[to].bubble) { await think(a, t, 2600); continue; }
      await walk(a, to); await say(a, t, to); home(a);
      if (to === teamLead(p.dept)) await review(a, to, t); }
  }
  async function director() { for (let k = 0, order = [0, 2, 1]; ; k++) { while (state.items.filter(i => i.kind === 'plan' && !i.done).length >= 2) await sleep(1500); await campaignCycle(CAMPAIGNS[order[k % 3]]); await sleep(5000); } }

  /* ---------- approval chain ---------- */
  function addItem(c, version = 1, signed = {}) {
    const it = { id: ++seq, kind: 'plan', c, version, signed, done: false, result: null };
    state.items.unshift(it); ui.log(A.cmo, `${c.name}${version > 1 ? ' v' + version : ''} sent to ${c.heads.map(h => APPROVER_NAMES[h]).join(', ')}.`, 'talking', A[c.heads[0]]);
    refreshQuests(); stage(4, c, 'Waiting for department heads'); ui.changed(); return it;
  }
  function addReport(r) {
    const it = { id: ++seq, kind: 'report', ...r, done: false, result: null };
    state.items.unshift(it); ui.log(A[r.lead], `Report from ${A[r.staff].name} sent to the ${APPROVER_NAMES[r.head]}.`, 'talking', A[r.head]);
    refreshQuests(); ui.changed(); return it;
  }
  const nextFor = it => { if (it.done) return []; if (it.kind === 'report') return [it.head]; const left = it.c.heads.filter(h => !it.signed[h]); return left.length ? left : ['superAdmin']; };
  function refreshQuests() { Object.keys(APPROVER_NAMES).forEach(id => office.setQuest(id, state.items.some(it => nextFor(it).includes(id)))); }
  async function act(id, kind, note) {
    const it = state.items.find(i => i.id === id); if (!it || it.done) return; const role = state.role, who = A[role];
    if (it.kind === 'report') {
      it.done = true; it.result = kind; it.note = note; it.by = who.name;
      const verb = { approve: 'Accepted', changes: 'Sent back', reject: 'Rejected' }[kind];
      ui.log(who, `${verb} the ${A[it.staff].name} report${note ? ': ' + note : '.'}`, kind === 'approve' ? 'talking' : 'feedback', A[it.lead]); refreshQuests(); ui.changed();
      if (kind === 'changes') { await sleep(1500); await say(it.lead, `The ${APPROVER_NAMES[it.head]} wants changes: ${note}`, it.staff, 'feedback'); await think(it.staff, 'Revising the report', 2400); }
      return;
    }
    if (kind === 'approve') {
      if (role === 'superAdmin') {
        it.done = true; it.result = 'live'; ui.log(who, `Approved ${it.c.name}. Publishing.`); refreshQuests(); ui.changed(); stage(6, it.c, 'Publishing within the approved cap');
        await think('metaSpec', `Creating ${it.c.name} Meta ads within the cap`, 2600); await think('googleSpec', 'Creating Google ads within the cap', 2400);
        it.live = true; ui.log(A.metaSpec, `${it.c.name} is live. Budget Guard is tracking it daily.`, 'live'); ui.changed(); return;
      }
      it.signed[role] = true; ui.log(who, `Approved ${it.c.name}.`); refreshQuests(); ui.changed();
      if (!it.c.heads.some(h => !it.signed[h])) { stage(5, it.c, 'Waiting for the Super Admin'); if (who.sitting) { office.setCarry(role, true); await visit(role, 'superAdmin', `${it.c.name} has all head approvals.`); } }
    } else {
      it.done = true; it.result = kind; it.note = note; it.by = who.name; ui.log(who, `${kind === 'changes' ? 'Requested changes on' : 'Rejected'} ${it.c.name}: ${note}`, 'feedback'); refreshQuests(); ui.changed();
      if (kind === 'changes') { await sleep(1800); ui.log(A.creativeDirector, 'Revising with the note now.'); await sleep(14000); addItem(it.c, it.version + 1); }
      else { await sleep(1500); ui.log(A.cmo, 'Reason logged. Future plans will learn from it.'); }
    }
  }
  function setRole(r) { state.role = r; refreshQuests(); ui.changed(); }
  function start() {
    addItem(CAMPAIGNS[1], 1, { creativeHead: true }); state.items.reverse();
    stage(0, CAMPAIGNS[0], 'Analysing sales, ads and competitors');
    ui.log(A.cmo, 'Morning team. Dhanteras is two weeks out. Let’s get the Diwali plan moving.');
    director(); ambient(0, 5200); ambient(1, 6100); ambient(2, 7300);
  }
  return { state, act, nextFor, setRole, start, CAMPAIGNS, STAGES };
}
