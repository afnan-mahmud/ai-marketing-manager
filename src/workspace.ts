import dotenv from "dotenv";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { format } from "date-fns";
import type { BusinessPatch } from "./config/business.js";
import { loadProjectEnv } from "./config/env.js";
import { buildPaths } from "./config/paths.js";
import { createContext, type AppContext, type ProjectInfo } from "./context.js";
import { toIsoDate } from "./utils/dates.js";
import { AppError, NotFoundError } from "./utils/errors.js";
import { logger } from "./utils/logger.js";
import { slugify } from "./utils/slug.js";

const META_FILE = "project.json";
const ACTIVE_FILE = ".active";
const ARCHIVE_DIR = "_archived";
const PROJECT_SUBDIRS = ["inbox", "processed", "competitors", "snapshots", "reports"];

const PROJECT_ENV_TEMPLATE = `# Meta settings for this project only (gitignored). Values here override the global .env.
# The ad account id is NEVER taken from the global .env — set it here (or with configure_project_meta).
META_AD_ACCOUNT_ID=
# Optional: a token only for this client. Leave empty to use the agency-wide token from the global .env.
META_ACCESS_TOKEN=
# Optional overrides
META_AD_LIBRARY_TOKEN=
META_API_VERSION=
`;

export interface WorkspaceOptions {
  projectsDir: string;
  /** Global environment (process.env after loading the root .env). */
  globalEnv: Record<string, string | undefined>;
  now?: () => Date;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Tests: open every project database in memory. */
  inMemoryDb?: boolean;
}

interface CachedContext {
  ctx: AppContext;
  envMtime: number;
}

/**
 * The agency workspace: one folder per client project under PROJECTS_DIR. Each project has its own
 * business.yaml, project.env (Meta keys), database, inbox, competitor files, snapshots and reports.
 */
export class Workspace {
  private readonly cache = new Map<string, CachedContext>();

  constructor(private readonly opts: WorkspaceOptions) {
    mkdirSync(opts.projectsDir, { recursive: true });
  }

  get projectsDir(): string {
    return this.opts.projectsDir;
  }

  now(): Date {
    return this.opts.now ? this.opts.now() : new Date();
  }

  today(): string {
    return toIsoDate(this.now());
  }

