/**
 * Typed errors. Each carries a user-facing, actionable message that is safe to show the client.
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ConfigMissingError extends AppError {
  constructor(message = "Business profile not found.") {
    super(
      message,
      "Create config/business.yaml from config/business.example.yaml, or run the setup_wizard prompt / update_business_profile tool.",
    );
  }
}

export class ConfigInvalidError extends AppError {
  constructor(public readonly issues: string[]) {
    super(
      `config/business.yaml is invalid: ${issues.join("; ")}`,
      "Fix the listed fields and retry.",
    );
  }
}

export class NoDataError extends AppError {
  constructor(message = "No ad data found for this period.") {
    super(
      message,
      "Drop a Meta Ads Manager export (Ads level, breakdown by Day) into data/inbox/ and run import_ads_from_folder, or configure META_ACCESS_TOKEN and run sync_ads_from_meta.",
    );
  }
}

export class MetaApiError extends AppError {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: number,
  ) {
    super(
      message,
      "Check META_ACCESS_TOKEN (needs ads_read), META_AD_ACCOUNT_ID (numeric, without act_) and META_API_VERSION in .env.",
    );
  }
}

export class ImportFormatError extends AppError {
  constructor(message: string) {
    super(
      message,
      "Export from Ads Manager at the Ads level with a Day breakdown and include at least: Day, Ad name, Amount spent, Impressions.",
    );
  }
}

export class FetchBlockedError extends AppError {
  constructor(message: string) {
    super(
      message,
      "This page cannot be fetched politely (robots.txt, size, or network). Skip it or add a different public URL.",
    );
  }
}

export class NotFoundError extends AppError {}

export interface FriendlyError {
  error: string;
  type: string;
  hint?: string;
  details?: unknown;
}

export function toFriendlyError(err: unknown): FriendlyError {
  if (err instanceof ConfigInvalidError) {
    return { error: err.message, type: err.name, hint: err.hint, details: err.issues };
  }
  if (err instanceof AppError) {
    return { error: err.message, type: err.name, ...(err.hint ? { hint: err.hint } : {}) };
  }
  return {
    error: "Unexpected server error. Details were written to the server log (stderr).",
    type: "InternalError",
  };
}
