const API = "https://www.googleapis.com/youtube/v3";

export type HeldComment = {
  id: string;
  videoId: string;
  videoTitle: string;
  author: string;
  text: string;
  publishedAt: string;
  isReply: boolean;
};

type Credentials = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

export async function getAccessToken(credentials: Credentials): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Google のアクセストークン取得に失敗しました (${response.status})。リフレッシュトークンが失効していないか確認してください。`,
    );
  }

  const payload = (await response.json()) as { access_token: string };
  return payload.access_token;
}

async function youtubeFetch(accessToken: string, path: string, init?: RequestInit) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...init?.headers },
  });

  if (!response.ok) {
    // レスポンス本文にコメント内容が含まれることはないが、念のためステータスと理由だけ出す
    let reason = "";
    try {
      const body = (await response.json()) as { error?: { errors?: { reason?: string }[] } };
      reason = body.error?.errors?.map((e) => e.reason).join(",") ?? "";
    } catch {
      // ignore
    }
    throw new Error(`YouTube API ${path.split("?")[0]} が ${response.status} を返しました ${reason}`);
  }

  return response;
}

type CommentResource = {
  id: string;
  snippet: {
    videoId?: string;
    authorDisplayName: string;
    textOriginal?: string;
    textDisplay: string;
    publishedAt: string;
    moderationStatus?: string;
  };
};

type CommentThreadResource = {
  snippet: {
    videoId?: string;
    topLevelComment: CommentResource;
  };
  replies?: { comments: CommentResource[] };
};

function toHeldComment(comment: CommentResource, videoId: string, isReply: boolean): HeldComment {
  return {
    id: comment.id,
    videoId,
    videoTitle: "",
    author: comment.snippet.authorDisplayName,
    text: comment.snippet.textOriginal ?? comment.snippet.textDisplay,
    publishedAt: comment.snippet.publishedAt,
    isReply,
  };
}

/** 承認待ち（heldForReview）のコメントを全件取得する。 */
export async function listHeldComments(accessToken: string, channelId: string): Promise<HeldComment[]> {
  const comments: HeldComment[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      part: "snippet,replies",
      allThreadsRelatedToChannelId: channelId,
      moderationStatus: "heldForReview",
      textFormat: "plainText",
      maxResults: "100",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const response = await youtubeFetch(accessToken, `/commentThreads?${params}`);
    const payload = (await response.json()) as {
      items?: CommentThreadResource[];
      nextPageToken?: string;
    };

    for (const thread of payload.items ?? []) {
      const videoId = thread.snippet.videoId ?? thread.snippet.topLevelComment.snippet.videoId ?? "";
      const top = thread.snippet.topLevelComment;
      if (!top.snippet.moderationStatus || top.snippet.moderationStatus === "heldForReview") {
        comments.push(toHeldComment(top, videoId, false));
      }
      for (const reply of thread.replies?.comments ?? []) {
        if (reply.snippet.moderationStatus === "heldForReview") {
          comments.push(toHeldComment(reply, videoId, true));
        }
      }
    }

    pageToken = payload.nextPageToken;
  } while (pageToken);

  return comments;
}

/** 動画IDからタイトルを引く（判定の文脈と通知の表示用）。 */
export async function fillVideoTitles(accessToken: string, comments: HeldComment[]): Promise<void> {
  const ids = [...new Set(comments.map((c) => c.videoId).filter(Boolean))];
  const titles = new Map<string, string>();

  for (let i = 0; i < ids.length; i += 50) {
    const params = new URLSearchParams({ part: "snippet", id: ids.slice(i, i + 50).join(",") });
    const response = await youtubeFetch(accessToken, `/videos?${params}`);
    const payload = (await response.json()) as { items?: { id: string; snippet: { title: string } }[] };
    for (const video of payload.items ?? []) {
      titles.set(video.id, video.snippet.title);
    }
  }

  for (const comment of comments) {
    comment.videoTitle = titles.get(comment.videoId) ?? "";
  }
}

/**
 * コメントを公開（published）または非公開（rejected）にする。
 * 投稿者のブロック（banAuthor）は誤判定時に取り返しがつかないため行わない。
 */
export async function setModerationStatus(
  accessToken: string,
  ids: string[],
  status: "published" | "rejected",
): Promise<void> {
  for (let i = 0; i < ids.length; i += 50) {
    const params = new URLSearchParams({
      id: ids.slice(i, i + 50).join(","),
      moderationStatus: status,
    });
    await youtubeFetch(accessToken, `/comments/setModerationStatus?${params}`, { method: "POST" });
  }
}
