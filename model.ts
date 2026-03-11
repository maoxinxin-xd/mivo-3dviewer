/**
 * @license Copyright 2020 Google LLC. All Rights Reserved.
 *
 *   GLB材质提取器 - 纯JavaScript版本 独立的工具类，用于处理GLB文件上传和材质提取
 *
 *   使用方法：
 *
 *   1. 引入此文件
 *   2. 调用 GLBMaterialExtractor 的静态方法
 *   3. 处理返回的材质和纹理数据
 */

/** 缩略图尺寸常量 */
export const THUMBNAIL_SIZE = 256;

/** GLB材质提取器类 */
export class GLBMaterialExtractor {
  /** 从GLTF图像对象获取纹理ID */
  static getTextureId(gltfImage: any): any {
    return gltfImage.uri ?? gltfImage.bufferView?.toString();
  }

  /**
   * 为单个纹理创建缩略图并添加到Map中
   *
   * @param {Map} thumbnailsById - 纹理缩略图Map
   * @param {Object} textureInfo - 纹理信息对象
   * @param {number} thumbnailSize - 缩略图尺寸（默认256）
   * @returns {Promise<string | null>} 纹理ID或null
   */
  static async pushThumbnail(thumbnailsById: any, textureInfo: any, thumbnailSize: any = THUMBNAIL_SIZE): Promise<any> {
    const texture = textureInfo?.texture;
    if (!texture) {
      return null;
    }

    const source = texture.source;
    const id = this.getTextureId(source);

    // 避免重复创建相同纹理的缩略图
    if (!thumbnailsById.has(id)) {
      const objectUrl = await source.createThumbnail(thumbnailSize, thumbnailSize);
      thumbnailsById.set(id, {
        objectUrl,
        texture,
        id
      });
    }

    return id;
  }

  /**
   * 从单个材质中提取所有纹理
   *
   * @param {Object} material - 材质对象
   * @param {Map} thumbnailsById - 纹理缩略图Map
   * @param {number} thumbnailSize - 缩略图尺寸
   */
  static async extractTexturesFromMaterial(
    material: any,
    thumbnailsById: any,
    thumbnailSize: any = THUMBNAIL_SIZE
  ): Promise<any> {
    // 确保材质已加载
    await material.ensureLoaded();

    // 提取PBR材质的各种纹理
    const pbrMetallicRoughness = material.pbrMetallicRoughness || {};
    const normalTexture = material.normalTexture;
    const emissiveTexture = material.emissiveTexture;
    const occlusionTexture = material.occlusionTexture;
    const baseColorTexture = pbrMetallicRoughness.baseColorTexture;
    const metallicRoughnessTexture = pbrMetallicRoughness.metallicRoughnessTexture;

    // 按顺序提取所有纹理类型
    await this.pushThumbnail(thumbnailsById, normalTexture, thumbnailSize);
    await this.pushThumbnail(thumbnailsById, emissiveTexture, thumbnailSize);
    await this.pushThumbnail(thumbnailsById, occlusionTexture, thumbnailSize);
    await this.pushThumbnail(thumbnailsById, baseColorTexture, thumbnailSize);
    await this.pushThumbnail(thumbnailsById, metallicRoughnessTexture, thumbnailSize);
  }

  /**
   * 从model-viewer实例中提取所有材质和纹理
   *
   * @param {HTMLElement} modelViewer - ModelViewer元素实例
   * @param {number} thumbnailSize - 缩略图尺寸（默认256）
   * @returns {Promise<Object>} 材质提取结果
   */
  static async extractMaterialsFromModelViewer(modelViewer: any, thumbnailSize: any = THUMBNAIL_SIZE): Promise<any> {
    const thumbnailsById = new Map();

    if (!modelViewer.model || !modelViewer.model.materials) {
      throw new Error('模型或材质不可用');
    }

    const materials = modelViewer.model.materials;

    // 遍历所有材质并提取纹理
    for (const material of materials) {
      await this.extractTexturesFromMaterial(material, thumbnailsById, thumbnailSize);
    }

    // 转换为列表形式
    const thumbnailsList = Array.from(thumbnailsById.values());

    // 获取原始GLTF JSON（如果可用）
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

  /**
   * 处理文件上传（支持GLB、GLTF、HDR、图片）
   *
   * @param {File} file - 上传的文件
   * @returns {Promise<Object>} 文件上传结果
   */
  static async handleFileUpload(file: any): Promise<any> {
    const fileName = file.name;
    const fileNameLower = fileName.toLowerCase();

    let fileType;

    if (fileNameLower.match(/\.glb$/i)) {
      fileType = 'glb';
    } else if (fileNameLower.match(/\.gltf$/i)) {
      fileType = 'gltf';
    } else if (fileNameLower.match(/\.hdr$/i)) {
      fileType = 'hdr';
    } else if (fileNameLower.match(/\.(png|jpg|jpeg|webp)$/i)) {
      fileType = 'image';
    } else {
      throw new Error(`不支持的文件类型: ${fileName}`);
    }

    // 创建Blob URL
    const objectUrl = URL.createObjectURL(file);

    return {
      file,
      objectUrl,
      fileName,
      fileType
    };
  }

  /**
   * 从ArrayBuffer创建安全的Object URL
   *
   * @param {ArrayBuffer} arrayBuffer - 文件的ArrayBuffer
   * @returns {string} Object URL
   */
  static createObjectUrlFromArrayBuffer(arrayBuffer: any): any {
    const blob = new Blob([arrayBuffer]);
    return URL.createObjectURL(blob);
  }

  /**
   * 处理拖放上传的文件
   *
   * @param {DataTransfer} dataTransfer - DragEvent的dataTransfer对象
   * @returns {Promise<Array>} 文件上传结果数组
   */
  static async handleDragDrop(dataTransfer: any): Promise<any> {
    const results: any = [];

    if (!dataTransfer.items) {
      return results;
    }

    for (let i = 0; i < dataTransfer.items.length; i++) {
      const item = dataTransfer.items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          try {
            const result = await this.handleFileUpload(file);
            results.push(result);
          } catch (e) {
            console.warn(`处理文件失败 ${file.name}:`, e);
          }
        }
      }
    }

