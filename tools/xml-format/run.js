// 工具：XML 格式化（美化 / 压缩 / 合法性校验，纯浏览器执行）
//
// 为什么自己写 tokenizer 而不用浏览器的 DOMParser：
// DOMParser 只回一句「This page contains the following errors」，行号藏在解析器内部，
// 拿不到稳定的位置；而「非法 XML 指出行号」是这个工具的主要用处。自己扫一遍，
// 每个错误都能落在具体的行上。
//
// 两条保守策略：
// · 混合内容（同一元素里既有文字又有子元素）不重排——重排会改变文字之间的空白，
//   而空白在 XML 里是有意义的。这类元素原样输出，只在外面缩进。
// · 压缩只删元素之间的空白节点，不压缩文字内部的空格，理由同上。
const NAME_RE = /[A-Za-z_:][\w.:-]*/y;

export const manifest = {
  usage:
    '把压缩成一行的 XML 排版成有缩进的样子，或者反过来压成一行；解析失败时给出行号与原因。美化会重排元素之间的空白，混合内容（元素里既有文字又有子元素）保持原样不动。',
  tips: [
    '报错会指出第几行、什么原因（标签没闭合、闭合标签对不上、属性少了引号）',
    '混合内容不重排：<p>文字<b>粗</b>文字</p> 这种元素保持原样，避免改动文字间的空白',
    '压缩只删元素之间的空白，不压缩文字内部的空格——那会改变内容',
    '不校验 DTD、命名空间与自定义实体，只做「标签是否合法闭合」这一层',
  ],
  scenarios: [
    { scene: '接口返回一整行 XML 看不清结构', how: '粘贴 → 选「美化」、2 空格', result: '层级一眼可见，能定位到具体节点' },
    { scene: '要往请求体里塞最省的 XML', how: '选「压缩」', result: '去掉元素间换行与缩进，文本内容不变' },
    { scene: '改了配置后解析报错', how: '粘贴 → 看第几行、什么原因', result: '直接跳到出错的那一行改' },
  ],
  inputs: [
    { name: 'xml', label: 'XML 内容', type: 'textarea', placeholder: '<?xml version="1.0"?><root><item id="1">value</item></root>' },
    {
      name: 'mode',
      label: '处理方式',
      type: 'select',
      options: [
        { value: 'pretty', label: '美化' },
        { value: 'minify', label: '压缩' },
      ],
    },
    {
      name: 'indent',
      label: '缩进（美化时有效）',
      type: 'select',
      options: [
        { value: '2', label: '2 空格' },
        { value: '4', label: '4 空格' },
      ],
    },
  ],
  runLabel: '处理',
};

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

class XmlError extends Error {
  constructor(line, message) {
    super(message);
    this.line = line;
  }
}

