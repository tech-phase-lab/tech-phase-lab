"use client";
import { useState } from "react";
import styles from "./watchlist.module.css";
const domains: Record<string,string> = {GLW:"corning.com",AAOI:"ao-inc.com",CIEN:"ciena.com",SPCX:"spacex.com",PL:"planet.com",PLTR:"palantir.com",APP:"applovin.com",CBRS:"cerebras.ai",ALAB:"asteralabs.com",ARM:"arm.com",ANET:"arista.com",ASML:"asml.com",TSM:"tsmc.com",PM:"pmi.com",APH:"amphenol.com",AEHR:"aehr.com",GLDM:"ssga.com",AVAV:"avinc.com",ONDS:"ondas.com",RCAT:"redcat.red",IONQ:"ionq.com",RGTI:"rigetti.com",QBTS:"dwavequantum.com",MU:"micron.com",SKHY:"skhynix.com",DRAM:"roundhillinvestments.com",NVDA:"nvidia.com",MSFT:"microsoft.com",AMZN:"amazon.com",JPM:"jpmorganchase.com",LLY:"lilly.com",XOM:"exxonmobil.com",V:"visa.com",MA:"mastercard.com",JNJ:"jnj.com",ABBV:"abbvie.com",COST:"costco.com",WMT:"walmart.com",CVX:"chevron.com",COP:"conocophillips.com",SNDK:"sandisk.com",WDC:"westerndigital.com",STX:"seagate.com",NBIS:"nebius.com",CRWV:"coreweave.com",IREN:"iren.com",AMD:"amd.com",AVGO:"broadcom.com",MRVL:"marvell.com",LITE:"lumentum.com",COHR:"coherent.com",CRDO:"credosemi.com",VRT:"vertiv.com",GEV:"gevernova.com",BE:"bloomenergy.com",VST:"vistracorp.com",CRWD:"crowdstrike.com",PANW:"paloaltonetworks.com",ZS:"zscaler.com",FTNT:"fortinet.com",NEM:"newmont.com",AEM:"agnicoeagle.com",KGC:"kinross.com",CRM:"salesforce.com",NOW:"servicenow.com",ADBE:"adobe.com",RKLB:"rocketlabcorp.com",ASTS:"ast-science.com",IRDM:"iridium.com"};
/** `full`: without a logo the whole ticker, sized to the square (割安判別ツール: two letters such as 「IN」 read as the IN badge). */
const fullSize = (ticker: string) => ticker.length <= 3 ? undefined : { fontSize: ticker.length === 4 ? "9px" : "7.5px", letterSpacing: "-.02em" };
export default function StockLogo({ ticker, className, full = false }: { ticker: string; className?: string; full?: boolean }) {
  const [failed, setFailed] = useState(false);
  return <span className={className ?? styles.logo} aria-hidden="true">{!failed && domains[ticker] ?
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`https://www.google.com/s2/favicons?domain=${domains[ticker]}&sz=64`} alt="" width={28} height={28} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : full ? <span style={fullSize(ticker)}>{ticker}</span> : ticker.slice(0, 2)}</span>;
}
