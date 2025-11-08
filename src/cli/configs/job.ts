import { ResultTypeUnion } from "../../core/types.js";
import {
  AIProviderUse,
  BatchJob,
  BatchOptions,
  ChatStep,
  DAGJob,
  DocumentReference,
  ImageReference,
  Job,
  JobConfig,
  Replace,
  SerialJob,
  SkipOptions,
  Step,
  TextFileReference,
  ValidationError,
  WriteToDiskStep,
} from "./types.js";

export function isJobConfig(obj: any, errVal?: ValidationError): obj is JobConfig {
  if (!obj || typeof obj !== "object") {
    if (errVal) errVal.value = "Not an object";
    return false;
  }

  if (!isUsing(obj.using, errVal)) {
    if (errVal) errVal.value = `Invalid 'using' property: ${errVal?.value}`;
    return false;
  }

  if (!obj.jobs || typeof obj.jobs !== "object") {
    if (errVal) errVal.value = "Missing or invalid 'jobs' property";
    return false;
  }

  if (!isDAGJob(obj.jobs, errVal)) {
    if (errVal) errVal.value = `Invalid 'jobs' property: ${errVal?.value}`;
    return false;
  }

  return true;
}

export function isUsing(obj: any, errVal?: ValidationError): obj is AIProviderUse {
  if (!obj || typeof obj !== "object") {
    if (errVal) errVal.value = "Not an object";
    return false;
  }

  if (typeof obj.engine !== "string") {
    if (errVal) errVal.value = "Missing or invalid 'engine' property";
    return false;
  }

  // The engine property should be a valid key for AIProviderConfig
  const validProviders = ["openai", "anthropic", "ollama", "gemini"];
  if (!validProviders.includes(obj.engine)) {
    if (errVal)
      errVal.value = "Invalid provider type. Must be 'openai', 'anthropic', 'gemini', or 'ollama'";
    return false;
  }

  // Validate provider-specific optional properties based on the 'engine' property
  switch (obj.engine) {
    case "ollama":
      // Optional model property
      if ("model" in obj && typeof obj.model !== "string") {
        if (errVal) errVal.value = "Property 'model' must be a string";
        return false;
      }
      // Optional url property
      if ("url" in obj && typeof obj.url !== "string") {
        if (errVal) errVal.value = "Property 'url' must be a string";
        return false;
      }
      break;
    case "gemini":
    case "anthropic":
    case "openai":
      // Optional api-key property
      if ("api-key" in obj && typeof obj["api-key"] !== "string") {
        if (errVal) errVal.value = "Property 'api-key' must be a string";
        return false;
      }
      // Optional model property
      if ("model" in obj && typeof obj.model !== "string") {
        if (errVal) errVal.value = "Property 'model' must be a string";
        return false;
      }
      break;
  }

  return true;
}

export function isDAGJob(obj: any, errVal?: ValidationError): obj is DAGJob {
  for (const [key, value] of Object.entries(obj)) {
    if (!isDAGJobValue(value, errVal)) {
      if (errVal) errVal.value = `Invalid job '${key}': ${errVal?.value}`;
      return false;
    }
  }
  return true;
}

export function isDAGJobValue(
  obj: any,
  errVal?: ValidationError,
): obj is Job & { dependsOn?: string | string[] } {
  if (!obj || typeof obj !== "object") {
    if (errVal) errVal.value = "Not an object";
    return false;
  }

  // Validate the base job
  if (!isJob(obj, errVal)) {
    return false;
  }

  // Validate dependsOn if provided
  if ("dependsOn" in obj && obj.dependsOn !== undefined) {
    const dependsOn = (obj as any).dependsOn;
    if (typeof dependsOn === "string") {
      // Single dependency is valid
    } else if (Array.isArray(dependsOn)) {
      for (let i = 0; i < dependsOn.length; i++) {
        if (typeof dependsOn[i] !== "string") {
          if (errVal) errVal.value = `Dependency at index ${i} must be a string`;
          return false;
        }
      }
    } else {
      if (errVal) errVal.value = "Property 'dependsOn' must be a string or array of strings";
      return false;
    }
  }

  return true;
}

