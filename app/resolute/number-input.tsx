"use client";
import { useLayoutEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { formatNumberInput, normalizeNumberInput } from "@/lib/resolute/number-input";
/** Formatting is display-only. Callers receive ungrouped decimal strings. */
export default function NumberInput({value,onValueChange,decimal=false,...props}:Omit<InputHTMLAttributes<HTMLInputElement>,"value"|"onChange"|"type"> & {
 value:string|number; onValueChange:(value:string)=>void; decimal?:boolean;
}) {
 const [editing,setEditing]=useState<string|null>(null);
 const input=useRef<HTMLInputElement>(null),caret=useRef<number|null>(null);
 const raw=editing ?? String(value);
 const displayed=formatNumberInput(raw);
 useLayoutEffect(()=>{if(caret.current!==null && input.current){input.current.setSelectionRange(caret.current,caret.current);caret.current=null;}},[displayed]);
 return <input {...props} ref={input} type="text" inputMode={decimal?"decimal":"numeric"} autoComplete="off" value={displayed} placeholder={props.placeholder??"0"}
 onFocus={e=>{setEditing(Number(value)===0?"":String(value));props.onFocus?.(e);}}
 onBlur={e=>{setEditing(null);props.onBlur?.(e);}}
 onChange={e=>{
  const text=e.target.value, next=normalizeNumberInput(text,decimal);if(next===null)return;
  const count=text.slice(0,e.target.selectionStart??text.length).replace(/[,，]/g,"").length;
  const formatted=formatNumberInput(next);let position=0,seen=0;
  while(position<formatted.length&&seen<count){if(formatted[position]!==",")seen++;position++;}
  caret.current=position;setEditing(next);onValueChange(next);
 }} onKeyDown={e=>{if(e.key==="Enter")e.currentTarget.blur();props.onKeyDown?.(e);}}/>;
}
