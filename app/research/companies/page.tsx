import type { Metadata } from 'next';
import { events } from '@/lib/research/content-server';
import { buildCompanyProfiles } from '@/lib/research/companies';
import { providers,sectorNames,sectorNamesEn } from '@/lib/research/intake';
import { verifiedChanges } from '@/lib/research/verified-changes';
import DirectoryPage from './directory-page';
export const metadata:Metadata={title:'Company watch | Tech Phase Research',robots:{index:false,follow:false}};
export default function CompaniesPage() {
 const verified=new Set([...buildCompanyProfiles(events).map(p=>p.ticker),...verifiedChanges.map(p=>p.ticker)]);
 return <DirectoryPage companies={providers.map(p=>({ticker:p.ticker,name:p.name,sector:{ja:sectorNames[p.sector],en:sectorNamesEn[p.sector]},verified:verified.has(p.ticker)}))}/>;
}
