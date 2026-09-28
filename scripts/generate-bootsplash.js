#!/usr/bin/env node
/**
 * Boot splash asset generator (light + dark).
 *
 * react-native-bootsplash's CLI puts its `--dark-background` / `--dark-logo`
 * flags behind a paid `--license-key`, so the free CLI can only emit one
 * background. That is why iOS showed a white splash in dark mode. This script
 * writes what the licensed generator would: the M2M logo on a white background
 * in light mode and on the app's navy background in dark mode.
 *
 * Android rules, taken from the library's own generator
 * (node_modules/react-native-bootsplash/dist/commonjs/generate.js): the logo is
 * composited onto a transparent 288dp canvas — the icon window Android 12+ hands
 * to `windowSplashScreenAnimatedIcon` — and Android masks that window to a
 * 192dp circle. The M2M logo is wide, so it is sized by its farthest opaque
 * pixel from the centre rather than by its bounding box; a 192dp-wide logo
 * would lose its corners.
 *
 * Usage: node scripts/generate-bootsplash.js
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');

// The same artwork works on both backgrounds (red letters with a white
// extrusion), so one master serves light and dark.
const SOURCE = path.join(ROOT, 'assets/MM2logo.webp');

// Kept in sync with backgroundDark in Code/Helper/Environment.js and
// app_window_background_dark in android/app/src/main/res/values/colors.xml so
// the splash hands over to the first screen without a colour step.
const BACKGROUND = '#FFFFFF';
const DARK_BACKGROUND = '#040D1A';

const ANDROID_CANVAS_DP = 288; // Android 12+ splash icon window
const ANDROID_MASK_RADIUS_DP = 92; // 192dp circle, less a 4dp safety margin
const IOS_LOGO_WIDTH_PT = 220;

const ANDROID_DENSITIES = [
  { suffix: 'mdpi', ratio: 1 },
  { suffix: 'hdpi', ratio: 1.5 },
  { suffix: 'xhdpi', ratio: 2 },
  { suffix: 'xxhdpi', ratio: 3 },
  { suffix: 'xxxhdpi', ratio: 4 },
];

const ANDROID_RES = path.join(ROOT, 'android/app/src/main/res');
const IOS_DIR = path.join(ROOT, 'ios/bloxfruitevalues');
// Names the library's CLI generated originally; BootSplash.storyboard and the
// Xcode project already reference them, so they are kept.
const IOS_LOGO_SET = 'BootSplashLogo-2f8f59';
const IOS_COLOR_SET = 'BootSplashBackground-2f8f59';
const JS_ASSETS = path.join(ROOT, 'assets/bootsplash');

const ensureDir = dir => fs.mkdirSync(dir, { recursive: true });
const written = [];

const write = (file, buffer) => {
  fs.writeFileSync(file, buffer);
  written.push(`${path.relative(ROOT, file)} (${(buffer.length / 1024).toFixed(1)} KB)`);
};

/** Strip the transparent margin so sizing is driven by the artwork, not the export canvas. */
const trim = async file => {
  const buffer = await sharp(file).trim({ threshold: 1 }).png().toBuffer();
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  // Farthest visible pixel from the centre: what the circular mask must clear.
  const cx = width / 2;
  const cy = height / 2;
  let maxRadius = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + 3] > 16) {
        maxRadius = Math.max(maxRadius, Math.hypot(x + 0.5 - cx, y + 0.5 - cy));
      }
    }
  }
  return { buffer, width, height, maxRadius };
};

const resizeToWidth = (logo, width) =>
  sharp(logo.buffer)
    .resize({ width: Math.round(width), kernel: 'lanczos3' })
    .png()
    .toBuffer();

/** Logo centred on the transparent 288dp canvas Android expects. */
const androidCanvas = async (logo, logoWidthDp, ratio) => {
  const size = ANDROID_CANVAS_DP * ratio;
  const input = await resizeToWidth(logo, logoWidthDp * ratio);

  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input }])
    .png({ compressionLevel: 9 })
    .toBuffer();
};

