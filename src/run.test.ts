import { describe, it, expect, vi } from "vitest";
import {
  run,
  hasWorkflowChanges,
  splitLines,
  buildActionlintArgs,
  type RunInput,
} from "./run";
import type { ExecOptions } from "./aqua";

const newLogger = () => ({
  info: vi.fn(),
  startGroup: vi.fn(),
  endGroup: vi.fn(),
  writeSummary: vi.fn().mockResolvedValue(undefined),
});

type Outputs = {
  actionlint?: { exitCode: number; stdout: string; stderr: string };
  reviewdogHelp?: string;
  reviewdogCode?: number;
  actionlintCode?: number;
};

const newExecutor = (outputs: Outputs = {}) => ({
  exec: vi.fn((command: string, args?: string[], _options?: ExecOptions) => {
    if (command === "reviewdog" && args?.[0] !== "-version") {
      return Promise.resolve(outputs.reviewdogCode ?? 0);
    }
    if (command === "actionlint" && args?.[0] !== "-version") {
      return Promise.resolve(outputs.actionlintCode ?? 0);
    }
    return Promise.resolve(0);
  }),
  getExecOutput: vi.fn(
    (command: string, _args?: string[], _options?: ExecOptions) => {
      if (command === "reviewdog") {
        return Promise.resolve({
          exitCode: 0,
          stdout: outputs.reviewdogHelp ?? "",
          stderr: "",
        });
      }
      return Promise.resolve(
        outputs.actionlint ?? { exitCode: 0, stdout: "", stderr: "" },
      );
    },
  ),
});

const newInput = (
  executor: ReturnType<typeof newExecutor>,
  override: Partial<RunInput> = {},
): RunInput => ({
  executor,
  githubToken: "token",
  actionlintOptions: {
    configFile: "",
    ignores: [],
    pyflakes: "pyflakes",
    shellcheck: "shellcheck",
  },
  eventName: "pull_request",
  isFork: false,
  listChangedFiles: () => Promise.resolve([".github/workflows/test.yaml"]),
  logger: newLogger(),
  ...override,
});

const findReviewdogCall = (executor: ReturnType<typeof newExecutor>) =>
  executor.exec.mock.calls.find(
    (call) => call[0] === "reviewdog" && call[1]?.[0] !== "-version",
  );

describe("hasWorkflowChanges", () => {
  it("returns true for workflow files", () => {
    expect(hasWorkflowChanges([".github/workflows/test.yaml"])).toBe(true);
    expect(hasWorkflowChanges(["README.md", ".github/workflows/a.yml"])).toBe(
      true,
    );
  });
  it("returns false for other files", () => {
    expect(hasWorkflowChanges([])).toBe(false);
    expect(hasWorkflowChanges(["README.md", "action.yaml"])).toBe(false);
    expect(hasWorkflowChanges([".github/workflows/foo/a.yaml"])).toBe(false);
    expect(hasWorkflowChanges([".github/workflows/a.json"])).toBe(false);
  });
});

describe("splitLines", () => {
  it("splits by lines and removes empty lines", () => {
    expect(splitLines("")).toEqual([]);
    expect(splitLines("  foo bar \n\n baz\n")).toEqual(["foo bar", "baz"]);
  });
});

describe("buildActionlintArgs", () => {
  it("passes default pyflakes and shellcheck", () => {
    expect(
      buildActionlintArgs({
        configFile: "",
        ignores: [],
        pyflakes: "pyflakes",
        shellcheck: "shellcheck",
      }),
    ).toEqual(["-pyflakes=pyflakes", "-shellcheck=shellcheck"]);
  });
  it("disables pyflakes and shellcheck if they are empty", () => {
    expect(
      buildActionlintArgs({
        configFile: "",
        ignores: [],
        pyflakes: "",
        shellcheck: "",
      }),
    ).toEqual(["-pyflakes=", "-shellcheck="]);
  });
  it("builds options", () => {
    expect(
      buildActionlintArgs({
        configFile: "actionlint.yaml",
        ignores: ['file "dist/index.js" does not exist', "SC2086"],
        pyflakes: "python3 -m pyflakes",
        shellcheck: "shellcheck -e SC2086",
      }),
    ).toEqual([
      "-config-file=actionlint.yaml",
      '-ignore=file "dist/index.js" does not exist',
      "-ignore=SC2086",
      "-pyflakes=python3 -m pyflakes",
      "-shellcheck=shellcheck -e SC2086",
    ]);
  });
});

