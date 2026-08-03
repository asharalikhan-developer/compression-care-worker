import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import config from '../config/index.js';

/**
 * S3-backed PDF store. Drop-in replacement for CloudinaryService — exposes the
 * same method surface (`uploadPdf`, `uploadPdfWithMeta`, `deleteFile`) so the
 * processors/content-extractor don't change beyond their import line.
 *
 * OpenAI's Responses API fetches the `file_url` from its own servers, so the
 * URL must be publicly reachable. We keep the bucket private and hand back a
 * short-lived presigned GET URL instead of making objects public. The object is
 * deleted (`deleteFile`) right after extraction, so the presign only needs to
 * outlive the OpenAI call.
 */
class S3Service {
  constructor() {
    this.client = null;
  }

  initialize() {
    if (!config.s3.bucket || !config.s3.region) {
      throw new Error(
        'S3 is not configured. Please set AWS_S3_BUCKET and AWS_REGION in .env file'
      );
    }

    // If explicit keys are provided, use them; otherwise fall back to the AWS
    // SDK default credential chain (EC2 IAM instance role, shared config, etc.).
    const clientConfig = { region: config.s3.region };
    if (config.s3.accessKeyId && config.s3.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey,
      };
    }

    this.client = new S3Client(clientConfig);
    console.log(
      `✅ S3 service initialized (bucket: ${config.s3.bucket}, region: ${config.s3.region}` +
      `${clientConfig.credentials ? '' : ', creds: IAM role/default chain'})`
    );
    return this;
  }

  /**
   * Upload a PDF buffer to S3 and return a presigned GET URL + the object key.
   * @param {Buffer} pdfBuffer - The PDF file as a buffer
   * @param {string} filename - Original filename for reference
   * @returns {Promise<{ url: string, publicId: string }>} - `publicId` is the S3 key
   */
  async uploadPdfWithMeta(pdfBuffer, filename = 'document.pdf') {
    try {
      const safeName = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
      const key = `fax-documents/${Date.now()}_${safeName}`;

      await this.client.send(
        new PutObjectCommand({
          Bucket: config.s3.bucket,
          Key: key,
          Body: pdfBuffer,
          ContentType: 'application/pdf',
        })
      );

      const url = await getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }),
        { expiresIn: config.s3.presignExpirySeconds }
      );

      console.log(`✅ PDF uploaded to S3: s3://${config.s3.bucket}/${key}`);
      return { url, publicId: key };
    } catch (error) {
      console.error('S3 upload error:', error.message);
      throw new Error(`Failed to upload PDF to S3: ${error.message}`);
    }
  }

  async uploadPdf(pdfBuffer, filename = 'document.pdf') {
    const { url } = await this.uploadPdfWithMeta(pdfBuffer, filename);
    return url;
  }

  /**
   * Delete an object from S3.
   * @param {string} publicId - The S3 key of the object to delete
   * @returns {Promise<void>}
   */
  async deleteFile(publicId) {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: publicId })
      );
      console.log(`✅ File deleted from S3: ${publicId}`);
    } catch (error) {
      console.error('S3 delete error:', error.message);
      throw new Error(`Failed to delete file from S3: ${error.message}`);
    }
  }
}

export const s3Service = new S3Service();
export default s3Service;
