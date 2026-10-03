import * as core from "@actions/core";
import * as github from "@actions/github";
import { NewExecutor } from "./aqua";
import { run, splitLines } from "./run";

const main = async (): Promise<void> => {
  const githubToken = core.getInput("github_token");
  const { context } = github;
  const pr = context.payload.pull_request;
  const executor = await NewExecutor(githubToken);
  await run({
    executor,
    githubToken,
    actionlintOptions: {
      configFile: core.getInput("config_file"),
      ignores: splitLines(core.getInput("ignores")),
      pyflakes: core.getInput("pyflakes"),
      shellcheck: core.getInput("shellcheck"),
    },
    eventName: context.eventName,
    isFork:
      context.eventName === "pull_request" && pr?.head?.repo?.fork === true,
    listChangedFiles: async () => {
      if (!pr) {
        return undefined;
      }
      const octokit = github.getOctokit(githubToken);
      const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: pr.number,
        per_page: 100,
      });
      return files.map((file) => file.filename);
    },
  });
};

main().catch((error: unknown) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
