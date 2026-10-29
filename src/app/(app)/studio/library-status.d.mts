export const LIBRARY_HEARTBEAT_MS:number;
export type LibraryRuntime = {active:boolean;stage:string|null;activeFolderName:string|null;startedAt:string|null;updatedAt:string|null;lastFinishedAt:string|null;lastResult:string|null;paused:boolean|null;designerEnabled:boolean|null;geminiConfigured:boolean|null;readError:boolean};
export type LibraryDisplay = {state:string;label:string;message:string;active:boolean;poll:boolean};
export function projectLibraryRuntime(input:{cursor:any;lease:any;paused:boolean|null;designerEnabled:boolean|null;geminiConfigured:boolean|null;readError?:boolean},now?:number):LibraryRuntime;
export function libraryDisplayState(runtime:LibraryRuntime,counts:{pendingFolders:number|null;waiting:number|null;failed:number|null;folderErrors:number|null;readError?:boolean}):LibraryDisplay;
export function readLibraryFolderPages<T>(readPage:(from:number,to:number)=>PromiseLike<{data:T[]|null;error:unknown}>,pageSize?:number):Promise<{rows:T[];complete:boolean}>;
export function safeLibraryNote(value:unknown):string|null;
