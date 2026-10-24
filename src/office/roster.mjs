// The Parakkat campus: buildings, rooms and everyone who works in them.
// Shared by the 3D office (positions, looks) and the agent engine (roles, models).

/** @typedef {{ id: string, name: string, short: string, ox: number, cols: number }} Building */
/** @typedef {{ id: string, name: string, building: string, col: number, row: 0 | 1, floor: string, decor: string }} Room */
/** @typedef {{ id: string, name: string, role: string, room: string, seat: number, model: string, dept: string, head?: boolean, human?: boolean }} Person */

/** @type {Building[]} */
export const BUILDINGS = [
  { id: 'ic', name: 'Parakkat Intelligence Centre', short: 'Intelligence Centre', ox: -48, cols: 3 },
  { id: 'hq', name: 'Parakkat Marketing HQ', short: 'Marketing HQ', ox: 0, cols: 4 },
  { id: 'ch', name: 'Parakkat Creative House', short: 'Creative House', ox: 48, cols: 3 },
];

/** @type {Room[]} */
export const ROOMS = [
  // Marketing HQ
  { id: 'board', name: 'Boardroom', building: 'hq', col: 0, row: 0, floor: 'wood', decor: 'board' },
  { id: 'insights', name: 'Insights Lab', building: 'hq', col: 1, row: 0, floor: 'oak', decor: 'insights' },
  { id: 'intel', name: 'Market Intel', building: 'hq', col: 2, row: 0, floor: 'concrete', decor: 'intel' },
  { id: 'strategy', name: 'Strategy Room', building: 'hq', col: 3, row: 0, floor: 'oak', decor: 'strategy' },
  { id: 'creative', name: 'Creative Studio', building: 'hq', col: 0, row: 1, floor: 'carpet', decor: 'creative' },
  { id: 'social', name: 'Social Desk', building: 'hq', col: 1, row: 1, floor: 'wood', decor: 'social' },
  { id: 'perf', name: 'Performance Bay', building: 'hq', col: 2, row: 1, floor: 'concrete', decor: 'perf' },
  { id: 'lead', name: 'Leadership Suite', building: 'hq', col: 3, row: 1, floor: 'marble', decor: 'lead' },
  // Intelligence Centre
  { id: 'warroom', name: 'Competitor War Room', building: 'ic', col: 0, row: 0, floor: 'concrete', decor: 'warroom' },
  { id: 'customer', name: 'Customer Insights', building: 'ic', col: 1, row: 0, floor: 'oak', decor: 'screens' },
  { id: 'goldrate', name: 'Gold Rate and Trends', building: 'ic', col: 2, row: 0, floor: 'wood', decor: 'ticker' },
  { id: 'datahub', name: 'Data Hub', building: 'ic', col: 0, row: 1, floor: 'concrete', decor: 'servers' },
  { id: 'forecast', name: 'Forecast Lab', building: 'ic', col: 1, row: 1, floor: 'carpet', decor: 'screens' },
  { id: 'qa', name: 'Quality and Compliance', building: 'ic', col: 2, row: 1, floor: 'marble', decor: 'shelves' },
  // Creative House
  { id: 'photo', name: 'Photo Studio', building: 'ch', col: 0, row: 0, floor: 'concrete', decor: 'photo' },
  { id: 'reels', name: 'Reels Studio', building: 'ch', col: 1, row: 0, floor: 'wood', decor: 'reels' },
  { id: 'catalog', name: 'Catalogue Room', building: 'ch', col: 2, row: 0, floor: 'oak', decor: 'shelves' },
  { id: 'lang', name: 'Language Desk', building: 'ch', col: 0, row: 1, floor: 'carpet', decor: 'shelves' },
  { id: 'crm', name: 'CRM and Email', building: 'ch', col: 1, row: 1, floor: 'oak', decor: 'screens' },
  { id: 'brand', name: 'Brand Studio', building: 'ch', col: 2, row: 1, floor: 'marble', decor: 'moodboard' },
];

const GPT_M = 'OpenAI GPT, manager tier', GPT_W = 'OpenAI GPT, worker tier', GEM_I = 'Gemini image model', GEM = 'Gemini, worker tier';
const JEV = (also) => `Jev for scoring${also ? ', ' + also : ''}`;

