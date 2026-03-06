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

interface GroupDefinitionYaml {
  order?: number;
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

interface Group {
  name: string;
  order: number;
  endpoints: Endpoint[];
}

interface Environment {
  label: string;
  baseUrl: string;
}

interface Config {
  environments: Environment[];
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

// ---------------------------------------------------------------------------
// Parse environments
// ---------------------------------------------------------------------------

function parseEnvironments(): Environment[] {
  const files = fg.sync(abs("postman/environments/*.environment.yaml"));
  return files
    .map((f) => {
      const env = readYaml<EnvironmentYaml>(f);
      const baseEntry = env.values.find((v) => v.key === "Base");
      return { label: env.name, baseUrl: baseEntry?.value ?? "" };
    })
    .filter((env) => !/prod/i.test(env.label));
}

// ---------------------------------------------------------------------------
// Parse requests + groups
// ---------------------------------------------------------------------------

function parseGroups(): Group[] {
  const requestFiles = fg.sync(
    abs("postman/collections/hallpass/**/*.request.yaml")
  );

  const groupMap = new Map<string, Group>();

  for (const filePath of requestFiles) {
    const rel = path.relative(abs("postman/collections/hallpass"), filePath);
    const parts = rel.split(path.sep);

    let groupName: string;
    let groupDir: string | null;
    if (parts.length === 1) {
      groupName = "No group";
      groupDir = null;
    } else {
      groupName = parts[0];
      groupDir = abs(path.join("postman/collections/hallpass", parts[0]));
    }

    let groupOrder = 9999;
    if (groupDir) {
      const defPath = path.join(groupDir, ".resources", "definition.yaml");
      if (fs.existsSync(defPath)) {
        const def = readYaml<GroupDefinitionYaml>(defPath);
        groupOrder = def.order ?? 9999;
      }
    }

    if (!groupMap.has(groupName)) {
      groupMap.set(groupName, { name: groupName, order: groupOrder, endpoints: [] });
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

    groupMap.get(groupName)!.endpoints.push(endpoint);
  }

  for (const group of groupMap.values()) {
    group.endpoints.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }

  return [...groupMap.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const environments = parseEnvironments();
  const groups = parseGroups();
  const config: Config = { environments, groups };

  const outDir = abs("apps/demo-ui");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "config.js"),
    `const CONFIG = ${JSON.stringify(config, null, 2)};\n`,
    "utf8"
  );

  const totalEndpoints = groups.reduce((n, g) => n + g.endpoints.length, 0);
  console.log(
    `Generated apps/demo-ui/config.js — ${groups.length} groups, ${totalEndpoints} endpoints, ${environments.length} environments`
  );
}

main();
