import { describe, expect, it } from 'vitest';
import { createTranslator } from 'next-intl';
import en from '../../../messages/en.json';
import pt from '../../../messages/pt.json';

// The queue-message catalogue strings carry literal {proximo_horario},
// {weekday} and {time} placeholders that distribute.ts fills itself. ICU
// would read them as arguments, so they are quoted in the catalogue —
// this pins that they come out literal.
describe('distribution catalogue strings', () => {
  for (const [locale, messages] of [['en', en], ['pt', pt]] as const) {
    it(`keeps the placeholders literal (${locale})`, () => {
      const t = createTranslator({ locale, messages, namespace: 'Distribution' as never }) as unknown as (
        key: string,
      ) => string;
      expect(t('nextSlotPattern')).toContain('{weekday}');
      expect(t('nextSlotPattern')).toContain('{time}');
      expect(t('defaultQueueMessage')).toContain('{proximo_horario}');
    });
  }
});