/** @type {Person[]} */
export const PEOPLE = [
  // Marketing HQ
  { id: 'cmo', name: 'AI Chief Marketing Officer', role: 'Sets goals and reviews every plan', room: 'board', seat: 0, model: GPT_M, dept: 'board', head: true },
  { id: 'analyticsLead', name: 'Analytics Lead', role: 'Head of Insights Lab', room: 'insights', seat: 0, model: GPT_M, dept: 'insights', head: true },
  { id: 'sales', name: 'Sales Analyst', role: 'Shopify and GA4 results', room: 'insights', seat: 1, model: GPT_W, dept: 'insights' },
  { id: 'adsAnalyst', name: 'Ads Analyst', role: 'Meta and Google results', room: 'insights', seat: 2, model: JEV('GPT for notes'), dept: 'insights' },
  { id: 'attribution', name: 'Attribution Analyst', role: 'Which channel earned each sale', room: 'insights', seat: 3, model: GPT_W, dept: 'insights' },
  { id: 'intelLead', name: 'Intelligence Lead', role: 'Head of Market Intel', room: 'intel', seat: 0, model: GPT_M, dept: 'intel', head: true },
  { id: 'scout', name: 'Competitor Scout', role: 'Finds competitors and their moves', room: 'intel', seat: 1, model: JEV('GPT summaries'), dept: 'intel' },
  { id: 'trend', name: 'Trend Watcher', role: 'Festivals and trends', room: 'intel', seat: 2, model: GEM, dept: 'intel' },
  { id: 'strategist', name: 'Campaign Strategist', role: 'Head of Strategy Room', room: 'strategy', seat: 0, model: GPT_M, dept: 'strategy', head: true },
  { id: 'mediaPlanner', name: 'Media Planner', role: 'Budget split across channels', room: 'strategy', seat: 1, model: GPT_W, dept: 'strategy' },
  { id: 'picker', name: 'Product Picker', role: 'Chooses in-stock Shopify products', room: 'strategy', seat: 2, model: JEV('GPT explains'), dept: 'strategy' },
  { id: 'audience', name: 'Audience Planner', role: 'Builds audiences and lookalikes', room: 'strategy', seat: 3, model: GPT_W, dept: 'strategy' },
  { id: 'creativeDirector', name: 'Creative Director AI', role: 'Head of Creative Studio', room: 'creative', seat: 0, model: GPT_M, dept: 'creative', head: true },
  { id: 'copywriter', name: 'Copywriter', role: 'Headlines and captions', room: 'creative', seat: 1, model: GPT_W, dept: 'creative' },
  { id: 'designer', name: 'Banner Designer', role: 'Banners and posters', room: 'creative', seat: 2, model: GEM_I, dept: 'creative' },
  { id: 'brandGuardian', name: 'Brand Guardian', role: 'Checks prices, logo, wording', room: 'creative', seat: 3, model: JEV('GPT explains'), dept: 'creative' },
  { id: 'smm', name: 'Social Media Manager AI', role: 'Head of Social Desk', room: 'social', seat: 0, model: GPT_M, dept: 'social', head: true },
  { id: 'contentPlanner', name: 'Content Planner', role: 'Instagram and Facebook calendar', room: 'social', seat: 1, model: GPT_W, dept: 'social' },
  { id: 'postAnalyst', name: 'Post Analyst', role: 'Which posts lead to sales', room: 'social', seat: 2, model: JEV(), dept: 'social' },
  { id: 'community', name: 'Community Manager', role: 'Comments and DMs themes', room: 'social', seat: 3, model: GPT_W, dept: 'social' },
  { id: 'perfLead', name: 'Performance Lead AI', role: 'Head of Performance Bay', room: 'perf', seat: 0, model: GPT_M, dept: 'perf', head: true },
  { id: 'metaSpec', name: 'Meta Ads Specialist', role: 'Facebook and Instagram ads', room: 'perf', seat: 1, model: GPT_W, dept: 'perf' },
  { id: 'googleSpec', name: 'Google Ads Specialist', role: 'Search and Shopping ads', room: 'perf', seat: 2, model: GPT_W, dept: 'perf' },
  { id: 'budgetGuard', name: 'Budget Guard', role: 'Caps and pacing', room: 'perf', seat: 3, model: JEV(), dept: 'perf' },
  { id: 'creativeHead', name: 'Creative Head', role: 'Approves creatives', room: 'lead', seat: 0, model: 'Person', dept: 'lead', human: true },
  { id: 'ecomManager', name: 'E-com Manager', role: 'Approves products, offers and pricing', room: 'lead', seat: 1, model: 'Person', dept: 'lead', human: true },
  { id: 'perfMarketer', name: 'Performance Marketer', role: 'Approves budgets and targeting', room: 'lead', seat: 2, model: 'Person', dept: 'lead', human: true },
  { id: 'superAdmin', name: 'Super Admin', role: 'Final approval before anything goes live', room: 'lead', seat: 3, model: 'Person', dept: 'lead', human: true },
  // Intelligence Centre
  { id: 'warLead', name: 'War Room Lead', role: 'Head of competitor research', room: 'warroom', seat: 0, model: GPT_M, dept: 'warroom', head: true },
  { id: 'igScout', name: 'Instagram Scout', role: 'Competitor posts and reels', room: 'warroom', seat: 1, model: JEV('GPT summaries'), dept: 'warroom' },
  { id: 'adLibScout', name: 'Ad Library Scout', role: 'Competitor ads on Meta and Google', room: 'warroom', seat: 2, model: JEV('GPT summaries'), dept: 'warroom' },
  { id: 'priceScout', name: 'Price Scout', role: 'Competitor offers and making charges', room: 'warroom', seat: 3, model: GPT_W, dept: 'warroom' },
  { id: 'custLead', name: 'Customer Insights Lead', role: 'What shoppers want', room: 'customer', seat: 0, model: GPT_M, dept: 'customer', head: true },
  { id: 'reviewAnalyst', name: 'Review Analyst', role: 'Reviews and ratings themes', room: 'customer', seat: 1, model: JEV(), dept: 'customer' },
  { id: 'searchAnalyst', name: 'Search Trends Analyst', role: 'What people search for', room: 'customer', seat: 2, model: GEM, dept: 'customer' },
  { id: 'goldAnalyst', name: 'Gold Rate Analyst', role: 'Daily gold and silver rates', room: 'goldrate', seat: 0, model: GPT_W, dept: 'goldrate', head: true },
  { id: 'festivalKeeper', name: 'Festival Calendar Keeper', role: 'Festivals, auspicious days, weddings', room: 'goldrate', seat: 1, model: GEM, dept: 'goldrate' },
  { id: 'eventsWatcher', name: 'Local Events Watcher', role: 'Kerala events and holidays', room: 'goldrate', seat: 2, model: GEM, dept: 'goldrate' },
  { id: 'dataLead', name: 'Data Hub Lead', role: 'Head of Data Hub, checks every sync', room: 'datahub', seat: 0, model: GPT_M, dept: 'datahub', head: true },
  { id: 'shopifySync', name: 'Shopify Sync Bot', role: 'Products, orders, stock', room: 'datahub', seat: 1, model: 'Scheduled job', dept: 'datahub' },
  { id: 'metaSync', name: 'Meta Sync Bot', role: 'Ads, Instagram, Facebook', room: 'datahub', seat: 2, model: 'Scheduled job', dept: 'datahub' },
  { id: 'googleSync', name: 'Google Sync Bot', role: 'Google Ads, GA4, Triple Whale', room: 'datahub', seat: 3, model: 'Scheduled job', dept: 'datahub' },
  { id: 'forecaster', name: 'Demand Forecaster', role: 'Sales forecast by product', room: 'forecast', seat: 0, model: GPT_W, dept: 'forecast', head: true },
  { id: 'budgetForecaster', name: 'Budget Forecaster', role: 'Spend needed for a target', room: 'forecast', seat: 1, model: GPT_W, dept: 'forecast' },
  { id: 'creativeScorer', name: 'Creative Scorer', role: 'Predicts winning creatives', room: 'forecast', seat: 2, model: JEV(), dept: 'forecast' },
  { id: 'compliance', name: 'Compliance Checker', role: 'Hallmark and claims rules', room: 'qa', seat: 0, model: JEV('GPT explains'), dept: 'qa', head: true },
  { id: 'priceAuditor', name: 'Price Auditor', role: 'Ad prices match Shopify', room: 'qa', seat: 1, model: JEV(), dept: 'qa' },
  { id: 'policyChecker', name: 'Ad Policy Checker', role: 'Meta and Google ad policies', room: 'qa', seat: 2, model: JEV(), dept: 'qa' },
  // Creative House
  { id: 'studioLead', name: 'Studio Lead', role: 'Head of Photo Studio', room: 'photo', seat: 0, model: GPT_M, dept: 'photo', head: true },
  { id: 'photoEditor', name: 'Product Photo Editor', role: 'Cleans Shopify photos', room: 'photo', seat: 1, model: GEM_I, dept: 'photo' },
  { id: 'bgGen', name: 'Background Artist', role: 'Festive scenes behind products', room: 'photo', seat: 2, model: GEM_I, dept: 'photo' },
  { id: 'modelShot', name: 'Model Shot Composer', role: 'On-model jewellery images', room: 'photo', seat: 3, model: GEM_I, dept: 'photo' },
  { id: 'reelsProducer', name: 'Reels Producer', role: 'Head of Reels Studio', room: 'reels', seat: 0, model: GPT_M, dept: 'reels', head: true },
  { id: 'videoEditor', name: 'Video Editor', role: 'Cuts reels and stories', room: 'reels', seat: 1, model: GEM, dept: 'reels' },
  { id: 'scriptWriter', name: 'Reels Scriptwriter', role: 'Hooks and scripts', room: 'reels', seat: 2, model: GPT_W, dept: 'reels' },
  { id: 'catalogLead', name: 'Catalogue Lead', role: 'Head of Catalogue Room', room: 'catalog', seat: 0, model: GPT_M, dept: 'catalog', head: true },
  { id: 'layoutDesigner', name: 'Layout Designer', role: 'Catalogue pages', room: 'catalog', seat: 1, model: GEM_I, dept: 'catalog' },
  { id: 'printDesigner', name: 'Print Designer', role: 'Posters and in-store prints', room: 'catalog', seat: 2, model: GEM_I, dept: 'catalog' },
  { id: 'malayalam', name: 'Malayalam Copywriter', role: 'Malayalam headlines and captions', room: 'lang', seat: 0, model: GPT_W, dept: 'lang', head: true },
  { id: 'tamil', name: 'Tamil Copywriter', role: 'Tamil headlines and captions', room: 'lang', seat: 1, model: GPT_W, dept: 'lang' },
  { id: 'hindi', name: 'Hindi Copywriter', role: 'Hindi headlines and captions', room: 'lang', seat: 2, model: GPT_W, dept: 'lang' },
  { id: 'crmLead', name: 'CRM Manager', role: 'Head of CRM and Email', room: 'crm', seat: 0, model: GPT_M, dept: 'crm', head: true },
  { id: 'emailDesigner', name: 'Email Designer', role: 'Festival emails', room: 'crm', seat: 1, model: GEM_I, dept: 'crm' },
  { id: 'segmenter', name: 'Customer Segmenter', role: 'Repeat buyers and lapsed customers', room: 'crm', seat: 2, model: JEV(), dept: 'crm' },
  { id: 'brandManager', name: 'Brand Manager AI', role: 'Head of Brand Studio', room: 'brand', seat: 0, model: GPT_M, dept: 'brand', head: true },
  { id: 'voiceKeeper', name: 'Brand Voice Keeper', role: 'Tone and words we use', room: 'brand', seat: 1, model: GPT_W, dept: 'brand' },
  { id: 'moodCurator', name: 'Moodboard Curator', role: 'Looks for each season', room: 'brand', seat: 2, model: GEM_I, dept: 'brand' },
];

