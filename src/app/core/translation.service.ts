import { Injectable } from '@angular/core';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { TranslationResult } from './models';

@Injectable({ providedIn: 'root' })
export class TranslationService {
  async translate(text: string, source: string, target: string): Promise<TranslationResult> {
    const trimmed = text.trim();
    if (!trimmed) return { text: '', detectedLanguage: source };
    if (window.wlsaplus) {
      try {
        return await window.wlsaplus.translator.translate(trimmed, source, target);
      } catch {
        return this.translateWithMyMemory(trimmed, source, target);
      }
    }

    if (Capacitor.isNativePlatform()) {
      try {
        const response = await CapacitorHttp.get({ url: this.googleUrl(trimmed, source, target), responseType: 'json' });
        if (response.status !== 200) throw new Error('Google Translate is unavailable.');
        return this.parseGoogle(response.data, source);
      } catch {
        return this.translateWithMyMemory(trimmed, source, target);
      }
    }
    return this.translateWithMyMemory(trimmed, source, target);
  }

  captureRegion(): Promise<string | null> {
    if (!window.wlsaplus || window.wlsaplus.platform.os !== 'windows') {
      return Promise.reject(new Error('Screen translation is available on Windows only.'));
    }
    return window.wlsaplus.translator.captureRegion();
  }

  private googleUrl(text: string, source: string, target: string): string {
    const params = new URLSearchParams({ client: 'gtx', sl: source, tl: target, dt: 't', q: text });
    return `https://translate.googleapis.com/translate_a/single?${params}`;
  }

  private async translateWithMyMemory(text: string, source: string, target: string): Promise<TranslationResult> {
    const chunks = this.splitTextByBytes(text, 450);
    const translations: string[] = [];
    let detectedLanguage = source;

    for (const chunk of chunks) {
      const params = new URLSearchParams({
        q: chunk,
        langpair: `${source === 'auto' ? 'Autodetect' : source}|${target}`,
      });
      const url = `https://api.mymemory.translated.net/get?${params}`;
      const response = Capacitor.isNativePlatform()
        ? await CapacitorHttp.get({ url, responseType: 'json' })
        : await fetch(url);
      const ok = 'ok' in response ? response.ok : response.status === 200;
      if (!ok) throw new Error('Translation service is unavailable. Please try again later.');
      const data = 'json' in response ? await response.json() : response.data;
      const parsed = this.parseMyMemory(data, source);
      translations.push(parsed.text);
      if (detectedLanguage === 'auto' && parsed.detectedLanguage !== 'auto') detectedLanguage = parsed.detectedLanguage;
    }

    return { text: translations.join(''), detectedLanguage };
  }

  private splitTextByBytes(text: string, maximumBytes: number): string[] {
    const chunks: string[] = [];
    const encoder = new TextEncoder();
    let chunk = '';
    let chunkBytes = 0;
    for (const character of text) {
      const characterBytes = encoder.encode(character).length;
      if (chunk && chunkBytes + characterBytes > maximumBytes) {
        chunks.push(chunk);
        chunk = '';
        chunkBytes = 0;
      }
      chunk += character;
      chunkBytes += characterBytes;
    }
    if (chunk) chunks.push(chunk);
    return chunks;
  }

  private parseGoogle(value: unknown, fallbackLanguage: string): TranslationResult {
    if (!Array.isArray(value) || !Array.isArray(value[0])) throw new Error('The translation response was invalid.');
    const text = value[0].map((part) => Array.isArray(part) ? String(part[0] ?? '') : '').join('');
    return { text, detectedLanguage: typeof value[2] === 'string' ? value[2] : fallbackLanguage };
  }

  private parseMyMemory(value: unknown, fallbackLanguage: string): TranslationResult {
    if (!value || typeof value !== 'object') throw new Error('The translation response was invalid.');
    const response = value as { responseData?: { translatedText?: unknown; detectedLanguage?: unknown }; responseStatus?: unknown; responseDetails?: unknown };
    if (response.responseStatus !== 200 || typeof response.responseData?.translatedText !== 'string') {
      const detail = typeof response.responseDetails === 'string' && response.responseDetails.trim()
        ? response.responseDetails
        : 'Translation service is unavailable. Please try again later.';
      throw new Error(detail);
    }
    return {
      text: response.responseData.translatedText,
      detectedLanguage: typeof response.responseData.detectedLanguage === 'string'
        ? response.responseData.detectedLanguage
        : fallbackLanguage,
    };
  }
}
