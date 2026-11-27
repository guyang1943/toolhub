/**
 * 静态内容页模板（v3.3 从 app.js 拆出，按需加载）
 * 关于/提交/反馈/隐私/批量/离线：只有打开这些页面时才需要，首页不为它们付字节。
 * 正文由常量拼出，唯一的注册表依赖是「已收录 N 个工具」。
 */
import { renderKeyTable } from './store-keys.js';

/* ---------- AI 中心（v3.40） ----------
   站内 AI 的口径只有一处：本地工具里 tags 含 'ai' 的那些。首页横带的数字、/ai/ 页的列表、
   verify 的断言，三处都从这里算——口径一旦分叉，就会出现「横带写 2 个、页面写 3 个」
   这种谁都不算错、但用户会截图来问的情况。 */
/* 判据用**运行时白名单**而不是 runtime !== 'link'：目录里的 AI 工具 runtime 是
   web / desktop / selfhost / extension，构建期它们还没被改写成 'link'（那是浏览器侧的活），
   用「不等于 link」会把 8 条外链误算成站内工具。browser / pyodide 才是真的跑在这台机器上。 */
export const isLocalAi = (t) =>
  !!t && (t.runtime === 'browser' || t.runtime === 'pyodide') && Array.isArray(t.tags) && t.tags.includes('ai');
export const countLocalAi = (tools) => (tools || []).filter(isLocalAi).length;

const AI_ESC = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * /ai/ 的正文。只写这一份：build-pages 生成静态页时调它，SPA 跳转后也调它。
 * 以前每个静态页都是「构建期一段字符串 + pages.js 一个函数」两份，改一处忘另一处就各说各的；
 * 这一页从一开始就只留一份正文，两边只在外面包一层 h1 与版心。
 */
export function aiBody(tools) {
  const local = (tools || []).filter(isLocalAi);
  const dir = (tools || []).filter((t) => t.category === 'AI');
  const items = local
    .map((t) => `<li><a href="/tools/${t.id}/"><b>${AI_ESC(t.name)}</b></a> —— ${AI_ESC(t.desc)}</li>`)
    .join('');
  return `
      <h2>能直接用的 ${local.length} 个</h2>
      <ul>${items}</ul>
      <p>分两类。文字类的调浏览器自带的模型（权重由浏览器管，本站不分发也不托管）；
      图片类的用本站自己带的两个小模型——U²-Net 轻量版做去背景、YuNet 找人脸，合计 4.8 MB。
      这两个第一次用要连带 10.2 MB 的推理引擎一起下载，之后浏览器缓存住，<b>断网也能继续用</b>。</p>
      <p>还有一个不下载任何模型：量硬件的那个只读这台机器的 WebGPU、内存与核数，回答「这条路上哪一档跑得动」。</p>

      <h2>四条路，别混着走</h2>
      <table class="cmp-table">
        <tr><th></th><th>浏览器内置</th><th>装在本机</th><th>自建服务</th><th>调云端 API</th></tr>
        <tr><td>要装什么</td><td>什么都不用装，模型随浏览器</td><td>一个客户端</td><td>一台常开的机器</td><td>什么都不用装</td></tr>
        <tr><td>数据去哪</td><td class="yes">不出设备</td><td class="yes">不出设备</td><td class="yes">不出你的内网</td><td class="no">发给厂商</td></tr>
        <tr><td>断网能不能用</td><td class="yes">模型下完就能</td><td class="yes">能</td><td>看内网是否可达</td><td class="no">不能</td></tr>
        <tr><td>门槛</td><td>Chrome 138 以上、16GB 内存、22GB 磁盘</td><td>8GB 内存起步</td><td>会 Docker、有机器</td><td>要 Key、按量付费</td></tr>
        <tr><td>适合</td><td>临时处理几百字</td><td>日常主力</td><td>团队共用一套</td><td>质量优先、能接受上传</td></tr>
      </table>
      <p>这张表不是「哪个最好」，是「哪个适合你现在这件事」。同一台机器上，写一封邮件用第一列就够了，
      跑一份几十页的合同就该走第二列，而要求最高质量时第四列才是对的——代价是你得承认内容出去了。</p>
      <p>第一列不只处理文字。去背景和人脸打码也走这条路：模型是本站在自己域名下提供的静态文件，
      算力来自你这台机器的 CPU，图片从头到尾没有离开浏览器——同一个网站里的另外两种做法，
      一种是把图传给别人的服务器，一种是让你装软件。</p>

      <h2>跑不动怎么办</h2>
      <p>先别急着加内存。三个动作按顺序试：把量化降一档（Q8 到 Q4_K_M 大约省一半）、把规模降一档（13B 到 7B 也是大约一半）、
      把上下文从 32K 降到 4K。三样都试过还不够，才轮到硬件。</p>
      <p>要真的跑起来，看这两篇：<a href="/guides/ollama-local-ai/">在本机跑一个开源大模型</a>、
      <a href="/guides/local-ai-coding/">用本地模型写代码</a>。</p>

      <h2>目录里的 ${dir.length} 个本地模型工具</h2>
      <p>Ollama、GPT4All、AnythingLLM、Open WebUI、ComfyUI、Dify、WebLLM、Cline——每一条都先回答两件事：
      <b>跑在哪</b>（浏览器 / 客户端 / 要自行部署 / 编辑器扩展）和<b>提示词会去哪</b>。
      只收能说清执行位置的项目，纯云端、必须注册的服务不进这一栏。</p>
      <p><a href="/categories/ai/">打开「AI 与本地模型」分类 →</a></p>

      <h2>这一页不做什么</h2>
      <p>不接云端大模型，也不做需要注册的聊天窗口。本站没有后端数据库，为一个聊天框把用户输入送到别人服务器上，
      和这个站的其他部分不是同一套逻辑。想要网页里的对话，浏览器内置 AI 已经够用；想要更强的模型，
      第二步那条「装在本机」才是该走的路。</p>`;
}