export function isJob(obj: any, errVal?: ValidationError): obj is Job {
  if (!obj || typeof obj !== "object") {
    if (errVal) errVal.value = "Not an object";
    return false;
  }

  // Distinguish between SerialJob and BatchJob by presence of batch property
  if ("batch" in obj) {
    return isBatchJob(obj, errVal);
  } else {
    return isSerialJob(obj, errVal);
  }
}

export function isSerialJob(obj: any, errVal?: ValidationError): obj is SerialJob {
  if (!obj || typeof obj !== "object") {
    if (errVal) errVal.value = "Not an object";
    return false;
  }

  // SerialJob should not have a batch property
  if ("batch" in obj) {
    if (errVal) errVal.value = "Serial job should not have a batch property";
    return false;
  }

  // Check tools if provided
  if (obj.tools !== undefined) {
    if (!Array.isArray(obj.tools)) {
      if (errVal) errVal.value = "Property 'tools' must be an array";
      return false;
    }

    for (const tool of obj.tools) {
      if (typeof tool !== "string") {
        if (errVal) errVal.value = "All tools must be strings";
        return false;
      }
    }
  }

  // Check steps
  if (!Array.isArray(obj.steps)) {
    if (errVal) errVal.value = "Property 'steps' must be an array";
    return false;
  }

  for (let i = 0; i < obj.steps.length; i++) {
    if (!isStep(obj.steps[i], errVal)) {
      if (errVal) errVal.value = `Invalid step at index ${i}: ${errVal?.value}`;
      return false;
    }
  }

  return true;
}

export function isBatchJob(obj: any, errVal?: ValidationError): obj is BatchJob {
  if (!obj || typeof obj !== "object") {
    if (errVal) errVal.value = "Not an object";
    return false;
  }

  // Check tools if provided
  if (obj.tools !== undefined) {
    if (!Array.isArray(obj.tools)) {
      if (errVal) errVal.value = "Property 'tools' must be an array";
      return false;
    }

    for (const tool of obj.tools) {
      if (typeof tool !== "string") {
        if (errVal) errVal.value = "All tools must be strings";
        return false;
      }
    }
  }

  // Check batch - this is required for BatchJob
  if (!Array.isArray(obj.batch)) {
    if (errVal) errVal.value = "Property 'batch' must be an array";
    return false;
  }

  for (let i = 0; i < obj.batch.length; i++) {
    if (!isBatchOptions(obj.batch[i], errVal)) {
      if (errVal) errVal.value = `Invalid batch item at index ${i}: ${errVal?.value}`;
      return false;
    }
  }

  // Check steps
  if (!Array.isArray(obj.steps)) {
    if (errVal) errVal.value = "Property 'steps' must be an array";
    return false;
  }

  for (let i = 0; i < obj.steps.length; i++) {
    if (!isStep(obj.steps[i], errVal)) {
      if (errVal) errVal.value = `Invalid step at index ${i}: ${errVal?.value}`;
      return false;
    }
  }

  return true;
}

export function isBatchOptions(obj: any, errVal?: ValidationError): obj is BatchOptions {
  if (!obj || typeof obj !== "object") {
    if (errVal) errVal.value = "Not an object";
    return false;
  }

  if (obj.type !== "files") {
    if (errVal) errVal.value = "Property 'type' must be 'files'";
    return false;
  }

  if (typeof obj.source !== "string") {
    if (errVal) errVal.value = "Property 'source' must be a string";
    return false;
  }

  if (typeof obj.bind !== "string") {
    if (errVal) errVal.value = "Property 'bind' must be a string";
    return false;
  }

  // Check skip-if if provided
  if (obj["skip-if"] !== undefined) {
    if (!Array.isArray(obj["skip-if"])) {
      if (errVal) errVal.value = "Property 'skip-if' must be an array";
      return false;
    }

    for (let j = 0; j < obj["skip-if"].length; j++) {
      if (!isSkipOptions(obj["skip-if"][j], errVal)) {
        if (errVal) errVal.value = `Invalid skip condition at index ${j}: ${errVal?.value}`;
        return false;
      }
    }
  }

  return true;
}

