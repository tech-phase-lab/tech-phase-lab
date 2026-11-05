import type { Metadata } from "next";
import { ProExperienceList } from "./screen";

export const metadata: Metadata = { title: "PRO機能体験" };
export default function ProExperiencePage() { return <ProExperienceList />; }
