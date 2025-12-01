import { describe, expect, it } from "vitest";
import * as z from "zod";
import { declarativeToOutputSchema, zodToExample } from "../../src/core/typecheck.js";
import { DeclarativeSchema, ResultType } from "../../src/core/types.js";

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
      // This simulates a schema created from declarativeToSchemaRecord
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

describe("declarativeToSchemaRecord", () => {
  describe("primitive types", () => {
    it("should convert string type", () => {
      const declarativeType = { name: ResultType.String };
      const result = declarativeToOutputSchema(declarativeType);

      expect(result.name).toBeInstanceOf(z.ZodString);
    });

    it("should convert number type", () => {
      const declarativeType = { age: "number" } as const;
      const result = declarativeToOutputSchema(declarativeType);

      expect(result.age).toBeInstanceOf(z.ZodNumber);
    });

    it("should convert boolean type", () => {
      const declarativeType = { active: "boolean" } as const;
      const result = declarativeToOutputSchema(declarativeType);

      expect(result.active).toBeInstanceOf(z.ZodBoolean);
    });

    it("should convert string array type", () => {
      const declarativeType = { tags: "string[]" } as const;
      const result = declarativeToOutputSchema(declarativeType);

      expect(result.tags).toBeInstanceOf(z.ZodArray);
      expect((result.tags as z.ZodArray<any>).element).toBeInstanceOf(z.ZodString);
    });
  });

  describe("complex types", () => {
    it("should convert mixed primitive types", () => {
      const declarativeType = {
        title: "string",
        count: "number",
        active: "boolean",
        tags: "string[]",
      } as const;
      const result = declarativeToOutputSchema(declarativeType);

      expect(result.title).toBeInstanceOf(z.ZodString);
      expect(result.count).toBeInstanceOf(z.ZodNumber);
      expect(result.active).toBeInstanceOf(z.ZodBoolean);
      expect(result.tags).toBeInstanceOf(z.ZodArray);
    });

    it("should convert nested object types", () => {
      const declarativeType = {
        user: {
          name: "string",
          email: "string",
        },
        settings: {
          theme: "string",
          notifications: "boolean",
        },
      } as const;
      const result = declarativeToOutputSchema(declarativeType);

      expect(result.user).toBeInstanceOf(z.ZodObject);
      expect(result.settings).toBeInstanceOf(z.ZodObject);

      const userShape = (result.user as z.ZodObject<any>).shape;
      expect(userShape.name).toBeInstanceOf(z.ZodOptional);
      expect(userShape.email).toBeInstanceOf(z.ZodOptional);

      const settingsShape = (result.settings as z.ZodObject<any>).shape;
      expect(settingsShape.theme).toBeInstanceOf(z.ZodOptional);
      expect(settingsShape.notifications).toBeInstanceOf(z.ZodOptional);
    });

    it("should convert deeply nested structures", () => {
      const declarativeType = {
        metadata: {
          author: {
            name: "string",
            contact: {
              email: "string",
              phone: "string",
            },
          },
          tags: "string[]",
        },
      } as const;
      const result = declarativeToOutputSchema(declarativeType);

      expect(result.metadata).toBeInstanceOf(z.ZodObject);

      const metadataShape = (result.metadata as z.ZodObject<any>).shape;
      expect(metadataShape.author).toBeInstanceOf(z.ZodObject);
      expect(metadataShape.tags).toBeInstanceOf(z.ZodArray);

      const authorShape = (metadataShape.author as z.ZodObject<any>).shape;
      expect(authorShape.name).toBeInstanceOf(z.ZodOptional);
      expect(authorShape.contact).toBeInstanceOf(z.ZodObject);

      const contactShape = (authorShape.contact as z.ZodObject<any>).shape;
      expect(contactShape.email).toBeInstanceOf(z.ZodOptional);
      expect(contactShape.phone).toBeInstanceOf(z.ZodOptional);
    });

    it("should convert array of objects", () => {
      const declarativeType = {
        results: [{ item: "string" as const, description: "string" as const }],
      };
      const result = declarativeToOutputSchema(declarativeType);

      expect(result.results).toBeInstanceOf(z.ZodArray);
      const arrayElement = (result.results as z.ZodArray<any>).element;
      expect(arrayElement).toBeInstanceOf(z.ZodObject);

      const elementShape = (arrayElement as z.ZodObject<any>).shape;
      expect(elementShape.item).toBeInstanceOf(z.ZodOptional);
      expect(elementShape.description).toBeInstanceOf(z.ZodOptional);
    });
  });

  describe("validation", () => {
    it("should create schemas that validate correctly", () => {
      const declarativeType = {
        title: "string",
        count: "number",
        active: "boolean",
        tags: "string[]",
      } as const;
      const schemaRecord = declarativeToOutputSchema(declarativeType);

      // Test individual field validation
      expect(schemaRecord.title.parse("test")).toBe("test");
      expect(schemaRecord.count.parse(42)).toBe(42);
      expect(schemaRecord.active.parse(true)).toBe(true);
      expect(schemaRecord.tags.parse(["tag1", "tag2"])).toEqual(["tag1", "tag2"]);

      // Test validation failures
      expect(() => schemaRecord.title.parse(123)).toThrow();
      expect(() => schemaRecord.count.parse("not a number")).toThrow();
      expect(() => schemaRecord.active.parse("not a boolean")).toThrow();
      expect(() => schemaRecord.tags.parse("not an array")).toThrow();
    });

    it("should create nested schemas that validate correctly", () => {
      const declarativeType = {
        user: {
          name: "string",
          age: "number",
        },
      } as const;
      const schemaRecord = declarativeToOutputSchema(declarativeType);

      const validData = { name: "John", age: 30 };
      const result = (schemaRecord.user as z.ZodObject<any>).parse(validData);
      expect(result).toEqual(validData);

      const invalidData = { name: "John", age: "thirty" };
      expect(() => (schemaRecord.user as z.ZodObject<any>).parse(invalidData)).toThrow();
    });
  });

  describe("error handling", () => {
    it("should throw error for unsupported types", () => {
      const declarativeType = {
        invalid: "unsupported_type" as any,
      } as DeclarativeSchema;

      expect(() => declarativeToOutputSchema(declarativeType)).toThrow(
        "Unsupported declarative type: unsupported_type",
      );
    });
  });

  describe("real-world scenarios", () => {
    it("should handle API response schema", () => {
      const declarativeType = {
        success: "boolean",
        data: {
          id: "number",
          name: "string",
          tags: "string[]",
        },
        meta: {
          page: "number",
          total: "number",
        },
      } as const;
      const result = declarativeToOutputSchema(declarativeType);

      expect(result.success).toBeInstanceOf(z.ZodBoolean);
      expect(result.data).toBeInstanceOf(z.ZodObject);
      expect(result.meta).toBeInstanceOf(z.ZodObject);

      // Validate the structure works end-to-end
      const testData = {
        success: true,
        data: { id: 1, name: "Test", tags: ["tag1", "tag2"] },
        meta: { page: 1, total: 100 },
      };

      expect(result.success.parse(testData.success)).toBe(true);
      expect((result.data as z.ZodObject<any>).parse(testData.data)).toEqual(testData.data);
      expect((result.meta as z.ZodObject<any>).parse(testData.meta)).toEqual(testData.meta);
    });

    it("should handle form validation schema", () => {
      const declarativeType = {
        username: "string",
        email: "string",
        age: "number",
        interests: "string[]",
        preferences: {
          newsletter: "boolean",
          notifications: "boolean",
        },
      } as const;
      const result = declarativeToOutputSchema(declarativeType);

      const testData = {
        username: "johndoe",
        email: "john@example.com",
        age: 25,
        interests: ["coding", "music"],
        preferences: { newsletter: true, notifications: false },
      };

      expect(result.username.parse(testData.username)).toBe(testData.username);
      expect(result.email.parse(testData.email)).toBe(testData.email);
      expect(result.age.parse(testData.age)).toBe(testData.age);
      expect(result.interests.parse(testData.interests)).toEqual(testData.interests);
      expect((result.preferences as z.ZodObject<any>).parse(testData.preferences)).toEqual(
        testData.preferences,
      );
    });

    it("should handle array schema validation end-to-end", () => {
      const declarativeType = {
        results: [{ item: "string" as const, description: "string" as const }],
      };
      const result = declarativeToOutputSchema(declarativeType);

      const testData = {
        results: [
          { item: "Rose", description: "Red flower with thorns" },
          { item: "Tulip", description: "Yellow spring flower" },
        ],
      };

      expect(result.results.parse(testData.results)).toEqual(testData.results);

      // Test that it handles partial objects (properties are optional at nested levels)
      expect(result.results.parse([{ item: "Rose" }])).toEqual([{ item: "Rose" }]);
      expect(result.results.parse([{ description: "Red flower" }])).toEqual([
        { description: "Red flower" },
      ]);

      // Test that it rejects invalid types
      expect(() => {
        result.results.parse([{ item: 123 }]); // wrong type for item
      }).toThrow();

      expect(() => {
        result.results.parse("not an array"); // wrong type entirely
      }).toThrow();
    });
  });
});
