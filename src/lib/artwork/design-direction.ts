import 'server-only';
import { chatJSON } from '@/lib/llm/openai';
import { researchArtwork, creativeResearchBrief } from '@/lib/agents/creative-research';

type Direction = {
  concepts?: { name?: string; distinction?: string }[];
  selected?: string;
  idea?: string;
  composition?: string;
  environment?: string;
  productStaging?: string;
  lighting?: string;
  palette?: string;
  typography?: string;
  logoPlacement?: string;
  customerHook?: string;
  novelty?: string;
};

const clip = (value: unknown, max = 450) => String(value || '').trim().slice(0, max);

/** Plan the scene before the image model sees any pixels. Old library images are only written lessons. */
export async function planArtwork(input: {
  brief: string; headline: string; format: string; occasion: string; products: string[];
  libraryLessons: string[]; revision: string; fixedTemplate: boolean;
}): Promise<string> {
  const research = await researchArtwork('luxury jewellery campaign', input.brief);
  const sourceNotes = research ? creativeResearchBrief(research) : [
    'Published luxury campaign references for visual principles only:',
    'Bulgari brand campaign: Roman architecture and dawn as atmosphere (https://www.bulgari.com/en-int/brand-campaign.html).',
    'Boucheron Carte Blanche: a central shape explored through material, volume and light (https://www.boucheron.com/sa_en/high-jewelry/collections-carte-blanche).',
    'Tiffany campaign: intimate cinematic storytelling (https://www.tiffany.com/world-of-tiffany/campaigns/natalie-portman-for-tiffany.html).',
    'These examples are starting points, not motifs or compositions to reproduce.',
  ].join(' ');
  const system = `You are the Banner Designer and an exacting luxury jewellery art director. Think before writing an image prompt. Propose three visibly distinct campaign ideas, choose the strongest for the manager's brief, and specify a shootable visual world. Use current research and brand library notes as principles, never as artwork to copy. Keep official jewellery identity unchanged. Do not invent offers, prices, gemstones, provenance, certifications or product claims. Do not copy another brand's distinctive motifs, layouts, copy or logo. Return one JSON object with concepts (three objects with name and distinction), selected, idea, composition, environment, productStaging, lighting, palette, typography, logoPlacement, customerHook and novelty. Give concrete camera, material, spatial and lighting decisions. Avoid generic phrases such as premium, elegant, beautiful, luxury look, gold glow and dark background without details. If a fixed carousel template exists, preserve it and develop only the product staging and fine detail.`;
  const response = await chatJSON<Direction>('manager', system, JSON.stringify({
    task: input, currentResearch: sourceNotes,
    constraint: 'The manager-approved uploaded logo is a separate visual input. Place only one faithful rendering in the upper-right reserved area; do not invent or alter its letters or shape. No past design image pixels are supplied.',
  }), { timeoutMs: 75_000, maxOutputTokens: 1000 });
  const required = ['idea','composition','environment','productStaging','lighting','palette','typography','customerHook','novelty'] as const;
  if (required.some(key => clip(response?.[key]).length < 8) || !Array.isArray(response?.concepts) || response.concepts.length < 3) {
    throw new Error('The Banner Designer could not complete a detailed art direction. Retry this artwork request.');
  }
  return [
    `BANNER DESIGNER'S CHOSEN CONCEPT: ${clip(response.selected || response.concepts[0]?.name, 120)}. ${clip(response.idea)}`,
    `Composition and camera: ${clip(response.composition)}`,
    `Physical scene and materials: ${clip(response.environment)}`,
    `Exact product staging: ${clip(response.productStaging)}`,
    `Lighting: ${clip(response.lighting)}`,
    `Colour relationship: ${clip(response.palette)}`,
    `Type treatment and hierarchy: ${clip(response.typography)}`,
    `Logo placement: ${clip(response.logoPlacement || 'One mark in the upper-right reserved zone')}`,
    `Customer feeling and hook: ${clip(response.customerHook)}`,
    `What makes this new: ${clip(response.novelty)}`,
    `Research basis: ${sourceNotes}`,
  ].join('\n');
}
