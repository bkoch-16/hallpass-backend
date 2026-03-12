import fg from "fast-glob";
import fs from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface KeyValue {
  key: string;
  value: string;
}

interface RequestBody {
  type: string;
  content: string;
}

interface RequestYaml {
  name?: string;
  url: string;
  method: string;
  description?: string;
  order?: number;
  headers?: KeyValue[];
  pathVariables?: KeyValue[];
  queryParams?: KeyValue[];
  body?: RequestBody;
}

interface DefinitionYaml {
  $kind?: string;
  order?: number;
  environmentPattern?: string;
}

interface EnvValue {
  key: string;
  value: string;
  enabled?: boolean;
}

interface EnvironmentYaml {
  name: string;
  values: EnvValue[];
}

interface ParsedEnvironment {
  label: string;
  stage: string;
  baseUrl: string;
}

interface Endpoint {
  name: string;
  order: number;
  method: string;
  url: string;
  description: string;
  headers: KeyValue[];
  pathVariables: KeyValue[];
  queryParams: KeyValue[];
  body: string | null;
}

interface Subgroup {
  name: string;
  order: number;
  endpoints: Endpoint[];
}

interface Group {
  name: string;
  order: number;
  baseUrls: Record<string, string>;
  subgroups: Subgroup[] | null;
  endpoints: Endpoint[];
}

