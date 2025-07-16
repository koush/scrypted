export interface BlobResourceContents {
  _meta?: { [key: string]: unknown };
  blob: string;
  mimeType?: string;
  uri: string;
}

export interface Annotations {
  audience?: "user" | "assistant";
  lastModified?: string;
  priority?: number;
}

export interface TextResourceContents {
  _meta?: { [key: string]: unknown };
  mimeType?: string;
  text: string;
  uri: string;
}

export interface EmbeddedResource {
  _meta?: { [key: string]: unknown };
  annotations?: Annotations;
  resource: TextResourceContents | BlobResourceContents;
  type: "resource";
}

export interface ResourceLink {
  _meta?: { [key: string]: unknown };
  annotations?: Annotations;
  description?: string;
  mimeType?: string;
  name: string;
  size?: number;
  title?: string;
  type: "resource_link";
  uri: string;
}
export interface AudioContent {
  _meta?: { [key: string]: unknown };
  annotations?: Annotations;
  data: string;
  mimeType: string;
  type: "audio";
}

export interface ImageContent {
  _meta?: { [key: string]: unknown };
  annotations?: Annotations;
  data: string;
  mimeType: string;
  type: "image";
}

export interface TextContent {
  _meta?: { [key: string]: unknown };
  annotations?: Annotations;
  text: string;
  type: "text";
}

export type ContentBlock = TextContent | ImageContent | AudioContent| ResourceLink | EmbeddedResource;


/**
 * https://modelcontextprotocol.io/specification/2025-06-18/schema#blobresourcecontents
 */
export interface CallToolResult {
  _meta?: { [key: string]: unknown };
  content: ContentBlock[];
  isError?: boolean;
  structuredContent?: { [key: string]: unknown };
  [key: string]: unknown;
}
