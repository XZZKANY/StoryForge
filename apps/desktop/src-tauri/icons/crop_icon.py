"""
裁剪并生成 Tauri 所需的图标
带圆角和阴影效果
"""
from PIL import Image, ImageDraw, ImageFilter
import os

def add_rounded_corners(img, radius_percent=0.15):
    """添加圆角"""
    size = img.size[0]
    radius = int(size * radius_percent)

    # 创建圆角遮罩
    mask = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([(0, 0), (size, size)], radius=radius, fill=255)

    # 应用遮罩
    output = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    output.paste(img, (0, 0))
    output.putalpha(mask)

    return output

def add_subtle_border(img):
    """添加柔和的边框"""
    size = img.size[0]
    draw = ImageDraw.Draw(img, 'RGBA')

    # 画一个半透明的圆角边框
    radius = int(size * 0.15)
    draw.rounded_rectangle(
        [(2, 2), (size-3, size-3)],
        radius=radius,
        outline=(255, 255, 255, 40),
        width=2
    )

    return img

# 读取原图
img = Image.open(r"C:\Users\kanye\Pictures\Saved Pictures\IMG_0595.JPG")

# 转换为 RGB
if img.mode != 'RGB':
    img = img.convert('RGB')

# 裁剪成正方形（居中裁剪）
width, height = img.size
if width > height:
    left = (width - height) // 2
    img_cropped = img.crop((left, 0, left + height, height))
else:
    top = (height - width) // 2
    img_cropped = img.crop((0, top, width, top + width))

# 生成各个尺寸
sizes = [
    (32, '32x32.png'),
    (128, '128x128.png'),
    (256, '128x128@2x.png'),
    (512, 'icon.png'),
]

for size, filename in sizes:
    # 调整大小
    resized = img_cropped.resize((size, size), Image.Resampling.LANCZOS)

    # 转换为 RGBA 以支持透明度
    resized = resized.convert('RGBA')

    # 添加圆角
    rounded = add_rounded_corners(resized, radius_percent=0.15)

    # 添加柔和边框（可选）
    # rounded = add_subtle_border(rounded)

    # 保存
    rounded.save(filename)
    print(f"生成: {filename}")

# macOS icns
resized_512 = img_cropped.resize((512, 512), Image.Resampling.LANCZOS).convert('RGBA')
rounded_512 = add_rounded_corners(resized_512, radius_percent=0.15)
rounded_512.save('icon.icns')
print("生成: icon.icns")

# Windows ico
resized_256 = img_cropped.resize((256, 256), Image.Resampling.LANCZOS).convert('RGBA')
rounded_256 = add_rounded_corners(resized_256, radius_percent=0.15)
rounded_256.save('icon.ico', sizes=[(32, 32), (64, 64), (128, 128), (256, 256)])
print("生成: icon.ico")

print("\n✨ 所有圆角图标生成完成！")
