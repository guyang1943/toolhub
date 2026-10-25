/**
 * 静态内容页模板（v3.3 从 app.js 拆出，按需加载）
 * 关于/提交/反馈/隐私/批量/离线：只有打开这些页面时才需要，首页不为它们付字节。
 * 正文由常量拼出，唯一的注册表依赖是「已收录 N 个工具」。
 */
export function makePages(reg, { analyticsOptedOut = () => false, ANALYTICS_OPT_OUT = 'toolhub:no-analytics' } = {}) {
  const counts = reg ? reg.counts.local + reg.counts.dir : '';
  return {
  about: () => `
    <div class="page">
      <h1>ℹ️ 关于 ToolHub</h1>
      <p class="lead">把 GitHub 上好用的开源工具，变成"打开网页就能用"的形态——不用装环境、不用敲命令、不用注册。</p>
      <h2>✦ 两种工具类型</h2>
      <ul>
        <li><b>🔒 本地运行</b>：直接在浏览器里计算（JS / WebAssembly），数据<b>不会离开你的设备</b>，可放心处理敏感内容。</li>
        <li><b>🌐 在线直达</b>：精选知名开源项目的官方在线版，点击跳转。版权与内容归各项目所有。</li>
      </ul>
      <h2>✦ 技术架构</h2>
      <ul>
        <li>纯静态站点 + 无构建步骤，托管于 Cloudflare 全球网络</li>
        <li>工具由 <b>Manifest 规范</b>驱动：新增工具 = 写一份清单 + 一个执行文件，平台代码零改动</li>
        <li>Python 工具通过 Pyodide（WASM）在浏览器内沙箱执行</li>
      </ul>
      <h2>✦ 为什么本地执行更放心</h2>
      <table class="cmp-table">
        <tr><th></th><th>ToolHub 本地工具</th><th>普通在线工具站</th><th>自己装环境</th></tr>
        <tr><td>数据是否上传</td><td class="yes">不上传</td><td class="no">上传到对方服务器</td><td class="yes">不上传</td></tr>
        <tr><td>是否需要注册</td><td class="yes">不需要</td><td class="no">常常需要</td><td class="yes">不需要</td></tr>
        <tr><td>上手成本</td><td class="yes">打开即用</td><td>打开即用</td><td class="no">装依赖、配环境</td></tr>
        <tr><td>能否离线</td><td class="yes">可以（PWA）</td><td class="no">不行</td><td>可以</td></tr>
      </table>
      <h2>✦ 数据与隐私</h2>
      <ul>
        <li>平台<b>没有后端数据库</b>，不收集你的输入内容</li>
        <li>「最近使用」「我的收藏」「本机使用次数」都只保存在你浏览器的 localStorage 中，可随时清除</li>
        <li>站点若启用访问量统计，仅统计页面访问次数，不使用 Cookie、不追踪个人身份；详细口径与关闭方式见 <a href="/privacy/">隐私说明</a></li>
      </ul>
      <h2>✦ 开源与致谢</h2>
      <p>每个工具页均标注来源仓库与 License。已收录 ${counts} 个工具，其中本地工具的开源依赖包括 qrcodejs、marked、DOMPurify、Pyodide，均以原始协议使用。</p>
    </div>`,
  batch: () => `
    <div class="page">
      <h1>📦 批量处理图片</h1>
      <p class="lead">一次拖入十几张截图，<b>限制边长 + 统一格式 + 压缩质量</b>一趟跑完，最后打包成一个 zip。全部在本机完成，图片不上传。</p>
      <div id="batch-app" class="batch"></div>
      <h2>✦ 适合什么场景</h2>
      <ul>
        <li>写文档要插十几张截图，每张都几百 KB —— 统一压到 1600px 宽，体积常常只剩三分之一</li>
        <li>把一堆 PNG 截图转成 WebP，网页加载更快</li>
        <li>相机直出的照片太大，发邮件前统一缩小</li>
      </ul>
      <h2>✦ 为什么不用在线批量工具</h2>
      <p>多数在线批量压缩会把图片上传到它自己的服务器，处理完再给你下载链接。这里是浏览器内的 canvas 编码，图片从头到尾没离开你的设备，断网也能用（缓存过离线包之后）。</p>
      <h2>✦ 注意事项</h2>
      <ul>
        <li>PNG 是无损格式，调「质量」对它没效果；要明显变小请选 WebP 或 JPEG</li>
        <li>转 JPEG 会丢掉透明背景（变成白底），带透明的图请保持 PNG</li>
        <li>处理在单线程里排队执行，几十张时请让页面留在前台</li>
      </ul>
      <p>只想处理单张、需要更细的参数？用 <a href="/tools/image-compress/">图片压缩</a>、<a href="/tools/image-resize/">图片改尺寸</a> 或 <a href="/tools/image-convert/">图片格式转换</a>。</p>
    </div>`,
  privacy: () => {
    const off = analyticsOptedOut();
    return `
    <div class="page">
      <h1>🔒 隐私说明</h1>
      <p class="lead">一句话：<b>你的输入不会离开这台设备</b>。这个页面把「数据到底去了哪」逐条写清楚，包括我们能看到的和看不到的。</p>

      <h2>✦ 三类工具，三种数据流向</h2>
      <table class="cmp-table">
        <tr><th>类型</th><th>数据去了哪</th><th>谁能看到</th></tr>
        <tr><td><b>本地执行</b>（占多数）</td><td>只在你浏览器的内存里</td><td class="yes">只有你</td></tr>
        <tr><td><b>Python 工具</b></td><td>Pyodide 在你浏览器内跑 WASM，首次下载运行时</td><td class="yes">只有你</td></tr>
        <tr><td><b>第三方官网</b>（目录工具）</td><td>点「打开官网」后进入对方站点，适用对方的隐私政策</td><td class="no">对方站点</td></tr>
      </table>
      <p>本站<b>没有后端数据库</b>，也没有上传接口——这不是承诺，是架构上就不存在：整站是静态文件，唯一的动态部分是 Cloudflare 的边缘缓存。</p>

      <h2>✦ 浏览器里存了什么</h2>
      <ul>
        <li><code>toolhub:theme</code> — 深色/浅色偏好</li>
        <li><code>toolhub:favs</code> — 你收藏的工具 id</li>
        <li><code>toolhub:recent</code> — 最近打开过的工具</li>
        <li><code>toolhub:usage</code> — 每个工具在本机用过几次（用于「最常用」排序）</li>
        <li><code>toolhub:draft:&lt;工具id&gt;</code> — 上次填的输入，方便回头继续</li>
        <li><code>${ANALYTICS_OPT_OUT}</code> — 你是否关闭了访问统计</li>
        <li>Service Worker 缓存 — 离线包（可在 <a href="/offline/">离线说明</a> 里查看与清理）</li>
      </ul>
      <p>全部在你自己浏览器里，清除站点数据即可一次清空。换设备不会同步，我们也没有能力同步。</p>

      <h2>✦ 访问统计</h2>
      <p>本站默认<b>不加载任何统计脚本</b>。若站长启用了统计，也只会是聚合的访问量（哪个页面被打开多少次），不使用 Cookie、不采集输入内容、不跨站追踪。
      当前状态：<b>${off ? '你已关闭统计' : '未关闭（若服务端未启用统计，也不会发出任何请求）'}</b>。</p>
      <div class="row">
        <button class="btn ghost" id="analytics-optout" data-off="${off ? '1' : '0'}">${off ? '恢复统计' : '在本机关闭统计'}</button>
      </div>
      <p class="muted-note">关闭后本机不再请求任何统计脚本；这个选择只存在本地，不会上传。浏览器开启 Do Not Track 时同样自动跳过。</p>

      <h2>✦ 关于加密分享</h2>
      <p>分享结果时可以选择加密：内容用 AES-GCM 在你的浏览器里加密后放进链接的 <code>#</code> 后面。<b>URL 片段（# 之后的部分）不会被发送到服务器</b>，所以服务器日志、CDN 访问日志里都不会出现明文。
      如果设置了口令，拿到链接的人还需要口令才能解开。</p>

      <h2>✦ 你可以自己验证</h2>
      <ul>
        <li>打开开发者工具的 Network 面板，随便跑一个本地工具——不会出现任何上传请求</li>
        <li>断网后刷新页面，本地工具仍然可用（离线包缓存过之后）</li>
        <li>源码就在仓库里，统计与安全头的定义分别在 <code>analytics.json</code> 与 <code>assets/lib/security-headers.js</code></li>
      </ul>
      <p><a href="/about/">← 回关于页</a></p>
    </div>`;
  },
  offline: () => {
    // 静态页首访时由构建期注入；SPA 内部跳转时没有，交给 mountOffline 从 sw.js 现算
    const meta = window.__OFFLINE_META__;
    const size = meta ? `${meta.files} 个地址 · 约 ${(meta.bytes / 1048576).toFixed(1)} MB` : '全部本地工具页与执行脚本';
    return `
    <div class="page">
      <h1>📴 离线包与安装</h1>
      <p class="lead">把全部本地工具缓存进浏览器之后，<b>断网、飞行模式、隔离内网都能照常打开并运算</b>——这时它才真正等同于一个装在电脑上的工具。</p>
      <div id="offline-app" class="offline"></div>

      <h2>✦ 两个概念别混淆</h2>
      <table class="cmp-table">
        <tr><th></th><th>安装成应用（PWA）</th><th>下载离线包</th></tr>
        <tr><td>解决什么</td><td>从桌面图标直接打开，有独立窗口</td><td>没有网络也能打开具体工具页</td></tr>
        <tr><td>是否必需网络</td><td>首次安装要，之后打开仍需联网</td><td>下载完成后完全不需要</td></tr>
        <tr><td>两者关系</td><td colspan="2">互相独立：不安装也能离线；装了应用但没下载离线包，断网时仍打不开工具页</td></tr>
      </table>

      <h2>✦ 包含与不包含</h2>
      <ul>
        <li><b>包含</b>：首页、全部分类页、全部本地工具页与其 <code>run.js</code>、界面样式与脚本、工具注册表与多语言文件（当前 ${size}）</li>
        <li><b>不包含</b>：第三方官网（目录工具是别人的站点，本来就不可能离线）</li>
        <li><b>不包含</b>：Python 运行时（13MB 起，还有可选的数据科学包）——第一次用 Python 工具时单独下载并缓存，不拖慢装包</li>
      </ul>

      <h2>✦ 更新机制</h2>
      <p>页面导航走「缓存优先 + 后台更新」：先给你秒开的旧版本，同时在后台把新版本写进缓存，下次打开就是新版。工具注册表与界面脚本走「网络优先」，所以新增工具、改文案在部署后立即生效，不必等缓存过期。</p>

      <h2>✦ 自己验证一下</h2>
      <ol>
        <li>点上面的「下载离线包」，等进度走到 100%</li>
        <li>开发者工具 Network 面板勾上 Offline（或直接关 Wi-Fi）</li>
        <li>刷新页面，随便打开一个本地工具——应该照常可用，且没有任何失败的上传请求（本来就没有上传接口）</li>
      </ol>
      <p class="muted-note">想彻底退回联网状态？点页面上的「清除缓存」，或清除本站站点数据。</p>
      <p><a href="/privacy/">隐私说明</a> · <a href="/batch/">批量处理</a> · <a href="/about/">关于</a></p>
    </div>`;
  },
  submit: () => `
    <div class="page">
      <h1>➕ 推荐一个工具</h1>
      <p class="lead">两条路：推荐一个现成的开源项目加入目录，或者用下面的生成器直接造一个能在浏览器本地跑的新工具。</p>
      <h2>✦ 方式一：推荐开源项目</h2>
      <ul>
        <li>开源项目（有明确 License），优先 MIT / Apache / BSD</li>
        <li>能在浏览器中使用，或可被工具化为网页形态</li>
        <li>有实际使用价值、站点可正常访问</li>
        <li>需要注册才能用、含广告追踪、站点不稳的，不收录</li>
      </ul>
      <p>推荐模板：</p>
      <pre>项目名称：
GitHub 仓库：
官网/在线地址：
一句话介绍：
License：
推荐理由（它解决什么问题）：</pre>
      <h2>✦ 方式二：自己写一个本地工具</h2>
      <p>ToolHub 的工具由 Manifest 驱动：新增一个工具 = 一份 <code>tool.json</code> + 一个 <code>run.js</code>，平台代码零改动。
      下面的生成器把这两份文件（含表单清单与执行骨架）直接生成成压缩包，并用<b>与构建期完全相同</b>的规范做校验——这里通过，构建就不会拦你。</p>
      <div id="tool-builder"></div>
      <h2>✦ 接入约定（必读）</h2>
      <ul>
        <li><code>run()</code> 返回 <code>{ html, text?, files? }</code>，<code>files</code> 为 <code>[{ name, blob, kind }]</code></li>
        <li><b>禁止任何网络请求</b>（fetch / XMLHttpRequest / WebSocket / sendBeacon），本地工具必须断网可跑</li>
        <li>单工具体积 ≤ 200KB，不引入远程脚本</li>
        <li>本地验收：<code>lint-tools.mjs</code> → <code>build-pages.mjs</code> → <code>verify.mjs</code> 全绿再提 PR</li>
      </ul>
      <h2>✦ 完整规范</h2>
      <p>字段定义、默认值与选项规则、常见拒绝原因，见 <a href="/tools/schema.json" target="_blank" rel="noopener">tools/schema.json</a>（机器可读）与仓库里的 <code>docs/TOOL-CONTRACT.md</code>（人话版）。</p>
    </div>`,
  feedback: () => {
    const tpl = `【ToolHub 反馈】
类型：报错 / 需求 / 收录推荐（三选一）
工具名或页面：
具体描述：
复现步骤（如为报错）：
浏览器与系统：`;
    return `
    <div class="page">
      <h1>💬 意见反馈与工具需求</h1>
      <p class="lead">这个平台没有后端数据库，所以我们用最朴素也最透明的方式收集反馈：复制模板发给我们。高频需求会排进开发计划。</p>
      <h2>✦ 可以反馈什么</h2>
      <ul>
        <li>某个工具报错、结果不对、加载失败</li>
        <li>希望新增的工具（尤其是你在 GitHub 上看到的好项目）</li>
        <li>界面、文案、翻译问题</li>
        <li>想收录某个开源项目的官方在线版</li>
      </ul>
      <h2>✦ 反馈模板（复制后发送）</h2>
      <pre id="fb-tpl">${tpl}</pre>
      <div class="row">
        <button class="btn" id="fb-copy">复制模板</button>
        <a class="btn ghost" id="fb-mail" href="mailto:guyang1966@hotmail.com?subject=${encodeURIComponent('【ToolHub 反馈】')}&body=${encodeURIComponent(tpl)}">用邮件发送</a>
      </div>
      <h2>✦ 我们怎么处理</h2>
      <ul>
        <li>报错类问题优先修，会在版本更新说明里注明</li>
        <li>工具需求按被提到的次数排序，不承诺时间但会公开排期</li>
        <li>不收集你的任何使用数据——反馈内容只来自你主动发送的部分</li>
      </ul>
    </div>`;
  },
  };
}
