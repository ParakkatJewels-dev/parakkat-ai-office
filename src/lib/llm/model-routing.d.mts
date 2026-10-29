export type ModelUseCase = 'decision' | 'review' | 'reviewed_draft' | 'reviewed_specialist';
export declare const MODEL_USE_CASES: Readonly<Record<ModelUseCase, { label: string; preferred: 'chatgpt' | 'nim' }>>;
export declare function preferredTextProvider(useCase: ModelUseCase | undefined, readiness?: { chatReady?: boolean; nimReady?: boolean }): 'chatgpt' | 'nim' | 'wait';