function parse(src) {
  let i = 0;
  let line = 1;
  const root = { type: 'root', children: [] };
  const stack = [root];

  const advance = (n) => {
    for (let k = 0; k < n && i < src.length; k++) {
      if (src[i] === '\n') line++;
      i++;
    }
  };
  const top = () => stack[stack.length - 1];

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      top().children.push({ type: 'text', value: src.slice(i), line });
      i = src.length;
      break;
    }
    if (lt > i) {
      const text = src.slice(i, lt);
      top().children.push({ type: 'text', value: text, line });
      advance(lt - i);
      continue;
    }
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      if (end < 0) throw new XmlError(line, '注释没有闭合：找不到 -->');
      const startLine = line;
      const value = src.slice(i, end + 3);
      top().children.push({ type: 'raw', value, line: startLine });
      advance(end + 3 - i);
      continue;
    }
    if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i + 9);
      if (end < 0) throw new XmlError(line, 'CDATA 段没有闭合：找不到 ]]>');
      const startLine = line;
      const value = src.slice(i, end + 3);
      top().children.push({ type: 'raw', value, line: startLine });
      advance(end + 3 - i);
      continue;
    }
    if (/^<!DOCTYPE/i.test(src.slice(i, i + 9))) {
      let depth = 0;
      let j = i;
      for (; j < src.length; j++) {
        if (src[j] === '[') depth++;
        else if (src[j] === ']') depth--;
        else if (src[j] === '>' && depth <= 0) break;
      }
      if (j >= src.length) throw new XmlError(line, 'DOCTYPE 没有闭合');
      const startLine = line;
      const value = src.slice(i, j + 1);
      top().children.push({ type: 'raw', value, line: startLine });
      advance(j + 1 - i);
      continue;
    }
    if (src.startsWith('<?', i)) {
      const end = src.indexOf('?>', i + 2);
      if (end < 0) throw new XmlError(line, '处理指令没有闭合：找不到 ?>');
      const startLine = line;
      const value = src.slice(i, end + 2);
      top().children.push({ type: 'raw', value, line: startLine });
      advance(end + 2 - i);
      continue;
    }
    if (src.startsWith('</', i)) {
      const end = src.indexOf('>', i + 2);
      if (end < 0) throw new XmlError(line, '闭合标签没有写完：找不到 >');
      const name = src.slice(i + 2, end).trim();
      if (!/^[A-Za-z_:][\w.:-]*$/.test(name)) throw new XmlError(line, `闭合标签 </${name}> 的名字不合法`);
      const node = top();
      if (node.type === 'root') throw new XmlError(line, `多出来的闭合标签 </${name}>：它前面没有对应的开始标签`);
      if (node.name !== name) {
        throw new XmlError(line, `闭合标签 </${name}> 与第 ${node.line} 行开始的 <${node.name}> 对不上`);
      }
      stack.pop();
      advance(end + 1 - i);
      continue;
    }

    // 开始标签
    const startLine = line;
    let j = i + 1;
    NAME_RE.lastIndex = j;
    const m = NAME_RE.exec(src);
    if (!m) throw new XmlError(line, '标签名不合法：< 后面要跟字母、下划线或冒号');
    const name = m[0];
    j = NAME_RE.lastIndex;
    let attrsRaw = '';
    let selfClose = false;
    let closed = false;
    while (j < src.length) {
      while (j < src.length && /\s/.test(src[j])) j++;
      if (src[j] === '>') {
        j++;
        closed = true;
        break;
      }
      if (src[j] === '/' && src[j + 1] === '>') {
        selfClose = true;
        closed = true;
        j += 2;
        break;
      }
      const attrStart = j;
      const am = /[A-Za-z_:][\w.:-]*/.exec(src.slice(j, j + 200));
      if (!am) throw new XmlError(line, `标签 <${name}> 的属性写法有问题：这里期待一个属性名或 >`);
      j += am[0].length;
      while (j < src.length && /\s/.test(src[j])) j++;
      if (src[j] !== '=') throw new XmlError(line, `属性 ${am[0]} 后面缺少 = 号`);
      j++;
      while (j < src.length && /\s/.test(src[j])) j++;
      const quote = src[j];
      if (quote !== '"' && quote !== "'") throw new XmlError(line, `属性 ${am[0]} 的值要用引号包起来`);
      const close = src.indexOf(quote, j + 1);
      if (close < 0) throw new XmlError(line, `属性 ${am[0]} 的引号没有闭合`);
      j = close + 1;
      attrsRaw += (attrsRaw ? ' ' : '') + src.slice(attrStart, j);
    }
    if (!closed) throw new XmlError(startLine, `标签 <${name}> 没有写完：找不到 >`);
    const node = { type: 'elem', name, attrsRaw, selfClose, children: [], line: startLine };
    top().children.push(node);
    if (!selfClose) stack.push(node);
    advance(j - i);
  }

  if (stack.length > 1) {
    const open = stack[stack.length - 1];
    throw new XmlError(open.line, `<${open.name}> 没有闭合：一直到文件结尾都没等到 </${open.name}>`);
  }
  const elems = root.children.filter((c) => c.type === 'elem');
  if (!elems.length) throw new XmlError(1, '这段内容里没有 XML 元素');
  const strayText = root.children.find((c) => c.type === 'text' && c.value.trim());
  if (strayText) throw new XmlError(strayText.line, '元素外面出现了文字：XML 只允许一个根元素，文本必须写在元素内');
  if (elems.length > 1) throw new XmlError(elems[1].line, `出现第二个根元素 <${elems[1].name}>：XML 只能有一个根元素`);
  return root;
}

