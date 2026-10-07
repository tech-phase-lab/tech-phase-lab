import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "プライバシーポリシー | わたがしコメント審査",
  description: "YouTube コメント審査ツールのプライバシーポリシー",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 leading-relaxed">
      <h1 className="mb-6 text-2xl font-bold">プライバシーポリシー</h1>
      <p className="mb-6">
        「わたがしコメント審査」（以下、本ツール）は、YouTube チャンネル「投資家わたがし」の運営者が、
        自身のチャンネルに投稿されたコメントを審査するためだけに使用する非公開のツールです。
      </p>

      <h2 className="mb-2 mt-8 text-lg font-bold">取得する情報</h2>
      <p>
        YouTube Data API を通じて、運営者のチャンネルで承認待ちになっているコメント（本文・投稿者の表示名・投稿日時）と、
        対象動画のタイトルを取得します。
      </p>

      <h2 className="mb-2 mt-8 text-lg font-bold">利用目的</h2>
      <p>
        コメントを公開するか非公開にするかを判定し、YouTube 上の承認状態を更新するため、
        および判断に迷うコメントを運営者に通知するためにのみ利用します。
      </p>

      <h2 className="mb-2 mt-8 text-lg font-bold">第三者への提供</h2>
      <p>
        判定のため、コメントの内容を OpenAI 社の API に送信します。
        また、運営者への通知のため、コメントの内容を運営者の Discord または LINE に送信します。
        これ以外の第三者に提供することはありません。
      </p>

      <h2 className="mb-2 mt-8 text-lg font-bold">保存</h2>
      <p>
        コメントの本文や投稿者名は保存しません。重複通知を防ぐため、コメントの ID のみを最大30日間保存します。
      </p>

      <h2 className="mb-2 mt-8 text-lg font-bold">アクセス権の取り消し</h2>
      <p>
        本ツールへのアクセス権は{" "}
        <a className="underline" href="https://myaccount.google.com/permissions">
          Google アカウントの権限設定
        </a>
        からいつでも取り消せます。本ツールによる Google API から取得した情報の利用は、
        <a className="underline" href="https://developers.google.com/terms/api-services-user-data-policy">
          Google API Services User Data Policy
        </a>
        （Limited Use の要件を含む）に従います。
      </p>
    </main>
  );
}
