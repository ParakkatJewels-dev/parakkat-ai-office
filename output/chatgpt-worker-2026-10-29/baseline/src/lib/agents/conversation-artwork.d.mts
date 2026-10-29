export type ConversationArtwork = {id:string;status:string;requestId:string|null;imported:boolean;importProvider:'ChatGPT'|'Higgsfield'|null;generatedProvider:'Higgsfield'|null;title:string;imageUrl:string|null;version:number|null;carouselId:string|null;carouselIndex:number|null;needsAttention:boolean};
export function artworkRevisionIntent(request:string):boolean;
export function conversationDesignRevision(request:string,history?:Array<any>):string|null;
export function readConversationArtworks(reader:any,messages?:Array<any>):Promise<ConversationArtwork[]>;
