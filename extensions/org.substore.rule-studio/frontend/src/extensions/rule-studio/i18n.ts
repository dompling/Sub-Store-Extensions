import { useI18n as useHostI18n } from '@/extensions/frontend-sdk-v1';
import en from './locales/en.json';
import zh from './locales/zh.json';

const messages = { zh, en } as const;
type Locale = keyof typeof messages;
type HostComposer = ReturnType<typeof useHostI18n>;
const composers = new Set<HostComposer>();

export const useRuleStudioI18n = () => {
  const composer = useHostI18n({ useScope: 'global' });
  if (!composers.has(composer)) {
    for (const locale of Object.keys(messages) as Locale[]) composer.mergeLocaleMessage(locale, messages[locale]);
    composers.add(composer);
  }
  return composer;
};

export const disposeRuleStudioMessages = () => {
  for (const composer of composers) {
    for (const locale of Object.keys(messages) as Locale[]) {
      const current = composer.getLocaleMessage(locale) as Record<string, any>;
      const next = { ...current };
      delete next.ruleStudio;
      if (current.navBar?.pagesTitle) {
        const pagesTitle = { ...current.navBar.pagesTitle };
        delete pagesTitle.ruleStudio;
        next.navBar = { ...current.navBar, pagesTitle };
      }
      composer.setLocaleMessage(locale, next);
    }
  }
  composers.clear();
};
