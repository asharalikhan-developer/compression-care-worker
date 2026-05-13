import { v2 as cloudinary } from 'cloudinary';
import config from '../config/index.js';

class CloudinaryService {
  constructor() {
    this.client = null;
  }

  initialize() {
    if (!config.cloudinary.cloudName || !config.cloudinary.apiKey || !config.cloudinary.apiSecret) {
      throw new Error(
        'Cloudinary credentials are not configured. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in .env file'
      );
    }

    cloudinary.config({
      cloud_name: config.cloudinary.cloudName,
      api_key: config.cloudinary.apiKey,
      api_secret: config.cloudinary.apiSecret,
      secure: true

    });

    this.client = cloudinary;
    console.log('✅ Cloudinary service initialized successfully');
    return this;
  }

  /**
   * Upload a PDF file to Cloudinary and return the secure URL
   * @param {Buffer} pdfBuffer - The PDF file as a buffer
   * @param {string} filename - Original filename for reference
   * @returns {Promise<string>} - The secure URL of the uploaded PDF
   */
  async uploadPdf(pdfBuffer, filename = 'document.pdf') {
    try {
      const base64Data = `data:application/pdf;base64,${pdfBuffer.toString('base64')}`;
      
      const uploadOptions = {
        resource_type: 'raw',
        folder: 'fax-documents',
        public_id: `${Date.now()}_${filename.replace(/[^a-zA-Z0-9.-]/g, '_')}`,
        format: 'pdf',
      };

      const result = await this.client.uploader.upload(base64Data, uploadOptions);
      
      console.log(`✅ PDF uploaded to Cloudinary: ${result.secure_url}`);
      return result.secure_url;
    } catch (error) {
      console.error('Cloudinary upload error:', error.message);
      throw new Error(`Failed to upload PDF to Cloudinary: ${error.message}`);
    }
  }

  /**
   * Delete a file from Cloudinary
   * @param {string} publicId - The public ID of the file to delete
   * @returns {Promise<void>}
   */
  async deleteFile(publicId) {
    try {
      await this.client.uploader.destroy(publicId, { resource_type: 'raw' });
      console.log(`✅ File deleted from Cloudinary: ${publicId}`);
    } catch (error) {
      console.error('Cloudinary delete error:', error.message);
      throw new Error(`Failed to delete file from Cloudinary: ${error.message}`);
    }
  }
}

export const cloudinaryService = new CloudinaryService();
export default cloudinaryService;
