export function normalizeNumberInput(value:string,decimal=false):string|null {
 const plain=value.normalize("NFKC").replace(/,/g,"");
 if(plain.length>32)return null;
 return (decimal?/^\d*(?:\.\d*)?$/:/^\d*$/).test(plain)?plain:null;
}
export function formatNumberInput(value:string):string {
 const [whole,fraction]=value.split(".");
 return whole.replace(/\B(?=(\d{3})+(?!\d))/g,",")+(fraction===undefined?"":"."+fraction);
}
/** Convert a displayed decimal to integer money without floating point rounding. */
export function scaledNumberInput(value:string,places:number,max=1e12):number|null {
 if(value==="")return 0;
 if(value.length>32||!/^\d+(?:\.\d*)?$/.test(value))return null;
 const [whole,fraction=""]=value.split(".");
 if(fraction.length>places)return null;
 const amount=BigInt(whole)*BigInt(10**places)+BigInt(fraction.padEnd(places,"0")||"0");
 return amount<=BigInt(max)?Number(amount):null;
}
