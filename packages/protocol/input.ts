export function composerKey(key: string, shift: boolean, composing: boolean, keyCode = 0, sinceCompositionEnd = Infinity): 'send' | 'release' | 'none' {
  if (composing || keyCode === 229) return 'none';
  if (key === 'Escape') return 'release';
  if (key === 'Enter' && !shift && sinceCompositionEnd > 80) return 'send';
  return 'none';
}
export function validLocalText(value: string): boolean { return value.trim().length > 0 && Array.from(value.trim()).length <= 120 && new TextEncoder().encode(value).byteLength <= 512; }
