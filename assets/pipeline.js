// 工具链（Pipeline）：把上一步的产出直接交给下一个工具，中间结果不落盘
// 约定：CHAINS[工具 id] = [{ to, label, note? }]，to 为目标工具 id
export const CHAINS = {
  'image-compress': [
    { to: 'image-convert', label: '接着转格式' },
    { to: 'img-to-pdf', label: '合成 PDF' },
  ],
  'image-resize': [
    { to: 'image-compress', label: '再压缩体积' },
    { to: 'image-convert', label: '接着转格式' },
  ],
  'image-convert': [
    { to: 'img-to-pdf', label: '合成 PDF' },
    { to: 'image-compress', label: '再压缩体积' },
  ],
  'img-to-pdf': [{ to: 'pdf-merge', label: '与其他 PDF 合并' }],
  'pdf-merge': [
    { to: 'pdf-merge', label: '继续拆分/提取' },
    { to: 'img-to-pdf', label: '图片转 PDF' },
  ],
  'json-format': [{ to: 'csv-json', label: '转成 CSV' }],
  'csv-json': [{ to: 'json-format', label: '转成 JSON' }],
  'text-dedupe': [{ to: 'text-diff', label: '与另一版对比' }],
  'text-diff': [{ to: 'word-count', label: '统计字数' }],
  'base64-url': [{ to: 'sha256-hash', label: '算哈希' }],
  'qr-decode': [{ to: 'json-format', label: '格式化内容' }],
};

let HANDOFF = null;

export function setHandoff(payload) {
  HANDOFF = payload || null;
}

export function takeHandoff() {
  const h = HANDOFF;
  HANDOFF = null;
  return h;
}

export function peekHandoff() {
  return HANDOFF;
}
