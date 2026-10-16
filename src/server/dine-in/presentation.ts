import {z} from "zod";
type Amounts={subtotalMinor:string|number;discountMinor:string|number;payableMinor:string|number;cashbackMinor:string|number};
type Item={productId:string;name:string;quantity:number;unitPriceMinor:string|number;totalMinor:string|number};
export function majorTotals(value:Amounts){return {subtotal:Number(value.subtotalMinor)/100,discount:Number(value.discountMinor)/100,payable:Number(value.payableMinor)/100,cashback:Number(value.cashbackMinor)/100};}
export function guestLines(items:Item[]){return items.map(i=>({productId:i.productId,productName:i.name,quantity:i.quantity,unitPrice:Number(i.unitPriceMinor)/100,total:Number(i.totalMinor)/100}));}
export function guestQuote<T extends Amounts & {items:Item[]}>(quote:T){return {...quote,...majorTotals(quote),lines:guestLines(quote.items)};}
export function guestOrder(order:Amounts & {items:Item[];number:string;acceptedAt:string|Date;guestName?:unknown;guestPhone?:unknown;guestId?:unknown;events?:unknown;[key:string]:unknown},receiptToken?:string){
  const {guestName,guestPhone,events,guestId,...safe}=order;
  return {...safe,...majorTotals(order),orderNumber:order.number,createdAt:order.acceptedAt,lines:guestLines(order.items),...(receiptToken?{receiptToken}:{})};
}
export function pageCursor(raw:string|null|undefined):[string|null,string|null]{
  if(!raw)return [null,null];const parts=raw.split("|");if(parts.length>2)throw new z.ZodError([{code:"custom",path:[],message:"Invalid cursor"}]);
  z.string().datetime().parse(parts[0]);if(parts[1])z.string().uuid().parse(parts[1]);return [parts[0],parts[1]??null];
}
