"use client";
import { useEffect,useState } from 'react';
import { usePlanClient } from '../review-context';
import type { PlanSnapshot } from '@/lib/resolute/plan-data';
import { useRemembered } from './use-remembered';
/** The saved plan. A plan already loaded in this tab is shown at once and refreshed behind it (no "Loading…" between pages). */
export function useSavedPlan(){const request=usePlanClient(),known=useRemembered<PlanSnapshot>('plan'),[plan,setPlan]=useState<PlanSnapshot['plan']>(known?.plan??null),[state,setState]=useState(known?(known.plan?'ready':'empty'):'loading');useEffect(()=>{const c=new AbortController();void request(undefined,c.signal).then(v=>{if(!c.signal.aborted){setPlan(v.plan);setState(v.plan?'ready':'empty');}},()=>{if(!c.signal.aborted)setState('error');});return()=>c.abort();},[request]);return{plan,state};}
