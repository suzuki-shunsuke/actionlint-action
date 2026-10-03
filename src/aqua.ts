import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as tc from "@actions/tool-cache";
import { createHash } from "crypto";
import { chmod, readFile, rm } from "fs/promises";
import { join, dirname } from "path";
import { arch, homedir, platform, tmpdir } from "os";
import { mkdtempSync, existsSync, renameSync, mkdirSync } from "fs";
import { fileURLToPath } from "node:url";

const Version = "v2.56.2";
const CHECKSUMS = new Map([
  [
    "aqua_darwin_amd64.tar.gz",
    "46fb7060a3c94483ff3ea70e48b4bee3793d1d629ccec66050296ea57944af9c",
  ],
  [
    "aqua_darwin_arm64.tar.gz",
    "a93db5795ca73d878c8bae612cb08c67e0130b1c0926c995fd84fdde08ccc1aa",
  ],
  [
    "aqua_linux_amd64.tar.gz",
    "6ecff5d9f79ed31d3aeab826a15023dce577806a85b563d71975503418c2b34b",
  ],
  [
    "aqua_linux_arm64.tar.gz",
    "158c501f3aa5b97b54acfb3c8e8438cabb3f931929da8265c564badcf872e596",
  ],
  [
    "aqua_windows_amd64.zip",
    "fc3480ee1f43563a3703e853d5e659b2894b5c302ca27781f6c2bad3e337a9b6",
  ],
  [
    "aqua_windows_arm64.zip",
    "190e2450d4857c497b3bf37a1998c0bb155526da1eea2645f255590c6b0956df",
  ],
]);

/** The root directory of this action. dist/index.js is located at <root>/dist/index.js */
export const GitHubActionPath = join(
  fileURLToPath(import.meta.url),
  "..",
  "..",
);

/** aqua.yaml bundled with this action. It installs actionlint, reviewdog, and shellcheck */
export const aquaConfig = join(GitHubActionPath, "aqua", "aqua.yaml");

export const buildAquaGlobalConfig = (
  current: string | undefined,
  config: string,
): string => (current ? `${current}:${config}` : config);

export const getOS = (p: string): string => {
  switch (p) {
    case "darwin":
      return "darwin";
    case "linux":
      return "linux";
    case "win32":
      return "windows";
    default:
      throw new Error(`Unsupported OS: ${p}`);
  }
};

export const getArch = (architecture: string): string => {
  switch (architecture) {
    case "x64":
      return "amd64";
    case "arm64":
      return "arm64";
    default:
      throw new Error(`Unsupported architecture: ${architecture}`);
  }
};

export const getInstallPath = (
  os: string,
  aquaRoot: string,
  xdgDataHome: string,
  homeDir: string,
): string => {
  if (os === "windows") {
    const base = aquaRoot || join(homeDir, "AppData", "Local", "aquaproj-aqua");
    return join(base, "bin", "aqua.exe");
  }
  const xdgDataHomeVal = xdgDataHome || join(homeDir, ".local", "share");
  const base = aquaRoot || join(xdgDataHomeVal, "aquaproj-aqua");
  return join(base, "bin", "aqua");
};

export type EnvDeps = {
  processEnv: Record<string, string | undefined>;
  path: string;
  aquaGlobalConfig: string;
};

export const buildEnv = (
  deps: EnvDeps,
  installDir: string,
  githubToken?: string,
  env?: Record<string, string>,
): Record<string, string> => {
  const dynamicEnv: Record<string, string> = {
    AQUA_GLOBAL_CONFIG: deps.aquaGlobalConfig,
  };
  if (installDir) {
    dynamicEnv.PATH = `${deps.path}:${installDir}`;
  }
  if (githubToken) {
    dynamicEnv.AQUA_GITHUB_TOKEN = githubToken;
  }
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries(deps.processEnv)) {
    if (v !== undefined) {
      merged[k] = v;
    }
  }
  return { ...merged, ...env, ...dynamicEnv };
};

