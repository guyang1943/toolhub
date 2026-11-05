// 工具：HTTP 状态码速查（纯浏览器执行）
//
// 一份手写的数据表 + 一个模糊搜索。之所以不做「输入码 → 只显示一条」，是因为实际排查时
// 人往往手里只有一个现象（「网关超时」「传不上去」），需要反查可能是哪几个码。
// 每条都带「常见场景」与「往哪查」，因为知道 504 叫网关超时并不解决问题。
const GROUP_NAME = { 1: '信息响应', 2: '成功', 3: '重定向', 4: '客户端错误', 5: '服务端错误' };

const CODES = [
  { c: 100, n: 'Continue', g: 1, m: '服务器已收到请求头，等客户端继续发请求体。', s: '客户端带 Expect: 100-continue 试探服务器要不要收这个大请求体。', f: '正常流程，不用处理；如果客户端一直卡在等 100，检查中间代理是否把 100 响应吞了。' },
  { c: 101, n: 'Switching Protocols', g: 1, m: '服务器同意切换协议，之后这条连接不再走 HTTP。', s: 'ws:// 握手成功：升级之后这条连接不再走 HTTP。', f: '连不上长连接时，先看反向代理有没有透传 Upgrade 与 Connection 这两个头。' },
  { c: 102, n: 'Processing', g: 1, m: '请求已收到，正在处理，暂时没有结果。', s: 'WebDAV 里的长任务占位。', f: '少见；如果客户端把 102 当最终结果，说明它没按 WebDAV 规范实现。' },
  { c: 103, n: 'Early Hints', g: 1, m: '最终响应之前，先把要预加载的资源提示给浏览器。', s: '配合 Link 头提前加载 CSS/字体，减少首屏等待。', f: '浏览器兼容性有限，别把它当关键路径；看不到效果先查 CDN 是否支持。' },

  { c: 200, n: 'OK', g: 2, m: '请求成功，响应体里是结果。', s: '最常见的成功响应。', f: '如果业务上说「没成功」，那问题在响应体里，不在状态码——去看返回的 code/message 字段。' },
  { c: 201, n: 'Created', g: 2, m: '资源创建成功，通常在 Location 头里给出新资源的地址。', s: 'POST 新建用户、新建订单。', f: '前端拿不到新资源 id 时，看 Location 头有没有被网关丢掉。' },
  { c: 202, n: 'Accepted', g: 2, m: '请求已接受，但还没处理完，结果要另查。', s: '异步任务、批量导入、转码排队。', f: '别把它当成功；要么轮询任务接口，要么看回调。' },
  { c: 203, n: 'Non-Authoritative Information', g: 2, m: '返回的是经过代理改写的副本，不是源站原文。', s: '老式代理转换内容。', f: '内容与你预期不一致时，先确认中间有没有转换代理。' },
  { c: 204, n: 'No Content', g: 2, m: '成功，但没有响应体。', s: 'DELETE 成功、PUT 更新成功但无需回传。', f: '前端报「解析 JSON 失败」多半是这里：204 没有 body，不要对它调 json()。' },
  { c: 205, n: 'Reset Content', g: 2, m: '成功，并要求客户端重置表单或视图。', s: '提交表单后清空输入。', f: '现代前端多自己清，含义接近 204。' },
  { c: 206, n: 'Partial Content', g: 2, m: '只返回了资源的一部分，配合 Range 请求。', s: '视频拖动进度、断点续传。', f: '下载文件损坏时，检查 Range 与 Content-Range 是否对得上。' },
  { c: 207, n: 'Multi-Status', g: 2, m: '一次请求里有多个子操作，各自结果不同。', s: 'WebDAV 批量操作。', f: '响应体里是 XML，要看每个子项的状态，别只看 207。' },
  { c: 208, n: 'Already Reported', g: 2, m: '同一批绑定里的重复项已报告过，不再重复。', s: 'WebDAV 批量查询。', f: '把 208 当「跳过」处理即可。' },
  { c: 226, n: 'IM Used', g: 2, m: '返回的是基于增量编码的结果。', s: 'Delta 编码压缩传输。', f: '少见；客户端不支持就别用增量编码。' },

  { c: 300, n: 'Multiple Choices', g: 3, m: '同一个地址对应多个可选资源。', s: '内容协商、多语言版本。', f: '很少主动返回；真遇到就看响应体里的候选列表。' },
  { c: 301, n: 'Moved Permanently', g: 3, m: '资源永久换地址，后续请求都该用新地址。', s: '换域名、http 跳 https。', f: '浏览器会缓存 301，改回来很难生效——调试期先用 302，确认稳定再换 301。' },
  { c: 302, n: 'Found', g: 3, m: '临时换地址，下次还请求旧地址。', s: '登录后跳回原页面。', f: 'POST 遇到 302 常被改成 GET，需要保住方法就改用 307。' },
  { c: 303, n: 'See Other', g: 3, m: '去另一个地址用 GET 取结果。', s: '表单提交成功后跳转到结果页。', f: '这是「POST 后跳 GET」的标准做法，比 302 语义清楚。' },
  { c: 304, n: 'Not Modified', g: 3, m: '资源没变，用你本地的缓存。', s: '带 If-None-Match / If-Modified-Since 的缓存校验。', f: '页面发白或样式错乱时先想它：304 没有 body，强制刷新（Ctrl+F5）能验证。' },
  { c: 305, n: 'Use Proxy', g: 3, m: '必须通过指定代理访问。', s: '历史遗留。', f: '已废弃，别用。' },
  { c: 307, n: 'Temporary Redirect', g: 3, m: '临时换地址，且要求保持原请求方法。', s: 'POST 临时迁移到新接口。', f: '跨域 307 时浏览器会把预检重发一遍，注意 CORS 配置。' },
  { c: 308, n: 'Permanent Redirect', g: 3, m: '永久换地址，且保持原请求方法。', s: '接口整体迁移后保留旧路径。', f: '和 301 一样会被缓存，但不会把 POST 变成 GET。' },

  { c: 400, n: 'Bad Request', g: 4, m: '请求本身有问题，服务器看不懂。', s: 'JSON 格式错、必填参数缺失、参数类型不对。', f: '先看响应体的报错字段；用同一个请求在本地复现一次，多半是序列化或编码问题。' },
  { c: 401, n: 'Unauthorized', g: 4, m: '没有身份凭证，或者凭证无效/过期。', s: 'Token 过期、没带 Authorization 头。', f: '看 WWW-Authenticate 头判断认证方式；注意它和 403 不是一回事——401 是「你是谁不清楚」，403 是「知道你是谁但不许」。' },
  { c: 402, n: 'Payment Required', g: 4, m: '需要付费才能访问。', s: '保留状态码，少数 API 拿来标记额度用尽。', f: '遇到它先查账户余额与配额。' },
  { c: 403, n: 'Forbidden', g: 4, m: '身份已知，但没有权限访问这个资源。', s: '越权访问、IP 被拉黑、目录禁止列出。', f: '先确认当前账号的角色与资源归属；nginx 的 403 常是目录没有 index 且禁止列目录。' },
  { c: 404, n: 'Not Found', g: 4, m: '资源不存在，或者服务器不愿意说它存在。', s: '路径拼错、路由没注册、文件被删。', f: '先确认路径与方法；SPA 部署后刷新 404 是服务器没配 fallback，把未匹配路径交给 index.html。' },
  { c: 405, n: 'Method Not Allowed', g: 4, m: '路径存在，但不支持这个 HTTP 方法。', s: '用 GET 调了只收 POST 的接口。', f: '看响应里的 Allow 头，它会列出真正支持的方法。' },
  { c: 406, n: 'Not Acceptable', g: 4, m: '服务端生成不出客户端 Accept 要求的格式。', s: '只接受 application/xml，但服务端只会回 JSON。', f: '放宽 Accept 头，或让服务端补上对应的序列化。' },
  { c: 407, n: 'Proxy Authentication Required', g: 4, m: '需要先向代理完成认证。', s: '公司内网代理。', f: '和 401 类似，只是认证对象是代理；检查 Proxy-Authorization。' },
  { c: 408, n: 'Request Timeout', g: 4, m: '服务器等客户端把请求发完，等超时了。', s: '网络差、上传大文件时卡住。', f: '这是「客户端发得太慢」的超时，和 504 不同（504 是上游回得太慢）。先看上传体积与网络，再看服务端的 client_header_timeout。' },
  { c: 409, n: 'Conflict', g: 4, m: '请求与资源当前状态冲突。', s: '并发编辑同一条记录、重复创建唯一键。', f: '重试前先重新拉一次最新数据；或用 If-Match 做乐观锁。' },
  { c: 410, n: 'Gone', g: 4, m: '资源曾经存在，现在永久没了。', s: '删除的订单、下架的页面。', f: '和 404 的区别是「确定不会回来」，搜索引擎会更快清理索引。' },
  { c: 411, n: 'Length Required', g: 4, m: '请求没带 Content-Length，服务端不接受。', s: '手工拼的请求、部分代理改写后丢了头。', f: '补上 Content-Length；分块传输时用 Transfer-Encoding: chunked。' },
  { c: 412, n: 'Precondition Failed', g: 4, m: 'If-Match / If-Unmodified-Since 等前置条件不成立。', s: '乐观锁更新时数据已被别人改过。', f: '这是保护机制在生效：重新读取最新数据再提交。' },
  { c: 413, n: 'Payload Too Large', g: 4, m: '请求体超过服务端允许的大小。', s: '上传大图、批量导入。', f: '调大 nginx 的 client_max_body_size 或应用层上限；前端也可以先压再传。' },
  { c: 414, n: 'URI Too Long', g: 4, m: '请求地址太长。', s: '把大量参数塞进 query。', f: '改用 POST + 请求体；GET 的 URL 各层限制通常在 2–8KB。' },
  { c: 415, n: 'Unsupported Media Type', g: 4, m: '请求体的格式服务端不支持。', s: '忘写 Content-Type，或写成了 text/plain。', f: '补上正确的 Content-Type（JSON 要 application/json），并确认没有多余的空格或大小写问题。' },
  { c: 416, n: 'Range Not Satisfiable', g: 4, m: '请求的字节范围超出文件大小。', s: '断点续传时本地记录的文件大小与服务端不一致。', f: '清掉续传缓存重新下载；服务端该回 Content-Range: bytes */总长度。' },
  { c: 417, n: 'Expectation Failed', g: 4, m: 'Expect 头里的期望无法满足。', s: '老客户端发 Expect: 100-continue 而中间设备不认。', f: '去掉 Expect 头，或让代理支持它。' },
  { c: 418, n: "I'm a teapot", g: 4, m: '彩蛋状态码，来自 1998 年的愚人节 RFC。', s: '有些服务拿它当反爬或拦截标记。', f: '正经业务别用它；被返回 418 时先怀疑反爬策略。' },
  { c: 421, n: 'Misdirected Request', g: 4, m: '请求被发到了不能处理它的服务器。', s: 'HTTP/2 连接复用 + 多个域名 + 证书不匹配。', f: '关闭连接复用，或让证书覆盖所有复用域名（SAN）。' },
  { c: 422, n: 'Unprocessable Content', g: 4, m: '格式合法，但语义校验不通过。', s: '字段类型对但值不合法（如年龄 200）、FastAPI 的校验失败。', f: '看响应体里逐字段的错误；这类错误通常是业务校验，不是协议问题。' },
  { c: 423, n: 'Locked', g: 4, m: '资源被锁住了。', s: 'WebDAV 编辑锁。', f: '等锁释放或解开锁再操作。' },
  { c: 424, n: 'Failed Dependency', g: 4, m: '因为前一个操作失败，这个操作也没做。', s: 'WebDAV 批量事务。', f: '顺着响应里的子项找到最先失败的那一步。' },
  { c: 425, n: 'Too Early', g: 4, m: '担心重放攻击，拒绝处理过早到达的数据。', s: 'TLS 1.3 的 0-RTT 早期数据。', f: '禁用 0-RTT，或让服务端接受重放风险。' },
  { c: 426, n: 'Upgrade Required', g: 4, m: '必须升级协议才能继续。', s: '要求改用 HTTP/2 或 TLS。', f: '看 Upgrade 头要求什么；服务端开对应协议即可。' },
  { c: 428, n: 'Precondition Required', g: 4, m: '服务端要求带上前置条件头，防并发覆盖。', s: '更新接口强制要求 If-Match。', f: '先 GET 拿到 ETag，再带着 If-Match 提交。' },
  { c: 429, n: 'Too Many Requests', g: 4, m: '请求太频繁，被限流了。', s: '爬虫、批量调用、共享 IP 撞上限。', f: '看 Retry-After 等多久；长期方案是加退避重试与配额分配。' },
  { c: 431, n: 'Request Header Fields Too Large', g: 4, m: '请求头太大。', s: 'Cookie 攒太多、JWT 塞太长。', f: '清 Cookie、把大 Token 移到请求体；服务端也可调大 header 缓冲。' },
  { c: 451, n: 'Unavailable For Legal Reasons', g: 4, m: '因法律要求不可用。', s: '地域封锁、版权下架。', f: '这类拦截通常按 IP/地区，换网络也无法绕过，找服务方确认。' },

  { c: 500, n: 'Internal Server Error', g: 5, m: '服务端内部出错，具体原因没暴露给你。', s: '未捕获异常、空指针、数据库连接失败。', f: '看服务端日志里的堆栈，状态码本身不说明原因；能稳定复现的话把请求 id 带上去查。' },
  { c: 501, n: 'Not Implemented', g: 5, m: '服务器不支持这个请求所需的功能。', s: '不支持某个 HTTP 方法或扩展。', f: '换方法或换实现；这类错误一般不是临时故障。' },
  { c: 502, n: 'Bad Gateway', g: 5, m: '网关从上游收到无效响应。', s: '上游进程崩了、端口没起、返回了非法响应。', f: '先确认上游服务活着且端口对；502 是「上游给了坏东西」，不是「上游慢」。' },
  { c: 503, n: 'Service Unavailable', g: 5, m: '服务暂时不可用，通常是过载或维护。', s: '发布重启、连接池打满、限流熔断。', f: '看 Retry-After；持续 503 就查资源水位（CPU、连接数、线程池）。' },
  { c: 504, n: 'Gateway Timeout', g: 5, m: '网关等上游响应超时。', s: '慢查询、上游卡死、超时配置太短。', f: '这是「上游回得太慢」的超时，和 408 方向相反；先看上游耗时（日志里的 upstream_response_time），再调 proxy_read_timeout。' },
  { c: 505, n: 'HTTP Version Not Supported', g: 5, m: '不支持请求用的 HTTP 版本。', s: '客户端发了 HTTP/3 而服务端只认 1.1。', f: '统一协议版本，或让入口网关做转换。' },
  { c: 506, n: 'Variant Also Negotiates', g: 5, m: '内容协商配置成了循环。', s: '服务端协商配置错误。', f: '服务端配置问题，客户端无解。' },
  { c: 507, n: 'Insufficient Storage', g: 5, m: '服务器存储空间不足。', s: 'WebDAV 上传、磁盘写满。', f: '清理磁盘或扩容；磁盘满还会连带数据库写入失败。' },
  { c: 508, n: 'Loop Detected', g: 5, m: '处理请求时检测到死循环。', s: 'WebDAV 目录软链接成环。', f: '检查目录结构与软链接。' },
  { c: 510, n: 'Not Extended', g: 5, m: '还需要对请求做更多扩展才能处理。', s: 'HTTP 扩展框架，几乎没人用。', f: '实际项目里基本见不到，见到就当服务端配置异常。' },
  { c: 511, n: 'Network Authentication Required', g: 5, m: '需要先完成网络层认证（例如连 Wi-Fi）。', s: '酒店/机场 Wi-Fi 的登录门户。', f: '打开任意 http 页面完成门户登录；接口调用遇到 511 说明网络还没放行。' },
];

