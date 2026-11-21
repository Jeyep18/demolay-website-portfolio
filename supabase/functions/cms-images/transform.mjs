import { dimensions, inspectImage, ImageRequestError, MAX_FILE_BYTES } from "./validation.mjs";

export async function initializeImages(magick, wasm) {
  const configuration = magick.ConfigurationFiles.default;
  configuration.policy.data = `<?xml version="1.0"?><policymap>
    <policy domain="delegate" rights="none" pattern="*" />
    <policy domain="coder" rights="none" pattern="*" />
    <policy domain="coder" rights="read|write" pattern="{JPEG,PNG,WEBP}" />
    <policy domain="path" rights="none" pattern="@*" />
    <policy domain="resource" name="map" value="0" />
  </policymap>`;
  await magick.initializeImageMagick(wasm, configuration);
  imagePolicy(magick);
}

export function imagePolicy(magick) {
  const { ResourceLimits } = magick;
  ResourceLimits.memory = 96n * 1024n * 1024n;
  ResourceLimits.disk = 0n;
  ResourceLimits.maxMemoryRequest = 96n * 1024n * 1024n;
  ResourceLimits.maxProfileSize = 1024n * 1024n;
  ResourceLimits.area = 20_000_000n;
  ResourceLimits.width = 20_000n;
  ResourceLimits.height = 20_000n;
  // ImageMagick needs temporary image slots while converting a single still image.
  ResourceLimits.listLength = 4n;
  ResourceLimits.time = 2n;
}

export function transformImage(data, magick) {
  const info = inspectImage(data);
  const { ImageMagick, MagickReadSettings, MagickFormat } = magick;
  const settings = new MagickReadSettings({
    format: MagickFormat[info.format === "JPEG" ? "Jpeg" : info.format === "PNG" ? "Png" : "WebP"],
    frameCount: 1,
    frameIndex: 0,
  });
  try {
    return ImageMagick.read(data, settings, (image) => {
      dimensions(image.width, image.height);
      if (image.width !== info.width || image.height !== info.height)
        throw new Error("Header mismatch");
      image.autoOrient();
      const scale = Math.min(
        1,
        4096 / image.width,
        4096 / image.height,
        Math.sqrt(16_000_000 / (image.width * image.height)),
      );
      if (scale < 1)
        image.resize(
          Math.max(1, Math.floor(image.width * scale)),
          Math.max(1, Math.floor(image.height * scale)),
        );
      image.strip();
      image.quality = 82;
      return image.write(MagickFormat.WebP, (output) => {
        if (output.length > MAX_FILE_BYTES || !output.length)
          throw new Error("Derivative too large");
        return { data: output.slice(), width: image.width, height: image.height, mime: info.mime };
      });
    });
  } catch {
    throw new ImageRequestError(
      "This image could not be safely processed. Try a smaller JPEG, PNG, or WebP image.",
    );
  }
}
