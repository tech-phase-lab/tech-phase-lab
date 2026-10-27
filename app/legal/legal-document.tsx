import { parseLegal } from "@/lib/legal/parse";
import s from "./legal.module.css";

export default function LegalDocument({ source }: { source: string }) {
  return <article className={s.doc}>
    {parseLegal(source).map((block, i) => {
      if (block.kind === "title") return <h1 key={i}>{block.text}</h1>;
      if (block.kind === "heading") return <h2 key={i}>{block.text}</h2>;
      if (block.kind === "bullets") return <ul key={i}>{block.items.map((item, j) => <li key={j}>{item}</li>)}</ul>;
      if (block.kind === "items") return <div key={i} className={s.items}>{block.items.map((item, j) => <p key={j}><span className={s.no}>{item.no}.</span><span>{item.text}</span></p>)}</div>;
      return <p key={i}>{block.text}</p>;
    })}
  </article>;
}