/** People who approve, in the order a plan visits them. */
export const APPROVERS = ['creativeHead', 'ecomManager', 'perfMarketer', 'superAdmin'];
export const APPROVER_NAMES = { creativeHead: 'Creative Head', ecomManager: 'E-com Manager', perfMarketer: 'Performance Marketer', superAdmin: 'Super Admin' };

/**
 * The human head each department reports to. Every department also has an AI team lead (the person with head: true),
 * who reviews staff reports and forwards, sends back or rejects them before they reach this human.
 * Stored per department in the database so the Super Admin can reassign without code changes.
 */
export const HUMAN_HEAD = {
  creative: 'creativeHead', photo: 'creativeHead', reels: 'creativeHead', catalog: 'creativeHead', lang: 'creativeHead', brand: 'creativeHead',
  insights: 'ecomManager', strategy: 'ecomManager', customer: 'ecomManager', forecast: 'ecomManager', crm: 'ecomManager', goldrate: 'ecomManager',
  perf: 'perfMarketer', social: 'perfMarketer', intel: 'perfMarketer', warroom: 'perfMarketer',
  board: 'superAdmin', datahub: 'superAdmin', qa: 'superAdmin', lead: 'superAdmin',
};

/** The AI team lead of a department. */
export const teamLead = dept => (PEOPLE.find(p => p.dept === dept && p.head) || {}).id;

/** Departments a human can see. The Super Admin sees all of them. */
export const deptsOf = role => role === 'superAdmin' ? Object.keys(HUMAN_HEAD) : Object.keys(HUMAN_HEAD).filter(d => HUMAN_HEAD[d] === role);

/**
 * Can this human see a message? Heads see their own departments' messages, and cross-department
 * messages where one side is their team. Messages between two other teams stay hidden.
 * Mirrors the row-level security policy on agent_events.
 */
export const canSee = (role, msg) => role === 'superAdmin' || [msg.fromDept, msg.toDept].some(d => d && HUMAN_HEAD[d] === role);
