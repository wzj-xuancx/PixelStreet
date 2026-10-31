import fs from 'node:fs';
import path from 'node:path';
import { defaults, isRecord, parseSettings, readSettings, type Settings } from '../../packages/protocol';
export class SettingsStore {
  readonly file: string;
  value: Settings = { ...defaults };
  warnings: string[] = [];
  private lastGood: string | null = null;
  constructor(folder: string) {
    fs.mkdirSync(folder, { recursive: true });
    this.file = path.join(folder, 'settings.json');
    for (const [file, backup] of [[this.file, false], [this.file + '.bak', true]] as const) {
      if (!fs.existsSync(file)) continue;
      try {
        if (fs.statSync(file).size > 32768) throw new Error('文件超过 32 KiB');
        const text = fs.readFileSync(file, 'utf8');
        const raw = JSON.parse(text);
        this.value = readSettings(raw); this.lastGood = JSON.stringify(this.value, null, 2);
        if (raw.version < 4) this.warnings.push(`已兼容 v${raw.version} 设置：移除旧快捷键，高度映射为${this.value.height} DIP档位；保存后升级为v4，读取时保留原文件。`);
        if (backup) this.warnings.push('主配置无效，已从上一份有效备份恢复；原文件保留。');
        return;
      } catch { this.warnings.push(`${backup ? '备份' : '主'}配置无法读取或版本不支持；原文件保留。`); }
    }
  }
  save(input: unknown): Settings {
    const value = parseSettings(input), text = JSON.stringify(value, null, 2) + '\n';
    const tmp = this.file + `.tmp-${process.pid}`;
    try {
      if (this.lastGood !== null) {
        fs.writeFileSync(tmp, this.lastGood + '\n', { mode: 0o600 });
        fs.renameSync(tmp, this.file + '.bak');
      }
      fs.writeFileSync(tmp, text, { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch (error) { try { fs.unlinkSync(tmp); } catch {} throw error; }
    this.value = value; this.lastGood = text.trimEnd(); return value;
  }
  export(): string { return JSON.stringify({ schema: 'pixel-street-settings', version: 1, settings: this.value }, null, 2); }
  import(text: unknown): Settings {
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 32768) throw new Error('配置文本过大或无效。');
    const value = JSON.parse(text);
    if (!isRecord(value) || Object.keys(value).length !== 3 || value.schema !== 'pixel-street-settings' || value.version !== 1) throw new Error('只接受 PixelStreet v1 设置备份。');
    return this.save(readSettings(value.settings));
  }
}
