import { describe, expect, it } from "vitest";
import * as z from "zod";
import { zodToExample } from "../../src/core/parse.js";

describe("zodToExample", () => {
  describe("primitive types", () => {
    it("should handle ZodString", () => {
      const schema = z.string();
      const result = zodToExample(schema);

      expect(result).toEqual(["string", "Your answer"]);
    });

    it("should handle ZodNumber", () => {
      const schema = z.number();
      const result = zodToExample(schema);

      expect(result).toEqual(["number", 42]);
    });

    it("should handle ZodBoolean", () => {
      const schema = z.boolean();
      const result = zodToExample(schema);

      expect(result).toEqual(["boolean", true]);
    });
  });

  describe("array types", () => {
    it("should handle ZodArray of strings", () => {
      const schema = z.array(z.string());
      const result = zodToExample(schema);

      expect(result).toEqual(["string array", ["answer 1", "answer 2", "third answer"]]);
    });

    it("should handle ZodArray of numbers", () => {
      const schema = z.array(z.number());
      const result = zodToExample(schema);

      expect(result).toEqual(["number array", [42, 59, 3.14]]);
    });

    it("should handle ZodArray of booleans", () => {
      const schema = z.array(z.boolean());
      const result = zodToExample(schema);

      expect(result).toEqual(["boolean array", [true, false, false]]);
    });

    it("should handle nested arrays", () => {
      const schema = z.array(z.array(z.string()));
      const result = zodToExample(schema);

      expect(result).toEqual(["array", []]);
    });
  });

  describe("object types", () => {
    it("should handle simple ZodObject", () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
        active: z.boolean(),
      });
      const result = zodToExample(schema);

      expect(result[0]).toBe("JSON object");

      const example = result[1];
      expect(example).toEqual({
        name: "Your answer",
        age: 42,
        active: true,
      });
    });

    it("should handle ZodObject with array properties", () => {
      const schema = z.object({
        tags: z.array(z.string()),
        scores: z.array(z.number()),
      });
      const result = zodToExample(schema);

      expect(result[0]).toBe("JSON object");

      const example = result[1];
      expect(example).toEqual({
        tags: ["answer 1", "answer 2", "third answer"],
        scores: [42, 59, 3.14],
      });
    });

    it("should handle nested ZodObject", () => {
      const schema = z.object({
        user: z.object({
          name: z.string(),
          email: z.string(),
        }),
        settings: z.object({
          theme: z.string(),
          notifications: z.boolean(),
        }),
      });
      const result = zodToExample(schema);

      expect(result[0]).toBe("JSON object");

      const example = result[1] as any;
      expect(example.user).toEqual({
        name: "Your answer",
        email: "Your answer",
      });
      expect(example.settings).toEqual({
        theme: "Your answer",
        notifications: true,
      });
    });

    it("should handle ZodObject with mixed types", () => {
      const schema = z.object({
        id: z.number(),
        title: z.string(),
        published: z.boolean(),
        tags: z.array(z.string()),
        metadata: z.object({
          views: z.number(),
          likes: z.array(z.number()),
        }),
      });
      const result = zodToExample(schema);

      expect(result[0]).toBe("JSON object");

      const example = result[1] as any;
      expect(example.id).toBe(42);
      expect(example.title).toBe("Your answer");
      expect(example.published).toBe(true);
      expect(example.tags).toEqual(["answer 1", "answer 2", "third answer"]);
      expect(example.metadata).toEqual({
        views: 42,
        likes: [42, 59, 3.14],
      });
    });
  });

  describe("optional types", () => {
    it("should handle ZodOptional with string", () => {
      const schema = z.string().optional();
      const result = zodToExample(schema);

      expect(result).toEqual(["string | undefined", "Your answer"]);
    });

    it("should handle ZodOptional with number", () => {
      const schema = z.number().optional();
      const result = zodToExample(schema);

      expect(result).toEqual(["number | undefined", 42]);
    });

    it("should handle ZodOptional with boolean", () => {
      const schema = z.boolean().optional();
      const result = zodToExample(schema);

      expect(result).toEqual(["boolean | undefined", true]);
    });

    it("should handle ZodOptional with array", () => {
      const schema = z.array(z.string()).optional();
      const result = zodToExample(schema);

      expect(result).toEqual([
        "string array | undefined",
        ["answer 1", "answer 2", "third answer"],
      ]);
    });

    it("should handle ZodOptional with object", () => {
      const schema = z
        .object({
          name: z.string(),
          age: z.number(),
        })
        .optional();
      const result = zodToExample(schema);

      expect(result[0]).toBe("JSON object | undefined");

      const example = result[1];
      expect(example).toEqual({
        name: "Your answer",
        age: 42,
      });
    });
  });

  describe("complex nested structures", () => {
    it("should handle arrays of objects", () => {
      const schema = z.array(
        z.object({
          id: z.number(),
          name: z.string(),
        }),
      );
      const result = zodToExample(schema);

      expect(result[0]).toBe("object array");
      expect(result[1]).toEqual([
        { id: 42, name: "Your answer" },
        { id: 42, name: "Your answer" },
      ]);
    });

    it("should handle objects with optional properties", () => {
      const schema = z.object({
        required: z.string(),
        optional: z.number().optional(),
        nested: z.object({
          value: z.string(),
          optionalValue: z.boolean().optional(),
        }),
      });
      const result = zodToExample(schema);

      expect(result[0]).toBe("JSON object");

      const example = result[1] as any;
      expect(example.required).toBe("Your answer");
      expect(example.optional).toBe(42);
      expect(example.nested).toEqual({
        value: "Your answer",
        optionalValue: true,
      });
    });

    it("should handle deeply nested structures", () => {
      const schema = z.object({
        level1: z.object({
          level2: z.object({
            level3: z.array(
              z.object({
                deepValue: z.string(),
                deepNumber: z.number().optional(),
              }),
            ),
          }),
        }),
      });
      const result = zodToExample(schema);

      expect(result[0]).toBe("JSON object");

      // Just verify the structure exists and contains expected keys
      const example = result[1] as any;
      expect(example.level1).toBeTruthy();
      expect(typeof example.level1).toBe("object");

      // Verify we can access the nested structure
      const level1 = example.level1;
      expect(level1.level2).toBeTruthy();
      expect(typeof level1.level2).toBe("object");
    });
  });

  describe("edge cases", () => {
    it("should handle empty object", () => {
      const schema = z.object({});
      const result = zodToExample(schema);

      expect(result).toEqual(["JSON object", {}]);
    });

    it("should handle optional nested in optional", () => {
      const schema = z.string().optional().optional();
      const result = zodToExample(schema);

      expect(result).toEqual(["string | undefined | undefined", "Your answer"]);
    });
  });

  describe("unsupported schema types", () => {
    it("should return undefined for ZodDate", () => {
      const schema = z.date();
      const result = zodToExample(schema);

      expect(result).toBeUndefined();
    });

    it("should return undefined for ZodEnum", () => {
      const schema = z.enum(["red", "green", "blue"]);
      const result = zodToExample(schema);

      expect(result).toBeUndefined();
    });

    it("should return undefined for ZodLiteral", () => {
      const schema = z.literal("specific-value");
      const result = zodToExample(schema);

      expect(result).toBeUndefined();
    });

    it("should return undefined for ZodUnion", () => {
      const schema = z.union([z.string(), z.number()]);
      const result = zodToExample(schema);

      expect(result).toBeUndefined();
    });

    it("should return undefined for ZodRecord", () => {
      const schema = z.record(z.string(), z.string());
      const result = zodToExample(schema);

      expect(result).toBeUndefined();
    });

    it("should return undefined for ZodTuple", () => {
      const schema = z.tuple([z.string(), z.number()]);
      const result = zodToExample(schema);

      expect(result).toBeUndefined();
    });

    it("should return undefined for ZodNull", () => {
      const schema = z.null();
      const result = zodToExample(schema);

      expect(result).toBeUndefined();
    });

    it("should return undefined for ZodUndefined", () => {
      const schema = z.undefined();
      const result = zodToExample(schema);

      expect(result).toBeUndefined();
    });

    it("should return undefined for ZodAny", () => {
      const schema = z.any();
      const result = zodToExample(schema);

      expect(result).toBeUndefined();
    });

    it("should return undefined for ZodUnknown", () => {
      const schema = z.unknown();
      const result = zodToExample(schema);

      expect(result).toBeUndefined();
    });
  });

  describe("real-world scenarios", () => {
    it("should handle API response schema", () => {
      const schema = z.object({
        success: z.boolean(),
        data: z.object({
          id: z.number(),
          name: z.string(),
          email: z.string(),
          tags: z.array(z.string()),
          profile: z.object({
            bio: z.string().optional(),
            age: z.number().optional(),
            active: z.boolean(),
          }),
        }),
        meta: z.object({
          page: z.number(),
          total: z.number(),
          hasMore: z.boolean(),
        }),
      });
      const result = zodToExample(schema);

      expect(result[0]).toBe("JSON object");

      const example = result[1] as any;
      expect(example.success).toBe(true);
      expect(example.data).toBeTruthy();
      expect(example.meta).toBeTruthy();

      const dataExample = example.data;
      expect(dataExample.id).toBe(42);
      expect(dataExample.name).toBe("Your answer");
      expect(dataExample.email).toBe("Your answer");

      const metaExample = example.meta;
      expect(metaExample.page).toBe(42);
      expect(metaExample.total).toBe(42);
      expect(metaExample.hasMore).toBe(true);
    });

    it("should handle form validation schema", () => {
      const schema = z.object({
        username: z.string(),
        password: z.string(),
        confirmPassword: z.string(),
        email: z.string(),
        age: z.number().optional(),
        terms: z.boolean(),
        preferences: z
          .object({
            newsletter: z.boolean().optional(),
            notifications: z.array(z.string()).optional(),
          })
          .optional(),
      });
      const result = zodToExample(schema);

      expect(result[0]).toBe("JSON object");

      const example = result[1] as any;
      expect(example.username).toBe("Your answer");
      expect(example.password).toBe("Your answer");
      expect(example.confirmPassword).toBe("Your answer");
      expect(example.email).toBe("Your answer");
      expect(example.age).toBe(42);
      expect(example.terms).toBe(true);
      expect(example.preferences).toBeTruthy();
    });

    it("should handle configuration schema", () => {
      const schema = z.object({
        database: z.object({
          host: z.string(),
          port: z.number(),
          ssl: z.boolean(),
          credentials: z.object({
            username: z.string(),
            password: z.string(),
          }),
        }),
        cache: z
          .object({
            enabled: z.boolean(),
            ttl: z.number().optional(),
            providers: z.array(z.string()),
          })
          .optional(),
        logging: z.object({
          level: z.string(),
          outputs: z.array(z.string()),
          structured: z.boolean().optional(),
        }),
      });
      const result = zodToExample(schema);

      expect(result[0]).toBe("JSON object");

      const example = result[1] as any;
      expect(example.database).toBeTruthy();
      expect(example.cache).toBeTruthy();
      expect(example.logging).toBeTruthy();

      const dbExample = example.database;
      expect(dbExample.host).toBe("Your answer");
      expect(dbExample.port).toBe(42);
      expect(dbExample.ssl).toBe(true);
      expect(dbExample.credentials).toBeTruthy();

      const loggingExample = example.logging;
      expect(loggingExample.level).toBe("Your answer");
      expect(loggingExample.outputs).toEqual(["answer 1", "answer 2", "third answer"]);
      expect(loggingExample.structured).toBe(true);
    });

    it("should handle declarative type conversion result", () => {
      // This simulates a typical OutputSchema used with Instruct
      const declarativeType = {
        title: "string",
        count: "number",
        active: "boolean",
        tags: "string[]",
        metadata: {
          created: "string",
          updated: "string",
          version: "number",
        },
      };

      // Manually create the equivalent Zod schema
      const schema = z.object({
        title: z.string(),
        count: z.number(),
        active: z.boolean(),
        tags: z.array(z.string()),
        metadata: z.object({
          created: z.string(),
          updated: z.string(),
          version: z.number(),
        }),
      });

      const result = zodToExample(schema);

      expect(result[0]).toBe("JSON object");

      const example = result[1] as any;
      expect(example.title).toBe("Your answer");
      expect(example.count).toBe(42);
      expect(example.active).toBe(true);
      expect(example.tags).toEqual(["answer 1", "answer 2", "third answer"]);
      expect(example.metadata).toBeTruthy();

      const metadataExample = example.metadata;
      expect(metadataExample.created).toBe("Your answer");
      expect(metadataExample.updated).toBe("Your answer");
      expect(metadataExample.version).toBe(42);
    });

    it("should handle arrays of complex objects", () => {
      const schema = z.array(
        z.object({
          user: z.object({
            id: z.number(),
            name: z.string(),
            roles: z.array(z.string()),
          }),
          permissions: z.array(
            z.object({
              resource: z.string(),
              actions: z.array(z.string()),
              granted: z.boolean(),
            }),
          ),
          lastLogin: z.string().optional(),
        }),
      );

      const result = zodToExample(schema);

      expect(result[0]).toBe("object array");
      expect(result[1]).toEqual([
        {
          user: {
            id: 42,
            name: "Your answer",
            roles: ["answer 1", "answer 2", "third answer"],
          },
          permissions: [
            {
              resource: "Your answer",
              actions: ["answer 1", "answer 2", "third answer"],
              granted: true,
            },
            {
              resource: "Your answer",
              actions: ["answer 1", "answer 2", "third answer"],
              granted: true,
            },
          ],
          lastLogin: "Your answer",
        },
        {
          user: {
            id: 42,
            name: "Your answer",
            roles: ["answer 1", "answer 2", "third answer"],
          },
          permissions: [
            {
              resource: "Your answer",
              actions: ["answer 1", "answer 2", "third answer"],
              granted: true,
            },
            {
              resource: "Your answer",
              actions: ["answer 1", "answer 2", "third answer"],
              granted: true,
            },
          ],
          lastLogin: "Your answer",
        },
      ]);
    });
  });
});
