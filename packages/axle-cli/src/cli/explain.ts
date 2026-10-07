import { styleText } from "node:util";
import { z } from "zod";
import { CliConfigSchema, JobConfigSchema } from "./configs/schemas.js";

type Schema = z.core.JSONSchema.JSONSchema;

interface Field {
  key: string;
  schemas: Schema[];
  required: boolean;
  condition?: string;
}

const KEY_STYLE = ["bold", "cyan"] as const;

const ROOTS = [
  { key: "recipe", title: "a recipe file, run with axle -j", schema: JobConfigSchema },
  {
    key: "config",
    title: "cli.yaml in ~/.axle is read first, ./.axle overrides",
    schema: CliConfigSchema,
  },
];

/**
 * `axle explain [path]`: the configuration reference, read from the schemas
 * that validate a recipe and `cli.yaml`. No path lists both files' top-level
 * keys; a dotted path such as `recipe.request.reasoning` describes one key
 * and the keys beneath it. Lists and maps are transparent in a path:
 * `recipe.mcps.command`, `config.providers.baseUrl`. Text wraps at `width`.
 */
export function formatExplain(path: string | undefined, width: number): string[] {
  const roots = rootFields();

  if (path === undefined) {
    return [
      ...wrap("Run axle explain <path> for one key, e.g. axle explain recipe.batch", "", width),
      ...ROOTS.flatMap((root, index) => [
        "",
        `${paintKey(root.key)}  ${root.title}`,
        ...formatFields(childrenOf(roots[index]), width),
      ]),
    ];
  }

  const [rootKey, ...segments] = path.split(".");
  let field = roots.find((root) => root.key === rootKey);
  if (field === undefined) {
    throw new Error(
      `Unknown config "${rootKey}". Expected ${ROOTS.map((root) => root.key).join(" or ")}.`,
    );
  }

  const walked = [rootKey];
  for (const segment of segments) {
    const children = childrenOf(field);
    const child = children.find((candidate) => candidate.key === segment);
    if (child === undefined) {
      const location = walked.join(".");
      throw new Error(
        children.length === 0
          ? `${location} has no keys beneath it.`
          : `Unknown key "${segment}" in ${location}. Keys: ${children.map((candidate) => candidate.key).join(", ")}.`,
      );
    }
    field = child;
    walked.push(segment);
  }

  const root = ROOTS.find((candidate) => candidate.key === path);
  return [
    root ? `${paintKey(path)}  ${root.title}` : headingOf(paintKey(path), field),
    ...wrap(descriptionOf(field), "  ", width),
    ...formatFields(childrenOf(field), width),
  ];
}

/**
 * Every key of one file at every depth, as unstyled, unwrapped text: the
 * same reference `axle explain` prints, in a form to hand to a model.
 */
export function formatReference(rootKey: "recipe" | "config"): string[] {
  const visit = (path: string, field: Field): string[] =>
    childrenOf(field).flatMap((child) => {
      const childPath = `${path}.${child.key}`;
      return [
        "",
        headingOf(childPath, child),
        `  ${descriptionOf(child)}`,
        ...visit(childPath, child),
      ];
    });

  return rootFields()
    .filter((root) => root.key === rootKey)
    .flatMap((root) => visit(root.key, root));
}

function rootFields(): Field[] {
  return ROOTS.map((root) => ({
    key: root.key,
    schemas: [z.toJSONSchema(root.schema, { io: "input" })],
    required: true,
  }));
}

function paintKey(key: string): string {
  return styleText(KEY_STYLE, key);
}

function formatFields(fields: Field[], width: number): string[] {
  return fields.flatMap((field) => {
    const keys = childrenOf(field).map((child) => child.key);
    return [
      "",
      `  ${headingOf(paintKey(field.key), field)}`,
      ...wrap(descriptionOf(field), "    ", width),
      ...wrap(keys.length > 0 ? `keys: ${keys.join(", ")}` : "", "    ", width),
    ];
  });
}

function headingOf(label: string, field: Field): string {
  const defaultValue = field.schemas.find((schema) => schema.default !== undefined)?.default;
  const notes = [
    ...(field.required ? ["required"] : []),
    ...(defaultValue === undefined ? [] : [`default ${JSON.stringify(defaultValue)}`]),
    ...(field.condition === undefined ? [] : [field.condition]),
  ];
  const heading = `${label}  ${typeOf(field.schemas)}`;
  return notes.length > 0 ? `${heading}  (${notes.join("; ")})` : heading;
}

function descriptionOf(field: Field): string {
  const described = field.schemas.filter((schema) => schema.description !== undefined);
  const distinct = new Set(described.map((schema) => schema.description));
  const descriptions =
    distinct.size > 1
      ? described.map((schema) =>
          schema.const === undefined
            ? schema.description
            : `${schema.const}: ${schema.description}`,
        )
      : [...distinct];
  return descriptions.join(" ");
}

function wrap(text: string, indent: string, width: number): string[] {
  if (text === "") return [];
  const lines: string[] = [];
  let line = indent;
  for (const word of text.split(" ")) {
    if (line !== indent && line.length + 1 + word.length > width) {
      lines.push(line);
      line = indent;
    }
    line += line === indent ? word : ` ${word}`;
  }
  return [...lines, line];
}

function alternativesOf(schema: Schema): Schema[] {
  const branches = schema.anyOf ?? schema.oneOf;
  return branches === undefined ? [schema] : branches.flatMap(alternativesOf);
}

function objectsWithin(schema: Schema): Schema[] {
  return alternativesOf(schema).flatMap((alternative) => {
    if (alternative.properties !== undefined) return [alternative];
    const inner = alternative.items ?? alternative.additionalProperties;
    return typeof inner === "object" && !Array.isArray(inner) ? objectsWithin(inner) : [];
  });
}

function childrenOf(field: Field): Field[] {
  const objects = field.schemas.flatMap(objectsWithin);
  const keys = [...new Set(objects.flatMap((object) => Object.keys(object.properties ?? {})))];

  const discriminator =
    objects.length > 1
      ? keys.find((key) => objects.every((object) => propertyOf(object, key)?.const !== undefined))
      : undefined;

  return keys.map((key) => {
    const holders = objects.filter((object) => propertyOf(object, key) !== undefined);
    const condition =
      discriminator !== undefined && holders.length < objects.length
        ? `only with ${discriminator}: ${holders.map((holder) => propertyOf(holder, discriminator)?.const).join(" | ")}`
        : undefined;
    return {
      key,
      schemas: holders
        .map((holder) => propertyOf(holder, key))
        .filter((property) => property !== undefined),
      required:
        (holders.length === objects.length || discriminator !== undefined) &&
        holders.every((holder) => holder.required?.includes(key)),
      condition,
    };
  });
}

function propertyOf(object: Schema, key: string): Schema | undefined {
  const property = object.properties?.[key];
  return typeof property === "object" ? property : undefined;
}

function typeOf(schemas: Schema[]): string {
  return [...new Set(schemas.flatMap(alternativesOf).map(typeOfOne))].join(" | ");
}

function typeOfOne(schema: Schema): string {
  if (schema.const !== undefined) return String(schema.const);
  if (schema.enum !== undefined) return schema.enum.join(" | ");
  if (schema.properties !== undefined) return "object";
  if (typeof schema.items === "object" && !Array.isArray(schema.items)) {
    return `list of ${typeOf([schema.items])}`;
  }
  if (typeof schema.additionalProperties === "object") {
    return `map of name to ${typeOf([schema.additionalProperties])}`;
  }
  return typeof schema.type === "string" ? schema.type : "any";
}
