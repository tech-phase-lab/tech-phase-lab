"use client";
import { useAuth } from "@clerk/nextjs";
import DiagnosisScreen from "./screen";
import SimulationScreen from "./simulation/screen";
import NotificationScreen from "./notifications-screen";
export default function ResoluteIdentity({ simulation=false, notification }: {simulation?:boolean;notification?:"alerts"|"morning"}) {
 const {isLoaded,sessionId}=useAuth();
 // Session replacement discards all private answers and in-flight writes.
 if(notification)return <NotificationScreen key={sessionId ?? "signed-out"} identityReady={isLoaded} mode={notification}/>;
 return simulation ? <SimulationScreen key={sessionId ?? "signed-out"} identityReady={isLoaded} /> :
 <DiagnosisScreen key={sessionId ?? "signed-out"} identityReady={isLoaded} />;
}
