"use client";
import CompanyDirectory,{type DirectoryCompany} from './company-directory';
import ResearchToolShell from '../research-tool-shell';
import { useResearchLanguage } from '../use-research-language';
export default function DirectoryPage({companies}:{companies:DirectoryCompany[]}) {
 const [lang,setLang]=useResearchLanguage();
 return <ResearchToolShell lang={lang} setLang={setLang} title="" description="" showTools={false} showHeading={false}><CompanyDirectory companies={companies} lang={lang}/></ResearchToolShell>;
}