const verifyChecksum = async (
  filePath: string,
  expectedChecksum: string,
): Promise<void> => {
  core.info("Verifying checksum ...");
  const hash = createHash("sha256");
  hash.update(await readFile(filePath));
  const hashHex = hash.digest("hex");
  if (hashHex !== expectedChecksum) {
    throw new Error(
      `Checksum verification failed. Expected: ${expectedChecksum}, Got: ${hashHex}`,
    );
  }
};

export interface ExecOptions extends Omit<exec.ExecOptions, "env"> {
  env?: Record<string, string>;
  group?: string;
}

export class Executor {
  installDir: string;
  githubToken?: string;
  constructor(installDir: string, githubToken?: string) {
    this.installDir = installDir;
    this.githubToken = githubToken;
  }

  env(options?: ExecOptions): Record<string, string> {
    return buildEnv(
      {
        processEnv: process.env,
        path: process.env.PATH ?? "",
        aquaGlobalConfig: buildAquaGlobalConfig(
          process.env.AQUA_GLOBAL_CONFIG,
          aquaConfig,
        ),
      },
      this.installDir,
      this.githubToken,
      options?.env,
    );
  }

  async exec(
    command: string,
    args?: string[],
    options?: ExecOptions,
  ): Promise<number> {
    if (options?.group) {
      core.startGroup(options.group);
    }
    try {
      return await exec.exec(command, args, {
        ...options,
        env: this.env(options),
      });
    } finally {
      if (options?.group) {
        core.endGroup();
      }
    }
  }

  async getExecOutput(
    command: string,
    args?: string[],
    options?: ExecOptions,
  ): Promise<exec.ExecOutput> {
    if (options?.group) {
      core.startGroup(options.group);
    }
    try {
      return await exec.getExecOutput(command, args, {
        ...options,
        env: this.env(options),
      });
    } finally {
      if (options?.group) {
        core.endGroup();
      }
    }
  }
}

export const NewExecutor = async (githubToken?: string): Promise<Executor> => {
  const installDir = await install();
  const executor = new Executor(installDir, githubToken);
  await executor.exec("aqua", ["i", "-l", "-a"], {
    group: "aqua i -l -a",
  });
  return executor;
};

/**
 * install installs aqua.
 * It doesn't run commands like `aqua install` and `aqua policy allow`.
 * @returns The installation directory of aqua
 */
export const install = async (): Promise<string> => {
  try {
    await exec.exec("aqua", ["--version"], {
      silent: true,
    });
    core.info("Installing aqua is skipped");
    return "";
  } catch {
    // aqua is not installed, continue with installation
  }

  const os = getOS(platform());
  const architecture = getArch(arch());

  const installPath = getInstallPath(
    os,
    process.env.AQUA_ROOT_DIR ?? "",
    process.env.XDG_DATA_HOME ?? "",
    homedir(),
  );
  const installDir = dirname(installPath);
  core.addPath(installDir);

  if (existsSync(installPath)) {
    core.info(`aqua is already installed at ${installPath}`);
    await chmod(installPath, 0o755);
    return installDir;
  }

  core.info("installing aqua");
  const isWindows = os === "windows";
  const ext = isWindows ? "zip" : "tar.gz";
  const filename = `aqua_${os}_${architecture}.${ext}`;
  const url = `https://github.com/aquaproj/aqua/releases/download/${Version}/${filename}`;

  const expectedChecksum = CHECKSUMS.get(filename);
  if (!expectedChecksum) {
    throw new Error(`No checksum found for ${filename}`);
  }

  const tempDir = mkdtempSync(join(tmpdir(), "aqua-"));
  try {
    core.info(`Downloading ${url} ...`);
    const downloadPath = await tc.downloadTool(url);
    await verifyChecksum(downloadPath, expectedChecksum);

    const extractedPath = isWindows
      ? await tc.extractZip(downloadPath, tempDir)
      : await tc.extractTar(downloadPath, tempDir);

    const aquaBinaryPath = join(extractedPath, isWindows ? "aqua.exe" : "aqua");
    await chmod(aquaBinaryPath, 0o755);
    mkdirSync(installDir, { recursive: true });
    renameSync(aquaBinaryPath, installPath);
    return installDir;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};
