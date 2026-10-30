"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useClerk, useUser } from "@clerk/nextjs";
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { billingRequest, billingSummary, type BillingSummary } from "@/lib/membership/billing-client";
import { useIdentityRefresh } from "../identity-provider";
import Crown from "./crown";
import { INITIAL, tileBackground, tileById } from "./avatars";
import { AvatarSheet, DeleteSheet, NameSheet, StopSheet, UpgradeSheet, type Mode } from "./account-sheets";
import styles from "./account.module.css";

export type Member = { adminMfaRequired?: boolean; accessExpiresAt?: number; status: string; plan: string; isAdmin: boolean; ownerMode: boolean; canTest: boolean; testing: boolean };
type ViewAs = "owner" | "free" | "pro";
const VIEW_KEY = "tech-phase:owner-view-as";
const viewListeners = new Set<() => void>();
const readView = (): ViewAs => { try { const v = localStorage.getItem(VIEW_KEY); return v === "free" || v === "pro" ? v : "owner"; } catch { return "owner"; } };
const subscribeView = (cb: () => void) => { viewListeners.add(cb); return () => { viewListeners.delete(cb); }; };
function writeView(value: ViewAs) { try { localStorage.setItem(VIEW_KEY, value); } catch { /* storage may be blocked */ } viewListeners.forEach(cb => cb()); }

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


const dateText = (iso: string | number | null | undefined, ja: boolean) => {
  const ms = typeof iso === "number" ? iso : iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) && ms > 0 ? new Intl.DateTimeFormat(ja ? "ja-JP" : "en-US", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" }).format(ms) : null;
};

type Resolute = { state: "loading" } | { state: "unknown" } | { state: "none" } | { state: "bought"; alertsUntil: string | null };
type Contract = { state: "loading" } | { state: "unknown" } | { state: "ok"; summary: BillingSummary };

