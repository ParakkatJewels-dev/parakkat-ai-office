export type CatalogueCopy={id:string;title:string;descriptionHtml:string;seo:{title:string;description:string}};
export function catalogueChange(payload:Record<string,any>):CatalogueCopy;
export function assertCatalogueSource(payload:Record<string,any>,current:any):void;
export function matchesCatalogueCopy(current:any,change:CatalogueCopy):boolean;