export function isSkipOptions(obj: any, errVal?: ValidationError): obj is SkipOptions {
  if (!obj || typeof obj !== "object") {
    if (errVal) errVal.value = "Not an object";
    return false;
  }

  if (obj.type !== "file-exist") {
    if (errVal) errVal.value = "Property 'type' must be 'file-exist'";
    return false;
  }

  if (typeof obj.pattern !== "string") {
    if (errVal) errVal.value = "Property 'pattern' must be a string";
    return false;
  }

  return true;
}

export function isStep(obj: any, errVal?: ValidationError): obj is Step {
  if (!obj || typeof obj !== "object") {
    if (errVal) errVal.value = "Not an object";
    return false;
  }

  if (!obj.uses || typeof obj.uses !== "string") {
    if (errVal) errVal.value = "Step must have a string 'uses' property";
    return false;
  }

  if (obj.uses === "chat") {
    return isChatStep(obj, errVal);
  } else if (obj.uses === "write-to-disk") {
    return isWriteToDiskStep(obj, errVal);
  } else {
    if (errVal) errVal.value = `Unknown uses type: ${obj.uses}`;
    return false;
  }
}

export function isChatStep(obj: any, errVal?: ValidationError): obj is ChatStep {
  if (!obj || typeof obj !== "object") {
    if (errVal) errVal.value = "Not an object";
    return false;
  }

  if (obj.uses !== "chat") {
    if (errVal) errVal.value = "Uses must be 'chat'";
    return false;
  }

  if (typeof obj.message !== "string") {
    if (errVal) errVal.value = "Property 'message' must be a string";
    return false;
  }

  // Check optional output property
  if (obj.output !== undefined) {
    if (!obj.output || typeof obj.output !== "object" || Array.isArray(obj.output)) {
      if (errVal) errVal.value = "Property 'output' must be an object";
      return false;
    }

    // Validate output is Record<string, ResTypeStrings>
    const validResTypes: ResultTypeUnion[] = ["string", "string[]", "number", "boolean"];
    for (const [key, value] of Object.entries(obj.output)) {
      if (
        typeof key !== "string" ||
        typeof value !== "string" ||
        !validResTypes.includes(value as ResultTypeUnion)
      ) {
        if (errVal)
          errVal.value =
            "Property 'output' must be a Record<string, ResTypeStrings> where ResTypeStrings is 'string' | 'string[]' | 'number' | 'boolean'";
        return false;
      }
    }
  }

  // Check system if provided
  if (obj.system !== undefined && typeof obj.system !== "string") {
    if (errVal) errVal.value = "Property 'system' must be a string";
    return false;
  }

  // Check replace if provided
  if (obj.replace !== undefined) {
    if (!Array.isArray(obj.replace)) {
      if (errVal) errVal.value = "Property 'replace' must be an array";
      return false;
    }

    for (let i = 0; i < obj.replace.length; i++) {
      if (!isReplace(obj.replace[i], errVal)) {
        if (errVal) errVal.value = `Invalid replace at index ${i}: ${errVal?.value}`;
        return false;
      }
    }
  }

  // Check tools if provided
  if (obj.tools !== undefined) {
    if (!Array.isArray(obj.tools)) {
      if (errVal) errVal.value = "Property 'tools' must be an array";
      return false;
    }

    for (const tool of obj.tools) {
      if (typeof tool !== "string") {
        if (errVal) errVal.value = "All tools must be strings";
        return false;
      }
    }
  }

  // Check images if provided
  if (obj.images !== undefined) {
    if (!Array.isArray(obj.images)) {
      if (errVal) errVal.value = "Property 'images' must be an array";
      return false;
    }

    for (let i = 0; i < obj.images.length; i++) {
      if (!isImageReference(obj.images[i], errVal)) {
        if (errVal) errVal.value = `Invalid image at index ${i}: ${errVal?.value}`;
        return false;
      }
    }
  }

  // Check documents if provided
  if (obj.documents !== undefined) {
    if (!Array.isArray(obj.documents)) {
      if (errVal) errVal.value = "Property 'documents' must be an array";
      return false;
    }

    for (let i = 0; i < obj.documents.length; i++) {
      if (!isDocumentReference(obj.documents[i], errVal)) {
        if (errVal) errVal.value = `Invalid document at index ${i}: ${errVal?.value}`;
        return false;
      }
    }
  }

  // Check references if provided
  if (obj.references !== undefined) {
    if (!Array.isArray(obj.references)) {
      if (errVal) errVal.value = "Property 'references' must be an array";
      return false;
    }

    for (let i = 0; i < obj.references.length; i++) {
      if (!isTextFileReference(obj.references[i], errVal)) {
        if (errVal) errVal.value = `Invalid reference at index ${i}: ${errVal?.value}`;
        return false;
      }
    }
  }

  return true;
}

