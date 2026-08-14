interface ResourceRefV1 {
  schema: 'substore.resource-ref@1';
  providerId: string;
  providerContributionId: string;
  type: 'subscription' | 'collection';
  id: string;
  contract: 'substore.subscription@1' | 'substore.collection@1';
}

interface SubscriptionDoctorResource {
  ref: ResourceRefV1;
  name: string;
  revision?: string | number;
  lifecycle?: { state: 'active' | 'archived' };
  availability?: {
    status: 'available' | 'disabled' | 'missing' | 'incompatible' | 'updating';
    reasonCode?: string;
  };
}

type CompatibilityCounts = {
  exact: number;
  fallback: number;
  filtered: number;
  unknown: number;
};

interface SubscriptionDoctorDiagnostic {
  code: string;
  severity: 'info' | 'warning' | 'error';
  count: number;
  message: string;
  path?: string;
}

interface SubscriptionDoctorReport {
  id: string;
  sourceRef: ResourceRefV1;
  lastKnownName?: string;
  sourceRevision?: string | number;
  checkedAt: number;
  durationMs: number;
  status: 'healthy' | 'warning' | 'error';
  counts: {
    total: number;
    invalid: number;
    duplicate: number;
    duplicateName: number;
  };
  protocols: Record<string, number>;
  targets: Record<'surge' | 'qx' | 'clash' | 'loon', CompatibilityCounts>;
  quality: {
    unknownProtocol: number;
    tlsVerificationDisabled: number;
    tlsServerNameMissing: number;
    privateEndpoint: number;
    sharedEndpoint: number;
    plaintextProxy: number;
    legacyCipher: number;
  };
  profile: {
    uniqueServers: number;
    uniqueEndpoints: number;
    regionTagged: number;
    mediaTagged: number;
    regions: Record<string, number>;
    media: Record<string, number>;
  };
  networkChecks: {
    state: 'not-run' | 'unsupported' | 'partial' | 'complete';
    runner: 'none' | 'http-socks' | 'host-probe';
    tested: number;
    skipped: number;
    reachable: number;
    failed: number;
    reasonCode?: string;
    features: {
      connectivity: 'not-run' | 'unsupported' | 'partial' | 'complete';
      streaming: 'not-run' | 'unsupported' | 'partial' | 'complete';
      egress: 'not-run' | 'unsupported' | 'partial' | 'complete';
    };
  };
  diagnostics: SubscriptionDoctorDiagnostic[];
  diff?: {
    previousReportId: string;
    checkedAt: number;
    counts: Record<'total' | 'invalid' | 'duplicate' | 'duplicateName', number>;
    protocols: Record<string, number>;
    targets: Record<'surge' | 'qx' | 'clash' | 'loon', CompatibilityCounts>;
  } | null;
  snapshotHash: string;
}
