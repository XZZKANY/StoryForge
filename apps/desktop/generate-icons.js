// 简单的图标占位符生成器
const fs = require('fs');
const path = require('path');

const iconsDir = path.join(__dirname, 'src-tauri', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// 创建一个最小的有效 ICO 文件（16x16 白色方块）
// ICO 文件格式：ICONDIR header + ICONDIRENTRY + DIB bitmap
const createMinimalICO = () => {
  const width = 32;
  const height = 32;
  const bpp = 32; // 32 bits per pixel (RGBA)

  // ICO header (6 bytes)
  const header = Buffer.from([
    0x00,
    0x00, // Reserved
    0x01,
    0x00, // Type (1 = ICO)
    0x01,
    0x00, // Number of images
  ]);

  // ICONDIRENTRY (16 bytes)
  const dibSize = 40 + width * height * 4; // BITMAPINFOHEADER + pixel data
  const entry = Buffer.alloc(16);
  entry[0] = width; // Width
  entry[1] = height; // Height
  entry[2] = 0; // Color palette (0 = no palette)
  entry[3] = 0; // Reserved
  entry.writeUInt16LE(1, 4); // Color planes
  entry.writeUInt16LE(bpp, 6); // Bits per pixel
  entry.writeUInt32LE(dibSize, 8); // Size of image data
  entry.writeUInt32LE(22, 12); // Offset of image data (6 + 16)

  // DIB (Device Independent Bitmap) - BITMAPINFOHEADER (40 bytes)
  const dib = Buffer.alloc(40);
  dib.writeUInt32LE(40, 0); // Header size
  dib.writeInt32LE(width, 4); // Width
  dib.writeInt32LE(height * 2, 8); // Height (doubled for ICO)
  dib.writeUInt16LE(1, 12); // Planes
  dib.writeUInt16LE(bpp, 14); // Bits per pixel
  dib.writeUInt32LE(0, 16); // Compression (0 = none)
  dib.writeUInt32LE(width * height * 4, 20); // Image size

  // Pixel data (BGRA format, bottom-up)
  // 简单的蓝色方块
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4 + 0] = 0x64; // Blue
    pixels[i * 4 + 1] = 0x95; // Green
    pixels[i * 4 + 2] = 0xed; // Red
    pixels[i * 4 + 3] = 0xff; // Alpha
  }

  return Buffer.concat([header, entry, dib, pixels]);
};

// 创建简单的 PNG（使用纯 JS，不依赖外部库）
const createSimplePNG = (size) => {
  // 这里使用最简单的方法：创建一个纯色 PNG
  // 实际项目中应该使用真实的图标
  const canvas = require('canvas').createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // 绘制蓝色背景
  ctx.fillStyle = '#6495ED';
  ctx.fillRect(0, 0, size, size);

  // 绘制白色 "SF" 文字
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold ${Math.floor(size * 0.4)}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SF', size / 2, size / 2);

  return canvas.toBuffer('image/png');
};

console.log('生成图标占位符...');

// 生成 ICO
try {
  const icoPath = path.join(iconsDir, 'icon.ico');
  fs.writeFileSync(icoPath, createMinimalICO());
  console.log('✓ 已生成 icon.ico');
} catch (err) {
  console.error('生成 ICO 失败:', err.message);
}

// 生成 PNG（需要 canvas 包）
try {
  const canvas = require('canvas');

  fs.writeFileSync(path.join(iconsDir, '32x32.png'), createSimplePNG(32));
  console.log('✓ 已生成 32x32.png');

  fs.writeFileSync(path.join(iconsDir, '128x128.png'), createSimplePNG(128));
  console.log('✓ 已生成 128x128.png');

  fs.writeFileSync(path.join(iconsDir, '128x128@2x.png'), createSimplePNG(256));
  console.log('✓ 已生成 128x128@2x.png');
} catch (err) {
  console.log('⚠ PNG 生成跳过（需要安装 canvas 包）:', err.message);
  console.log('  可以稍后手动添加 PNG 文件');
}

// 对于 macOS 的 .icns，我们暂时跳过（需要更复杂的工具）
console.log('⚠ icon.icns 需要手动生成（仅 macOS 需要）');

console.log('\n图标占位符已生成！可以继续编译了。');
console.log('提示：使用 https://icon.kitchen 生成专业图标');
