// 简单的图标占位符生成器
const fs = require('fs');
const path = require('path');

const iconsDir = path.join(__dirname, 'src-tauri', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// 创建一个最小的有效 ICO 文件（32x32 蓝色方块）
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
  const dibSize = 40 + width * height * 4;
  const entry = Buffer.alloc(16);
  entry[0] = width;
  entry[1] = height;
  entry[2] = 0;
  entry[3] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(bpp, 6);
  entry.writeUInt32LE(dibSize, 8);
  entry.writeUInt32LE(22, 12);

  // BITMAPINFOHEADER (40 bytes)
  const dib = Buffer.alloc(40);
  dib.writeUInt32LE(40, 0);
  dib.writeInt32LE(width, 4);
  dib.writeInt32LE(height * 2, 8);
  dib.writeUInt16LE(1, 12);
  dib.writeUInt16LE(bpp, 14);
  dib.writeUInt32LE(0, 16);
  dib.writeUInt32LE(width * height * 4, 20);

  // Pixel data (BGRA format, 蓝色)
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4 + 0] = 0x64; // Blue
    pixels[i * 4 + 1] = 0x95; // Green
    pixels[i * 4 + 2] = 0xed; // Red
    pixels[i * 4 + 3] = 0xff; // Alpha
  }

  return Buffer.concat([header, entry, dib, pixels]);
};

console.log('生成图标占位符...');

// 生成 ICO
const icoPath = path.join(iconsDir, 'icon.ico');
fs.writeFileSync(icoPath, createMinimalICO());
console.log('✓ 已生成 icon.ico (32x32 蓝色方块)');

// 生成空的占位 PNG 文件（1x1 透明像素，最小有效 PNG）
const minimalPNG = Buffer.from([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a, // PNG signature
  0x00,
  0x00,
  0x00,
  0x0d,
  0x49,
  0x48,
  0x44,
  0x52, // IHDR chunk
  0x00,
  0x00,
  0x00,
  0x01,
  0x00,
  0x00,
  0x00,
  0x01, // 1x1 pixels
  0x08,
  0x06,
  0x00,
  0x00,
  0x00,
  0x1f,
  0x15,
  0xc4,
  0x89,
  0x00,
  0x00,
  0x00,
  0x0a,
  0x49,
  0x44,
  0x41, // IDAT chunk
  0x54,
  0x78,
  0x9c,
  0x63,
  0x00,
  0x01,
  0x00,
  0x00,
  0x05,
  0x00,
  0x01,
  0x0d,
  0x0a,
  0x2d,
  0xb4,
  0x00,
  0x00,
  0x00,
  0x00,
  0x49,
  0x45,
  0x4e,
  0x44,
  0xae, // IEND chunk
  0x42,
  0x60,
  0x82,
]);

fs.writeFileSync(path.join(iconsDir, '32x32.png'), minimalPNG);
console.log('✓ 已生成 32x32.png (占位符)');

fs.writeFileSync(path.join(iconsDir, '128x128.png'), minimalPNG);
console.log('✓ 已生成 128x128.png (占位符)');

fs.writeFileSync(path.join(iconsDir, '128x128@2x.png'), minimalPNG);
console.log('✓ 已生成 128x128@2x.png (占位符)');

// 创建空的 .icns（macOS）
fs.writeFileSync(path.join(iconsDir, 'icon.icns'), Buffer.alloc(0));
console.log('✓ 已生成 icon.icns (空文件，仅占位)');

console.log('\n✅ 图标占位符已生成！现在可以编译了。');
console.log('💡 提示：使用 https://icon.kitchen 生成专业图标替换这些占位符');
