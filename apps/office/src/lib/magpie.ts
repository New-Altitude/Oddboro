/** Safe public data. Management sessions and inference tokens stay on the server. */
export type MagpieMode = 'managed' | 'existing';
export type MagpieLocation = 'local' | 'server';
export type MagpieModel = {
  /** Opaque inference route. Preserve provider prefixes and group aliases exactly. */
  id: string;
  name: string;
  provider: string;
  images: boolean;
  kind?: 'model' | 'group';
};
export type MagpieProvider = {
  id: string;
  name: string;
  preset: string;
  chat: string;
  responses: string;
  anthropic: string;
  ready: boolean;
  off: boolean;
  keySet: boolean;
  subscription?: boolean;
  keys?: { id: string; name: string; on: boolean; active: boolean }[];
  models: MagpieModel[];
};
export type MagpieRouting =
  | ''
  | 'order'
  | 'rotate'
  | 'usage'
  | 'pace'
  | 'weight'
  | 'free'
  | 'fast'
  | 'cheap'
  | 'drain'
  | 'expiring';
export type MagpieGroup = {
  id: string;
  name: string;
  ref: string;
  members: string[];
  routing: MagpieRouting;
  ready: boolean;
  firstToken: number;
  patience: number;
};
export type MagpieSignIn = {
  id: string;
  agent: string;
  state: string;
  url: string;
  code: string;
  pasteCallback: boolean;
  pasteCode: boolean;
  pasteKey: boolean;
  instructions: string;
  user: string;
  error: string;
};
export type MagpieLogin = {
  id: string;
  name: string;
  signedIn: boolean;
  supported: boolean;
  reason: string;
  kind?: 'builtin' | 'plugin';
  methods: { type: string; label: string }[];
};
export type MagpieDiscovered = {
  source: string;
  ref: string;
  name: string;
  status: string;
  canImport: boolean;
};
export type MagpiePrompt = {
  key: string;
  label: string;
  type: string;
  placeholder: string;
  options: { label: string; value: string }[];
};
export type MagpieCall = {
  model: string;
  provider: string;
  status: number;
  at: string;
  duration: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  fallbackUsed?: boolean;
  attempts?: { provider: string; model: string; status: number; failed: boolean }[];
};
export type MagpieState = {
  connected: boolean;
  mode: MagpieMode | null;
  location?: MagpieLocation;
  /** Catalog access grants use only; management authorization is a separate capability. */
  access?: 'manage' | 'use';
  /** Setup readiness, not proof that an inference request or every listed model will succeed. */
  ready: boolean;
  version: string;
  managementUrl: string;
  gatewayUrl: string;
  shared: boolean;
  notice: string;
  problem: string;
  managedAvailable: boolean;
  providers: MagpieProvider[];
  presets: { id: string; name: string }[];
  models: MagpieModel[];
  groups: MagpieGroup[];
  logins: MagpieLogin[];
  calls: MagpieCall[];
  discoverySupported: boolean;
};
export type MagpieProviderInput = {
  id: string;
  name: string;
  preset?: string;
  chat?: string;
  responses?: string;
  anthropic?: string;
  key?: string;
  models?: string[];
  new?: boolean;
};
/** POST /api/magpie. The reply always contains state and may contain signIn or candidates. */
export type MagpieAction =
  | { action: 'connect-gateway'; gatewayUrl: string }
  | ({
      action: 'connect';
      location?: MagpieLocation;
      gatewayUrl?: string;
      inferenceToken?: string;
      shared: true;
    } & (
      | { accessLink: string; managementUrl?: never; managementKey?: never }
      | { accessLink?: never; managementUrl: string; managementKey: string }
    ))
  | { action: 'setup' }
  | { action: 'start-managed' }
  | { action: 'disconnect' }
  | { action: 'find-existing' }
  | { action: 'inspect' }
  | { action: 'provider-save'; provider: MagpieProviderInput }
  | { action: 'provider-delete'; id: string }
  | { action: 'key-add'; id: string; key: string; name?: string }
  | { action: 'key-replace'; id: string; ref: string; key: string }
  | { action: 'key-remove'; id: string; ref: string }
  | { action: 'key-toggle'; id: string; ref: string; on: boolean }
  | {
      action: 'group-save';
      group: {
        id: string;
        name: string;
        members: string[];
        routing: MagpieRouting;
        firstToken?: number;
        patience?: number;
      };
    }
  | { action: 'group-delete'; id: string }
  | {
      action: 'signin-start';
      agent: string;
      method?: number;
      inputs?: Record<string, string>;
      key?: string;
    }
  | {
      action: 'signin-prompt';
      agent: string;
      method: number;
      inputs?: Record<string, string>;
      key?: string;
      value?: string;
    }
  | { action: 'signin-status' | 'signin-cancel'; id: string }
  | { action: 'signin-callback'; id: string; url: string }
  | { action: 'discovery'; enabled: true }
  | { action: 'import-selected'; picks: { source: string; ref: string }[] };
export type MagpieReply = {
  state: MagpieState;
  setup?: {
    status: 'connected' | 'authorization-required' | 'unavailable';
    message: string;
    reused?: boolean;
  };
  signIn?: MagpieSignIn;
  discovered?: MagpieDiscovered[];
  prompt?: MagpiePrompt | null;
  inputs?: Record<string, string>;
  candidates?: { managementUrl: string; gatewayUrl?: string }[];
};
