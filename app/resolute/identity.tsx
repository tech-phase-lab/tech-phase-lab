"use client";
import type { ThermometerSnapshot } from "@/lib/resolute/thermometer-view";
import { useAuth } from "@clerk/nextjs";
import { useDiagnosisSessionIdentity } from "./use-diagnosis-session";
import HomeScreen from "./home/screen";
import DiagnosisScreen from "./screen";
import SimulationScreen from "./simulation/screen";
import NotificationScreen from "./notifications-screen";
import TaxScreen from "./tax/screen";
import ThermometerScreen from "./thermometer/screen";
import NotebookScreen from "./notebook/screen";
import WallScreen from "./wall/screen";
import TonightScreen from "./tonight/screen";
import NewsScreen from "./news/screen";
export default function ResoluteIdentity({ simulation=false, notification, extra, thermometerSnapshot }: {thermometerSnapshot?:ThermometerSnapshot;simulation?:boolean;notification?:"alerts"|"morning";extra?:"home"|"tax"|"thermometer"|"notebook"|"wall"|"tonight"|"news"}) {
 const {isLoaded,sessionId}=useAuth();
 useDiagnosisSessionIdentity(isLoaded,sessionId);
 if(extra==="home")return <HomeScreen snapshot={thermometerSnapshot} key={sessionId ?? "signed-out"} identityReady={isLoaded}/>;
 if(extra==="wall")return <WallScreen key={sessionId ?? "signed-out"} identityReady={isLoaded}/>;
 if(extra==="tonight")return <TonightScreen key={sessionId ?? "signed-out"} identityReady={isLoaded}/>;
 if(extra==="news")return <NewsScreen key={sessionId ?? "signed-out"} identityReady={isLoaded}/>;
 // Session replacement discards all private answers and in-flight writes.
 if(extra==="notebook")return <NotebookScreen key={sessionId ?? "signed-out"} identityReady={isLoaded}/>;
 if(extra==="tax")return <TaxScreen key={sessionId ?? "signed-out"} identityReady={isLoaded}/>;
 if(extra==="thermometer")return <ThermometerScreen snapshot={thermometerSnapshot} key={sessionId ?? "signed-out"} identityReady={isLoaded}/>;
 if(notification)return <NotificationScreen key={sessionId ?? "signed-out"} identityReady={isLoaded} mode={notification}/>;
 return simulation ? <SimulationScreen key={sessionId ?? "signed-out"} identityReady={isLoaded} /> :
 <DiagnosisScreen key={sessionId ?? "signed-out"} identityReady={isLoaded} draftSession={sessionId ?? undefined} />;
}
