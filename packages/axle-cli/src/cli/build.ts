import pkg from "../../package.json";

declare const AXLE_BUILD_STAMP: string | undefined;

export interface BuildInfo {
  /** The package version, with `-dev` appended when the binary was packaged off a release tag. */
  version: string;
  /** Where the build came from, shown by `axle info`; absent for a release. */
  detail?: string;
}

export function resolveBuildInfo(entryUrl: string = import.meta.url): BuildInfo {
  const stamp = typeof AXLE_BUILD_STAMP === "string" ? AXLE_BUILD_STAMP : undefined;
  if (stamp !== undefined) return { version: `${pkg.version}-dev`, detail: `built ${stamp}` };
  if (entryUrl.endsWith(".ts")) return { version: pkg.version, detail: "source" };
  return { version: pkg.version };
}
