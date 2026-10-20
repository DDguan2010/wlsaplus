import { Injectable, Pipe, PipeTransform, computed, inject } from '@angular/core';
import { formatDate, registerLocaleData } from '@angular/common';
import zh from '@angular/common/locales/zh';
import { LocalStore } from './local-store.service';
import { ZH_CN } from './i18n.messages';
import type { AppLanguage } from './models';

registerLocaleData(zh, 'zh-CN');

export type MessageParams = Readonly<Record<string, string | number | null | undefined>>;

// Only recognize these app-owned native status formats, never arbitrary placeholders
// or user content. Keep variable parts (versions, device names, etc.) unchanged.
const STATUS_MESSAGES = [
  { pattern: /^PowerSchool returned HTTP (?<status>\d{3})\.$/, template: 'PowerSchool returned HTTP {status}.' },
  { pattern: /^WLSAPlus (?<version>\d[\w.+-]*) is available\.$/, template: 'WLSAPlus {version} is available.' },
  { pattern: /^WLSAPlus (?<version>\d[\w.+-]*) is ready to install\.$/, template: 'WLSAPlus {version} is ready to install.' },
  { pattern: /^Downloading WLSAPlus (?<version>\d[\w.+-]*)\.\.\.$/, template: 'Downloading WLSAPlus {version}...' },
  { pattern: /^Downloading update: (?<percent>\d+(?:\.\d+)?)%$/, template: 'Downloading update: {percent}%' },
  { pattern: /^Full device protected by (?<source>[^\r\n]+)$/, template: 'Full device protected by {source}' },
  { pattern: /^Web traffic protected by (?<source>[^\r\n]+)$/, template: 'Web traffic protected by {source}' },
  { pattern: /^Connecting (?<source>[^\r\n]+) full-device tunnel\.\.\.$/, template: 'Connecting {source} full-device tunnel...' },
  { pattern: /^Connecting to (?<device>[^\r\n]+) over Wi-Fi\.\.\.$/, template: 'Connecting to {device} over Wi-Fi...' },
  { pattern: /^Connecting to (?<source>[^\r\n]+)\.\.\.$/, template: 'Connecting to {source}...' },
  { pattern: /^(?<source>[^\r\n]+) opened in your VPN client\.$/, template: '{source} opened in your VPN client.' },
  { pattern: /^Reconnecting to (?<device>[^\r\n]+)\.\.\.$/, template: 'Reconnecting to {device}...' },
];

/** Translate app-owned labels only; user and PowerSchool content stays untouched. */
export function translateMessage(language: AppLanguage, message: string, params: MessageParams = {}): string {
  let translated = message;
  if (language === 'zh-CN') {
    if (Object.hasOwn(ZH_CN, message)) translated = ZH_CN[message];
    else {
      for (const { pattern, template } of STATUS_MESSAGES) {
        const match = message.match(pattern);
        if (!match) continue;
        translated = ZH_CN[template];
        params = { ...match.groups, ...params };
        break;
      }
    }
  }
  return translated.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
    Object.hasOwn(params, key) ? String(params[key] ?? '') : placeholder);
}

@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly store = inject(LocalStore);
  readonly language = computed(() => this.store.settings().language);
  readonly locale = computed(() => this.language() === 'zh-CN' ? 'zh-CN' : 'en-US');

  t(message: string | null | undefined, params?: MessageParams): string {
    return translateMessage(this.language(), message ?? '', params);
  }
}

// Impure so a saved language change also refreshes unchanged labels and open dialogs.
@Pipe({ name: 't', pure: false })
export class TranslatePipe implements PipeTransform {
  private readonly i18n = inject(I18nService);
  transform(message: string | null | undefined, params?: MessageParams): string {
    return this.i18n.t(message, params);
  }
}

@Pipe({ name: 'appDate', pure: false })
export class LocalizedDatePipe implements PipeTransform {
  private readonly i18n = inject(I18nService);
  transform(value: string | number | Date | null | undefined, format = 'mediumDate', timezone?: string): string | null {
    if (value === null || value === undefined || value === '') return null;
    const localizedFormats: Record<string, string> = {
      'EEEE, MMMM d': 'M月d日 EEEE', 'MMM d, HH:mm': 'M月d日 HH:mm',
      'EEE, MMM d': 'M月d日 EEE', 'MMMM d': 'M月d日', 'MMM d': 'M月d日',
      'EEE, MMM d · HH:mm': 'M月d日 EEE · HH:mm', 'MMM d · HH:mm': 'M月d日 · HH:mm',
    };
    const pattern = this.i18n.language() === 'zh-CN' ? localizedFormats[format] ?? format : format;
    return formatDate(value, pattern, this.i18n.locale(), timezone);
  }
}
