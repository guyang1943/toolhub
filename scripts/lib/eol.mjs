/* 换行符归一（v3.5.1）
   为什么需要这个：仓库里生成的 JSON（tools/tools.json、sw.js 等）是脚本用 `\n` 写的，
   提交进 git 的是 LF。但 Windows 上 `core.autocrlf=true` 的机器一 clone / 一 archive，
   工作区里的文件就被转成 CRLF——于是「内容完全一致」的 tools.json 在逐字节比对时红了。
   这类红不是真问题，却会让每个新接手的贡献者（和每个外包执行方）在第一步就撞墙，
   而且报错信息（「与工具分片不一致」）指向完全错误的方向。

   这里只做一件事：比较前把 CRLF 折成 LF。比对的语义是「内容是否同步」，不是「字节是否相同」。 */
export const normEol = (s) => String(s ?? '').replace(/\r\n/g, '\n');

/** 两段 JSON 文本是否内容相同（忽略行尾差异与首尾空白） */
export const sameJsonText = (actual, expected) => normEol(actual).trim() === normEol(expected).trim();