    return results;
  }

  /**
   * 清理已创建的Object URLs以释放内存
   *
   * @param {string[]} urls - 要清理的URL数组
   */
  static revokeObjectUrls(urls: any): any {
    urls.forEach((url: any) => {
      try {
        URL.revokeObjectURL(url);
      } catch (e) {
        console.warn('清理URL失败:', url, e);
      }
    });
  }

  /**
   * 完整的GLB加载和材质提取流程
   *
   * @param {File} file - GLB/GLTF文件
   * @param {HTMLElement} modelViewer - ModelViewer元素实例
   * @param {Function} onProgress - 进度回调函数(stage, progress)
   * @returns {Promise<Object>} 材质提取结果
   */
  static async processGLBFile(file: any, modelViewer: any, onProgress: any): Promise<any> {
    try {
      // 1. 处理文件上传
      onProgress?.('upload', 0);
      const uploadResult = await this.handleFileUpload(file);
      onProgress?.('upload', 100);

      // 2. 设置模型URL
      onProgress?.('loading', 0);
      modelViewer.src = uploadResult.objectUrl;

      // 3. 等待模型加载完成
      await new Promise<any>((resolve: any, reject: any) => {
        const handleLoad = () => {
          modelViewer.removeEventListener('load', handleLoad);
          modelViewer.removeEventListener('error', handleError);
          resolve();
        };

        const handleError = (event: any) => {
          modelViewer.removeEventListener('load', handleLoad);
          modelViewer.removeEventListener('error', handleError);
          reject(new Error(`模型加载失败: ${event.detail?.message || '未知错误'}`));
        };

        modelViewer.addEventListener('load', handleLoad);
        modelViewer.addEventListener('error', handleError);
      });

      onProgress?.('loading', 100);

      // 4. 提取材质和纹理
      onProgress?.('extracting', 0);
      const result = await this.extractMaterialsFromModelViewer(modelViewer);
      onProgress?.('extracting', 100);

      // 5. 完成
      onProgress?.('complete', 100);

      return result;
    } catch (error) {
      console.error('处理GLB文件时出错:', error);
      throw error;
    }
  }

  /**
   * 导出材质信息为JSON格式
   *
   * @param {Object} result - 材质提取结果
   * @returns {string} JSON字符串
   */
  static exportMaterialsToJSON(result: any): any {
    const exportData = {
      materialsCount: result.materialsCount,
      texturesCount: result.texturesCount,
      thumbnails: result.thumbnailsList.map((t: any) => ({
        id: t.id,
        objectUrl: t.objectUrl
      })),
      originalGltf: result.originalGltf
    };

    return JSON.stringify(exportData, null, 2);
  }
}

/**
 * 便捷函数：快速从文件提取材质
 *
 * @param {File} file - GLB/GLTF文件
 * @returns {Promise<Object>} 材质提取结果
 */
export async function extractMaterialsFromFile(file: any): Promise<any> {
  // 创建临时的model-viewer元素
  const tempModelViewer = document.createElement('model-viewer');
  tempModelViewer.style.position = 'fixed';
  tempModelViewer.style.top = '-9999px';
  tempModelViewer.style.width = '1px';
  tempModelViewer.style.height = '1px';
  document.body.appendChild(tempModelViewer);

  try {
    const result = await GLBMaterialExtractor.processGLBFile(file, tempModelViewer, undefined);
    return result;
  } finally {
    // 清理临时元素
    document.body.removeChild(tempModelViewer);
  }
}

/**
 * 便捷函数：从URL提取材质
 *
 * @param {string} url - GLB/GLTF文件URL
 * @param {HTMLElement} modelViewer - ModelViewer元素实例
 * @returns {Promise<Object>} 材质提取结果
 */
export async function extractMaterialsFromUrl(url: any, modelViewer: any): Promise<any> {
  modelViewer.src = url;

  // 等待加载完成
  await new Promise<any>((resolve: any, reject: any) => {
    const handleLoad = () => {
      modelViewer.removeEventListener('load', handleLoad);
      modelViewer.removeEventListener('error', handleError);
      resolve();
    };

    const handleError = (event: any) => {
      modelViewer.removeEventListener('load', handleLoad);
      modelViewer.removeEventListener('error', handleError);
      reject(new Error(`模型加载失败: ${event.detail?.message || '未知错误'}`));
    };

    modelViewer.addEventListener('load', handleLoad);
    modelViewer.addEventListener('error', handleError);
  });

  return GLBMaterialExtractor.extractMaterialsFromModelViewer(modelViewer);
}

// 如果在浏览器环境中直接使用
if (typeof window !== 'undefined') {
  (window as any).GLBMaterialExtractor = GLBMaterialExtractor;
  (window as any).extractMaterialsFromFile = extractMaterialsFromFile;
  (window as any).extractMaterialsFromUrl = extractMaterialsFromUrl;
}
