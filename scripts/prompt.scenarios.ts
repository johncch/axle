import { Command, Option } from "@commander-js/extra-typings";
import dotenv from "dotenv";
import {} from "../src/core/typecheck.js";
import { DeclarativeSchema } from "../src/core/types.js";
import { Axle, ChainOfThought, Instruct } from "../src/index.js";

dotenv.config();

const PROVIDERS = ["openai", "anthropic", "ollama", "gemini"] as const;
const INSTRUCT_TYPES = ["instruct", "cot"] as const;

// Define interface for command options
interface CommandOptions {
  provider: (typeof PROVIDERS)[number];
  model?: string;
  type: (typeof INSTRUCT_TYPES)[number];
}

const program = new Command();
program
  .name("prompt-scenarios")
  .description("Run prompt scenarios with different LLM models to test Instruct")
  .addOption(
    new Option("-p, --provider <provider>", "LLM provider to use")
      .choices(PROVIDERS)
      .default("ollama"),
  )
  .option("-m, --model <model>", "LLM model to use")
  .addOption(
    new Option("-t, --type <type>", "Instruct subclass to use")
      .choices(INSTRUCT_TYPES)
      .default("instruct"),
  )
  .parse(process.argv);
const options = program.opts() as CommandOptions;

interface PromptScenario {
  id: string;
  description: string;
  prompt: string;
  resFormat: DeclarativeSchema;
}

