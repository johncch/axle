import z from "zod";

export enum ResultType {
  String = "string",
  List = "string[]",
  Number = "number",
  Boolean = "boolean",
}

export type ResultTypeUnion = `${ResultType}`;

export type DeclarativeSchema = {
  [key: string]: ResultTypeUnion | DeclarativeSchema | DeclarativeSchema[];
};

export type DeclarativeToTS<T extends DeclarativeSchema> = {
  [K in keyof T]: T[K] extends "string"
    ? string
    : T[K] extends "number"
      ? number
      : T[K] extends "boolean"
        ? boolean
        : T[K] extends "string[]"
          ? string[]
          : T[K] extends [infer U extends DeclarativeSchema]
            ? DeclarativeToTS<U>[]
            : T[K] extends DeclarativeSchema
              ? DeclarativeToTS<T[K]>
              : never;
};

export type OutputSchema = Record<string, z.ZodTypeAny>;

export type InferedOutputSchema<T extends OutputSchema> = {
  [K in keyof T]: z.output<T[K]>;
};