export function isWriteToDiskStep(obj: any, errVal?: ValidationError): obj is WriteToDiskStep {
  if (!obj || typeof obj !== "object") {
    if (errVal) errVal.value = "Not an object";
    return false;
  }

  if (obj.uses !== "write-to-disk") {
    if (errVal) errVal.value = "Uses must be 'write-to-disk'";
    return false;
  }

  if (typeof obj.output !== "string") {
    if (errVal) errVal.value = "Property 'output' must be a string";
    return false;
  }

  // Check keys if provided
  if (obj.keys !== undefined) {
    if (typeof obj.keys === "string") {
      // Single key is valid
    } else if (Array.isArray(obj.keys)) {
      for (let i = 0; i < obj.keys.length; i++) {
        if (typeof obj.keys[i] !== "string") {
          if (errVal) errVal.value = `Key at index ${i} must be a string`;
          return false;
        }
      }
    } else {
      if (errVal) errVal.value = "Property 'keys' must be a string or array of strings";
      return false;
    }
  }

  return true;
}

export function isReplace(obj: any, errVal?: ValidationError): obj is Replace {
  if (!obj || typeof obj !== "object") {
    if (errVal) errVal.value = "Not an object";
    return false;
  }

  if (typeof obj.pattern !== "string") {
    if (errVal) errVal.value = "Property 'pattern' must be a string";
    return false;
  }

  if (obj.source !== "file") {
    if (errVal) errVal.value = "Property 'source' must be 'file'";
    return false;
  }

  if (typeof obj.files !== "string" && !Array.isArray(obj.files)) {
    if (errVal) errVal.value = "Property 'files' must be a string or an array of strings";
    return false;
  }

  if (Array.isArray(obj.files)) {
    for (let i = 0; i < obj.files.length; i++) {
      if (typeof obj.files[i] !== "string") {
        if (errVal) errVal.value = `Files entry at index ${i} must be a string`;
        return false;
      }
    }
  }

  return true;
}

export function isImageReference(obj: any, errVal?: ValidationError): obj is ImageReference {
  if (!obj || typeof obj !== "object") {
    if (errVal) errVal.value = "Not an object";
    return false;
  }

  if (typeof obj.file !== "string") {
    if (errVal) errVal.value = "Property 'file' must be a string";
    return false;
  }

  return true;
}

export function isDocumentReference(obj: any, errVal?: ValidationError): obj is DocumentReference {
  if (!obj || typeof obj !== "object") {
    if (errVal) errVal.value = "Not an object";
    return false;
  }

  if (typeof obj.file !== "string") {
    if (errVal) errVal.value = "Property 'file' must be a string";
    return false;
  }

  return true;
}

export function isTextFileReference(obj: any, errVal?: ValidationError): obj is TextFileReference {
  if (!obj || typeof obj !== "object") {
    if (errVal) errVal.value = "Not an object";
    return false;
  }

  if (typeof obj.file !== "string") {
    if (errVal) errVal.value = "Property 'file' must be a string";
    return false;
  }

  return true;
}
