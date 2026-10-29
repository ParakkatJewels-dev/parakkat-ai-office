export function paginationState(page:number,total:number,pageSize:number): {page:number;pages:number;pageSize:number;total:number;start:number;end:number};
export function pageNumbers(page:number,pages:number): Array<number|'ellipsis'>;