interface Config {
  stages: string[];
  groups: Group[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(path.dirname(process.argv[1]), "..");

function abs(rel: string): string {
  return path.join(REPO_ROOT, rel);
}

function readYaml<T>(filePath: string): T {
  return parseYaml(fs.readFileSync(filePath, "utf8")) as T;
}

function stemName(filePath: string): string {
  return path.basename(filePath).replace(/\.request\.yaml$/, "");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function readOrder(dir: string): number {
  const defPath = path.join(dir, ".resources", "definition.yaml");
  if (fs.existsSync(defPath)) {
    const def = readYaml<DefinitionYaml>(defPath);
    return def.order ?? 9999;
  }
  return 9999;
}

function readEnvironmentPattern(dir: string): string | null {
  const defPath = path.join(dir, ".resources", "definition.yaml");
  if (fs.existsSync(defPath)) {
    const def = readYaml<DefinitionYaml>(defPath);
    return def.environmentPattern ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Parse environments
// ---------------------------------------------------------------------------

function parseEnvironments(): { stages: string[]; envs: ParsedEnvironment[] } {
  const files = fg.sync(abs("postman/environments/*.environment.yaml"));
  const stageSet = new Set<string>();
  const envs: ParsedEnvironment[] = [];

  for (const f of files) {
    const env = readYaml<EnvironmentYaml>(f);
    const baseEntry = env.values.find((v) => v.key === "Base");
    const baseUrl = baseEntry?.value ?? "";
    const stageMatch = env.name.match(/\b(dev|prod|staging|beta|local)\b/i);
    if (!stageMatch) continue;
    const stage = capitalize(stageMatch[1]);
    stageSet.add(stage);
    envs.push({ label: env.name, stage, baseUrl });
  }

  // Prod first, then alphabetical; exclude dev/local environments
  const stages = [...stageSet].sort((a, b) =>
    a === "Prod" ? -1 : b === "Prod" ? 1 : a.localeCompare(b)
  ).filter(s => !/^(dev|local)$/i.test(s));

  const filteredEnvs = envs.filter(e => !/^(dev|local)$/i.test(e.stage));

  return { stages, envs: filteredEnvs };
}

// ---------------------------------------------------------------------------
// Match environments to a collection by pattern
// ---------------------------------------------------------------------------

function getBaseUrls(
  pattern: string | null,
  envs: ParsedEnvironment[]
): Record<string, string> {
  if (!pattern) return {};
  const baseUrls: Record<string, string> = {};
  for (const env of envs) {
    if (env.label.toLowerCase().includes(pattern.toLowerCase())) {
      baseUrls[env.stage] = env.baseUrl;
    }
  }
  return baseUrls;
}

// ---------------------------------------------------------------------------
// Parse groups for a single collection directory
// ---------------------------------------------------------------------------

function parseGroupsForCollection(
  collectionDir: string,
  envs: ParsedEnvironment[]
): Group[] {
  const collectionDefPath = path.join(
    collectionDir,
    ".resources",
    "definition.yaml"
  );
  let environmentPattern: string | null = null;
  if (fs.existsSync(collectionDefPath)) {
    const def = readYaml<DefinitionYaml>(collectionDefPath);
    environmentPattern = def.environmentPattern ?? null;
  }

  const requestFiles = fg.sync(
    path.join(collectionDir, "**/*.request.yaml")
  );
  const groupMap = new Map<string, Group>();
  // subgroupMap: groupName -> subgroupName -> Subgroup
  const subgroupMap = new Map<string, Map<string, Subgroup>>();

  for (const filePath of requestFiles) {
    const rel = path.relative(collectionDir, filePath);
    const parts = rel.split(path.sep);

    // Determine group and optional subgroup from path depth
    let groupName: string;
    let groupDir: string | null;
    let subgroupName: string | null = null;
    let subgroupDir: string | null = null;

    if (parts.length === 1) {
      groupName = "No group";
      groupDir = null;
    } else if (parts.length === 2) {
      groupName = parts[0];
      groupDir = path.join(collectionDir, parts[0]);
    } else {
      // 3+ levels: treat first as group, second as subgroup
      groupName = parts[0];
      groupDir = path.join(collectionDir, parts[0]);
      subgroupName = parts[1];
      subgroupDir = path.join(collectionDir, parts[0], parts[1]);
    }

    if (!groupMap.has(groupName)) {
      const groupPattern = groupDir ? readEnvironmentPattern(groupDir) : null;
      groupMap.set(groupName, {
        name: groupName,
        order: groupDir ? readOrder(groupDir) : 9999,
        baseUrls: getBaseUrls(groupPattern ?? environmentPattern, envs),
        subgroups: null,
        endpoints: [],
      });
      subgroupMap.set(groupName, new Map());
    }

    const req = readYaml<RequestYaml>(filePath);
    const endpoint: Endpoint = {
      name: req.name ?? stemName(filePath),
      order: req.order ?? 9999,
      method: (req.method ?? "GET").toUpperCase(),
      url: (req.url ?? "").split("?")[0],
      description: req.description ?? "",
      headers: req.headers ?? [],
      pathVariables: req.pathVariables ?? [],
      queryParams: req.queryParams ?? [],
      body: req.body?.content ?? null,
    };

    const group = groupMap.get(groupName)!;
    const sgMap = subgroupMap.get(groupName)!;

    if (subgroupName) {
      if (!sgMap.has(subgroupName)) {
        sgMap.set(subgroupName, {
          name: subgroupName,
          order: subgroupDir ? readOrder(subgroupDir) : 9999,
          endpoints: [],
        });
      }
      sgMap.get(subgroupName)!.endpoints.push(endpoint);
      // Mark group as having subgroups
      if (group.subgroups === null) group.subgroups = [];
    } else {
      group.endpoints.push(endpoint);
    }
  }

  // Attach and sort subgroups
  for (const [groupName, sgMap] of subgroupMap.entries()) {
    if (sgMap.size === 0) continue;
    const group = groupMap.get(groupName)!;
    group.subgroups = [...sgMap.values()].sort(
      (a, b) => a.order - b.order || a.name.localeCompare(b.name)
    );
    for (const sg of group.subgroups) {
      sg.endpoints.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    }
  }

  for (const group of groupMap.values()) {
    group.endpoints.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }

  return [...groupMap.values()].sort(
    (a, b) => a.order - b.order || a.name.localeCompare(b.name)
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const { stages, envs } = parseEnvironments();

  const collectionDirs = fg.sync(abs("postman/collections/*/"), {
    onlyDirectories: true,
  });

  const groups: Group[] = [];
  for (const dir of collectionDirs) {
    groups.push(...parseGroupsForCollection(dir, envs));
  }
  groups.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  const config: Config = { stages, groups };

  const outDir = abs("apps/demo-ui");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "config.js"),
    `const CONFIG = ${JSON.stringify(config, null, 2)};\n`,
    "utf8"
  );

  const totalEndpoints = groups.reduce((n, g) => {
    if (g.subgroups) {
      return n + g.subgroups.reduce((m, sg) => m + sg.endpoints.length, 0);
    }
    return n + g.endpoints.length;
  }, 0);
  console.log(
    `Generated apps/demo-ui/config.js — ${groups.length} groups, ${totalEndpoints} endpoints, ${stages.length} stages`
  );
}

main();
