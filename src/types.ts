export type PlainObject = Record<string, unknown>;

export type ProgramOptions = {
  config?: string;
  job?: string;
  log?: boolean;
  debug?: boolean;
  interactive?: boolean;
  args?: string[];
  allowMissingVars?: boolean;
};

export interface Stats {
  in: number;
  out: number;
}
