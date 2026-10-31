"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useIdentityRefresh } from "../identity-provider";
import Crown from "./crown";
import { INITIAL, tileBackground, tileById } from "./avatars";
import { AvatarSheet, NameSheet, StopSheet, UpgradeSheet, type Mode } from "./account-sheets";
import { contractComplete, formatAmount, formatDay, maskEmail, getJson, patchProfile, readContract, readProfile, type Contract, type Profile } from "./account-data";
import styles from "./account.module.css";

export type Member = { adminMfaRequired?: boolean; accessExpiresAt?: number; status: string; plan: string; isAdmin: boolean; ownerMode: boolean; canTest: boolean; testing: boolean };
type ViewAs = "owner" | "free" | "pro";

const ico = (d: ReactNode, color = "#a9b6c6", size = 18) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
const I = {
  user: ico(<><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></>),
  mail: ico(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>),
  bell: ico(<><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z" /><path d="M10 21h4" /></>),
  key: ico(<><circle cx="8" cy="15" r="4" /><path d="M11 12l8-8M16 7l3 3M14 9l2 2" /></>),
  shield: ico(<><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2.2 2.2L15.5 10" /></>),
  out: ico(<path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9" />),
  doc: ico(<><path d="M7 3h8l4 4v14H7z" /><path d="M15 3v4h4M10 12h6M10 16h6" /></>),
  lock: ico(<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>),
  trash: ico(<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6" />, "#e5838c"),
  anchor: ico(<><circle cx="12" cy="5" r="2.2" /><path d="M12 7.2V21M7 11h10M5 15c0 3 3 6 7 6s7-3 7-6" /></>, "#f0b27c", 22),
  ext: ico(<path d="M14 5h5v5M19 5l-8 8M18 14v5H5V6h5" />, "#e7c982", 15),
  tick: ico(<path d="M5 12l5 5 9-10" />, "#e7c982", 16),
  plus: ico(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.7-3.6 3.2-5.5 6.5-5.5M17 14v6M14 17h6" /></>, "#e7c982"),
  feed: ico(<path d="M4 7h16M4 12h10M4 17h7" />, "#e7c982"),
  pencil: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#c9d3df" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19z" /><path d="M14 7l3 3" /></svg>,
  seal: <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#2a1f05" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="M12 2.5l8 3v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10v-6z" /><path d="M12 7.6l3.6 4-3.6 5-3.6-5z" /></svg>,
};
const chev = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5d6c80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>;


type Resolute = { state: "loading" } | { state: "unknown" } | { state: "none" } | { state: "bought"; alertsUntil: string | null };
type ContractState = { state: "loading" } | { state: "unknown" } | { state: "ok"; value: Contract };
type ProfileState = { state: "loading" } | { state: "error" } | { state: "ok"; value: Profile };

export default function AccountView({ ja, member, billingAvailable, upgradeFirst, onRecheck }: { ja: boolean; member: Member; billingAvailable: boolean; upgradeFirst: boolean; onRecheck: () => void }) {
  const t = (a: string, b: string) => ja ? a : b;
  const router = useRouter();
  const clerk = useClerk();
  const refresh = useIdentityRefresh();
  const owner = member.isAdmin && (member.ownerMode || member.testing);
  const savedView: ViewAs = member.testing ? (member.plan === "pro" ? "pro" : "free") : "owner";
  // The screen follows the tap at once; the server save and the membership refresh finish behind it.
  const [pendingView, setPendingView] = useState<ViewAs | null>(null);
  const viewAs = pendingView ?? savedView;
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState(false);
  useEffect(() => {
    if (pendingView === null || pendingView !== savedView) return;
    const id = setTimeout(() => setPendingView(null), 0);
    return () => clearTimeout(id);
  }, [pendingView, savedView]);
  async function changeView(value: ViewAs) {
    if (switching || value === viewAs) return;
    setSwitching(true); setSwitchError(false); setPendingView(value);
    try {
      const result = await fetch("/api/research/member/preview", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: value === "owner" ? "restore" : value }), signal: AbortSignal.timeout(15000) });
      if (!result.ok) throw Error("switch-failed");
      try { localStorage.removeItem("tech-phase:member-hint"); localStorage.removeItem("tech-phase:owner-view-as"); } catch { /* optional display hints */ }
      // No page reload: the header, the menu and this screen listen for this and re-read the membership themselves.
      window.dispatchEvent(new Event("tech-phase:membership-changed"));
      setSwitching(false);
      // If the membership read never confirms the change, fall back to what the server says.
      setTimeout(() => setPendingView(null), 8000);
    } catch { setPendingView(null); setSwitchError(true); setSwitching(false); }
  }
  const preview = owner && viewAs !== "owner";
  const mode: Mode | null = billingAvailable ? "live" : member.canTest ? "sandbox" : null;
  const [profile, setProfile] = useState<ProfileState>({ state: "loading" });
  const [contract, setContract] = useState<ContractState>({ state: "loading" });
  const [resolute, setResolute] = useState<Resolute>({ state: "loading" });
  const [tick, setTick] = useState(0);
  const [sheet, setSheet] = useState<"" | "upgrade" | "stop" | "avatar" | "name">(upgradeFirst && member.plan !== "pro" && !owner ? "upgrade" : "");

  useEffect(() => {
    const controller = new AbortController();
    getJson("/api/research/account/profile", controller.signal)
      .then(value => { if (!controller.signal.aborted) setProfile({ state: "ok", value: readProfile(value) }); })
      .catch(() => { if (!controller.signal.aborted) setProfile(prev => prev.state === "ok" ? prev : { state: "error" }); });
    return () => controller.abort();
  }, [tick]);
  useEffect(() => {
    const controller = new AbortController();
    getJson("/api/research/account/contract", controller.signal)
      .then(value => { if (!controller.signal.aborted) setContract({ state: "ok", value: readContract(value) }); })
      .catch(() => { if (!controller.signal.aborted) setContract({ state: "unknown" }); });
    return () => controller.abort();
  }, [owner, tick]);
  useEffect(() => {
    if (owner) return;
    const controller = new AbortController();
    getJson("/api/resolute/entitlements", controller.signal)
      .then(value => {
        const use = value?.use?.status, alerts = value?.alerts;
        if (typeof use !== "string") throw new Error("entitlements");
        if (!controller.signal.aborted) setResolute(use === "active" ? { state: "bought", alertsUntil: alerts?.status === "active" && typeof alerts.expiresAt === "string" ? alerts.expiresAt : null } : use === "missing" ? { state: "none" } : { state: "unknown" });
      })
      .catch(() => { if (!controller.signal.aborted) setResolute({ state: "unknown" }); });
    return () => controller.abort();
  }, [owner, tick]);
  const recheck = useCallback(() => { setContract({ state: "loading" }); setResolute({ state: "loading" }); setTick(v => v + 1); onRecheck(); }, [onRecheck]);

  useEffect(() => {
    let lastRefresh = 0;
    const resume = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastRefresh < 1000) return;
      lastRefresh = Date.now();
      // Silent: what is on screen stays (and an open sheet keeps its input) until the new answers arrive.
      setTick(v => v + 1);
    };
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);

  const me = profile.state === "ok" ? profile.value : null;
  const email = me?.email ?? "";
  // The owner often films this screen: the owner's own address is shown masked (am***@gmail.com). Everyone else sees their own address as is.
  const shownEmail = owner ? maskEmail(email) : email;
  const display = (me?.displayName || email.split("@")[0] || t("会員", "Member")).trim();
  const initial = Array.from(display)[0] ?? "?";
  const tile = tileById(me?.icon);
  const twoFactor = me ? me.twoFactorEnabled : null;
  const passwordRow = me?.passwordEnabled === true && !owner;

  const effective: "free" | "pro" = owner ? (viewAs === "pro" ? "pro" : "free") : me?.plan === "pro" ? "pro" : member.plan === "pro" && !me ? "pro" : "free";
  const c = contract.state === "ok" ? contract.value : null;
  const contractReady = !!c && contractComplete(c);
  const stopped = effective === "pro" && !preview && contractReady && c.status === "renewal-stopped";
  const activeContract = effective === "pro" && !preview && contractReady && c.status === "active";
  // PRO members whose contract cannot be confirmed (or contradicts the plan) see the "could not check" card.
  const unknown = effective === "pro" && !preview && contract.state !== "loading" && !stopped && !activeContract;
  const loadingContract = effective === "pro" && !preview && contract.state === "loading";
  const freeUnverified = effective === "free" && !preview && !owner && (contract.state === "unknown" || (c !== null && !(c.verification === "verified" && c.status === "none")));
  const accessUntil = formatDay(c?.accessExpiresAt, ja);

  // The owner is one person: say something only when the contract state is verified; otherwise leave it blank.
  const ownerContractText = !(c?.verification === "verified") ? null
    : c.status === "none" ? t("有料契約\nなし", "No paid contract")
    : c.status === "active" ? t("有料契約\nあり", "Paid subscription")
    : c.status === "renewal-stopped" ? t("自動更新\n停止済み", "Renewal stopped") : null;
  const closeSheet = useCallback(() => {
    setSheet("");
    if (upgradeFirst) router.replace("/research");
  }, [upgradeFirst, router]);
  const closePlain = useCallback(() => setSheet(""), []);
  const ownerPreviewNote = <p className={styles.previewBar}>{t("表示の確認中です。金額や日付は表示例です。ここでの操作は、実際の契約や権限には反映されません。", "Previewing the view. Amounts and dates are samples. Actions here change nothing real.")}</p>;

  async function saveAvatar(id: string) { setProfile({ state: "ok", value: await patchProfile({ icon: id }) }); }
  async function saveName(name: string) { setProfile({ state: "ok", value: await patchProfile({ displayName: name }) }); }

  // Entry from the PRO introduction card: the confirmation sheet opens without the account screen behind it.
  if (upgradeFirst && sheet === "upgrade" && member.plan !== "pro" && !owner) {
    return <UpgradeSheet ja={ja} mode={mode} refresh={refresh} onClose={closeSheet} />;
  }

  const row = (icon: ReactNode, label: ReactNode, opts: { href?: string; onClick?: () => void; value?: ReactNode; sub?: string; pro?: boolean; chevron?: boolean; className?: string; disabled?: boolean } = {}) => {
    const body = <><span className={styles.ri}>{icon}</span><span className={`${styles.rt} ${opts.className ?? ""}`}>{label}{opts.sub && <small>{opts.sub}</small>}</span>{opts.pro && <span className={styles.proTag}>PRO</span>}{opts.value}{opts.chevron !== false && chev}</>;
    return opts.href ? <Link className={styles.row} href={opts.href} prefetch={false}>{body}</Link>
      : opts.onClick ? <button type="button" className={styles.row} disabled={opts.disabled} onClick={opts.onClick}>{body}</button>
      : <div className={styles.row} style={{ cursor: "default" }}>{body}</div>;
  };
  const avatar = <div className={styles.av}>
    <div className={`${styles.avc} ${effective === "pro" || owner ? styles.avPro : ""} ${owner ? styles.avOwner : ""} ${tile ? styles.avEmoji : ""}`} style={!owner && tile ? { background: tileBackground(tile), borderColor: "rgba(255,255,255,.18)" } : undefined}>
      {owner ? <img src="/rizel-avatar.webp" alt="" width={52} height={52} /> : tile ? tile.glyph : initial}
    </div>
    {!owner && me?.iconEditable !== false && <button type="button" className={styles.pencil} aria-label={t("アイコンを変更", "Change icon")} disabled={!me} onClick={() => setSheet("avatar")}>{I.pencil}</button>}
  </div>;
  const stopTag = <span className={`${styles.pt} ${styles.ptStop}`}>{t("自動更新停止済み", "Renewal stopped")}</span>;

  // ---- plan card
  const price = c?.amount && c.currency ? formatAmount(c.amount, c.currency) : null;
  const planCard = effective === "free"
    ? <div className={`${styles.cd} ${styles.proFree}`} style={{ marginTop: 0 }}>
        <div className={styles.proHead}><Crown size={36} /><span className={styles.proName} style={{ fontSize: 19, letterSpacing: ".04em" }}>Tech Phase PRO</span></div>
        <div className={styles.price}><span className={styles.priceN}>¥2,980</span><span className={styles.priceU}>/ {t("月", "mo")}</span><span className={styles.priceR}>{t("毎月自動更新", "Renews monthly")}</span></div>
        <ul className={styles.perks}>{[t("RIZEL'S DESK", "RIZEL'S DESK"), t("ハイテク速報をリアルタイムで", "Real-time Tech Alerts"), t("監視22銘柄リストとテーマランキング", "22-stock list and Theme Ranking"), t("銘柄比較・スマホ通知", "Compare and phone alerts")].map(text => <li key={text}>{I.tick}<span>{text}</span></li>)}</ul>
        <button type="button" className={`${styles.btn} ${styles.gbt}`} style={{ marginTop: 18 }} disabled={preview || !mode || freeUnverified || contract.state === "loading" && !preview} onClick={() => setSheet("upgrade")}>{t("PROにアップグレード", "Upgrade to PRO")}</button>
        {freeUnverified
          ? <div className={styles.ctaNote} role="status">{t("契約の状態を確認できませんでした。", "Could not check your contract.")} <button type="button" className={styles.link} style={{ display: "inline", width: "auto", margin: 0, padding: "0 0 0 6px", color: "#e7c982" }} onClick={recheck}>{t("再確認", "Check again")}</button></div>
          : <div className={styles.ctaNote}>{!mode && !preview ? t("お申し込みの受付は、現在停止中です。", "New subscriptions are closed right now.") : t("料金と規約を確認してから、PayPalへ進みます。", "Review the price and terms, then continue to PayPal.")}</div>}
      </div>
    : <div className={`${styles.cd} ${styles.cdGold} ${styles.pro}`} style={{ marginTop: 0 }}>
        <div className={styles.proHead}><Crown size={46} /><div style={{ flex: 1, minWidth: 0 }}><div className={styles.proName}>Tech Phase PRO</div>
          <div className={styles.proTagRow}>{unknown ? <span className={`${styles.pt} ${styles.ptUnknown}`}>{t("確認できません", "Unavailable")}</span> : stopped ? stopTag : loadingContract ? <span className={`${styles.pt} ${styles.ptUnknown}`}>{t("確認中", "Checking")}</span> : <span className={`${styles.pt} ${styles.ptOn}`}><i />{t("利用中", "Active")}</span>}</div></div></div>
        {unknown ? <>
            <p className={styles.note} style={{ marginTop: 14 }} role="status">{t("契約の状態を確認できませんでした。", "Could not check your contract.")}</p>
            <button type="button" className={`${styles.btn} ${styles.gbtO} ${styles.btnS}`} style={{ marginTop: 12 }} onClick={recheck}>{t("再確認", "Check again")}</button>
          </>
          : <>
            {!loadingContract && <div className={styles.kvs}>
              <div className={styles.kv}><span>{t("月額料金", "Monthly price")}</span><b>{preview ? "¥2,980" : price ?? "—"} {(preview || c?.currency) && <small>{preview ? "JPY" : c?.currency}</small>}</b></div>
              {preview && <div className={styles.kv}><span>{t("次回請求日", "Next billing date")}</span><b>{t("（表示例）", "(sample)")}</b></div>}
              {activeContract && <div className={styles.kv}><span>{t("次回請求日", "Next billing date")}</span><b>{formatDay(c?.nextBillingAt, ja)}</b></div>}
              {stopped && <div className={styles.kv}><span>{t("利用期限", "Access until")}</span><b>{accessUntil}</b></div>}
            </div>}
            {stopped && <p className={styles.note}>{t("この日まで、PROの機能を利用できます。", "PRO stays available until this date.")}</p>}
            {mode && !preview && !loadingContract && <Link className={`${styles.btn} ${styles.gbtO} ${styles.btnS}`} style={{ marginTop: 14 }} href="/research/account/billing" prefetch={false}>{t("支払い方法・履歴を確認", "Payment method & history")} {I.ext}</Link>}
            {mode && !preview && activeContract && <button type="button" className={styles.link} onClick={() => setSheet("stop")}>{t("自動更新を停止する", "Stop automatic renewal")}</button>}
            {preview && <button type="button" className={styles.link} disabled>{t("自動更新を停止する", "Stop automatic renewal")}</button>}
          </>}
      </div>;

  // ---- RESOLUTE
  const resoluteCard = <div className={styles.res}>
    <div className={styles.resHead}><span className={styles.resIcon}>{I.anchor}</span><span className={styles.resName}>RESOLUTE</span>
      {resolute.state === "bought" && !preview && <span className={`${styles.pt} ${styles.ptOn}`}>{t("購入済み", "Purchased")}</span>}
      <span className={styles.resSub}>{t("暴落の夜も、上昇の朝も、自分のルールに立ち戻るためのキット。", "A kit to return to your own rules, on crash nights and rally mornings.")}</span></div>
    {!preview && resolute.state === "unknown" && <p className={styles.note} role="status">{t("購入状況を確認できませんでした。", "Could not check your purchase.")} <button type="button" className={styles.link} onClick={recheck}>{t("再確認", "Check again")}</button></p>}
    {!preview && resolute.state === "loading" && <p className={styles.note} role="status">{t("購入状況を確認中", "Checking purchase")}</p>}
    {resolute.state === "bought" && !preview
      ? <>{resolute.alertsUntil && formatDay(resolute.alertsUntil, ja) && <div className={styles.kvs} style={{ marginTop: 6 }}><div className={styles.kv}><span>{t("通知サービスの有効期限", "Alerts valid until")}</span><b>{formatDay(resolute.alertsUntil, ja)}</b></div></div>}
          <div className={styles.stack}><Link className={`${styles.btn} ${styles.abt}`} href="/resolute">{t("RESOLUTEを開く", "Open RESOLUTE")}</Link>
            <Link className={`${styles.btn} ${styles.abt} ${styles.abtO}`} style={{ height: 46, fontSize: 14 }} href="/resolute/settings">{t("通知サービスを更新", "Renew alerts")}</Link></div></>
      : <Link className={`${styles.btn} ${styles.abt} ${styles.abtO}`} style={{ marginTop: 16 }} href="/resolute">{t("RESOLUTEを見る", "See RESOLUTE")}</Link>}
  </div>;

  // ---- security / support
  const twoValue = <span className={`${styles.rv} ${twoFactor ? styles.rvOn : ""}`}>{twoFactor === null ? t("確認できません", "Unavailable") : twoFactor ? t("オン", "On") : t("オフ", "Off")}</span>;
  const security = <div className={styles.cd} style={{ marginTop: 0 }}>
    {row(I.bell, t("スマホ通知の設定", "Phone notifications"), { href: "/research/notifications", pro: true })}
    {passwordRow && row(I.key, t("パスワードを変更", "Change password"), { href: "/research/account/security" })}
    {/* The owner's two-step verification is required for admin access: shown, never offered to turn off. */}
    {owner ? row(I.shield, t("2段階認証", "Two-step verification"), { value: twoValue, chevron: false }) : row(I.shield, t("2段階認証", "Two-step verification"), { href: "/research/account/security", value: twoValue })}
    {row(I.out, t("ログアウト", "Log out"), { onClick: () => void clerk.signOut({ redirectUrl: "/research" }), chevron: false, className: styles.muted })}
  </div>;

  // ---- owner menu
  const modes: [ViewAs, string][] = [["owner", t("運営者", "Owner")], ["free", "FREE"], ["pro", "PRO"]];
  const ownerMenu = owner && <>
    <div className={styles.sl} style={{ color: "#8a7a52" }}>{t("運営者専用メニュー", "Owner menu")}</div>
    <div className={styles.mode}><div className={styles.modeHead}>{t("表示モード", "View mode")}<span>VIEW AS</span></div>
      <div className={styles.seg} role="group" aria-label={t("表示モード", "View mode")}>{modes.map(([id, label]) => <button key={id} type="button" aria-pressed={viewAs === id} disabled={switching} onClick={() => void changeView(id)}>{label}</button>)}</div>
      {switchError && <p role="alert">{t("切り替えできませんでした。もう一度お試しください。", "Could not switch. Please try again.")}</p>}
      <p className={styles.modeNote}>{t("会員の画面を、運営者のまま確認できます。", "Preview the member screens while staying the owner.")}</p></div>
    <div className={`${styles.cd} ${styles.ownerMenu}`} style={{ marginTop: 14 }}>
      {row(I.plus, t("会員・契約の確認", "Members & contracts"), { href: "/research/account/members", sub: t("会員の検索と、契約状況・利用期限の確認", "Search members; contracts and expiry") })}
      {row(I.feed, t("配信状況", "Delivery status"), { href: "/research/account/delivery", sub: t("ニュース取得とスマホ通知の送信状況", "News intake and phone-alert sending") })}
    </div></>;

  return <div className={styles.page}>
    <div className={`${styles.kick} ${owner || effective === "pro" ? styles.kickGold : ""}`}>{owner && !preview ? "OWNER" : effective === "pro" ? "PRO MEMBER" : "FREE MEMBER"}</div>
    <h1 className={styles.h1}>{t("アカウント", "Account")}</h1>

    {profile.state === "error" && <div className={styles.cd}><div style={{ padding: 16 }}><p className={styles.note} role="alert" style={{ margin: 0 }}>{t("アカウント情報を確認できませんでした。", "Could not load your account.")}</p>
      <button type="button" className={`${styles.btn} ${styles.gbtO} ${styles.btnS}`} style={{ marginTop: 12 }} onClick={() => { setProfile({ state: "loading" }); recheck(); }}>{t("再確認", "Check again")}</button></div></div>}
    {profile.state === "loading" && <div className={styles.skel} style={{ marginTop: 20 }} aria-busy="true" />}
    {profile.state === "ok" && <div className={`${styles.cd} ${owner ? styles.ownerHero : ""}`}>
      <div className={styles.hero}>{avatar}
        <div className={styles.who}><div className={styles.name}>{owner ? "リゼル" : display}</div><div className={styles.mail}>{shownEmail}</div></div>
        <span className={`${styles.pt} ${owner && !preview ? styles.ptOwner : effective === "pro" ? styles.ptPro : styles.ptFree}`}>{owner && !preview ? "OWNER" : effective === "pro" ? "PRO" : "FREE"}</span></div>
      {(!owner || preview) && <div className={`${styles.grp} ${styles.cdIn}`}>
        {preview ? <>{row(I.user, t("表示名を変更", "Change display name"))}{row(I.mail, t("メールアドレスを変更", "Change email"))}</>
          : <>{row(I.user, t("表示名を変更", "Change display name"), { onClick: () => setSheet("name") })}
        {row(I.mail, t("メールアドレスを変更", "Change email"), { href: "/research/account/security" })}</>}
      </div>}
    </div>}

    {owner && viewAs === "owner" && <div className={styles.ownerBadge}><span className={styles.seal}>{I.seal}</span>
      <div style={{ flex: 1, minWidth: 0 }}><div className={styles.ownerWord}>OWNER</div><div className={styles.ownerSub}>{t("全機能をご利用中です", "All features unlocked")}</div></div>
      {ownerContractText && <span className={styles.ownerNone}>{ownerContractText}</span>}</div>}

    {member.adminMfaRequired && <p className={styles.warn} role="alert" style={{ marginTop: 12 }}>{t("管理機能には2段階認証が必要です。設定後、ログインし直してください。", "Admin access requires two-step verification. Set it up, then sign in again.")} <Link href="/research/account/security" style={{ color: "#e7c982" }}>{t("2段階認証を設定する", "Set up")}</Link></p>}

    {owner && !preview && c?.verification === "verified" && (c.status === "active" || c.status === "renewal-stopped") && <div className={styles.cd}>
      {row(I.key, t("有料契約を確認", "View paid subscription"), { href: "/research/account/billing" })}
    </div>}
    {ownerMenu}
    {preview && ownerPreviewNote}

    {(!owner || preview) && <>
      <div className={styles.sl}>{t("PROプラン", "PRO plan")}</div>
      {planCard}
      <div className={styles.sl}>RESOLUTE</div>
      {resoluteCard}
    </>}

    <div className={styles.sl}>{t("通知・セキュリティ", "Notifications & security")}</div>
    {security}

    {!owner && <>
      <div className={styles.sl}>{t("サポート", "Support")}</div>
      <div className={styles.cd} style={{ marginTop: 0 }}>
        {row(I.mail, t("お問い合わせ", "Contact"), { href: "/research/faq" })}
        {row(I.doc, t("利用規約", "Terms"), { href: "/terms" })}
        {row(I.lock, t("プライバシーポリシー", "Privacy policy"), { href: "/privacy" })}
      </div>
      {/* Deletion is not available yet (docs/ACCOUNT-API-HANDOFF-2026-10-31.md): no button, no sheet. */}
      <div className={styles.delBlock}><h2>{t("アカウントの削除", "Delete account")}</h2><p>{t("現在、この画面からは削除できません。お問い合わせください。", "Accounts cannot be deleted from this screen right now. Please contact us.")}</p></div>
    </>}
    <div className={styles.foot}>Tech Phase Research</div>

    {sheet === "upgrade" && <UpgradeSheet ja={ja} mode={mode} refresh={refresh} onClose={closePlain} />}
    {sheet === "stop" && mode && <StopSheet ja={ja} mode={mode} until={accessUntil} onDone={() => { closePlain(); recheck(); }} onClose={closePlain} />}
    {sheet === "avatar" && me && <AvatarSheet ja={ja} initial={initial} current={tile ? tile.id : INITIAL} onSave={saveAvatar} onClose={closePlain} />}
    {sheet === "name" && me && <NameSheet ja={ja} current={display} onSave={saveName} onClose={closePlain} />}
  </div>;
}
