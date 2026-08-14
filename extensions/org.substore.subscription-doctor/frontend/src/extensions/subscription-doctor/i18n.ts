import { useI18n as useHostI18n } from '@/extensions/frontend-sdk-v1';
import en from './locales/en.json';
import ru from './locales/ru.json';
import zh from './locales/zh.json';

const messages = { zh, en, ru } as const;
type Locale = keyof typeof messages;
type Composer = ReturnType<typeof useHostI18n>;
const composers = new Set<Composer>();

const withoutMessages = (current: Record<string, any>) => {
  const next = { ...current };
  delete next.subscriptionDoctor;
  if (current.navBar?.pagesTitle) {
    const pagesTitle = { ...current.navBar.pagesTitle };
    delete pagesTitle.subscriptionDoctor;
    next.navBar = { ...current.navBar, pagesTitle };
  }
  return next;
};

export const installSubscriptionDoctorMessages = (composer: Composer) => {
  if (composers.has(composer)) return;
  for (const locale of Object.keys(messages) as Locale[]) {
    composer.mergeLocaleMessage(locale, messages[locale]);
  }
  composers.add(composer);
};

export const useSubscriptionDoctorI18n = () => {
  const composer = useHostI18n({ useScope: 'global' });
  installSubscriptionDoctorMessages(composer);
  return composer;
};

export const disposeSubscriptionDoctorMessages = () => {
  for (const composer of composers) {
    for (const locale of Object.keys(messages) as Locale[]) {
      composer.setLocaleMessage(
        locale,
        withoutMessages(composer.getLocaleMessage(locale) as Record<string, any>),
      );
    }
  }
  composers.clear();
};

