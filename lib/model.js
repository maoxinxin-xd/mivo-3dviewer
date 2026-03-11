/**
 * GLB材质提取器 - 纯JavaScript版本
 * 独立的工具类，用于处理GLB文件上传和材质提取
 */

export const THUMBNAIL_SIZE = 256;

export class GLBMaterialExtractor {
  static getTextureId(gltfImage) {
    return gltfImage.uri ?? gltfImage.bufferView?.toString();
  }

  static async pushThumbnail(thumbnailsById, textureInfo, thumbnailSize = THUMBNAIL_SIZE) {
    const texture = textureInfo?.texture;
    if (!texture) return null;

    const source = texture.source;
    const id = this.getTextureId(source);

    if (!thumbnailsById.has(id)) {
      const objectUrl = await source.createThumbnail(thumbnailSize, thumbnailSize);
      thumbnailsById.set(id, { objectUrl, texture, id });
    }

    return id;
  }

  static async extractTexturesFromMaterial(material, thumbnailsById, thumbnailSize = THUMBNAIL_SIZE) {
    await material.ensureLoaded();

    const pbrMetallicRoughness = material.pbrMetallicRoughness || {};
    const normalTexture = material.normalTexture;
    const emissiveTexture = material.emissiveTexture;
    const occlusionTexture = material.occlusionTexture;
    const baseColorTexture = pbrMetallicRoughness.baseColorTexture;
    const metallicRoughnessTexture = pbrMetallicRoughness.metallicRoughnessTexture;

    await this.pushThumbnail(thumbnailsById, normalTexture, thumbnailSize);
    await this.pushThumbnail(thumbnailsById, emissiveTexture, thumbnailSize);
    await this.pushThumbnail(thumbnailsById, occlusionTexture, thumbnailSize);
    await this.pushThumbnail(thumbnailsById, baseColorTexture, thumbnailSize);
    await this.pushThumbnail(thumbnailsById, metallicRoughnessTexture, thumbnailSize);
  }

  static async extractMaterialsFromModelViewer(modelViewer, thumbnailSize = THUMBNAIL_SIZE) {
    const thumbnailsById = new Map();

    if (!modelViewer.model || !modelViewer.model.materials) {
      throw new Error('模型或材质不可用');
    }

    const materials = modelViewer.model.materials;

    for (const material of materials) {
      await this.extractTexturesFromMaterial(material, thumbnailsById, thumbnailSize);
    }

    const thumbnailsList = Array.from(thumbnailsById.values());

    let originalGltf;
    try {
      if (modelViewer.originalGltfJson) {
        const originalGltfJson = JSON.stringify(modelViewer.originalGltfJson, null, 2);
        originalGltf = JSON.parse(originalGltfJson);
      }
    } catch (e) {
      console.warn('无法提取原始GLTF JSON:', e);
    }

    return {
      thumbnailsById,
      thumbnailsList,
      materialsCount: materials.length,
      texturesCount: thumbnailsById.size,
      originalGltf
    };
  }

  static async handleFileUpload(file) {
    const fileName = file.name;
    const fileNameLower = fileName.toLowerCase();

    let fileType;
    if (fileNameLower.match(/\.glb$/i)) {
      fileType = 'glb';
    } else if (fileNameLower.match(/\.gltf$/i)) {
      fileType = 'gltf';
    } else {
      throw new Error(`不支持的文件类型: ${fileName}`);
    }

    const objectUrl = URL.createObjectURL(file);
    return { file, objectUrl, fileName, fileType };
  }

  static revokeObjectUrls(urls) {
    urls.forEach((url) => {
      try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
    });
  }
}