  /** All projects (folders with a project.json), sorted by name. */
  list(): ProjectInfo[] {
    const dir = this.opts.projectsDir;
    return readdirSync(dir)
      .filter((d) => !d.startsWith(".") && d !== ARCHIVE_DIR && existsSync(join(dir, d, META_FILE)))
      .map((d) => this.readMeta(d))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private readMeta(slug: string): ProjectInfo {
    const dir = join(this.opts.projectsDir, slug);
    const meta = JSON.parse(readFileSync(join(dir, META_FILE), "utf8")) as Partial<ProjectInfo>;
    return { name: meta.name ?? slug, slug, dir, created_at: meta.created_at ?? "" };
  }

  /** Creates projects/<slug>/ with its folders, an empty project.env and (optionally) a business profile. */
  create(name: string, business?: BusinessPatch): { project: ProjectInfo; ctx: AppContext } {
    const clean = name.trim();
    if (!clean) throw new AppError("Project name is required.");
    const slug = slugify(clean);
    if (slug === ARCHIVE_DIR || slug.startsWith("."))
      throw new AppError(`"${clean}" can't be used as a project name.`);
    const existing = this.list().find(
      (p) => p.slug === slug || p.name.toLowerCase() === clean.toLowerCase(),
    );
    if (existing) {
      throw new AppError(
        `A project named "${existing.name}" already exists (folder projects/${existing.slug}).`,
        "Use switch_project to work on it, or pick another name.",
      );
    }
    const dir = join(this.opts.projectsDir, slug);
    if (existsSync(dir))
      throw new AppError(
        `The folder projects/${slug} already exists but isn't a project.`,
        "Rename or remove that folder first.",
      );
    for (const sub of PROJECT_SUBDIRS) mkdirSync(join(dir, sub), { recursive: true });
    const info: ProjectInfo = { name: clean, slug, dir, created_at: this.now().toISOString() };
    writeFileSync(
      join(dir, META_FILE),
      JSON.stringify({ name: info.name, slug, created_at: info.created_at }, null, 2) + "\n",
    );
    writeFileSync(join(dir, "project.env"), PROJECT_ENV_TEMPLATE);
    const ctx = this.context(slug);
    if (business && Object.keys(business).length > 0) {
      const cfg = ctx.business.update(business);
      ctx.services.competitors.syncFromConfig(cfg);
    }
    this.setActive(slug);
    logger.info(`Created project "${clean}" at ${dir}`);
    return { project: info, ctx };
  }

  /** Finds a project by name or slug (case-insensitive); without an argument, the active project. */
  resolve(nameOrSlug?: string): ProjectInfo {
    const projects = this.list();
    if (nameOrSlug && nameOrSlug.trim()) {
      const key = nameOrSlug.trim().toLowerCase();
      const found = projects.find(
        (p) => p.slug === key || p.name.toLowerCase() === key || p.slug === slugify(key),
      );
      if (!found) {
        throw new NotFoundError(
          `No project named "${nameOrSlug}".`,
          projects.length
            ? `Projects: ${projects.map((p) => p.name).join(", ")}. Or create it with create_project.`
            : "Create one with create_project.",
        );
      }
      return found;
    }
    const active = this.activeSlug();
    const activeProject = active ? projects.find((p) => p.slug === active) : undefined;
    if (activeProject) return activeProject;
    if (projects.length === 1) return projects[0]!;
    if (projects.length === 0) {
      throw new NotFoundError(
        "No project exists yet.",
        'Create one for the client with create_project, e.g. { "name": "Client Name" }.',
      );
    }
    throw new NotFoundError(
      "No project selected.",
      `Pass "project" to the tool, or call switch_project. Projects: ${projects.map((p) => p.name).join(", ")}.`,
    );
  }

  activeSlug(): string | null {
    const f = join(this.opts.projectsDir, ACTIVE_FILE);
    if (!existsSync(f)) return null;
    const slug = readFileSync(f, "utf8").trim();
    return slug && existsSync(join(this.opts.projectsDir, slug, META_FILE)) ? slug : null;
  }

  setActive(slug: string): void {
    writeFileSync(join(this.opts.projectsDir, ACTIVE_FILE), slug + "\n");
  }

  /** The project's context (opened once and cached; rebuilt when its project.env changes). */
  context(nameOrSlug?: string): AppContext {
    const project = this.resolve(nameOrSlug);
    const envFile = buildPaths(project.dir).projectEnv;
    const mtime = existsSync(envFile) ? statSync(envFile).mtimeMs : 0;
    const cached = this.cache.get(project.slug);
    if (cached && cached.envMtime === mtime) return cached.ctx;
    if (cached) cached.ctx.db.close();
    const projectEnv = existsSync(envFile) ? dotenv.parse(readFileSync(envFile)) : {};
    const ctx = createContext({
      project,
      env: loadProjectEnv(this.opts.globalEnv, projectEnv),
      dbFile: this.opts.inMemoryDb ? ":memory:" : undefined,
      now: this.opts.now,
      fetch: this.opts.fetch,
      sleep: this.opts.sleep,
    });
    this.cache.set(project.slug, { ctx, envMtime: mtime });
    return ctx;
  }

  /** Writes non-secret Meta settings into the project's project.env (other lines are kept). */
  configureMeta(
    nameOrSlug: string | undefined,
    values: Record<string, string | undefined>,
  ): ProjectInfo {
    const project = this.resolve(nameOrSlug);
    const file = buildPaths(project.dir).projectEnv;
    const lines = existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/) : [];
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) continue;
      const idx = lines.findIndex((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
      const line = `${key}=${value}`;
      if (idx >= 0) lines[idx] = line;
      else lines.push(line);
    }
    writeFileSync(file, lines.join("\n").replace(/\n*$/, "\n"));
    this.cache.delete(project.slug);
    return project;
  }

  /** Moves a project folder to projects/_archived/<slug>-<timestamp> (nothing is deleted). */
  archive(nameOrSlug: string): { project: ProjectInfo; archived_to: string } {
    const project = this.resolve(nameOrSlug);
    const cached = this.cache.get(project.slug);
    if (cached) cached.ctx.db.close();
    this.cache.delete(project.slug);
    const target = join(
      this.opts.projectsDir,
      ARCHIVE_DIR,
      `${project.slug}-${format(this.now(), "yyyyMMdd-HHmmss")}`,
    );
    mkdirSync(join(this.opts.projectsDir, ARCHIVE_DIR), { recursive: true });
    renameSync(project.dir, target);
    if (this.activeSlug() === null) {
      const left = this.list();
      if (left.length === 1) this.setActive(left[0]!.slug);
    }
    return { project, archived_to: target };
  }

  close(): void {
    for (const { ctx } of this.cache.values()) ctx.db.close();
    this.cache.clear();
  }
}
