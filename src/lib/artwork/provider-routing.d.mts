export type ArtworkProvider = 'chatgpt'|'higgsfield';
export type RevisionArtwork = {id:string;artwork_origin?:string|null};
export function revisionArtworkProvider(selected:unknown,origin?:string|null):ArtworkProvider;
export function requestedArtworkProvider(request:unknown):ArtworkProvider|null;
export function chatGPTRevisionMessage(count:number):string;
export type ArtworkChoice = {provider:ArtworkProvider|null;basis:'explicit'|'ai'|'policy'|'availability';reason:string};
export function chooseArtworkProvider(input:{selected?:ArtworkProvider|null;chatgpt:boolean;higgsfield:boolean;referenceCount?:number;format?:string;suggestion?:{provider?:ArtworkProvider;reason?:string}|null}):ArtworkChoice;
