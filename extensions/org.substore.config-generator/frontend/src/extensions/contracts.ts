export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  [key: string]: unknown;
}

export interface ExtensionRouteContribution {
  id?: string;
  path?: string;
  [key: string]: unknown;
}
