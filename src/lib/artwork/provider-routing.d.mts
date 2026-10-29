export type ArtworkProvider = 'chatgpt'|'higgsfield';
export type RevisionArtwork = {id:string;artwork_origin?:string|null};
export function revisionArtworkProvider(selected:unknown,origin?:string|null):ArtworkProvider;
export function requestedArtworkProvider(request:unknown):ArtworkProvider|null;
export function chatGPTRevisionMessage(count:number):string;
