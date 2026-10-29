import Link from 'next/link';
import { getChatGPTStatus } from '@/lib/chatgpt/auth.mjs';
import { getNimStatus } from '@/lib/llm/nim-config';
import { getGeminiStatus } from '@/lib/llm/gemini-config';
import { getJevStatus } from '@/lib/llm/jev-config';
import styles from './ModelRouting.module.css';
import { isChatGPTHandoff } from '@/lib/artwork-mode.mjs';

export async function ModelRouting() {
  const handoff = isChatGPTHandoff();
  const [chat, nim, gemini, jev] = await Promise.allSettled([
    getChatGPTStatus(), getNimStatus(), handoff ? Promise.resolve(null) : getGeminiStatus(), getJevStatus(),
  ]);
  const chatReady = chat.status === 'fulfilled' && chat.value.enabled && chat.value.connected && !chat.value.usageBlocked;
  const nimReady = nim.status === 'fulfilled' && nim.value.status === 'connected';
  const geminiReady = gemini.status === 'fulfilled' && gemini.value?.configured;
  const jevReady = jev.status === 'fulfilled' && jev.value.status === 'connected';
  const routes = [
    { number: '01', task: 'Answer and decide', model: 'ChatGPT', state: chatReady ? 'Ready' : 'Waiting', description: 'Direct questions use one head call. Complex analysis, final answers and quality reviews stay with ChatGPT.' },
    { number: '02', task: 'Prepare a reviewed draft', model: nimReady ? 'NVIDIA NIM → ChatGPT review' : 'ChatGPT draft and review', state: nimReady && chatReady ? 'Ready' : 'Waiting', description: 'Verified NIM handles bounded reports and one-to-one specialist contributions when a head or QC check follows.' },
    { number: '03', task: 'Classify and route', model: 'Jev', state: jevReady ? 'Ready' : 'Check provider', description: 'Clear requests route directly. Jev resolves ambiguous assignments only when its connection is verified; uncertain choices go to the head.' },
    handoff ? { number: '04', task: 'Generate artwork', model: 'Higgsfield → Studio → human review', state: 'Subscription credits', description: 'A connected Higgsfield account generates explicit artwork requests using GPT Image 2.5 or Nano Banana Pro. Studio saves the result for human review. ChatGPT is a manual import option; Gemini image generation is disabled.' } : { number: '04', task: 'Visual and source work', model: 'Gemini', state: geminiReady ? 'Configured' : 'Check provider', description: 'Image creation and visual checks use Gemini. Image attempts are tracked separately, with optional app caps.' },
  ];
  return <section className={styles.panel} aria-labelledby="model-routing-title">
    <div className={styles.head}>
      <div><span className={styles.eyebrow}>MODEL USAGE</span><h3 id="model-routing-title">Right model for each job</h3><p>Quality gates decide when a smaller model can help. Provider use and token totals are recorded per task.</p></div>
      <Link href="/usage?tab=tasks">See usage by task <span aria-hidden="true">↗</span></Link>
    </div>
    <div className={styles.routes}>{routes.map(route => <div className={styles.route} key={route.number}>
      <span className={styles.number}>{route.number}</span>
      <div className={styles.copy}><h4>{route.task}</h4><p>{route.description}</p></div>
      <div className={styles.provider}><strong>{route.model}</strong><span className={route.state === 'Ready' || route.state === 'Configured' ? styles.ready : styles.waiting}>{route.state}</span></div>
    </div>)}</div>
    <p className={styles.foot}>If ChatGPT plan usage is exhausted, decisions and mandatory reviews wait. AI Office does not silently approve a draft with a lower model. A failed provider request is not automatically sent to a second paid model.</p>
  </section>;
}
