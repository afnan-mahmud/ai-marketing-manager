import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { MetaApiError } from "../../utils/errors.js";
import type { MetaApiClient } from "./client.js";

/**
 * Write side of the Marketing API. Every function here changes something in Ads Manager, so services must only call
 * them from a user-confirmed action (see services/adManagerService.ts). Reads used for previews live here too.
 */

export type MetaLevel = "campaign" | "adset" | "ad";

/** Currencies whose budgets Meta stores without minor units (offset 1); all others use offset 100. */
const ZERO_DECIMAL_CURRENCIES = new Set([
  "CLP",
  "COP",
  "CRC",
  "HUF",
  "ISK",
  "IDR",
  "JPY",
  "KRW",
  "PYG",
  "TWD",
  "VND",
]);

export function currencyOffset(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 1 : 100;
}

export interface AdAccountInfo {
  id: string;
  account_id: string;
  name?: string;
  currency: string;
  account_status?: number;
}

export function getAdAccount(client: MetaApiClient, accountId: string): Promise<AdAccountInfo> {
  return client.get<AdAccountInfo>(`act_${accountId}`, {
    fields: "account_id,name,currency,account_status",
  });
}

export interface MetaObject {
  id: string;
  account_id?: string;
  name?: string;
  status?: string;
  effective_status?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  objective?: string;
  optimization_goal?: string;
  campaign_id?: string;
  adset_id?: string;
  campaign?: { id: string; name?: string; objective?: string };
}

const OBJECT_FIELDS: Record<MetaLevel, string> = {
  campaign: "account_id,name,status,effective_status,daily_budget,lifetime_budget,objective",
  adset:
    "account_id,name,status,effective_status,daily_budget,lifetime_budget,optimization_goal,campaign{id,name,objective}",
  ad: "account_id,name,status,effective_status,adset_id,campaign_id",
};

export function getObject(
  client: MetaApiClient,
  level: MetaLevel,
  id: string,
): Promise<MetaObject> {
  return client.get<MetaObject>(id, { fields: OBJECT_FIELDS[level] });
}

const LIVE = [
  "ACTIVE",
  "PAUSED",
  "CAMPAIGN_PAUSED",
  "ADSET_PAUSED",
  "IN_PROCESS",
  "WITH_ISSUES",
  "PENDING_REVIEW",
  "DISAPPROVED",
  "PREAPPROVED",
  "PENDING_BILLING_INFO",
];

/** Live (not deleted/archived) campaigns, ad sets and ads with ids, statuses and budgets. */
export async function listStructure(client: MetaApiClient, accountId: string, includeAds: boolean) {
  const filtering = JSON.stringify([{ field: "effective_status", operator: "IN", value: LIVE }]);
  const [campaigns, adsets, ads] = await Promise.all([
    client.getAll<MetaObject>(
      `act_${accountId}/campaigns`,
      { fields: OBJECT_FIELDS.campaign, filtering, limit: 200 },
      10,
    ),
    client.getAll<MetaObject>(
      `act_${accountId}/adsets`,
      {
        fields:
          "name,status,effective_status,daily_budget,lifetime_budget,optimization_goal,campaign_id",
        filtering,
        limit: 200,
      },
      10,
    ),
    includeAds
      ? client.getAll<MetaObject>(
          `act_${accountId}/ads`,
          { fields: "name,status,effective_status,adset_id,campaign_id", filtering, limit: 200 },
          10,
        )
      : Promise.resolve([] as MetaObject[]),
  ]);
  return { campaigns, adsets, ads };
}

// ---------- media ----------

export const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png"];
export const VIDEO_EXTENSIONS = [".mp4", ".mov", ".m4v"];

export function mediaType(file: string): "image" | "video" | null {
  const ext = extname(file).toLowerCase();
  if (IMAGE_EXTENSIONS.includes(ext)) return "image";
  if (VIDEO_EXTENSIONS.includes(ext)) return "video";
  return null;
}

function fileBlob(path: string): Blob {
  return new Blob([readFileSync(path)]);
}

export async function uploadImage(
  client: MetaApiClient,
  accountId: string,
  path: string,
): Promise<{ hash: string; url?: string }> {
  const form = new FormData();
  form.append("filename", fileBlob(path), basename(path));
  const res = await client.post<{ images?: Record<string, { hash: string; url?: string }> }>(
    `act_${accountId}/adimages`,
    form,
  );
  const first = Object.values(res.images ?? {})[0];
  if (!first?.hash) throw new MetaApiError("Meta did not return an image hash for the upload.");
  return first;
}

