// 最小 zip 读取：只取其中的 .json（stored / deflate），用浏览器自带的 DecompressionStream，不依赖第三方库。
import {AdviceInputError} from './aspen-advice.mjs';
const MAX_ENTRY = 40 * 1024 * 1024;

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new AdviceInputError('这个浏览器不支持读取 .zip 里的压缩文件。请解压后直接选择 JSON 文件，或换用新版 Chrome / Edge / Firefox。');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** buffer: ArrayBuffer；返回 [{name, text}]（只含 .json）。 */
export async function readZipJson(buffer, zipName = '压缩包') {
  const view = new DataView(buffer), bytes = new Uint8Array(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new AdviceInputError(`“${zipName}”不是有效的 zip 文件（找不到目录结尾）。`);
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  if (count === 0xffff || p === 0xffffffff) throw new AdviceInputError(`“${zipName}”是 zip64 格式，暂不支持。请解压后直接选择 JSON 文件。`);
  const out = [], dec = new TextDecoder('utf-8');
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new AdviceInputError(`“${zipName}”的目录损坏。`);
    const flags = view.getUint16(p + 8, true), method = view.getUint16(p + 10, true), csize = view.getUint32(p + 20, true), usize = view.getUint32(p + 24, true);
    const nlen = view.getUint16(p + 28, true), xlen = view.getUint16(p + 30, true), clen = view.getUint16(p + 32, true), off = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/') || name.startsWith('__MACOSX/') || !name.toLowerCase().endsWith('.json')) continue;
    if (flags & 1) throw new AdviceInputError(`“${zipName}”里的“${name}”被加密，无法读取。`);
    if (usize > MAX_ENTRY) throw new AdviceInputError(`“${name}”解压后超过 40 MB，不像是体检文件。`);
    const lnlen = view.getUint16(off + 26, true), lxlen = view.getUint16(off + 28, true), start = off + 30 + lnlen + lxlen;
    const raw = bytes.subarray(start, start + csize);
    let data;
    if (method === 0) data = raw; else if (method === 8) data = await inflateRaw(raw);
    else throw new AdviceInputError(`“${zipName}”里的“${name}”使用了不支持的压缩方式（${method}）。`);
    out.push({name: name.split('/').pop(), text: dec.decode(data)});
  }
  if (!out.length) throw new AdviceInputError(`“${zipName}”里没有 .json 文件。需要 probe-summary.json（可附 graph.json、roles.json）。`);
  return out;
}
