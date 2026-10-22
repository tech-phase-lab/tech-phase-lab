import { buildComparisonSample } from "@/lib/research/comparison-sample";
import SampleScreen from "./screen";
export const metadata={title:"比較PRO サンプル | Tech Phase",robots:{index:false,follow:false}};
export default function Page(){return <SampleScreen sample={buildComparisonSample()}/>;}