function hasElemChild(node) {
  return node.children.some((c) => c.type === 'elem');
}
function hasSignificantText(node) {
  return node.children.some((c) => c.type === 'text' && c.value.trim());
}

function renderPretty(nodes, depth, pad) {
  const ind = pad.repeat(depth);
  const out = [];
  for (const node of nodes) {
    if (node.type === 'text') {
      const t = node.value.trim();
      if (t) out.push(ind + t);
      continue;
    }
    if (node.type === 'raw') {
      out.push(ind + node.value);
      continue;
    }
    const open = `<${node.name}${node.attrsRaw ? ' ' + node.attrsRaw : ''}`;
    if (node.selfClose) {
      out.push(`${ind}${open}/>`);
      continue;
    }
    const kids = node.children.filter((c) => !(c.type === 'text' && !c.value.trim()));
    if (!kids.length) {
      out.push(`${ind}${open}></${node.name}>`);
      continue;
    }
    // 混合内容：保持原样，不重排（重排会改掉文字之间的空白）
    if (hasElemChild(node) && hasSignificantText(node)) {
      const inner = node.children.map((c) => (c.type === 'text' ? c.value : c.value || renderInline(c))).join('');
      out.push(`${ind}${open}>${inner}</${node.name}>`);
      continue;
    }
    if (!hasElemChild(node)) {
      const inner = node.children.map((c) => (c.type === 'text' ? c.value : c.value)).join('');
      out.push(`${ind}${open}>${inner}</${node.name}>`);
      continue;
    }
    out.push(`${ind}${open}>`);
    out.push(renderPretty(node.children, depth + 1, pad));
    out.push(`${ind}</${node.name}>`);
  }
  return out.join('\n');
}

function renderInline(node) {
  if (node.type === 'raw') return node.value;
  if (node.type === 'text') return node.value;
  const open = `<${node.name}${node.attrsRaw ? ' ' + node.attrsRaw : ''}`;
  if (node.selfClose) return `${open}/>`;
  return `${open}>${node.children.map(renderInline).join('')}</${node.name}>`;
}

function renderMinify(nodes) {
  return nodes.map(renderMinifyNode).join('');
}

function renderMinifyNode(node) {
  if (node.type === 'text') return node.value.trim() ? node.value : '';
  if (node.type === 'raw') return node.value;
  const open = `<${node.name}${node.attrsRaw ? ' ' + node.attrsRaw : ''}`;
  if (node.selfClose) return `${open}/>`;
  return `${open}>${renderMinify(node.children)}</${node.name}>`;
}

export async function run({ xml, mode, indent }) {
  const src = String(xml || '');
  if (!src.trim()) throw new Error('请先粘贴 XML 内容');
  const pretty = mode !== 'minify';
  const pad = indent === '4' ? '    ' : '  ';

  let tree;
  try {
    tree = parse(src);
  } catch (e) {
    if (e instanceof XmlError) throw new Error(`第 ${e.line} 行：${e.message}`);
    throw e;
  }

  const out = pretty ? renderPretty(tree.children, 0, pad) : renderMinify(tree.children);
  const before = src.length;
  const after = out.length;
  const delta = after - before;
  const deltaText = pretty
    ? `美化后 ${after.toLocaleString('zh-CN')} 字符（多出 ${delta.toLocaleString('zh-CN')}，都是缩进与换行）`
    : `压缩后 ${after.toLocaleString('zh-CN')} 字符（省了 ${Math.abs(delta).toLocaleString('zh-CN')}，约 ${before ? Math.round((Math.abs(delta) / before) * 100) : 0}%）`;

  return {
    html: `<div class="msg-ok">✅ XML 合法 · ${deltaText}</div>
      <textarea readonly rows="14" style="width:100%;margin-top:10px;font-family:var(--mono);font-size:12.5px;line-height:1.6">${esc(out)}</textarea>
      <p style="margin-top:10px;color:var(--muted);font-size:13px">只做标签闭合这一层校验：不校验 DTD、命名空间与自定义实体。混合内容（元素里同时有文字与子元素）保持原样，不重排。</p>`,
    text: out,
  };
}
