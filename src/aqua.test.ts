import { describe, it, expect } from "vitest";
import {
  buildAquaGlobalConfig,
  buildEnv,
  getArch,
  getInstallPath,
  getOS,
} from "./aqua";

describe("getOS", () => {
  it("converts platforms", () => {
    expect(getOS("darwin")).toBe("darwin");
    expect(getOS("linux")).toBe("linux");
    expect(getOS("win32")).toBe("windows");
    expect(() => getOS("aix")).toThrow("Unsupported OS: aix");
  });
});

describe("getArch", () => {
  it("converts architectures", () => {
    expect(getArch("x64")).toBe("amd64");
    expect(getArch("arm64")).toBe("arm64");
    expect(() => getArch("ia32")).toThrow("Unsupported architecture: ia32");
  });
});

describe("getInstallPath", () => {
  it("uses AQUA_ROOT_DIR", () => {
    expect(getInstallPath("linux", "/aqua", "", "/home/foo")).toBe(
      "/aqua/bin/aqua",
    );
  });
  it("uses XDG_DATA_HOME", () => {
    expect(getInstallPath("linux", "", "/data", "/home/foo")).toBe(
      "/data/aquaproj-aqua/bin/aqua",
    );
  });
  it("uses the home directory", () => {
    expect(getInstallPath("darwin", "", "", "/home/foo")).toBe(
      "/home/foo/.local/share/aquaproj-aqua/bin/aqua",
    );
  });
});

describe("buildAquaGlobalConfig", () => {
  it("appends the config", () => {
    expect(buildAquaGlobalConfig(undefined, "/a.yaml")).toBe("/a.yaml");
    expect(buildAquaGlobalConfig("/b.yaml", "/a.yaml")).toBe("/b.yaml:/a.yaml");
  });
});

describe("buildEnv", () => {
  it("merges environment variables", () => {
    expect(
      buildEnv(
        {
          processEnv: { FOO: "foo", UNDEF: undefined },
          path: "/usr/bin",
          aquaGlobalConfig: "/a.yaml",
        },
        "/aqua/bin",
        "token",
        { BAR: "bar" },
      ),
    ).toEqual({
      FOO: "foo",
      BAR: "bar",
      AQUA_GLOBAL_CONFIG: "/a.yaml",
      PATH: "/usr/bin:/aqua/bin",
      AQUA_GITHUB_TOKEN: "token",
    });
  });
  it("doesn't set PATH and AQUA_GITHUB_TOKEN if they are empty", () => {
    expect(
      buildEnv(
        { processEnv: {}, path: "/usr/bin", aquaGlobalConfig: "/a.yaml" },
        "",
      ),
    ).toEqual({ AQUA_GLOBAL_CONFIG: "/a.yaml" });
  });
});
