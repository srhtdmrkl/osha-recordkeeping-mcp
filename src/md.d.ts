/**
 * TypeScript declaration file to allow importing Markdown (`.md`) files
 * as raw strings (e.g. using bundlers or custom loaders).
 */
declare module "*.md" {
  const content: string;
  export default content;
}
