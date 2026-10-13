"use client";
import { useEffect,useState } from 'react';
import { usePlanClient } from '../review-context';
import type { PlanSnapshot } from '@/lib/resolute/plan-data';
export function useSavedPlan(){const request=usePlanClient(),[plan,setPlan]=useState<PlanSnapshot['plan']>(null),[state,setState]=useState('loading');useEffect(()=>{const c=new AbortController();void request(undefined,c.signal).then(v=>{if(!c.signal.aborted){setPlan(v.plan);setState(v.plan?'ready':'empty');}},()=>{if(!c.signal.aborted)setState('error');});return()=>c.abort();},[request]);return{plan,state};}
