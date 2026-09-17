export type Json = Record<string, unknown>;

export interface HealthResponse extends Json {
  status: string;
  worker: string;
  heartbeatAgeSeconds: number;
}

export interface SettingsField extends Json {
  key: string;
  kind: string;
  label?: string;
  help?: string;
  section?: string;
  value?: unknown;
  isSet?: boolean;
  source?: string;
  defaultValue?: unknown;
}

export interface SettingsResponse extends Json {
  fields: SettingsField[];
  effective: Record<string, unknown>;
}

export type RefreshScope = 'all' | 'group';

export interface PreviewRequest {
  channelId: number;
  aliases?: string[];
  contains?: string[];
  exclude?: string[];
  providers?: string[];
}

export interface ApplyRequest {
  order: number[];
  removeUnmatched?: boolean;
  force?: boolean;
  allowAssign?: boolean;
}

export interface RulesRequest {
  aliases?: string[];
  contains?: string[];
  exclude?: string[];
  providers?: string[];
  minResolution?: string | number;
}

export interface GroupUpdateRequest {
  mode?: string;
  measureOnly?: boolean;
}

export interface GroupPatternRequest {
  pattern: string;
  mode?: string;
  measureOnly?: boolean;
}

export interface OrderingWeights {
  resolution?: number;
  bitrate?: number;
  fps?: number;
  codec?: number;
  audio?: number;
  hdr?: number;
  preferH265?: boolean;
  hdrPreference?: string;
  hevcBitrateFactor?: number;
  uhdBitrateKbps?: number;
}

export interface OrderingRequest {
  mode?: string;
  providerPreference?: string[];
  weights?: OrderingWeights;
}

export interface QualityProfileQuery {
  minSamples: number;
  eventOnly?: boolean;
  include?: string;
  exclude?: string;
}
