import type { Metadata } from 'next';
import { events } from '@/lib/research/content-server';
import { buildCompanyProfiles } from '@/lib/research/companies';
import { providers,sectorNames,sectorNamesEn } from '@/lib/research/intake';
import { companyWatches } from '@/lib/research/company-watch';
import DirectoryPage from './directory-page';

// This page is built per request; only the research home is prerendered (owner, Oct 22: faster app open).
export const dynamic = "force-dynamic";
export const metadata:Metadata={title:'Company watch | Tech Phase Research',robots:{index:false,follow:false}};
export default function CompaniesPage() {
 const verified=new Set([...buildCompanyProfiles(events).map(p=>p.ticker),...companyWatches.map(p=>p.ticker)]);
 return <DirectoryPage companies={providers.map(p=>({ticker:p.ticker,name:p.name,sector:{ja:sectorNames[p.sector],en:sectorNamesEn[p.sector]},verified:verified.has(p.ticker)}))}/>;
}