export async function uploadVideo(
  client: MetaApiClient,
  accountId: string,
  path: string,
  name: string,
): Promise<string> {
  const form = new FormData();
  form.append("source", fileBlob(path), basename(path));
  form.append("name", name);
  const res = await client.post<{ id?: string }>(`act_${accountId}/advideos`, form);
  if (!res.id) throw new MetaApiError("Meta did not return a video id for the upload.");
  return res.id;
}

export async function videoStatus(
  client: MetaApiClient,
  videoId: string,
): Promise<"ready" | "processing" | "error"> {
  const res = await client.get<{ status?: { video_status?: string } }>(videoId, {
    fields: "status",
  });
  const s = res.status?.video_status;
  return s === "ready" ? "ready" : s === "error" ? "error" : "processing";
}

export async function videoThumbnail(
  client: MetaApiClient,
  videoId: string,
): Promise<string | null> {
  const res = await client.get<{ data?: { uri: string; is_preferred?: boolean }[] }>(
    `${videoId}/thumbnails`,
  );
  const list = res.data ?? [];
  return (list.find((t) => t.is_preferred) ?? list[0])?.uri ?? null;
}

// ---------- creatives & ads ----------

export interface CreativeSpec {
  name: string;
  page_id: string;
  instagram_user_id?: string;
  link_url: string;
  primary_text: string;
  headline?: string;
  description?: string;
  cta: string;
  image_hash?: string;
  video_id?: string;
  thumbnail_url?: string;
}

export function creativePayload(spec: CreativeSpec): Record<string, string> {
  const cta = { type: spec.cta, value: { link: spec.link_url } };
  const story: Record<string, unknown> = { page_id: spec.page_id };
  if (spec.instagram_user_id) story.instagram_user_id = spec.instagram_user_id;
  if (spec.video_id) {
    story.video_data = {
      video_id: spec.video_id,
      ...(spec.thumbnail_url ? { image_url: spec.thumbnail_url } : {}),
      message: spec.primary_text,
      ...(spec.headline ? { title: spec.headline } : {}),
      ...(spec.description ? { link_description: spec.description } : {}),
      call_to_action: cta,
    };
  } else {
    story.link_data = {
      image_hash: spec.image_hash,
      link: spec.link_url,
      message: spec.primary_text,
      ...(spec.headline ? { name: spec.headline } : {}),
      ...(spec.description ? { description: spec.description } : {}),
      call_to_action: cta,
    };
  }
  return { name: spec.name, object_story_spec: JSON.stringify(story) };
}

export async function createCreative(
  client: MetaApiClient,
  accountId: string,
  spec: CreativeSpec,
): Promise<string> {
  const res = await client.post<{ id?: string }>(
    `act_${accountId}/adcreatives`,
    creativePayload(spec),
  );
  if (!res.id) throw new MetaApiError("Meta did not return a creative id.");
  return res.id;
}

export async function createAd(
  client: MetaApiClient,
  accountId: string,
  ad: { name: string; adset_id: string; creative_id: string; status: "ACTIVE" | "PAUSED" },
): Promise<string> {
  const res = await client.post<{ id?: string }>(`act_${accountId}/ads`, {
    name: ad.name,
    adset_id: ad.adset_id,
    creative: JSON.stringify({ creative_id: ad.creative_id }),
    status: ad.status,
  });
  if (!res.id) throw new MetaApiError("Meta did not return an ad id.");
  return res.id;
}

export async function updateObject(
  client: MetaApiClient,
  id: string,
  fields: Record<string, string | number>,
): Promise<void> {
  const res = await client.post<{ success?: boolean }>(id, fields);
  if (res.success === false) throw new MetaApiError(`Meta did not apply the change to ${id}.`);
}

/** Duplicates an ad or ad set (POST /{id}/copies). Returns the new object's id. */
export async function copyObject(
  client: MetaApiClient,
  level: "ad" | "adset",
  id: string,
  opts: { status: "ACTIVE" | "PAUSED"; deepCopy?: boolean },
): Promise<string> {
  const res = await client.post<{ copied_ad_id?: string; copied_adset_id?: string }>(
    `${id}/copies`,
    {
      status_option: opts.status,
      ...(level === "adset" ? { deep_copy: opts.deepCopy ? "true" : "false" } : {}),
    },
  );
  const newId = level === "ad" ? res.copied_ad_id : res.copied_adset_id;
  if (!newId) throw new MetaApiError("Meta did not return the id of the copy.");
  return newId;
}
