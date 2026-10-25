// 工具：二维码生成（基于开源 qrcodejs，MIT，本地 vendor）
export const manifest = {
  inputs: [
    { name: 'text', label: '内容（网址或任意文本）', type: 'text', placeholder: 'https://sitool.eu.org' },
    { name: 'size', label: '尺寸（像素）', type: 'select', default: '256', options: [
      { value: '128', label: '128' }, { value: '256', label: '256' }, { value: '512', label: '512' },
    ] },
  ],
  runLabel: '生成二维码',
  tips: ['网址越长二维码越密，打印后扫不出可以试试短链', '二维码中心可以贴 logo 而不影响识别（容错级别 M）', '生成全程本地，不会把你的链接发送到任何服务器'],
  scenarios: [
    { scene: '要把公众号文章转到线下海报', how: '粘贴文章链接 → 生成 512px → 下载 PNG', result: '高分辨率图片，印刷清晰' },
    { scene: '会议投屏让观众扫码进群', how: '粘贴群邀请链接 → 256px', result: '屏幕大小正好，扫码即入' },
    { scene: '分享 WiFi 密码给客人', how: '输入 WIFI:T:WPA;S:名称;P:密码;;', result: '扫码自动连网，不用手输密码' },
  ],
};

export async function run({ text, size }) {
  if (!text.trim()) throw new Error('请输入要生成的内容');
  const s = Number(size);
  const holder = document.createElement('div');
  // qrcodejs 全局库已在页面引入
  new window.QRCode(holder, { text, width: s, height: s, correctLevel: window.QRCode.CorrectLevel.M });
  const img = holder.querySelector('img') || holder.querySelector('canvas');
  const canvas = holder.querySelector('canvas');
  let url = canvas?.toDataURL('image/png');
  if (!url && img) url = img.src;

  return {
    html: `<div class="msg-ok">✅ 已生成 ${s}×${s} 二维码</div>`,
    files: [{ name: 'qrcode.png', url, kind: 'image' }],
    text,
  };
}
