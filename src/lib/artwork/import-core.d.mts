export const MAX_IMAGE_BYTES: number;
export const MAX_BODY_BYTES: number;
export function validId(value: unknown): value is string;
export function validOrigin(request: Request, appUrl?: string): boolean;
export function boundedFormData(request: Request): Promise<FormData>;
export function validateArtwork(bytes: Buffer, declaredType: string): Promise<{mimeType:string;extension:string;width:number;height:number}>;
export function zipFiles(files: {name:string;data:Buffer|string}[]): Buffer;
