export interface ModelId {
  /** Lowercased; absent for a bare id. */
  publisher?: string;
  name: string;
}

/** Splits `publisher/name`; the name is kept as written, a bare id is all name. */
export function splitModelId(model: string): ModelId {
  const separator = model.indexOf("/");
  if (separator === -1) return { name: model };
  return { publisher: model.slice(0, separator).toLowerCase(), name: model.slice(separator + 1) };
}

export function resolveFirstPartyModel(model: string, publishers: readonly string[]): string {
  const { publisher, name } = splitModelId(model);
  if (publisher === undefined) return model;

  if (!publishers.includes(publisher)) {
    throw new Error(`Model ${JSON.stringify(model)} is not available from ${publishers[0]}`);
  }
  if (!name) throw new Error(`Model ${JSON.stringify(model)} is missing a model ID`);
  return name;
}
