import { buildComparisonSample } from "@/lib/research/comparison-sample";
import SampleScreen from "./screen";

// This page is built per request; only the research home is prerendered (owner, Oct 22: faster app open).
export const dynamic = "force-dynamic";
export const metadata={title:"比較PRO サンプル | Tech Phase",robots:{index:false,follow:false}};
export default function Page(){return <SampleScreen sample={buildComparisonSample()}/>;}