const PROMPT_SCENARIOS: PromptScenario[] = [
  // --- Single Tag Scenarios ---

  // String Type
  {
    id: "single_string_01_capital_city",
    description: "Single string output: Capital city of a country.",
    prompt: "What is the capital of France?",
    resFormat: { capital: "string" },
  },
  {
    id: "single_string_02_famous_quote",
    description: "Single string output: A famous quote.",
    prompt: "Share a famous quote by Albert Einstein.",
    resFormat: { quoteText: "string" },
  },
  {
    id: "single_string_03_book_genre",
    description: "Single string output: Genre of a book.",
    prompt: 'What is the primary genre of the book "Dune"?',
    resFormat: { genre: "string" },
  },

  // Number Type
  {
    id: "single_number_01_planet_moons",
    description: "Single number output: Number of moons of a planet.",
    prompt: "How many moons does Mars have?",
    resFormat: { moonCount: "number" },
  },
  {
    id: "single_number_02_boiling_point",
    description: "Single number output: Boiling point of water in Celsius.",
    prompt: "What is the boiling point of water in Celsius at standard atmospheric pressure?",
    resFormat: { boilingPointC: "number" },
  },

  // Boolean Type
  {
    id: "single_boolean_01_is_earth_flat",
    description: "Single boolean output: Whether Earth is flat.",
    prompt: "Is the Earth flat?",
    resFormat: { isFlat: "boolean" },
  },
  {
    id: "single_boolean_02_is_sun_star",
    description: "Single boolean output: Whether the Sun is a star.",
    prompt: "Is the Sun a star?",
    resFormat: { isStar: "boolean" },
  },
  {
    id: "single_boolean_03_is_square_root",
    description: "Consider if 1024 is a perfect square.",
    prompt: "Consider whether the following statement is true or false: 1024 is a perfect square.",
    resFormat: { isTrue: "boolean" },
  },

  // List Type
  {
    id: "single_list_01_primary_colors",
    description: "Single list output: List of primary colors.",
    prompt: "List the three primary colors.",
    resFormat: { primaryColors: "string[]" },
  },
  {
    id: "single_list_02_continents",
    description: "Single list output: List of continents.",
    prompt: "Name three continents.",
    resFormat: { continentsList: "string[]" },
  },

  // --- Two Tag Scenarios ---

  // String & String
  {
    id: "double_string_string_01_inventor_invention",
    description: "Two string outputs: Inventor and their invention.",
    prompt: "Name an inventor and their most famous invention",
    resFormat: { inventorName: "string", inventionName: "string" },
  },
  {
    id: "double_string_string_02_movie_director",
    description: "Two string outputs: Movie title and its director.",
    prompt: "What is a popular science fiction movie and who directed it?",
    resFormat: { movieTitle: "string", directorName: "string" },
  },

  // String & Number
  {
    id: "double_string_number_01_country_population",
    description: "String and Number outputs: Country name and its approximate population.",
    prompt: "What is the approximate population of Canada in millions?",
    resFormat: { countryName: "string", populationMillions: "number" },
  },
  {
    id: "double_string_number_02_product_rating",
    description: "String and Number outputs: Product name and its average rating (1-5).",
    prompt: "Suggest a common electronic product and its average user rating out of 5.",
    resFormat: { productName: "string", averageRating: "number" },
  },

  // String & Boolean
  {
    id: "double_string_boolean_01_animal_mammal",
    description: "String and Boolean outputs: Animal name and if it is a mammal.",
    prompt: "Is a whale a mammal?",
    resFormat: { animalName: "string", isMammal: "boolean" },
  },

  // String & List
  {
    id: "double_string_list_01_band_albums",
    description: "String and List outputs: Music band and a list of their albums.",
    prompt: "Name a famous rock band and list two of their albums.",
    resFormat: { bandName: "string", albumList: "string[]" },
  },

  // Number & Boolean
  {
    id: "double_number_boolean_01_year_leap",
    description: "Number and Boolean outputs: Year and whether it is a leap year.",
    prompt: "Was the year 2000 a leap year?",
    resFormat: { yearValue: "number", isLeapYear: "boolean" },
  },

  // --- Three Tag Scenarios ---

  // String, String, String
  {
    id: "triple_string_string_string_01_person_city_profession",
    description: "Three string outputs: Person's name, city, and profession.",
    prompt: "Describe a fictional character with their name, city of residence, and profession.",
    resFormat: {
      characterName: "string",
      cityOfResidence: "string",
      professionName: "string",
    },
  },

  // String, Number, Boolean
  {
    id: "triple_string_number_boolean_01_food_calories_healthy",
    description:
      "String, Number, Boolean outputs: Food item, calorie count, and if it is generally considered healthy.",
    prompt:
      "Name a food item, its approximate calorie count per serving, and whether it is generally considered healthy.",
    resFormat: {
      foodItem: "string",
      caloriesPerServing: "number",
      isHealthy: "boolean",
    },
  },
  {
    id: "triple_string_number_boolean_02_website_users_secure",
    description:
      "String, Number, Boolean outputs: Website name, monthly active users (approx), and if it uses HTTPS.",
    prompt:
      "Imagine a popular website. Provide its name, estimated monthly active users, and whether it uses HTTPS.",
    resFormat: {
      websiteName: "string",
      monthlyUsers: "number",
      usesHttps: "boolean",
    },
  },

  // String, Number, List
  {
    id: "triple_string_number_list_01_company_employees_products",
    description:
      "String, Number, List outputs: Company name, number of employees, and key products.",
    prompt:
      "Detail a well-known tech company: its name, approximate number of employees, and a comma-separated list of 2-3 key products or services.",
    resFormat: {
      companyName: "string",
      employeeCount: "number",
      keyProducts: "string[]",
    },
  },

  // String, List, Boolean
  {
    id: "triple_string_list_boolean_01_game_genres_multiplayer",
    description:
      "String, List, Boolean outputs: Game title, list of genres, and if it has multiplayer.",
    prompt:
      "Name a video game, list its genres (comma-separated, e.g., RPG, Action), and state if it has a multiplayer mode.",
    resFormat: {
      gameTitle: "string",
      genreList: "string[]",
      hasMultiplayer: "boolean",
    },
  },

  // Number, List, String
  {
    id: "triple_number_list_string_01_recipe_time_ingredients_type",
    description:
      "Number, List, String outputs: Recipe prep time, ingredients, and type of cuisine.",
    prompt:
      "The user asked for Lasagna. Provide the recipe's preparation time in minutes, a short comma-separated list of 2 main ingredients, and its type of cuisine.",
    resFormat: {
      prepTimeMinutes: "number",
      mainIngredients: "string[]",
      cuisineType: "string",
    },
  },

  // --- Nested Object Scenarios ---

  // Simple nested object
  {
    id: "nested_simple_01_book_author",
    description: "Nested object: Book with author details.",
    prompt: "Tell me about a famous book including the author's name and birth year.",
    resFormat: {
      bookTitle: "string",
      author: {
        name: "string",
        birthYear: "number",
      },
    },
  },

  // Nested object with multiple fields
  {
    id: "nested_complex_01_product_details",
    description: "Complex nested object: Product with pricing and specifications.",
    prompt: "Describe a smartphone with its pricing information and key specifications.",
    resFormat: {
      productName: "string",
      pricing: {
        currentPrice: "number",
        originalPrice: "number",
        onSale: "boolean",
      },
      specs: {
        screenSize: "string",
        storageGB: "number",
        features: "string[]",
      },
    },
  },

  // Nested object with array of objects
  {
    id: "nested_array_01_restaurant_menu",
    description: "Nested object with array: Restaurant with menu items.",
    prompt: "Describe a restaurant including its basic info and 2 popular menu items with prices.",
    resFormat: {
      restaurantName: "string",
      cuisine: "string",
      location: {
        city: "string",
        country: "string",
      },
      popularItems: "string[]",
      averagePrice: "number",
    },
  },

  // Deep nested object
  {
    id: "nested_deep_01_company_structure",
    description: "Deep nested object: Company with department and employee info.",
    prompt:
      "Describe a tech company with information about one of its departments and a key employee.",
    resFormat: {
      companyName: "string",
      department: {
        name: "string",
        employeeCount: "number",
        manager: {
          name: "string",
          yearsExperience: "number",
          isRemote: "boolean",
        },
      },
      founded: "number",
    },
  },

  // Mixed nested with arrays
  {
    id: "nested_mixed_01_university_course",
    description: "Mixed nested object: University course with instructor and student info.",
    prompt:
      "Describe a university course including instructor details and information about enrolled students.",
    resFormat: {
      courseName: "string",
      courseCode: "string",
      instructor: {
        name: "string",
        department: "string",
        rating: "number",
      },
      enrollment: {
        totalStudents: "number",
        isFullyBooked: "boolean",
        prerequisites: "string[]",
      },
      semester: "string",
    },
  },
];

