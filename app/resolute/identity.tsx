"use client";
import { useAuth } from "@clerk/nextjs";
import DiagnosisScreen from "./screen";
import SimulationScreen from "./simulation/screen";
export default function ResoluteIdentity({ simulation=false }: {simulation?:boolean}) {
 const {isLoaded,sessionId}=useAuth();
 // Session replacement discards all private answers and in-flight writes.
 return simulation ? <SimulationScreen key={sessionId ?? "signed-out"} identityReady={isLoaded} /> :
 <DiagnosisScreen key={sessionId ?? "signed-out"} identityReady={isLoaded} />;
}
