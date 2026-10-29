import type {HeadTaskPlan} from './head-task-core.mjs';
type Request={title?:string;brief?:string;humanFeedback?:string;previousDelivery?:string};
export type HeadRoute={id:string;label:string;agentId:string};
export function eligibleHeadRoutes(request:Request,candidates:Array<{agentId:string}>):HeadRoute[];
export function routedHeadPlan(answer:unknown,routes:HeadRoute[],request:Request):HeadTaskPlan|null;