describe("run", () => {
  it("skips if no workflow file is changed", async () => {
    const executor = newExecutor();
    await run(
      newInput(executor, {
        listChangedFiles: () => Promise.resolve(["README.md"]),
      }),
    );
    expect(executor.exec).not.toHaveBeenCalled();
    expect(executor.getExecOutput).not.toHaveBeenCalled();
  });

  it("runs if the event isn't associated with a pull request", async () => {
    const executor = newExecutor();
    await run(
      newInput(executor, {
        eventName: "push",
        listChangedFiles: () => Promise.resolve(undefined),
      }),
    );
    expect(executor.getExecOutput).toHaveBeenCalledWith(
      "actionlint",
      ["-pyflakes=pyflakes", "-shellcheck=shellcheck"],
      expect.anything(),
    );
    expect(findReviewdogCall(executor)?.[1]).toContain("github-check");
  });

  it("passes actionlint output to reviewdog", async () => {
    const executor = newExecutor({
      actionlint: {
        exitCode: 0,
        stdout: "",
        stderr: "",
      },
      reviewdogHelp: "  -fail-level string",
    });
    await run(
      newInput(executor, {
        actionlintOptions: {
          configFile: "",
          ignores: ["foo"],
          pyflakes: "pyflakes",
          shellcheck: "shellcheck",
        },
      }),
    );
    expect(executor.getExecOutput).toHaveBeenCalledWith(
      "actionlint",
      ["-ignore=foo", "-pyflakes=pyflakes", "-shellcheck=shellcheck"],
      expect.objectContaining({ ignoreReturnCode: true }),
    );
    const call = findReviewdogCall(executor);
    expect(call?.[1]).toEqual([
      "-efm",
      "%f:%l:%c: %m",
      "-name",
      "actionlint",
      "-filter-mode",
      "nofilter",
      "-reporter",
      "github-pr-review",
      "-level",
      "warning",
      "-fail-level",
      "error",
    ]);
    expect(call?.[2]?.env).toEqual({ REVIEWDOG_GITHUB_API_TOKEN: "token" });
  });

  it("uses -fail-on-error if reviewdog doesn't support -fail-level", async () => {
    const executor = newExecutor();
    await run(newInput(executor));
    const args = findReviewdogCall(executor)?.[1];
    expect(args?.slice(-2)).toEqual(["-fail-on-error", "1"]);
  });

  it("fails and writes the summary if actionlint fails", async () => {
    const out = ".github/workflows/test.yaml:1:2: error [syntax-check]";
    const executor = newExecutor({
      actionlint: { exitCode: 1, stdout: out, stderr: "" },
      reviewdogCode: 1,
    });
    const logger = newLogger();
    await expect(run(newInput(executor, { logger }))).rejects.toThrow(
      "actionlint failed",
    );
    expect(findReviewdogCall(executor)?.[2]?.input).toEqual(Buffer.from(out));
    expect(logger.writeSummary).toHaveBeenCalledWith(
      `## actionlint\n\n\`\`\`\n${out}\n\`\`\`\n`,
    );
  });

  it("fails if actionlint fails even though reviewdog succeeds", async () => {
    const executor = newExecutor({
      actionlint: { exitCode: 2, stdout: "", stderr: "fatal error" },
    });
    await expect(run(newInput(executor))).rejects.toThrow("actionlint failed");
  });

  it("runs actionlint without reviewdog for pull requests from forks", async () => {
    const executor = newExecutor();
    await run(newInput(executor, { isFork: true, githubToken: "" }));
    expect(executor.exec).toHaveBeenCalledWith(
      "actionlint",
      ["-pyflakes=pyflakes", "-shellcheck=shellcheck"],
      expect.objectContaining({ ignoreReturnCode: true }),
    );
    expect(
      executor.exec.mock.calls.some((call) => call[0] === "reviewdog"),
    ).toBe(false);
  });

  it("fails if actionlint fails for pull requests from forks", async () => {
    const executor = newExecutor({ actionlintCode: 1 });
    await expect(run(newInput(executor, { isFork: true }))).rejects.toThrow(
      "actionlint failed",
    );
  });

  it("requires github_token", async () => {
    const executor = newExecutor();
    await expect(run(newInput(executor, { githubToken: "" }))).rejects.toThrow(
      "github_token is required",
    );
  });
});
