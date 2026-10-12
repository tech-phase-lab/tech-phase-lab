"use client";
import { useAuth } from "@clerk/nextjs";
import DiagnosisScreen from "./screen";
import SimulationScreen from "./simulation/screen";
import NotificationScreen from "./notifications-screen";
import TaxScreen from "./tax/screen";
import ThermometerScreen from "./thermometer/screen";
export default function ResoluteIdentity({ simulation=false, notification, extra }: {simulation?:boolean;notification?:"alerts"|"morning";extra?:"tax"|"thermometer"}) {
 const {isLoaded,sessionId}=useAuth();
 // Session replacement discards all private answers and in-flight writes.
 if(extra==="tax")return <TaxScreen key={sessionId ?? "signed-out"} identityReady={isLoaded}/>;
 if(extra==="thermometer")return <ThermometerScreen key={sessionId ?? "signed-out"} identityReady={isLoaded}/>;
 if(notification)return <NotificationScreen key={sessionId ?? "signed-out"} identityReady={isLoaded} mode={notification}/>;
 return simulation ? <SimulationScreen key={sessionId ?? "signed-out"} identityReady={isLoaded} /> :
 <DiagnosisScreen key={sessionId ?? "signed-out"} identityReady={isLoaded} />;
}