function validateResult(obj: Record<string, unknown>, resFormat: DeclarativeSchema) {
  if (!obj) {
    return false;
  }

  if (Object.keys(obj).length != Object.keys(resFormat).length) {
    console.error("fail length");
    return false;
  }

  for (const key in obj) {
    const type = resFormat[key];
    if (typeof type === "string") {
      if (type === "string" && typeof obj[key] !== "string") {
        console.error("fail string");
        return false;
      } else if (type === "number" && typeof obj[key] !== "number") {
        console.error("fail number");
        return false;
      } else if (type === "boolean" && typeof obj[key] !== "boolean") {
        console.error("fail boolean");
        return false;
      } else if (
        type === "string[]" &&
        (!Array.isArray(obj[key]) || Array(obj[key]).length === 0)
      ) {
        console.error("fail string[]");
        return false;
      }
    } else if (typeof type === "object" && type !== null) {
      // Handle nested objects
      if (typeof obj[key] !== "object" || obj[key] === null) {
        console.error(`fail nested object for key ${key}`);
        return false;
      }
      // Recursively validate nested object
      if (!validateResult(obj[key] as Record<string, unknown>, type as DeclarativeSchema)) {
        console.error(`fail nested validation for key ${key}`);
        return false;
      }
    }
  }

  return true;
}

const provider = options.provider;
let model = options.model;
const instructType = options.type;

const createAxleConfig = () => {
  switch (provider) {
    case "openai":
      if (!process.env.OPENAI_API_KEY) {
        console.error("The API Key is not found. Check your .env file");
        process.exit(1);
      }
      return { openai: { "api-key": process.env.OPENAI_API_KEY || "", model } };
    case "anthropic":
      if (!process.env.ANTHROPIC_API_KEY) {
        console.error("The API Key is not found. Check your .env file");
        process.exit(1);
      }
      return {
        anthropic: { "api-key": process.env.ANTHROPIC_API_KEY || "", model },
      };
    case "ollama":
      model = model ?? "gemma3"; // smallest model
      return { ollama: { model, url: "http://localhost:11434" } };
    case "gemini":
      if (!process.env.GEMINI_API_KEY) {
        console.error("The API Key is not found. Check your .env file");
        process.exit(1);
      }
      return {
        gemini: { "api-key": process.env.GEMINI_API_KEY || "", model },
      };
    default:
      console.error(`Unknown provider: ${provider}`);
      process.exit(1);
  }
};

const axle = new Axle(createAxleConfig());
console.log(
  `Using provider: ${provider}, model: ${axle.provider.model}, instruction type: ${instructType}`,
);

let success = 0;
const total = PROMPT_SCENARIOS.length;
for (const scenario of PROMPT_SCENARIOS) {
  let instruct;
  if (instructType === "cot") {
    instruct = ChainOfThought.with(scenario.prompt, scenario.resFormat);
  } else {
    instruct = Instruct.with(scenario.prompt, scenario.resFormat);
  }

  console.log("==> Scenario ID: " + scenario.id);
  console.log(instruct.compile().instructions);
  const result = await axle.execute(instruct);
  if (result.success) {
    success = success + 1;
  } else {
    console.error(result.error);
  }

  console.log("> Raw output");
  console.log(instruct.rawResponse);
  console.log("> Parsed output");
  console.log(instruct.result);
  console.log("");
}

console.log("==> Summary");
console.log(`Success: ${success} / ${total}`);
