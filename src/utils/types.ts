export interface LoadFileResults {
  content: string;
  format: string;
  path: string;
}

export interface FilePathInfo {
  abs: string; // Absolute path
  dir: string; // Directory path
  ext: string; // File extension
  stem: string; // File name stem
  name: string; // Full file name
}
