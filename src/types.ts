export type PlainObject = Record<string, unknown>;

export type ProgramOptions = {
  dryRun?: boolean;
  config?: string;
  warnUnused?: boolean;
  job?: string;
  log?: boolean;
  debug?: boolean;
  interactive?: boolean;
  args?: string[];
};

export interface Stats {
  in: number;
  out: number;
}
