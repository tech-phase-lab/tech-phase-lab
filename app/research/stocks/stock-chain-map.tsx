"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CHAIN_KINDS, chainAbove, chainCounts, chainGroup, chainKinds, chainText } from "@/lib/research/chain-map-core";
import type { ChainCompany, ChainKind, ChainMapData, ChainSource, ChainTone } from "@/lib/research/chain-map-core";
import styles from "./stock-chain-map.module.css";

type Line = { d: string; tone: ChainTone; on: boolean };
const CARD = "chain-card-";
/** From this many rivals on, only the main rivals show; the rest open behind a ＋. */
const RIVAL_FOLD = 6;
/** A map row with more chips than this folds to MAP_KEEP chips plus a "＋" chip. */
const MAP_FOLD = 8, MAP_KEEP = 6;
/** A list group of other kinds folds after this many cards. */
const GROUP_FOLD = 8, GROUP_KEEP = 5;
/** The main rivals first, topped up to five from the rest of the group. */
function foldRivals(members: ChainCompany[], main: string[], keep: number) {
  const first = members.filter(company => main.includes(company.id));
  const rest = members.filter(company => !main.includes(company.id));
  const shown = [...first, ...rest.slice(0, Math.max(0, keep - first.length))];
  return { shown, more: members.filter(company => !shown.includes(company)) };
}

function Source({ source, lang }: { source: ChainSource; lang: "ja" | "en" }) {
  const ja = lang === "ja";
  const note = ja ? source.note : source.note_en;
  return <div className={styles.src}>
    {source.date && <span>{ja ? "発表日" : "Published"} {source.date.replace(/-/g, "/")}</span>}
    <span><a href={source.url} target="_blank" rel="noopener noreferrer">{ja ? source.label : source.label_en}</a>{source.level === "press" && <> <em>{ja ? "報道" : "Media report"}</em></>}</span>
    {source.quote && <q lang="en">{source.quote}</q>}
    {note && <span>{note}</span>}
  </div>;
}

/** A card is one company: a one-line text and its sources behind a tap. Several relations share one card. */
/** The stock page's only rival sentence in every map ("X competes with <root>") adds nothing beside the tag and the source, so it is not shown (owner, Oct 20). */
const standardRival = (relation: ChainCompany["relations"][number], root: ChainMapData["root"], ja: boolean) =>
  relation.type === "rival" && (ja ? relation.text === `${root.name}と競合する` : relation.text_en === `Competes with ${root.name_en ?? root.name}`);