const generateAndroid = async (logo, logoWidthDp) => {
  for (const { suffix, ratio } of ANDROID_DENSITIES) {
    const dir = path.join(ANDROID_RES, `drawable-${suffix}`);
    ensureDir(dir);
    write(path.join(dir, 'bootsplash_logo.png'), await androidCanvas(logo, logoWidthDp, ratio));
  }
};

const hexToRgb = hex => {
  const int = parseInt(hex.replace('#', ''), 16);
  return { red: (int >> 16) & 255, green: (int >> 8) & 255, blue: int & 255 };
};

const hexToComponents = hex => {
  const { red, green, blue } = hexToRgb(hex);
  return {
    red: (red / 255).toFixed(3),
    green: (green / 255).toFixed(3),
    blue: (blue / 255).toFixed(3),
  };
};

/**
 * The launch screen is generated rather than hand-edited so its size can never
 * drift from the image set. `image` and `name` both resolve through the asset
 * catalog at runtime, which is what gives iOS its dark variant.
 */
const launchScreenXml = ({ width, height }) => {
  const { red, green, blue } = hexToRgb(BACKGROUND);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generated by scripts/generate-bootsplash.js — edit that script, not this file. -->
<document type="com.apple.InterfaceBuilder3.CocoaTouch.Storyboard.XIB" version="3.0" toolsVersion="21701" targetRuntime="iOS.CocoaTouch" propertyAccessControl="none" useAutolayout="YES" launchScreen="YES" useTraitCollections="YES" useSafeAreas="YES" colorMatched="YES" initialViewController="01J-lp-oVM">
    <device id="retina4_7" orientation="portrait" appearance="light"/>
    <dependencies>
        <deployment identifier="iOS"/>
        <plugIn identifier="com.apple.InterfaceBuilder.IBCocoaTouchPlugin" version="21678"/>
        <capability name="Named colors" minToolsVersion="9.0"/>
        <capability name="Safe area layout guides" minToolsVersion="9.0"/>
        <capability name="documents saved in the Xcode 8 format" minToolsVersion="8.0"/>
    </dependencies>
    <scenes>
        <!--View Controller-->
        <scene sceneID="EHf-IW-A2E">
            <objects>
                <viewController modalTransitionStyle="crossDissolve" id="01J-lp-oVM" sceneMemberID="viewController">
                    <view key="view" autoresizesSubviews="NO" contentMode="scaleToFill" id="Ze5-6b-2t3">
                        <rect key="frame" x="0.0" y="0.0" width="375" height="667"/>
                        <autoresizingMask key="autoresizingMask" widthSizable="YES" heightSizable="YES"/>
                        <subviews>
                            <imageView autoresizesSubviews="NO" clipsSubviews="YES" userInteractionEnabled="NO" contentMode="scaleAspectFit" image="${IOS_LOGO_SET}" translatesAutoresizingMaskIntoConstraints="NO" id="3lX-Ut-9ad">
                                <rect key="frame" x="${((375 - width) / 2).toFixed(1)}" y="${((667 - height) / 2).toFixed(1)}" width="${width}" height="${height}"/>
                                <constraints>
                                    <constraint firstAttribute="width" constant="${width}" id="Log-Wi-dth"/>
                                    <constraint firstAttribute="height" constant="${height}" id="Log-He-ght"/>
                                </constraints>
                                <accessibility key="accessibilityConfiguration">
                                    <accessibilityTraits key="traits" image="YES" notEnabled="YES"/>
                                </accessibility>
                            </imageView>
                        </subviews>
                        <viewLayoutGuide key="safeArea" id="Bcu-3y-fUS"/>
                        <color key="backgroundColor" name="${IOS_COLOR_SET}"/>
                        <constraints>
                            <constraint firstItem="3lX-Ut-9ad" firstAttribute="centerX" secondItem="Ze5-6b-2t3" secondAttribute="centerX" id="Fh9-Fy-1nT"/>
                            <constraint firstItem="3lX-Ut-9ad" firstAttribute="centerY" secondItem="Ze5-6b-2t3" secondAttribute="centerY" id="nvB-Ic-PnI"/>
                        </constraints>
                    </view>
                </viewController>
                <placeholder placeholderIdentifier="IBFirstResponder" id="iYj-Kq-Ea1" userLabel="First Responder" sceneMemberID="firstResponder"/>
            </objects>
            <point key="canvasLocation" x="0.0" y="0.0"/>
        </scene>
    </scenes>
    <resources>
        <image name="${IOS_LOGO_SET}" width="${width}" height="${height}"/>
        <namedColor name="${IOS_COLOR_SET}">
            <color red="${(red / 255).toFixed(17)}" green="${(green / 255).toFixed(17)}" blue="${(blue / 255).toFixed(17)}" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>
        </namedColor>
    </resources>
</document>
`;
};

const generateIOS = async logo => {
  const imageset = path.join(IOS_DIR, 'Images.xcassets', `${IOS_LOGO_SET}.imageset`);
  ensureDir(imageset);
  for (const file of fs.readdirSync(imageset)) {
    fs.unlinkSync(path.join(imageset, file));
  }

  const heightPt = Math.round((IOS_LOGO_WIDTH_PT * logo.height) / logo.width);
  const images = [];

  for (const scale of [1, 2, 3]) {
    const name = `bootsplash-logo@${scale}x.png`;
    write(path.join(imageset, name), await resizeToWidth(logo, IOS_LOGO_WIDTH_PT * scale));
    images.push({ idiom: 'universal', filename: name, scale: `${scale}x` });
  }

  write(
    path.join(imageset, 'Contents.json'),
    Buffer.from(`${JSON.stringify({ images, info: { author: 'xcode', version: 1 } }, null, 2)}\n`),
  );

  const colorset = path.join(IOS_DIR, 'Colors.xcassets', `${IOS_COLOR_SET}.colorset`);
  ensureDir(colorset);

  const color = (hex, appearances) => ({
    idiom: 'universal',
    ...(appearances ? { appearances } : {}),
    color: {
      'color-space': 'srgb',
      components: { alpha: '1.000', ...hexToComponents(hex) },
    },
  });

  write(
    path.join(colorset, 'Contents.json'),
    Buffer.from(
      `${JSON.stringify(
        {
          colors: [
            color(BACKGROUND),
            color(DARK_BACKGROUND, [{ appearance: 'luminosity', value: 'dark' }]),
          ],
          info: { author: 'xcode', version: 1 },
        },
        null,
        2,
      )}\n`,
    ),
  );

  write(
    path.join(IOS_DIR, 'BootSplash.storyboard'),
    Buffer.from(launchScreenXml({ width: IOS_LOGO_WIDTH_PT, height: heightPt })),
  );
};

/** The library's own copy of the assets, kept so the manifest describes what shipped. */
const generateJSAssets = async (logo, logoWidthDp) => {
  ensureDir(JS_ASSETS);

  for (const { ratio } of ANDROID_DENSITIES) {
    const suffix = ratio === 1 ? '' : `@${String(ratio).replace('.', ',')}x`;
    write(path.join(JS_ASSETS, `logo${suffix}.png`), await resizeToWidth(logo, logoWidthDp * ratio));
  }

  const { width, height } = await sharp(await resizeToWidth(logo, logoWidthDp)).metadata();

  write(
    path.join(JS_ASSETS, 'manifest.json'),
    Buffer.from(
      `${JSON.stringify(
        { background: BACKGROUND, darkBackground: DARK_BACKGROUND, logo: { width, height } },
        null,
        2,
      )}\n`,
    ),
  );
};

const main = async () => {
  if (!fs.existsSync(SOURCE)) {
    throw new Error(`Missing logo master: ${path.relative(ROOT, SOURCE)}`);
  }

  const logo = await trim(SOURCE);
  // Largest width whose farthest visible pixel still sits inside the mask.
  const logoWidthDp = Math.min(192, Math.floor((ANDROID_MASK_RADIUS_DP * logo.width) / logo.maxRadius));

  await generateAndroid(logo, logoWidthDp);
  await generateIOS(logo);
  await generateJSAssets(logo, logoWidthDp);

  console.log(written.join('\n'));
  console.log(`\nAndroid logo: ${logoWidthDp}dp wide. ${written.length} files written.`);
};

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