export default function AccountView({ ja, member, billingAvailable, upgradeFirst, onRecheck }: { ja: boolean; member: Member; billingAvailable: boolean; upgradeFirst: boolean; onRecheck: () => void }) {
  const t = (a: string, b: string) => ja ? a : b;
  const router = useRouter();
  const { user } = useUser();
  const clerk = useClerk();
  const refresh = useIdentityRefresh();
  const owner = member.ownerMode && !member.testing;
  const viewAs = useSyncExternalStore(subscribeView, readView, () => "owner" as ViewAs);
  const preview = owner && viewAs !== "owner";
  const mode: Mode | null = billingAvailable ? "live" : member.canTest ? "sandbox" : null;
  const [contract, setContract] = useState<Contract>({ state: "loading" });
  const [resolute, setResolute] = useState<Resolute>({ state: "loading" });
  const [tick, setTick] = useState(0);
  const [sheet, setSheet] = useState<"" | "upgrade" | "stop" | "delete" | "avatar" | "name">(upgradeFirst && member.plan !== "pro" && !owner ? "upgrade" : "");
  const needsContract = !owner && member.plan === "pro";

  useEffect(() => {
    if (!needsContract) return;
    if (!mode) return;
    const controller = new AbortController();
    billingRequest("status", undefined, AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]), mode)
      .then(value => { if (!controller.signal.aborted) setContract({ state: "ok", summary: billingSummary(value, mode) }); })
      .catch(() => { if (!controller.signal.aborted) setContract({ state: "unknown" }); });
    return () => controller.abort();
  }, [needsContract, mode, tick]);
  useEffect(() => {
    if (owner) return;
    const controller = new AbortController();
    fetch("/api/resolute/entitlements", { cache: "no-store", credentials: "same-origin", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      .then(async response => {
        if (!response.ok) throw new Error("entitlements");
        const value = await response.json();
        const use = value?.use?.status, alerts = value?.alerts;
        if (typeof use !== "string") throw new Error("entitlements");
        if (!controller.signal.aborted) setResolute(use === "active" ? { state: "bought", alertsUntil: alerts?.status === "active" && typeof alerts.expiresAt === "string" ? alerts.expiresAt : null } : { state: "none" });
      })
      .catch(() => { if (!controller.signal.aborted) setResolute({ state: "unknown" }); });
    return () => controller.abort();
  }, [owner, tick]);

  const recheck = useCallback(() => { setContract({ state: "loading" }); setResolute({ state: "loading" }); setTick(v => v + 1); onRecheck(); }, [onRecheck]);

  const metaAvatar = user?.unsafeMetadata?.avatar;
  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const display = (user?.firstName || user?.username || email.split("@")[0] || t("会員", "Member")).trim();
  const initial = Array.from(display)[0] ?? "?";
  const tile = tileById(metaAvatar);
  const twoFactor = user?.twoFactorEnabled === true;
  const passwordRow = user?.passwordEnabled === true && !owner;

  // What this screen shows as the plan.
  const effective: "free" | "pro" = owner ? (viewAs === "pro" ? "pro" : "free") : member.plan === "pro" ? "pro" : "free";
  const summary = contract.state === "ok" ? contract.summary : null;
  const sub = summary?.subscription ?? null;
  const stopped = effective === "pro" && !preview && sub?.state === "cancelled";
  const proUntil = !preview ? dateText(summary?.proExpiresAt ?? (mode ? null : member.accessExpiresAt), ja) : null;
  const unknown = effective === "pro" && !preview && contract.state === "unknown";
  const loadingContract = effective === "pro" && !preview && mode !== null && contract.state === "loading";

  const closeSheet = useCallback(() => {
    setSheet("");
    if (upgradeFirst) router.replace("/research");
  }, [upgradeFirst, router]);
  const closePlain = useCallback(() => setSheet(""), []);
  const ownerPreviewNote = <p className={styles.previewBar}>{t("表示の確認中です。ここでの操作は、実際の契約や権限には反映されません。", "Previewing the view. Actions here do not change your real contract or access.")}</p>;

  async function saveAvatar(id: string) { if (!user) throw new Error("user"); await user.update({ unsafeMetadata: { ...user.unsafeMetadata, avatar: id } }); }
  async function saveName(name: string) { if (!user) throw new Error("user"); await user.update({ firstName: name, lastName: "" }); }
  async function deleteAccount() { if (!user) throw new Error("user"); await user.delete(); window.location.assign("/research"); }

  // Entry from the PRO introduction card: the confirmation sheet opens without the account screen behind it.
  if (upgradeFirst && sheet === "upgrade" && member.plan !== "pro" && !owner) {
    return <UpgradeSheet ja={ja} mode={mode} refresh={refresh} onClose={closeSheet} />;
  }

  const row = (icon: ReactNode, label: ReactNode, opts: { href?: string; onClick?: () => void; value?: ReactNode; sub?: string; pro?: boolean; chevron?: boolean; className?: string; disabled?: boolean } = {}) => {
    const body = <><span className={styles.ri}>{icon}</span><span className={`${styles.rt} ${opts.className ?? ""}`}>{label}{opts.sub && <small>{opts.sub}</small>}</span>{opts.pro && <span className={styles.proTag}>PRO</span>}{opts.value}{opts.chevron !== false && chev}</>;
    return opts.href ? <Link className={styles.row} href={opts.href} prefetch={false}>{body}</Link>
      : <button type="button" className={styles.row} disabled={opts.disabled} onClick={opts.onClick}>{body}</button>;
  };
  const avatar = <div className={styles.av}>
    <div className={`${styles.avc} ${effective === "pro" || owner ? styles.avPro : ""} ${owner ? styles.avOwner : ""} ${tile ? styles.avEmoji : ""}`} style={!owner && tile ? { background: tileBackground(tile), borderColor: "rgba(255,255,255,.18)" } : undefined}>
      {owner ? <img src="/rizel-avatar.webp" alt="" width={52} height={52} /> : tile ? tile.glyph : initial}
    </div>
    {!owner && <button type="button" className={styles.pencil} aria-label={t("アイコンを変更", "Change icon")} onClick={() => setSheet("avatar")}>{I.pencil}</button>}
  </div>;
  const stopTag = <span className={`${styles.pt} ${styles.ptStop}`}>{t("自動更新停止済み", "Renewal stopped")}</span>;

  // ---- plan card
  const money = sub?.currency === "USD" ? { n: "$20", u: "USD" } : { n: "¥2,980", u: "JPY" };
  const planCard = effective === "free"
    ? <div className={`${styles.cd} ${styles.proFree}`} style={{ marginTop: 0 }}>
        <div className={styles.proHead}><Crown size={36} /><span className={styles.proName} style={{ fontSize: 19, letterSpacing: ".04em" }}>Tech Phase PRO</span></div>
        <div className={styles.price}><span className={styles.priceN}>¥2,980</span><span className={styles.priceU}>/ {t("月", "mo")}</span><span className={styles.priceR}>{t("毎月自動更新", "Renews monthly")}</span></div>
        <ul className={styles.perks}>{[t("RIZEL'S DESK", "RIZEL'S DESK"), t("ハイテク速報をリアルタイムで", "Real-time Tech Alerts"), t("監視22銘柄リストとテーマランキング", "22-stock list and Theme Ranking"), t("銘柄比較・スマホ通知", "Compare and phone alerts")].map(text => <li key={text}>{I.tick}<span>{text}</span></li>)}</ul>
        <button type="button" className={`${styles.btn} ${styles.gbt}`} style={{ marginTop: 18 }} disabled={preview || !mode} onClick={() => setSheet("upgrade")}>{t("PROにアップグレード", "Upgrade to PRO")}</button>
        <div className={styles.ctaNote}>{!mode && !preview ? t("お申し込みの受付は、現在停止中です。", "New subscriptions are closed right now.") : t("料金と規約を確認してから、PayPalへ進みます。", "Review the price and terms, then continue to PayPal.")}</div>
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
              <div className={styles.kv}><span>{t("月額料金", "Monthly price")}</span><b>{money.n} <small>{money.u}</small></b></div>
              {proUntil && <div className={styles.kv}><span>{stopped ? t("利用期限", "Access until") : t("確認済みの利用期限", "Verified access until")}</span><b>{proUntil}</b></div>}
            </div>}
            {stopped && proUntil && <p className={styles.note}>{t("この日まで、PROの機能を利用できます。", "PRO stays available until this date.")}</p>}
            {mode && !preview && <Link className={`${styles.btn} ${styles.gbtO} ${styles.btnS}`} style={{ marginTop: 14 }} href="/research/account/billing" prefetch={false}>{t("支払い方法・履歴を確認", "Payment method & history")} {I.ext}</Link>}
            {mode && !preview && !stopped && sub && ["active", "suspended"].includes(sub.state) && <button type="button" className={styles.link} onClick={() => setSheet("stop")}>{t("自動更新を停止する", "Stop automatic renewal")}</button>}
            {preview && <button type="button" className={styles.link} disabled>{t("自動更新を停止する", "Stop automatic renewal")}</button>}
          </>}
      </div>;

  // ---- RESOLUTE
  const resoluteCard = <div className={styles.res}>
    <div className={styles.resHead}><span className={styles.resIcon}>{I.anchor}</span><span className={styles.resName}>RESOLUTE</span>
      {resolute.state === "bought" && !preview && <span className={`${styles.pt} ${styles.ptOn}`}>{t("購入済み", "Purchased")}</span>}
      <span className={styles.resSub}>{t("暴落の夜も、上昇の朝も、自分のルールに立ち戻るためのキット。", "A kit to return to your own rules, on crash nights and rally mornings.")}</span></div>
    {resolute.state === "bought" && !preview
      ? <>{resolute.alertsUntil && dateText(resolute.alertsUntil, ja) && <div className={styles.kvs} style={{ marginTop: 6 }}><div className={styles.kv}><span>{t("通知サービスの有効期限", "Alerts valid until")}</span><b>{dateText(resolute.alertsUntil, ja)}</b></div></div>}
          <div className={styles.stack}><Link className={`${styles.btn} ${styles.abt}`} href="/resolute">{t("RESOLUTEを開く", "Open RESOLUTE")}</Link>
            <Link className={`${styles.btn} ${styles.abt} ${styles.abtO}`} style={{ height: 46, fontSize: 14 }} href="/resolute/settings">{t("通知サービスを更新", "Renew alerts")}</Link></div></>
      : <Link className={`${styles.btn} ${styles.abt} ${styles.abtO}`} style={{ marginTop: 16 }} href="/resolute">{t("RESOLUTEを見る", "See RESOLUTE")}</Link>}
  </div>;

  // ---- security / support
  const twoValue = <span className={`${styles.rv} ${twoFactor ? styles.rvOn : ""}`}>{twoFactor ? t("オン", "On") : t("オフ", "Off")}</span>;
  const security = <div className={styles.cd} style={{ marginTop: 0 }}>
    {row(I.bell, t("スマホ通知の設定", "Phone notifications"), { href: "/research/notifications", pro: true })}
    {passwordRow && row(I.key, t("パスワードを変更", "Change password"), { href: "/research/account/security" })}
    {row(I.shield, t("2段階認証", "Two-step verification"), { href: "/research/account/security", value: twoValue })}
    {row(I.out, t("ログアウト", "Log out"), { onClick: () => void clerk.signOut({ redirectUrl: "/research" }), chevron: false, className: styles.muted })}
  </div>;

  // ---- owner menu
  const modes: [ViewAs, string][] = [["owner", t("運営者", "Owner")], ["free", "FREE"], ["pro", "PRO"]];
  const ownerMenu = owner && <>
    <div className={styles.sl} style={{ color: "#8a7a52" }}>{t("運営者専用メニュー", "Owner menu")}</div>
    <div className={styles.mode}><div className={styles.modeHead}>{t("表示モード", "View mode")}<span>VIEW AS</span></div>
      <div className={styles.seg} role="group" aria-label={t("表示モード", "View mode")}>{modes.map(([id, label]) => <button key={id} type="button" aria-pressed={viewAs === id} onClick={() => writeView(id)}>{label}</button>)}</div>
      <p className={styles.modeNote}>{t("会員の画面を、運営者のまま確認できます。", "Preview the member screens while staying the owner.")}</p></div>
    <div className={`${styles.cd} ${styles.ownerMenu}`} style={{ marginTop: 14 }}>
      {row(I.plus, t("会員・契約の確認", "Members & contracts"), { href: "/research/account/members", sub: t("会員の検索と、契約状況・利用期限の確認", "Search members; contracts and expiry") })}
      {row(I.feed, t("配信状況", "Delivery status"), { href: "/research/account/delivery", sub: t("ニュース取得とスマホ通知の送信状況", "News intake and phone-alert sending") })}
    </div></>;

  return <div className={styles.page}>
    <div className={`${styles.kick} ${owner || effective === "pro" ? styles.kickGold : ""}`}>{owner ? "OWNER" : "MY ACCOUNT"}</div>
    <h1 className={styles.h1}>{t("アカウント", "Account")}</h1>

    <div className={`${styles.cd} ${owner ? styles.ownerHero : ""}`}>
      <div className={styles.hero}>{avatar}
        <div className={styles.who}><div className={styles.name}>{owner ? "リゼル" : display}</div><div className={styles.mail}>{email}</div></div>
        <span className={`${styles.pt} ${owner ? styles.ptOwner : effective === "pro" ? styles.ptPro : styles.ptFree}`}>{owner ? "OWNER" : effective === "pro" ? "PRO" : "FREE"}</span></div>
      {!owner && <div className={`${styles.grp} ${styles.cdIn}`}>
        {row(I.user, t("表示名を変更", "Change display name"), { onClick: () => setSheet("name") })}
        {row(I.mail, t("メールアドレスを変更", "Change email"), { href: "/research/account/security" })}
      </div>}
    </div>

    {owner && viewAs === "owner" && <div className={styles.ownerBadge}><span className={styles.seal}>{I.seal}</span>
      <div style={{ flex: 1, minWidth: 0 }}><div className={styles.ownerWord}>OWNER</div><div className={styles.ownerSub}>{t("全機能をご利用中です", "All features unlocked")}</div></div>
      <span className={styles.ownerNone}>{ja ? <>有料契約<br />なし</> : "No paid contract"}</span></div>}

    {member.adminMfaRequired && <p className={styles.warn} role="alert" style={{ marginTop: 12 }}>{t("管理機能には2段階認証が必要です。設定後、ログインし直してください。", "Admin access requires two-step verification. Set it up, then sign in again.")} <Link href="/research/account/security" style={{ color: "#e7c982" }}>{t("2段階認証を設定する", "Set up")}</Link></p>}

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
      <div className={styles.cd} style={{ marginTop: 12, borderColor: "#3a2226" }}>
        {row(I.trash, t("アカウントを削除", "Delete account"), { onClick: () => setSheet("delete"), className: styles.danger, sub: effective === "pro" && !stopped ? t("有効な契約がある場合は、先に自動更新の停止を確認します。", "If you have an active contract, confirm that renewal is stopped first.") : t("PROの解約とは別の操作です。", "Separate from cancelling PRO.") })}
      </div>
    </>}
    <div className={styles.foot}>Tech Phase Research</div>

    {sheet === "upgrade" && <UpgradeSheet ja={ja} mode={mode} refresh={refresh} onClose={closePlain} />}
    {sheet === "stop" && mode && sub && <StopSheet ja={ja} mode={mode} subscriptionId={sub.id} until={proUntil} onDone={() => { closePlain(); recheck(); }} onClose={closePlain} />}
    {sheet === "delete" && <DeleteSheet ja={ja}
      locked={member.plan === "pro" && !owner && (contract.state !== "ok" || ["active", "suspended", "creating", "approval_pending"].includes(sub?.state ?? ""))}
      lockedReason={contract.state === "ok" ? t("PROの契約が有効です。先に、自動更新の停止を確認してください。", "Your PRO contract is active. Stop automatic renewal first.") : t("契約の状態を確認できません。確認できるまで、削除はできません。", "Your contract cannot be checked, so deletion is unavailable.")}
      proUntil={member.plan === "pro" ? proUntil : null}
      onRecheck={() => { recheck(); if (sub && ["active", "suspended"].includes(sub.state)) { closePlain(); } }}
      onDelete={deleteAccount} onClose={closePlain} />}
    {sheet === "avatar" && <AvatarSheet ja={ja} initial={initial} current={tile ? tile.id : INITIAL} onSave={saveAvatar} onClose={closePlain} />}
    {sheet === "name" && <NameSheet ja={ja} current={display} onSave={saveName} onClose={closePlain} />}
  </div>;
}