function Card({ company, lang, root, anchor = true }: { company: ChainCompany; lang: "ja" | "en"; root: ChainMapData["root"]; anchor?: boolean }) {
  const ja = lang === "ja";
  const many = company.relations.length > 1;
  const line = company.relations.find(relation => !standardRival(relation, root, ja));
  return <div className={styles.it} id={anchor ? CARD + company.id : undefined} data-tone={company.relations[0].type}>
    <div className={styles.itHead}><b>{company.ticker}</b><span>{ja ? company.name : (company.name_en ?? company.name).replace(/([A-Za-z0-9])\(/g, "$1 (")}</span>
      {chainKinds(company).map(kind => <span key={kind} className={styles.tg} data-tone={kind}>{chainText(kind, "tag", lang)}</span>)}</div>
    {line && <p className={styles.ln}>{ja ? line.text : line.text_en}</p>}
    <details><summary>{ja ? "出典・引用・発表日" : "Sources, quotes & dates"}{many ? (ja ? `(${company.relations.length}件)` : ` (${company.relations.length})`) : ""}</summary>
      {company.relations.map((relation, index) => <div key={index} className={styles.srcBlock}>
        {many && <span><span className={styles.tg} data-tone={relation.type}>{chainText(relation.type, "tag", lang)}</span>{standardRival(relation, root, ja) ? "" : ` ${ja ? relation.text : relation.text_en}`}</span>}
        <Source source={relation.source} lang={lang} />
      </div>)}
    </details>
  </div>;
}

export function StockChainMap({ data, lang }: { data: ChainMapData; lang: "ja" | "en" }) {
  const ja = lang === "ja";
  const t = (jaText: string, enText: string) => ja ? jaText : enText;
  const [sel, setSel] = useState<string | null>(null);
  const [openRows, setOpenRows] = useState<number[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const map = useRef<HTMLDivElement>(null);
  const chips = useRef<Record<string, HTMLButtonElement | null>>({});
  const root = data.root.ticker;
  const byId = useMemo(() => new Map(data.companies.map(company => [company.id, company])), [data]);
  const counts = chainCounts(data);
  const picked = sel ? byId.get(sel) ?? null : null;
  const related = (id: string) => !!sel && (id === sel || data.far.some(link => (link.from === sel && link.to === id) || (link.to === sel && link.from === id)));

  const draw = useCallback(() => {
    const board = map.current, rootChip = chips.current[root];
    if (!board || !rootChip) return;
    const area = board.getBoundingClientRect();
    const rect = (id: string) => chips.current[id]!.getBoundingClientRect();
    const point = (id: string, side: "t" | "b", dx = 0): [number, number] => {
      const r = rect(id);
      return [r.left - area.left + r.width / 2 + dx, (side === "b" ? r.bottom : r.top) - area.top];
    };
    const spread = (list: ChainCompany[], id: string) => list.length < 2 ? 0 : (list.findIndex(company => company.id === id) / (list.length - 1) - 0.5) * (rect(root).width - 24);
    // Companies folded behind a row's "＋" have no chip, so they get no line either.
    const shown = data.companies.filter(company => chips.current[company.id]);
    const upstream = shown.filter(company => chainAbove(data, company.row)), downstream = shown.filter(company => !chainAbove(data, company.row));
    const out: Line[] = [];
    const curve = (a: [number, number], b: [number, number], tone: ChainTone, on: boolean) => {
      const [x1, y1] = a, [x2, y2] = b, dy = Math.max(26, Math.abs(y2 - y1) * 0.5);
      out.push({ d: `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`, tone, on });
    };
    for (const company of shown) {
      const kinds = chainKinds(company), on = sel === company.id;
      kinds.forEach((kind, index) => {
        const dx = (index - (kinds.length - 1) / 2) * 6;
        if (chainAbove(data, company.row)) curve(point(company.id, "b", dx), point(root, "t", spread(upstream, company.id)), kind, on);
        else curve(point(root, "b", spread(downstream, company.id)), point(company.id, "t", dx), kind, on);
      });
    }
    data.far.forEach((link, index) => {
      const on = sel === link.from || sel === link.to;
      const a = point(link.from, "b"), target = rect(link.to);
      if (byId.get(link.from)!.row === byId.get(link.to)!.row) {
        const x2 = target.left - area.left + target.width / 2, d = 14 + index * 5;
        out.push({ d: `M${a[0]},${a[1]} C${a[0]},${a[1] + d} ${x2},${a[1] + d} ${x2},${a[1]}`, tone: "far", on });
      } else curve(a, point(link.to, "t"), "far", on);
    });
    setBox({ width: area.width, height: area.height });
    setLines(out);
  }, [data, sel, root, byId]);

  useEffect(() => { draw(); }, [draw, lang, openRows]);
  useEffect(() => {
    const board = map.current;
    if (!board) return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(board);
    document.fonts?.ready.then(draw);
    return () => observer.disconnect();
  }, [draw]);

  function select(id: string | null) {
    // The page does not move (owner, Oct 18): the tapped company's card opens just under the map instead.
    setSel(id && sel === id ? null : id);
  }

  const chipOf = (company: ChainCompany) => {
    const kinds = chainKinds(company);
    return <button type="button" key={company.id} ref={element => { chips.current[company.id] = element; }} className={`${styles.chip} ${related(company.id) ? styles.on : ""}`}
      data-tone={kinds[0]} onClick={() => select(company.id)} aria-pressed={sel === company.id}>
      <span className={styles.dots} aria-hidden="true">{kinds.map(kind => <i key={kind} data-tone={kind} />)}</span>
      <b>{company.ticker}</b><small>{ja ? company.sub : company.sub_en}</small>
    </button>;
  };
  // A crowded row shows its main companies and a "＋" chip for the rest, so the map stays readable (owner, Oct 19).
  const rowChips = (row: number) => {
    const all = data.companies.filter(company => company.row === row);
    if (all.length <= MAP_FOLD || openRows.includes(row)) return <>{all.map(chipOf)}{all.length > MAP_FOLD && <button type="button" className={styles.more} onClick={() => setOpenRows(openRows.filter(index => index !== row))}>{t("閉じる", "Fold")}</button>}</>;
    const first = all.filter(company => data.rivals.includes(company.id)), rest = all.filter(company => !data.rivals.includes(company.id));
    const keep = [...first, ...rest].slice(0, MAP_KEEP);
    return <>{keep.map(chipOf)}<button type="button" className={styles.more} onClick={() => setOpenRows([...openRows, row])}>{ja ? `＋${all.length - keep.length}社` : `+${all.length - keep.length}`}</button></>;
  };

  // Rows with no company are left out, so a stock with no suppliers (or no customers) just has a shorter map.
  const rowsOf = (above: boolean) => data.rows.map((row, index) => ({ row, index })).filter(({ index }) => chainAbove(data, index) === above && data.companies.some(company => company.row === index))
    .map(({ row, index }) => <section className={styles.row} key={index}><h4>{ja ? row.ja : row.en}</h4><div className={styles.chips}>{rowChips(index)}</div></section>);

  return <section className={styles.chain} aria-label={t("企業の連鎖マップ", "Company connection map")}>
    {data.rivals.length > 0 && <div className={styles.rivals}>
      <h3><span>05</span>{t("競合は？", "Who competes with it?")}</h3>
      <div>{data.rivals.map(id => <span key={id}>{byId.get(id)?.ticker ?? id}</span>)}</div>
    </div>}
    <h3 className={styles.mapHeading}><span>06</span>{t("どこと繋がる？", "Who does it work with?")}</h3>
    <div className={styles.card}>
      <div className={styles.head}>
        <h3>{t("企業の連鎖マップ", "Company connection map")}</h3>
        <div className={styles.id}><div><span className={styles.tk}>{root}</span><span className={styles.nm}>{ja ? data.root.name : (data.root.name_en ?? data.root.name)}</span></div>
          <span className={styles.cnt}>{ja ? `${counts.companies}社 · ${counts.relations}の関係` : `${counts.companies} companies · ${counts.relations} relationships`}</span></div>
        <div className={styles.legend}>{([...CHAIN_KINDS.filter(kind => data.companies.some(company => chainKinds(company).includes(kind))), ...(data.far.length > 0 ? ["far"] : [])] as ChainTone[]).map(tone => <span key={tone} data-tone={tone}><i />{chainText(tone, "legend", lang)}</span>)}</div>
      </div>
      <div className={styles.mapWrap}>
      <div className={`${styles.map} ${sel ? styles.hasSel : ""}`} ref={map}>
        <svg viewBox={`0 0 ${box.width} ${box.height}`} aria-hidden="true">
          {lines.map((line, index) => <path key={index} className={`${styles.p} ${line.on ? styles.lineOn : ""}`} data-tone={line.tone} d={line.d} />)}
        </svg>
        {rowsOf(true)}
        <section className={`${styles.row} ${styles.rootRow}`}><div className={styles.chips}>
          <button type="button" ref={element => { chips.current[root] = element; }} className={`${styles.chip} ${styles.root}`} onClick={() => select(null)}><b>{root}</b><small>{ja ? data.root.name : (data.root.name_en ?? data.root.name)}</small></button>
        </div></section>
        {rowsOf(false)}
      </div>
      {picked && <div className={styles.picked} role="status">
        <button type="button" className={styles.close} onClick={() => setSel(null)} aria-label={t("閉じる", "Close")}>×</button>
        <Card company={picked} lang={lang} root={data.root} anchor={false} />
      </div>}
      </div>
      <div className={styles.lists}>
        <h3>{t(`${root}との関係`, `Relationships with ${root}`)}</h3>
        {CHAIN_KINDS.map((kind: ChainKind) => {
          const members = chainGroup(data, kind);
          return members.length > 0 && <div className={styles.grp} data-tone={kind} key={kind}>
            <h4 className={styles.gh}><i />{chainText(kind, "group", lang)} <small>{ja ? `${members.length}社` : members.length}</small></h4>
            {members.length >= (kind === "rival" ? RIVAL_FOLD : GROUP_FOLD)
              // The main companies stay as cards; the rest open behind a ＋ (owner, Oct 19).
              ? (() => {
                const { shown, more } = foldRivals(members, kind === "rival" ? data.rivals : [], kind === "rival" ? 5 : GROUP_KEEP);
                return <>
                  <div className={styles.items}>{shown.map(company => <Card key={company.id} company={company} lang={lang} root={data.root} />)}</div>
                  <details className={styles.more}>
                    <summary>{ja ? `＋ 残り${more.length}社を開く` : `+ Show ${more.length} more`}</summary>
                    <div className={styles.items}>{more.map(company => <Card key={company.id} company={company} lang={lang} root={data.root} />)}</div>
                  </details>
                </>;
              })()
              : <div className={styles.items}>{members.map(company => <Card key={company.id} company={company} lang={lang} root={data.root} />)}</div>}
          </div>;
        })}
        {data.far.length > 0 && <div className={styles.grp} data-tone="far">
          <h4 className={styles.gh}><i />{chainText("far", "group", lang)} <small>{ja ? `${data.far.length}件` : data.far.length}</small></h4>
          <div className={styles.items}>{data.far.map((link, index) => <div className={styles.it} key={index}>
            <div className={styles.itHead}><b>{byId.get(link.from)?.ticker ?? link.from}</b><span>×</span><b>{byId.get(link.to)?.ticker ?? link.to}</b><span className={styles.tg} data-tone="far">{chainText("far", "tag", lang)}</span></div>
            <p className={styles.ln}>{ja ? link.text : link.text_en}</p>
            <details><summary>{t("出典・引用・発表日", "Sources, quotes & dates")}</summary><div className={styles.srcBlock}><Source source={link.source} lang={lang} /></div></details>
          </div>)}</div>
          <p className={styles.empty}>{t(`${root}から見て3段先以降は、公式の資料で確認できた関係がありません。`, `No relationships three or more steps from ${root} have been confirmed in official materials.`)}</p>
        </div>}
      </div>
    </div>
    <p className={styles.note}>{data.note[lang]}</p>
  </section>;
}
