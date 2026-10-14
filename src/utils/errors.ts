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
      "This project has no business profile yet. Run the setup_wizard prompt for this project, or call update_business_profile (projects/<project>/business.yaml; template: config/business.example.yaml).",
    );
  }
}

export class ConfigInvalidError extends AppError {
  constructor(public readonly issues: string[]) {
    super(
      `projects/<project>/business.yaml is invalid: ${issues.join("; ")}`,
      "Fix the listed fields and retry.",
    );
  }
}

export class NoDataError extends AppError {
  constructor(message = "No ad data found for this period.") {
    super(
      message,
      "Drop a Meta Ads Manager export (Ads level, breakdown by Day) into projects/<project>/inbox/ and run import_ads_from_folder, or set the project's ad account (configure_project_meta) and run sync_ads_from_meta.",
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
      "Check META_ACCESS_TOKEN (needs ads_read; global .env or the project's project.env), the project's ad account (configure_project_meta) and META_API_VERSION.",
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
