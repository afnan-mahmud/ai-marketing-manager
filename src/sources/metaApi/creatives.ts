import type { AdCreative, CreativeFormat } from "../../types/ads.js";
import type { MetaApiClient } from "./client.js";

const CREATIVE_FIELDS =
  "creative{title,body,call_to_action_type,thumbnail_url,image_url,object_type,link_url,object_story_spec,asset_feed_spec}";
/** Graph API allows up to 50 ids per ?ids= request. */
const BATCH = 50;

interface StorySpec {
  link_data?: {
    name?: string;
    message?: string;
    link?: string;
    call_to_action?: { type?: string; value?: { link?: string } };
    child_attachments?: unknown[];
    picture?: string;
  };
  video_data?: {
    title?: string;
    message?: string;
    image_url?: string;
    call_to_action?: { type?: string; value?: { link?: string } };
  };
}

interface RawCreative {
  title?: string;
  body?: string;
  call_to_action_type?: string;
  thumbnail_url?: string;
  image_url?: string;
  object_type?: string;
  link_url?: string;
  object_story_spec?: StorySpec;
  asset_feed_spec?: {
    titles?: { text: string }[];
    bodies?: { text: string }[];
    link_urls?: { website_url?: string }[];
  };
}

export function mapCreative(adId: string, c: RawCreative | undefined): AdCreative {
  const link = c?.object_story_spec?.link_data;
  const video = c?.object_story_spec?.video_data;
  const feed = c?.asset_feed_spec;
  let format: CreativeFormat = "unknown";
  if (link?.child_attachments && link.child_attachments.length > 1) format = "carousel";
  else if (video || c?.object_type === "VIDEO") format = "video";
  else if (
    c?.object_type === "PHOTO" ||
    c?.object_type === "SHARE" ||
    link?.picture ||
    c?.image_url
  )
    format = "image";
  return {
    ad_id: adId,
    headline: c?.title ?? link?.name ?? video?.title ?? feed?.titles?.[0]?.text ?? null,
    primary_text: c?.body ?? link?.message ?? video?.message ?? feed?.bodies?.[0]?.text ?? null,
    cta:
      c?.call_to_action_type ?? link?.call_to_action?.type ?? video?.call_to_action?.type ?? null,
    format,
    thumbnail_url: c?.thumbnail_url ?? c?.image_url ?? video?.image_url ?? null,
    landing_url:
      c?.link_url ??
      link?.link ??
      link?.call_to_action?.value?.link ??
      video?.call_to_action?.value?.link ??
      feed?.link_urls?.[0]?.website_url ??
      null,
  };
}

export async function fetchCreatives(
  client: MetaApiClient,
  adIds: string[],
): Promise<AdCreative[]> {
  const out: AdCreative[] = [];
  for (let i = 0; i < adIds.length; i += BATCH) {
    const ids = adIds.slice(i, i + BATCH);
    const res = await client.get<Record<string, { id: string; creative?: RawCreative }>>("", {
      ids: ids.join(","),
      fields: CREATIVE_FIELDS,
    });
    for (const id of ids) out.push(mapCreative(id, res[id]?.creative));
  }
  return out;
}
