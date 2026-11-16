type SubscriptionLike = {
  name: string;
  displayName?: string;
  'display-name'?: string;
  icon?: string;
};

type SourceLike = { type?: string; name?: string; kind?: string; url?: string };

export const subscriptionPresentation = (
  source: SourceLike | undefined,
  subscriptions: SubscriptionLike[],
  collections: SubscriptionLike[],
) => {
  const items = source?.type === 'subscription' ? subscriptions
    : source?.type === 'collection' ? collections : [];
  const item = items.find(item => item.name === source?.name);
  return {
    label: item?.displayName || item?.['display-name'] || source?.name || '',
    icon: typeof item?.icon === 'string' ? item.icon.trim() : '',
  };
};

type SubscriptionSource = Extract<RemoteProxySource['source'], { kind: 'sub-store' }>;

export const selectSubscriptionSource = (draft: RemoteProxySource, source: SubscriptionSource) => {
  const previous = draft.source;
  if (previous.kind !== 'sub-store' || previous.type !== source.type || previous.name !== source.name) {
    delete draft.iconUrl;
  }
  draft.source = source;
};
