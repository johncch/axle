export function resolveFirstPartyModel(model: string, publishers: readonly string[]): string {
  const separator = model.indexOf("/");
  if (separator === -1) return model;

  const publisher = model.slice(0, separator).toLowerCase();
  const modelId = model.slice(separator + 1);
  if (!publishers.includes(publisher)) {
    throw new Error(`Model ${JSON.stringify(model)} is not available from ${publishers[0]}`);
  }
  if (!modelId) throw new Error(`Model ${JSON.stringify(model)} is missing a model ID`);
  return modelId;
}