export function makePages(reg, { analyticsOptedOut = () => false } = {}) {
  const counts = reg ? reg.counts.local + reg.counts.dir : '';
  return {
  ai: () => `
    <div class="page">
      <h1>AI 中心</h1>
      <p class="lead">这里只放能验证的东西：哪些 AI 能在你这台机器上跑、跑不动时往哪退、每条路的数据会去哪。
      没有「随便聊聊」的输入框，也没有需要注册的账号。</p>
      ${aiBody(reg ? reg.tools : [])}
    </div>`,
  about: () => `
    <div class="page">
      <h1>关于 ToolHub</h1>
      <p class="lead">把 GitHub 上好用的开源工具，变成"打开网页就能用"的形态——不用装环境、不用敲命令、不用注册。</p>
      <h2>两种工具类型</h2>
      <ul>
        <li><b>本地运行</b>：直接在浏览器里计算（JS / WebAssembly），数据<b>不会离开你的设备</b>，可放心处理敏感内容。</li>
        <li><b>在线直达</b>：精选知名开源项目的官方在线版，点击跳转。版权与内容归各项目所有。</li>
      </ul>
      <h2>技术架构</h2>
      <ul>
        <li>纯静态站点 + 无构建步骤，托管于 Cloudflare 全球网络</li>
        <li>工具由 <b>Manifest 规范</b>驱动：新增工具 = 写一份清单 + 一个执行文件，平台代码零改动</li>
        <li>Python 工具通过 Pyodide（WASM）在浏览器内沙箱执行</li>
      </ul>
      <h2>为什么本地执行更放心</h2>
      <table class="cmp-table">
        <tr><th></th><th>ToolHub 本地工具</th><th>普通在线工具站</th><th>自己装环境</th></tr>
        <tr><td>数据是否上传</td><td class="yes">不上传</td><td class="no">上传到对方服务器</td><td class="yes">不上传</td></tr>
        <tr><td>是否需要注册</td><td class="yes">不需要</td><td class="no">常常需要</td><td class="yes">不需要</td></tr>
        <tr><td>上手成本</td><td class="yes">打开即用</td><td>打开即用</td><td class="no">装依赖、配环境</td></tr>
        <tr><td>能否离线</td><td class="yes">可以（PWA）</td><td class="no">不行</td><td>可以</td></tr>
      </table>
      <h2>数据与隐私</h2>
      <ul>
        <li>平台<b>没有后端数据库</b>，不收集你的输入内容</li>
        <li>「最近使用」「我的收藏」「本机使用次数」都只保存在你浏览器的 localStorage 中，可在 <a href="/my/">我的数据</a> 逐项查看与清除</li>
        <li>站点若启用访问量统计，仅统计页面访问次数，不使用 Cookie、不追踪个人身份；详细口径与关闭方式见 <a href="/privacy/">隐私说明</a></li>
      </ul>
      <h2>开源与致谢</h2>
      <p>每个工具页均标注来源仓库与 License。已收录 ${counts} 个工具，其中本地工具的开源依赖包括 qrcodejs、marked、DOMPurify、Pyodide，均以原始协议使用。</p>
    </div>`,
  batch: () => `
    <div class="page">
      <h1>批量处理图片</h1>
      <p class="lead">一次拖入十几张截图，<b>限制边长 + 统一格式 + 压缩质量</b>一趟跑完，最后打包成一个 zip。全部在本机完成，图片不上传。</p>
      <div id="batch-app" class="batch"></div>
      <h2>适合什么场景</h2>
      <ul>
        <li>写文档要插十几张截图，每张都几百 KB —— 统一压到 1600px 宽，体积常常只剩三分之一</li>
        <li>把一堆 PNG 截图转成 WebP，网页加载更快</li>
        <li>相机直出的照片太大，发邮件前统一缩小</li>
      </ul>
      <h2>为什么不用在线批量工具</h2>
      <p>多数在线批量压缩会把图片上传到它自己的服务器，处理完再给你下载链接。这里是浏览器内的 canvas 编码，图片从头到尾没离开你的设备，断网也能用（缓存过离线包之后）。</p>
      <h2>注意事项</h2>
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
      <h1>隐私说明</h1>
      <p class="lead">一句话：<b>你的输入不会离开这台设备</b>。这个页面把「数据到底去了哪」逐条写清楚，包括我们能看到的和看不到的。</p>

      <h2>三类工具，三种数据流向</h2>
      <table class="cmp-table">
        <tr><th>类型</th><th>数据去了哪</th><th>谁能看到</th></tr>
        <tr><td><b>本地执行</b>（占多数）</td><td>在处理过程中只存在于内存，<b>文件不落盘</b>；文本类输入会留一份草稿在本机（≤4 KB）</td><td class="yes">只有你</td></tr>
        <tr><td><b>Python 工具</b></td><td>Pyodide 在你浏览器内跑 WASM，首次下载运行时</td><td class="yes">只有你</td></tr>
        <tr><td><b>第三方官网</b>（目录工具）</td><td>点「打开官网」后进入对方站点，适用对方的隐私政策</td><td class="no">对方站点</td></tr>
      </table>
      <p>本站<b>没有接收文件与输入内容的接口</b>——整站是静态文件，加一个只收访问事件的轻接口。发给服务器的只有两类：静态资源请求，以及下面第三节逐项列出的访问统计。</p>

      <h2>浏览器里存了什么</h2>
      ${renderKeyTable()}
      <p>外加 Service Worker 缓存（离线包，可在 <a href="/offline/">离线说明</a> 里查看与清理）。</p>
      <p>全部在你自己浏览器里，换设备不会同步，我们也没有能力同步。<a href="/my/">「我的数据」页</a>把每一条实际占了多少、怎么单独删，逐项列了出来。</p>
      <p class="muted-note">上面这张表不是手写的：它由 <code>assets/lib/store-keys.js</code> 的键清单直接渲染，构建期还有一道闸门核对「清单 / 代码里真实读写的键 / 这张表」三者一一对应。所以它不会随着版本迭代慢慢失真。</p>

      <h2>访问统计</h2>
      <p>本站<b>不加载任何第三方统计脚本</b>。访问统计由本站自己的一个接口完成，只存四个字段：<b>页面路径、事件名</b>（打开页面 / 打开工具 / 跑完一次 / 点结果操作）、<b>本机随机号</b>、<b>时间戳</b>，外加一个<b>国家级地区码</b>（由 CDN 提供，只到国家，不含城市）。不存 IP、不存浏览器标识、不存来源页、不存你在工具里填的任何东西，也不使用 Cookie；保留 90 天。</p>
      <p>本机随机号是首次访问时随机生成的 16 位串，存在你自己的浏览器里（下面那张表里的「本机随机访客号」），删掉或换设备就是另一个号。</p>
      <p>当前状态：<b>${!window.__TH_BEACON__ ? '本机未启用统计（当前发布方式下不会发出任何事件）' : off ? '你已关闭统计' : '统计开启（可随时关闭）'}</b>。三种情况一律不发：你在这里关掉、浏览器发出 Do Not Track、设备断网。</p>
      <div class="row">
        <button class="btn ghost" id="analytics-optout" data-off="${off ? '1' : '0'}">${off ? '恢复统计' : '在本机关闭统计'}</button>
      </div>
      <p class="muted-note">关闭后本机不再请求任何统计脚本；这个选择只存在本地，不会上传。浏览器开启 Do Not Track 时同样自动跳过。</p>

      <h2>关于加密分享</h2>
      <p>分享结果时可以选择加密：内容用 AES-GCM 在你的浏览器里加密后放进链接的 <code>#</code> 后面。<b>URL 片段（# 之后的部分）不会被发送到服务器</b>，所以服务器日志、CDN 访问日志里都不会出现明文。
      如果设置了口令，拿到链接的人还需要口令才能解开。</p>

      <h2>你可以自己验证</h2>
      <ul>
        <li>打开开发者工具的 Network 面板，随便跑一个本地工具——不会出现任何上传请求</li>
        <li>断网后刷新页面，本地工具仍然可用（离线包缓存过之后）</li>
        <li>源码就在仓库里，统计与安全头的定义分别在 <code>analytics.json</code> 与 <code>assets/lib/security-headers.js</code></li>
      </ul>
      <p><a href="/about/">← 回关于页</a></p>
    </div>`;
  },
  // v3.22：机身是静态文案（无 JS 也能读到「数据存在哪」这件事），明细由 my.js 填。
  // 为什么正文里要重写一遍「存在哪」：这一页的一半读者是禁用 JS 或以纯文本抓取的，
  // 而这一页的价值恰恰是「把话说清楚」，不能只有脚本跑起来才说得清。
  my: () => `
    <div class="page">
      <h1>我的数据</h1>
      <p class="lead">这个站<b>没有账号，也没有后端数据库</b>。你在这里做的每件事——收藏了哪些工具、用过几次、跑到什么结果——都只存在<b>这台设备</b>的浏览器里。这一页把它们摊开：每一条存在哪、存了什么、占多大、怎么单独删。</p>
      <div id="my-app" class="my"></div>
      <h2>「用过 N 个」是怎么算的</h2>
      <p>不另存一份「成就」——那样就多了一份你不知道的数据。这个数字是当场从运行记录里数的：<b>只有成功跑完一次才算用过</b>，打开页面看一眼就退出不算。所以它会自己变小：清掉本机统计，进度就归零；工具下架了，分母也跟着变。</p>
      <p>每天给你换三个「还没试过」的，是怕你只反复用顺手的那几个。这不影响任何排序，也不推广告——站里没有广告位。</p>
      <h2>为什么要把这些列出来</h2>
      <p>「你的数据在你手里」这句话，只有当你真的能看见、能删掉的时候才算数。只给一个「清除全部站点数据」的按钮，实际给出的选择是「全留」或者「全丢」——人一旦怕丢，就会选全留。所以这里能按类删：偏好、我的工具、本机统计、输入草稿，各删各的。</p>
      <p>另有一条：页面上的数字是<b>当场量的</b>（这个键现在多少条、占多少字节），不是抄配置里的上限。两者对不上就是代码有问题，这种事应该被看见，而不是被一句「最多 200 条」盖住。</p>
      <h2>这些数据会同步吗</h2>
      <p>不会。没有账号系统，也就没有同步通道。换一台设备、换一个浏览器、清一次站点数据，这里就空了 —— 我们也没有副本能还给你，因为本来就不存在别处。</p>
      <h2>关于自定义集合</h2>
      <p>集合只是把工具 id 归了个组：一组「发文章要用的」，一组「整理图片要用的」。它<b>不保存工具的输入输出</b>，也不排序、不串成流程——把几个工具连成一条流水线是下一版的事，这一版先解决「找得到」。</p>
      <p>这个站又加了什么？<a href="/feed.xml">RSS 订阅</a> 里是全部在册工具，新增一个就会更新——没有邮件，也不用留地址。</p>
      <p><a href="/privacy/">隐私说明</a> · <a href="/offline/">离线包</a> · <a href="/about/">关于</a></p>
    </div>`,
  offline: () => {
    // 静态页首访时由构建期注入；SPA 内部跳转时没有，交给 mountOffline 从 sw.js 现算
    const meta = window.__OFFLINE_META__;
    const size = meta ? `${meta.files} 个地址 · 约 ${(meta.bytes / 1048576).toFixed(1)} MB` : '全部本地工具页与执行脚本';
    return `
    <div class="page">
      <h1>离线包与安装</h1>
      <p class="lead">把全部本地工具缓存进浏览器之后，<b>断网、飞行模式、隔离内网都能照常打开并运算</b>——这时它才真正等同于一个装在电脑上的工具。</p>
      <div id="offline-app" class="offline"></div>

      <h2>两个概念别混淆</h2>
      <table class="cmp-table">
        <tr><th></th><th>安装成应用（PWA）</th><th>下载离线包</th></tr>
        <tr><td>解决什么</td><td>从桌面图标直接打开，有独立窗口</td><td>没有网络也能打开具体工具页</td></tr>
        <tr><td>是否必需网络</td><td>首次安装要，之后打开仍需联网</td><td>下载完成后完全不需要</td></tr>
        <tr><td>两者关系</td><td colspan="2">互相独立：不安装也能离线；装了应用但没下载离线包，断网时仍打不开工具页</td></tr>
      </table>

      <h2>包含与不包含</h2>
      <ul>
        <li><b>包含</b>：首页、全部分类页、全部本地工具页与其 <code>run.js</code>、界面样式与脚本、工具注册表与多语言文件（当前 ${size}）</li>
        <li><b>不包含</b>：第三方官网（目录工具是别人的站点，本来就不可能离线）</li>
        <li><b>不包含</b>：Python 运行时（13MB 起，还有可选的数据科学包）——第一次用 Python 工具时单独下载并缓存，不拖慢装包</li>
      </ul>

      <h2>更新机制</h2>
      <p>页面导航走「缓存优先 + 后台更新」：先给你秒开的旧版本，同时在后台把新版本写进缓存，下次打开就是新版。工具注册表与界面脚本走「网络优先」，所以新增工具、改文案在部署后立即生效，不必等缓存过期。</p>

      <h2>自己验证一下</h2>
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
      <h1>投稿</h1>
      <p class="lead">先选投哪一类，再填那一类要的字段。四类的门槛完全不同——资源填完当场校验，工具要能在浏览器里跑，教程得你自己先跑通，测评我们不收正文。
      把它们摊在同一页上，只会让人对着别人的字段发呆。</p>

      <div class="su-nav" id="su-nav" aria-label="选择投稿类别">
        <button type="button" class="su-pick" aria-pressed="false" data-slot="resource">
          <b>资源</b><span>一条值得收藏的链接</span><em>填完即校验</em>
        </button>
        <button type="button" class="su-pick" aria-pressed="false" data-slot="tool">
          <b>工具</b><span>推荐项目，或自己写一个</span><em>要跑得起来</em>
        </button>
        <button type="button" class="su-pick" aria-pressed="false" data-slot="guide">
          <b>教程</b><span>一条走完有结果的路</span><em>你得先走通</em>
        </button>
        <button type="button" class="su-pick" aria-pressed="false" data-slot="review">
          <b>测评</b><span>选题与事实纠错</span><em>正文编辑写</em>
        </button>
      </div>
      <p class="su-pick-hint" id="su-pick-hint">选一类之后，这里只出现那一类要填的东西。</p>

      <section class="su-panel" id="su-resource" data-panel="resource" hidden>
        <h2>资源：一条收藏</h2>
        <p>图标库、字体、配色、学习路线、模板站。这类收录的门槛不在「有没有用」，而在<b>写不写得出为什么值得收藏</b>——
        复述官网介绍的一律不收。<code>note</code> 那一栏是唯一没法从别处抄来的东西，也是这条记录的全部价值。</p>
        <div id="resource-submit"></div>
      </section>

      <section class="su-panel" id="su-tool" data-panel="tool" hidden>
        <h2>工具：推荐项目，或自己写一个</h2>
        <h3>方式一：推荐现成的开源项目</h3>
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
        <h3>方式二：自己写一个本地工具</h3>
        <p>ToolHub 的工具由 Manifest 驱动：新增一个工具 = 一份 <code>tool.json</code> + 一个 <code>run.js</code>，平台代码零改动。
        下面的生成器把这两份文件（含表单清单与执行骨架）直接生成成压缩包，并用<b>与构建期完全相同</b>的规范做校验——这里通过，构建就不会拦你。</p>
        <div id="tool-builder"></div>
        <h3>接入约定（必读）</h3>
        <ul>
          <li><code>run()</code> 返回 <code>{ html, text?, files? }</code>，<code>files</code> 为 <code>[{ name, blob, kind }]</code></li>
          <li><b>禁止任何网络请求</b>（fetch / XMLHttpRequest / WebSocket / sendBeacon），本地工具必须断网可跑</li>
          <li>单工具体积 ≤ 200KB，不引入远程脚本</li>
          <li>本地验收：<code>lint-tools.mjs</code> → <code>build-pages.mjs</code> → <code>verify.mjs</code> 全绿再提 PR</li>
        </ul>
        <h3>完整规范</h3>
        <p>字段定义、默认值与选项规则、常见拒绝原因，见 <a href="/tools/schema.json" target="_blank" rel="noopener">tools/schema.json</a>（机器可读）与仓库里的 <code>docs/TOOL-CONTRACT.md</code>（人话版）。</p>
      </section>

      <section class="su-panel" id="su-guide" data-panel="guide" hidden>
        <h2>教程：一条走完有结果的路</h2>
        <p>教程和工具是两种东西：工具是「打开网页就能用」，教程是「先装、先刷、先配」。所以门槛不一样，也高得多。</p>
        <ul>
          <li><b>你得自己按写下来的步骤跑通过一次。</b>没跑通的稿子不收——不是不信任，是这类内容翻车的代价由读者承担（刷成砖的人不会来找你）。</li>
          <li><b>前置条件写在动作前面。</b>芯片型号对不对、U 盘够不够大、有没有网线，写晚了人会在第三步才发现白忙一场。</li>
          <li><b>风险写在动作前面。</b>「会覆盖原系统」放在最后一段，等于没写。</li>
          <li><b>必须有回退路径。</b>只讲怎么往前冲、不讲怎么退回来的，是在催人做不可逆的事。</li>
        </ul>
        <p class="muted-note">投稿会记下你的署名与「已跑通」声明，一起进更新记录。</p>
        <p><a class="btn ghost" href="https://github.com/guyang1943/toolhub/issues/new?template=guide.yml" target="_blank" rel="noopener">按模板投一篇教程</a></p>
      </section>

      <section class="su-panel" id="su-review" data-panel="review" hidden>
        <h2>测评：只收选题和纠错，不收正文</h2>
        <p>这一条不是客气话，是硬规则。每篇测评里都写着 <code>method</code>——「依据哪个仓库、哪个版本、哪天的资料」。这句话是「不吹不黑」的全部依据，
        而外部投稿的这句声明<b>没法验证</b>。一旦收了一篇软文，整个站的可信度就没了。</p>
        <p>所以开放的是两件更有用的事：</p>
        <ul>
          <li><b>选题提议</b>：想知道哪几个工具横向比一比。被提到多的会排进计划。</li>
          <li><b>事实纠错</b>：某个结论过期了、某个数字不对、某个工具已经不维护了。这类反馈比新稿子值钱。</li>
        </ul>
        <p>
          <a class="btn ghost" href="https://github.com/guyang1943/toolhub/issues/new?template=review.yml" target="_blank" rel="noopener">提测评选题</a>
          <a class="btn ghost" href="https://github.com/guyang1943/toolhub/issues/new?template=review.yml&title=%5B%E7%BA%A0%E9%94%99%5D%20" target="_blank" rel="noopener">报告一处错误</a>
        </p>
      </section>
    </div>`,
  workflows: () => `
    <div class="page">
      <h1>工作流</h1>
      <p class="lead">把几个工具按顺序接起来，输入一次就看到整条链路的产物。它不是「又一个工具入口」，
      而是那几件<b>本来就该连做三步</b>的事：去元数据 → 限边长 → 压成 WebP。</p>

      <div id="flow-app" class="wf"><p class="muted-note">正在加载流程…</p></div>

      <h2>为什么只有这六条</h2>
      <p>判断标准只有一条：<b>少一步就不成立</b>。单看「图片压缩」谁都能单开一页做，
      但「先去 GPS、再限边长、最后压成 WebP」连着做才是发布前真正要的那件事；
      单看「CSV 转 JSON」也只是个小工具，可「先挑出要的列、再转成 JSON」才是接口真能用的结果。
      凑数的流程会把这一页变成另一个工具列表，还多一层点击。</p>
      <p>现在六条，按场景分三组：<b>图片</b>——发布包、照片成 PDF、二维码嵌码；
      <b>数据</b>——表格提列转 JSON；<b>文本</b>——名单去重计数、日志里的 Base64 还原成 JSON。
      每一条都能在页面上看到「少了哪一步会怎样」。</p>

      <h2>它不是拖拽编排器</h2>
      <p>没有画布、没有连线、没有自定义节点——那是另一个量级的东西，而且大多数人并不想自己设计流程，
      只想有人把顺序想好。这里给的是<b>固定顺序 + 可调输入</b>：你只决定「处理哪张图」。</p>

      <h2>参数写死在哪，错了会怎样</h2>
      <p>每一步的参数与「谁接谁」写在 <code>workflows/workflows.json</code> 里，构建期由
      <code>check-workflows.mjs</code> 按工具自己的 <code>manifest</code> 逐项校验：选项是否存在、
      数值是否落在上下限内、每个输入是不是都有确定的值。工具改了表单而流程没跟着改，<b>构建就会失败</b>，
      不会等到你点「运行」才炸。</p>

      <h2>中间结果去哪了</h2>
      <p>只在当前页面的内存里。没有上传、没有落盘、没有「任务 id」，关掉页面即释放。
      所以这里也没有「查看历史记录」——不是没做，是本来就不该有。</p>

      <p><a href="/privacy/">隐私说明</a> · <a href="/batch/">批量处理</a> · <a href="/tools/">全部工具</a></p>
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
      <h1>意见反馈与工具需求</h1>
      <p class="lead">这个平台没有后端数据库，所以我们用最朴素也最透明的方式收集反馈：复制模板发给我们。高频需求会排进开发计划。</p>
      <h2>可以反馈什么</h2>
      <ul>
        <li>某个工具报错、结果不对、加载失败</li>
        <li>希望新增的工具（尤其是你在 GitHub 上看到的好项目）</li>
        <li>界面、文案、翻译问题</li>
        <li>想收录某个开源项目的官方在线版</li>
      </ul>
      <h2>反馈模板（复制后发送）</h2>
      <pre id="fb-tpl">${tpl}</pre>
      <div class="row">
        <button class="btn" id="fb-copy">复制模板</button>
        <a class="btn ghost" id="fb-mail" href="mailto:guyang1966@hotmail.com?subject=${encodeURIComponent('【ToolHub 反馈】')}&body=${encodeURIComponent(tpl)}">用邮件发送</a>
      </div>
      <h2>我们怎么处理</h2>
      <ul>
        <li>报错类问题优先修，会在版本更新说明里注明</li>
        <li>工具需求按被提到的次数排序，不承诺时间但会公开排期</li>
        <li>不收集你的任何使用数据——反馈内容只来自你主动发送的部分</li>
      </ul>
    </div>`;
  },
  };
}
