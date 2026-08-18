import { useI18n as useHostI18n } from '@/extensions/frontend-sdk-v1';
import en from './locales/en.json';
import ru from './locales/ru.json';
import zh from './locales/zh.json';

const messages = { zh, en, ru } as const;
type ConfigGeneratorLocale = keyof typeof messages;
type HostComposer = ReturnType<typeof useHostI18n>;

const registeredComposers = new Set<HostComposer>();

const withoutConfigGeneratorMessages = (
  current: Record<string, any>,
) => {
  const next = { ...current };
  delete next.configGenerator;

  if (current.navBar?.pagesTitle) {
    const pagesTitle = { ...current.navBar.pagesTitle };
    delete pagesTitle.configGenerator;
    delete pagesTitle.configGeneratorHealth;
    next.navBar = {
      ...current.navBar,
      pagesTitle,
    };
  }

  if (current.tabBar) {
    const tabBar = { ...current.tabBar };
    delete tabBar.configGenerator;
    next.tabBar = tabBar;
  }

  return next;
};

export const installConfigGeneratorMessages = (composer: HostComposer) => {
  if (registeredComposers.has(composer)) return;
  for (const locale of Object.keys(messages) as ConfigGeneratorLocale[]) {
    composer.mergeLocaleMessage(locale, messages[locale]);
  }
  registeredComposers.add(composer);
};

export const useConfigGeneratorI18n = () => {
  const composer = useHostI18n({ useScope: 'global' });
  installConfigGeneratorMessages(composer);
  return composer;
};

export const disposeConfigGeneratorMessages = () => {
  for (const composer of registeredComposers) {
    for (const locale of Object.keys(messages) as ConfigGeneratorLocale[]) {
      const current = composer.getLocaleMessage(locale) as Record<string, any>;
      composer.setLocaleMessage(locale, withoutConfigGeneratorMessages(current));
    }
  }
  registeredComposers.clear();
};
