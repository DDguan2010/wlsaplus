import { TranslationService } from './translation.service';

describe('TranslationService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the CORS-compatible translation provider in a browser', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        responseStatus: 200,
        responseData: { translatedText: 'Bonjour', detectedLanguage: 'en' },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new TranslationService().translate('Hello', 'auto', 'fr');

    expect(result).toEqual({ text: 'Bonjour', detectedLanguage: 'en' });
    expect(String(fetchMock.mock.calls[0][0])).toContain('api.mymemory.translated.net/get');
    expect(String(fetchMock.mock.calls[0][0])).toContain('langpair=Autodetect%7Cfr');
  });

  it('surfaces provider errors instead of returning an empty result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ responseStatus: 403, responseDetails: 'Daily limit reached' }),
    }));

    await expect(new TranslationService().translate('Hello', 'en', 'fr')).rejects.toThrow('Daily limit reached');
  });

  it('splits long Unicode text without dropping any translated chunks', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const sourceText = new URL(url).searchParams.get('q') ?? '';
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ responseStatus: 200, responseData: { translatedText: sourceText } }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const input = '你'.repeat(200);

    const result = await new TranslationService().translate(input, 'zh-CN', 'en');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.text).toBe(input);
  });
});
