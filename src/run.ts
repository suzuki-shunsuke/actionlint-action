import * as core from "@actions/core";
import type { ExecOutput } from "@actions/exec";
import type { ExecOptions } from "./aqua";

export type Executor = {
  exec: (
    command: string,
    args?: string[],
    options?: ExecOptions,
  ) => Promise<number>;
  getExecOutput: (
    command: string,
    args?: string[],
    options?: ExecOptions,
  ) => Promise<ExecOutput>;
};

export type Logger = {
  info: (message: string) => void;
  startGroup: (name: string) => void;
  endGroup: () => void;
  writeSummary: (content: string) => Promise<void>;
};

export type RunInput = {
  executor: Executor;
  githubToken: string;
  actionlintOptions: ActionlintOptions;
  eventName: string;
  /** true if the event is pull_request and the pull request is from a fork */
  isFork: boolean;
  /**
   * listChangedFiles returns files changed in the pull request.
   * It returns undefined if the event isn't associated with a pull request.
   */
  listChangedFiles: () => Promise<string[] | undefined>;
  logger?: Logger;
};

const workflowPattern = /^\.github\/workflows\/[^/]+\.ya?ml$/;

export const hasWorkflowChanges = (files: string[]): boolean =>
  files.some((file) => workflowPattern.test(file));

export type ActionlintOptions = {
  /** -config-file */
  configFile: string;
  /** -ignore. Each element is passed as a separate -ignore option */
  ignores: string[];
  /** -pyflakes. If empty, pyflakes integration is disabled */
  pyflakes: string;
  /** -shellcheck. If empty, shellcheck integration is disabled */
  shellcheck: string;
};

/** splitLines splits text by lines and removes empty lines */
export const splitLines = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

export const buildActionlintArgs = (options: ActionlintOptions): string[] => {
  const args: string[] = [];
  if (options.configFile) {
    args.push(`-config-file=${options.configFile}`);
  }
  for (const ignore of options.ignores) {
    args.push(`-ignore=${ignore}`);
  }
  args.push(
    `-pyflakes=${options.pyflakes}`,
    `-shellcheck=${options.shellcheck}`,
  );
  return args;
};

const defaultLogger: Logger = {
  info: core.info,
  startGroup: core.startGroup,
  endGroup: core.endGroup,
  writeSummary: async (content: string) => {
    core.summary.addRaw(content);
    await core.summary.write();
  },
};

export const run = async (input: RunInput): Promise<void> => {
  const logger = input.logger ?? defaultLogger;
  const executor = input.executor;

  const files = await input.listChangedFiles();
  if (files !== undefined && !hasWorkflowChanges(files)) {
    logger.info("No workflow file is changed, so actionlint is skipped");
    return;
  }

  const useReviewdog = !input.isFork;
  if (useReviewdog) {
    if (!input.githubToken) {
      throw new Error("github_token is required");
    }
    await executor.exec("reviewdog", ["-version"]);
  }
  await executor.exec("shellcheck", ["-V"]);
  await executor.exec("actionlint", ["-version"]);

  const actionlintArgs = buildActionlintArgs(input.actionlintOptions);

  if (!useReviewdog) {
    // reviewdog can't post reviews to pull requests from forks
    // because github.token doesn't have the write permission.
    const code = await executor.exec("actionlint", actionlintArgs, {
      group: "actionlint",
      ignoreReturnCode: true,
    });
    if (code !== 0) {
      throw new Error("actionlint failed");
    }
    return;
  }

  const out = await executor.getExecOutput("actionlint", actionlintArgs, {
    group: "actionlint",
    ignoreReturnCode: true,
  });

  const reporter =
    input.eventName === "pull_request" ? "github-pr-review" : "github-check";

  const reviewdogArgs = [
    "-efm",
    "%f:%l:%c: %m",
    "-name",
    "actionlint",
    "-filter-mode",
    "nofilter",
    "-reporter",
    reporter,
    "-level",
    "warning",
  ];
  const reviewdogHelp = await executor.getExecOutput("reviewdog", ["--help"], {
    silent: true,
    ignoreReturnCode: true,
  });
  if (
    reviewdogHelp.stdout.includes("-fail-level") ||
    reviewdogHelp.stderr.includes("-fail-level")
  ) {
    reviewdogArgs.push("-fail-level", "error");
  } else {
    reviewdogArgs.push("-fail-on-error", "1");
  }

  const reviewdogCode = await executor.exec("reviewdog", reviewdogArgs, {
    input: Buffer.from(out.stdout),
    group: "reviewdog",
    ignoreReturnCode: true,
    env: {
      REVIEWDOG_GITHUB_API_TOKEN: input.githubToken,
    },
  });

  if (out.exitCode === 0 && reviewdogCode === 0) {
    return;
  }

  const body = [out.stdout, out.stderr].join("\n").trim();
  if (body.length > 0) {
    await logger.writeSummary(`## actionlint\n\n\`\`\`\n${body}\n\`\`\`\n`);
  }
  throw new Error("actionlint failed");
};