export const manifest = {
  usage:
    '查 HTTP 状态码：输入三位数看含义、常见场景与排查方向；也可以输入现象关键词（如「超时」「跨域」「上传」）反查可能是哪几个码。覆盖 1xx–5xx 的常见状态码。',
  tips: [
    '记不住码时直接搜现象：「超时」会同时给出 408 与 504，并说明两者方向相反',
    '401 与 403 的区别是「身份不清楚」与「身份清楚但没权限」，排查方向完全不同',
    '输入 4 或 50 这样的前缀，可以列出整组状态码',
    '这里只讲协议含义；具体业务错误码要看各家接口文档',
  ],
  scenarios: [
    { scene: '线上突然一片 502', how: '搜 502 看排查方向', result: '先确认上游进程与端口，而不是盲目重启网关' },
    { scene: '页面改完样式发白', how: '搜 304', result: '意识到是缓存校验，强制刷新即可验证' },
    { scene: '接口报「超时」但不知道是哪一段', how: '搜「超时」', result: '分清 408（客户端发得慢）与 504（上游回得慢）' },
  ],
  inputs: [{ name: 'code', label: '状态码或关键词', type: 'text', placeholder: '404，或「超时」「上传」' }],
  runLabel: '查询',
};

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export async function run({ code }) {
  const q = String(code || '').trim();
  if (!q) throw new Error('请输入状态码（如 404）或关键词（如「超时」）');

  if (/^\d{1,3}$/.test(q)) {
    if (q.length === 3) {
      const hit = CODES.find((x) => String(x.c) === q);
      if (!hit) throw new Error(`没有收录 ${q}：它不是标准状态码，或者属于厂商自定义码（那要看具体接口文档）`);
      return {
        html: `<div class="msg-ok">${hit.c} ${esc(hit.n)} · ${GROUP_NAME[hit.g]}</div>
          <table style="width:100%;font-size:13.5px;border-collapse:collapse;margin-top:10px">
            <tr style="border-bottom:1px solid var(--border)"><td style="padding:7px 4px;color:var(--muted);width:22%">含义</td><td style="padding:7px 4px">${esc(hit.m)}</td></tr>
            <tr style="border-bottom:1px solid var(--border)"><td style="padding:7px 4px;color:var(--muted)">常见场景</td><td style="padding:7px 4px">${esc(hit.s)}</td></tr>
            <tr><td style="padding:7px 4px;color:var(--muted);vertical-align:top">往哪查</td><td style="padding:7px 4px">${esc(hit.f)}</td></tr>
          </table>`,
        text: `${hit.c} ${hit.n}（${GROUP_NAME[hit.g]}）\n含义：${hit.m}\n常见场景：${hit.s}\n排查：${hit.f}`,
      };
    }
    const list = CODES.filter((x) => String(x.c).startsWith(q));
    if (!list.length) throw new Error(`没有以 ${q} 开头的状态码`);
    return {
      html: `<div class="msg-ok">✅ 以 ${q} 开头的状态码有 ${list.length} 个</div>
        <table style="width:100%;font-size:13px;border-collapse:collapse;margin-top:10px">
          <tr style="border-bottom:2px solid var(--border);color:var(--muted);font-size:12.5px"><th style="padding:6px 4px;text-align:left">码</th><th style="padding:6px 4px;text-align:left">名称</th><th style="padding:6px 4px;text-align:left">含义</th></tr>
          ${list.map((x) => `<tr style="border-bottom:1px solid var(--border)"><td style="padding:6px 4px;font-family:var(--mono)">${x.c}</td><td style="padding:6px 4px">${esc(x.n)}</td><td style="padding:6px 4px;color:var(--muted)">${esc(x.m)}</td></tr>`).join('')}
        </table>`,
      text: list.map((x) => `${x.c} ${x.n}：${x.m}`).join('\n'),
    };
  }

  const needle = q.toLowerCase();
  const hits = CODES.filter((x) =>
    [x.n, x.m, x.s, x.f, GROUP_NAME[x.g]].join(' ').toLowerCase().includes(needle)
  );
  if (!hits.length) throw new Error(`没有匹配「${q}」的状态码：换个说法试试，比如「超时」「权限」「上传」「缓存」`);

  return {
    html: `<div class="msg-ok">✅ 匹配「${esc(q)}」的状态码 ${hits.length} 个</div>
      <table style="width:100%;font-size:13px;border-collapse:collapse;margin-top:10px">
        <tr style="border-bottom:2px solid var(--border);color:var(--muted);font-size:12.5px"><th style="padding:6px 4px;text-align:left">码</th><th style="padding:6px 4px;text-align:left">名称</th><th style="padding:6px 4px;text-align:left">什么时候会看到</th></tr>
        ${hits
          .map(
            (x) =>
              `<tr style="border-bottom:1px solid var(--border)"><td style="padding:6px 4px;font-family:var(--mono)">${x.c}</td><td style="padding:6px 4px">${esc(x.n)}</td><td style="padding:6px 4px;color:var(--muted)">${esc(x.s)}</td></tr>`
          )
          .join('')}
      </table>
      <p style="margin-top:10px;color:var(--muted);font-size:13px">点不开具体条目时，直接输入那三位数字看排查方向。</p>`,
    text: hits.map((x) => `${x.c} ${x.n}：${x.s}`).join('\n'),
  };
}
