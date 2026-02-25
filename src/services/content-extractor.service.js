import pdf from 'pdf-parse/lib/pdf-parse.js';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import mammoth from 'mammoth';
import Tesseract from 'tesseract.js';
import sharp from 'sharp';
import XLSX from "xlsx";
import { execFile } from 'child_process';
import { writeFile, unlink, mkdir, readdir, readFile as fsReadFile } from 'fs/promises';
import { rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';


class ContentExtractorService {
  constructor() {
    this.supportedImageTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/tiff',
      'image/bmp',
    ];
    
    this.supportedDocTypes = {
      pdf: ['application/pdf'],
      docx: [
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword',
        
      ],
      excel: [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'text/csv',
        'application/csv',
  
      ],
    };
  }

 
  async extractContent(email) {
    const extractedContent = {
      emailId: email.id,
      subject: email.subject,
      from: email.from,
      date: email.date,
      textContent: null,
      attachmentContents: [],
      images: [],
    };

    const bodyParts = [];
    
    if (email.body.text && email.body.text.trim().length > 0) {
      bodyParts.push(email.body.text.trim());
      console.log('  📝 Found plain text email body');
    }
    
    if (email.body.html) {
      const htmlText = this.stripHtml(email.body.html);
      if (htmlText.trim().length > 0) {
        if (bodyParts.length === 0 || htmlText.length > bodyParts[0].length * 1.2) {
          if (bodyParts.length > 0) {
            bodyParts[0] = htmlText;
          } else {
            bodyParts.push(htmlText);
          }
        }
        console.log('  📝 Extracted text from HTML email body');
      }
    }
    
    if (bodyParts.length > 0) {
      extractedContent.textContent = bodyParts.join('\n\n');
      console.log(`  📄 Email body content length: ${extractedContent.textContent.length} characters`);
    } else {
      console.log('  ⚠️ No text content found in email body');
    }

    for (const attachment of email.attachments) {
      try {
        const content = await this.processAttachment(attachment);
        if (content) {
          if (content.type === 'text') {
            extractedContent.attachmentContents.push({
              filename: attachment.filename,
              content: content.data,
            });
          } else if (content.type === 'image') {
            extractedContent.images.push({
              filename: attachment.filename,
              base64: content.data,
              mimeType: attachment.mimeType,
            });
          }
        }
      } catch (error) {
        console.error(`Error processing attachment ${attachment.filename}:`, error.message);
      }
    }

    return extractedContent;
  }

 
  async processAttachment(attachment) {
    const { mimeType, data, filename } = attachment;

    if (this.supportedDocTypes.pdf.includes(mimeType) || filename?.toLowerCase().endsWith('.pdf')) {
      console.log(`  📄 Processing PDF: ${filename}`);
      const text = await this.extractFromPdf(data);
      
      // if (!text || text.trim().length === 0) {
      //   console.log('  📸 PDF appears to be fully scanned/image-based, sending to Vision API');
      //   const base64 = data.toString('base64');
      //   return { 
      //     type: 'image', 
      //     data: base64,
      //     mimeType: 'application/pdf',
      //     note: 'Scanned PDF - sent as image for Vision analysis'
      //   };
      // }
      
      console.log(`  ✅ Extracted ${text.length} characters from PDF (including any embedded images)`);
      return { type: 'text', data: text };
    }

    if (this.supportedDocTypes.docx.includes(mimeType) || filename?.endsWith('.docx') || filename?.endsWith('.doc')) {
      console.log(`  📄 Processing DOCX: ${filename}`);
      const text = await this.extractFromDocx(data);
      console.log(`  ✅ Extracted ${text.length} characters from DOCX (including any embedded images)`);
      return { type: 'text', data: text };
    }
    if (this.supportedDocTypes.excel.includes(mimeType) || filename?.endsWith('.xlsx') || filename?.endsWith('.xls') || filename?.endsWith('.csv')) {
      console.log(`  📄 Processing Excel: ${filename}`);
      const text = await this.parseExcelAttachment(data);
      console.log(`  ✅ Extracted ${text.length} characters from Excel`);
      return { type: 'text', data: text };
    }
    if (this.supportedImageTypes.includes(mimeType) || this.isImageFile(filename)) {
      
      
      const ocrText = await this.extractFromImage(data);
      
      const optimizedImage = await this.optimizeImageForApi(data);
      const base64 = optimizedImage.toString('base64');
      
      return { 
        type: 'image', 
        data: base64,
        ocrText: ocrText,
        mimeType: mimeType || 'image/jpeg',
      };
    }

    if (mimeType === 'text/plain') {
      return { type: 'text', data: data.toString('utf-8') };
    }

    console.warn(`Unsupported attachment type: ${mimeType}`);
    return null;
  }

 
  async extractFromPdf(buffer) {
    let textContent = '';
    let imageTexts = [];
    let isImageBasedPdf = false;

    try {
      const data = await pdf(buffer);
      if (data.text && data.text.trim().length > 0) {
        textContent = data.text;
      }
    } catch (error) {
      console.warn('PDF-parse failed, trying fallback method:', error.message);
    }

    if (!textContent) {
      try {
        textContent = await this.extractFromPdfWithPdfjs(buffer);
      } catch (error) {
        console.warn('PDFJS text extraction failed:', error.message);
      }
    }

    // Check if PDF is image-based (scanned/fax)
    const textLength = textContent ? textContent.trim().length : 0;
    if (textLength < 50) {
      console.log('  📄 PDF appears to be image-based (scanned/fax) - using advanced processing');
      isImageBasedPdf = true;
    }

    try {
      console.log('  🔍 Scanning PDF for embedded images...');
      imageTexts = await this.extractImagesFromPdf(buffer, isImageBasedPdf);
      if (imageTexts.length > 0) {
        console.log(`  📸 Found and processed ${imageTexts.length} embedded image(s) in PDF`);
      }
    } catch (error) {
      console.warn('PDF image extraction failed:', error.message);
    }

    // If image-based PDF and no success with embedded extraction, convert entire pages
    if (isImageBasedPdf && imageTexts.length === 0) {
      console.log('  🖼️  Converting PDF pages to images for advanced OCR...');
      try {
        const pageTexts = await this.extractFromImageBasedPdf(buffer);
        imageTexts = pageTexts;
      } catch (error) {
        console.warn('PDF page conversion failed:', error.message);
      }
    }

    const allContent = [textContent, ...imageTexts].filter(t => t && t.trim().length > 0);
    
    if (allContent.length === 0) {
      console.warn('Could not extract any content from PDF');
      return '';
    }

    return allContent.join('\n\n--- [Image Content] ---\n\n');
  }

  async extractImagesFromPdf(buffer, isImageBasedPdf = false) {
    const imageTexts = [];
    
    try {
      const uint8Array = new Uint8Array(buffer);
      const loadingTask = pdfjsLib.getDocument({
        data: uint8Array,
        useSystemFonts: true,
      });
      
      const pdfDocument = await loadingTask.promise;
// console.log("pdf Document pages",pdfDocument.numPages);
      for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
        try {
          const page = await pdfDocument.getPage(pageNum);
          // console.log("before operator",page);
          
          const operatorList = await page.getOperatorList();
          // console.log("after operator",operatorList);
          
          for (let i = 0; i < operatorList.fnArray.length; i++) {
            const fn = operatorList.fnArray[i];
            // console.log("inside loop fn: ",fn);
            
            // 82=paintJpegXObject, 83=paintImageMaskXObject, 84=paintImageMaskXObjectGroup
            // 85=paintImageXObject, 86=paintInlineImageXObject, 87=paintInlineImageXObjectGroup
            if (fn >= 82 && fn <= 87) {
              try {
                const imgData = operatorList.argsArray[i];
                // console.log("imgData ", imgData);
                
                if (imgData && imgData[0]) {
                  const imgName = imgData[0];
                  // const objs = page.objs;
                  // console.log("objs =====> ", objs);
                  
                  const imgObj = await new Promise((resolve) => {
              // Try page-specific objects first
              page.objs.get(imgName, (obj) => {
                if (obj) return resolve(obj);
                
                // If not in page.objs, check commonObjs
                page.commonObjs.get(imgName, (commonObj) => {
                  resolve(commonObj);
                });
              });
            });


                  
                  // if (objs._objs && objs._objs[imgName]) {
                  //   console.log("objs._objs =====> ",objs._objs);
                    
                  //   const imgObj = objs._objs[imgName];
                    // console.log("imgObj =====> ", imgObj);
                    if (imgObj.data) {
                      const imageBuffer = await this.convertPdfImageToBuffer(imgObj);
                      // console.log("imageBuffer =====> ", imageBuffer);
                      if (imageBuffer) {
                        const ocrText = await this.extractFromImage(imageBuffer, isImageBasedPdf);
                        if (ocrText && ocrText.trim().length > 10) {
                          imageTexts.push(ocrText);
                          console.log(`    📄 OCR extracted text from image on page ${pageNum}`);
                        }
                      }
                    }
                  }
                // }
              } catch (imgError) {
                console.warn(`    Error processing image on page ${pageNum}:`, imgError.message);
              }
            }
          }
        } catch (pageError) {
          console.warn(`Error processing page ${pageNum}:`, pageError.message);
        }
      }
    } catch (error) {
      console.warn('PDF image extraction error:', error.message);
    }

    return imageTexts;
  }

  // async convertPdfImageToBuffer(imageData) {
  //   try {
  //     const { width, height, data } = imageData;
      
  //     if (!width || !height || !data) {
  //       return null;
  //     }

  //     const channels = data.length / (width * height);
      
  //     if (channels === 4) {
  //       return await sharp(Buffer.from(data), {
  //         raw: { width, height, channels: 4 }
  //       }).png().toBuffer();
  //     } else if (channels === 3) {
  //       return await sharp(Buffer.from(data), {
  //         raw: { width, height, channels: 3 }
  //       }).png().toBuffer();
  //     } else if (channels === 1) {
  //       return await sharp(Buffer.from(data), {
  //         raw: { width, height, channels: 1 }
  //       }).png().toBuffer();
  //     }

  //     return null;
  //   } catch (error) {
  //     return null;
  //   }
  // }

async convertPdfImageToBuffer(imageData) {
  try {
    const { width, height, data, kind } = imageData;

    if (!width || !height || !data) return null;

    let processedData = data;
    let channels = 1;

    // Handle Kind 1: 1-bit per pixel (Black and White)
    if (kind === 1) {
      // We need to expand 1 bit into 1 byte (8 bits)
      const unpackedData = new Uint8Array(width * height);
      for (let i = 0, n = data.length; i < n; i++) {
        const byte = data[i];
        for (let bit = 7; bit >= 0; bit--) {
          const pixelIndex = i * 8 + (7 - bit);
          if (pixelIndex < unpackedData.length) {
            // If bit is 1, set pixel to 255 (white), else 0 (black)
            unpackedData[pixelIndex] = (byte & (1 << bit)) ? 255 : 0;
          }
        }
      }
      processedData = unpackedData;
      channels = 1;
    } else {
      // For Kind 2 (RGB) or 3 (RGBA), calculate channels normally
      channels = data.length / (width * height);
    }

    // Now use sharp with the processed data
    return await sharp(Buffer.from(processedData), {
      raw: {
        width: width,
        height: height,
        channels: channels
      }
    })
    .png()
    .toBuffer();

  } catch (error) {
    console.error("Error converting image buffer:", error);
    return null;
  }
}
  
  async extractFromPdfWithPdfjs(buffer) {
    try {
      const uint8Array = new Uint8Array(buffer);
      const loadingTask = pdfjsLib.getDocument({
        data: uint8Array,
        useSystemFonts: true,
      });
      
      const pdfDocument = await loadingTask.promise;
      const textParts = [];

      for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
        const page = await pdfDocument.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map(item => item.str)
          .join(' ');
        textParts.push(pageText);
      }

      return textParts.join('\n\n');
    } catch (error) {
      console.error('PDFJS extraction error:', error.message);
      throw error;
    }
  }

  
  async extractFromDocx(buffer) {
    try {
      let textContent = '';
      const imageTexts = [];

      const textResult = await mammoth.extractRawText({ buffer });
      textContent = textResult.value;

      try {
        console.log('  🔍 Scanning DOCX for embedded images...');
        const imageResult = await mammoth.convertToHtml({
          buffer,
          convertImage: mammoth.images.imgElement(async (image) => {
            try {
              const imageBuffer = await image.read();
              const contentType = image.contentType;
              
              if (contentType && contentType.startsWith('image/')) {
                const ocrText = await this.extractFromImage(imageBuffer);
                if (ocrText && ocrText.trim().length > 10) {
                  imageTexts.push(ocrText);
                  console.log(`    📄 OCR extracted text from embedded image in DOCX`);
                }
              }
            } catch (imgError) {
            }
            return { src: '' }; 
          })
        });
        
        if (imageTexts.length > 0) {
          console.log(`  📸 Found and processed ${imageTexts.length} embedded image(s) in DOCX`);
        }
      } catch (imgError) {
        console.warn('DOCX image extraction failed:', imgError.message);
      }

      const allContent = [textContent, ...imageTexts].filter(t => t && t.trim().length > 0);
      
      return allContent.join('\n\n--- [Image Content] ---\n\n');
    } catch (error) {
      console.error('DOCX extraction error:', error.message);
      throw new Error(`Failed to extract DOCX content: ${error.message}`);
    }
  }

  
  async extractFromImage(buffer, useAdvancedPreprocessing = false) {
    try {
      if (useAdvancedPreprocessing) {
        // Multi-pass OCR for noisy/fax images
        return await this.ocrWithBestStrategy(buffer);
      }

      const optimizedBuffer = await this.optimizeImageForOcr(buffer);
      const { data: { text } } = await Tesseract.recognize(optimizedBuffer, 'eng', {
        logger: () => {},
        tessedit_pageseg_mode: Tesseract.PSM.AUTO,
        preserve_interword_spaces: '1',
      });
      
      return text;
    } catch (error) {
      console.error('OCR extraction error:', error.message);
      throw new Error(`Failed to extract image content: ${error.message}`);
    }
  }

  
  async optimizeImageForOcr(buffer) {
    try {
      return await sharp(buffer)
        .grayscale()
        .normalize()
        .sharpen()
        .toBuffer();
    } catch (error) {
      return buffer;
    }
  }

  /**
   * Advanced image preprocessing for noisy fax-like documents.
   * Produces multiple preprocessed variants to maximise OCR accuracy.
   *
   *  Pipeline per strategy:
   *    grayscale → upscale (≥3000 px) → white border padding
   *    → invert detection → denoise → contrast → sharpen / threshold
   */
  async advancedImagePreprocessing(buffer) {
    try {
      const metadata = await sharp(buffer).metadata();

      // ── Base: grayscale + upscale + pad ──────────────────────────
      const minDim = 3000; // Tesseract is most accurate around 300 DPI; 3000 px ≈ 10" @ 300 DPI
      let baseChain = sharp(buffer).grayscale();

      if (metadata.width < minDim || metadata.height < minDim) {
        const sf = Math.max(minDim / metadata.width, minDim / metadata.height, 1);
        baseChain = baseChain.resize(
          Math.round(metadata.width * sf),
          Math.round(metadata.height * sf),
          { kernel: 'lanczos3' }
        );
      }

      // Add 50 px white border on every side – Tesseract needs whitespace
      baseChain = baseChain.extend({
        top: 50, bottom: 50, left: 50, right: 50,
        background: { r: 255, g: 255, b: 255 },
      });

      const baseBuffer = await baseChain.toBuffer();

      // ── Detect inverted image (white text on dark bg) ────────────
      const stats = await sharp(baseBuffer).stats();
      const meanBrightness = stats.channels[0].mean;
      const normalizedBase = meanBrightness < 127
        ? await sharp(baseBuffer).negate().toBuffer()
        : baseBuffer;

      // ── Build strategies ─────────────────────────────────────────
      const strategies = await Promise.all([
        // S1: Light cleanup (clean scans)
        sharp(normalizedBase).median(3).normalize().sharpen({ sigma: 1 }).toBuffer(),

        // S2: Heavy denoise + Otsu auto-binarize (heavy fax noise)
        sharp(normalizedBase).median(5).normalize().sharpen({ sigma: 1.5 }).threshold(0).toBuffer(),

        // S3: Gamma correction – preserves faded / light text & table lines
        sharp(normalizedBase).median(3).normalize().gamma(1.8).sharpen({ sigma: 2 }).toBuffer(),

        // S4: High threshold – grabs dark text, strips light noise
        sharp(normalizedBase).median(3).normalize().sharpen({ sigma: 1.5 }).threshold(170).toBuffer(),

        // S5: Low threshold – recovers faint / faded text
        sharp(normalizedBase).median(3).normalize().sharpen({ sigma: 1.5 }).threshold(80).toBuffer(),

        // S6: Strong unsharp mask – different sharpening for blurry faxes
        sharp(normalizedBase).median(3).normalize().sharpen({ sigma: 3, m1: 1, m2: 2 }).toBuffer(),
      ]);

      return strategies;
    } catch (error) {
      console.warn('Advanced preprocessing failed, using basic:', error.message);
      const fallback = await this.optimizeImageForOcr(buffer);
      return [fallback];
    }
  }

  /**
   * Run OCR across multiple preprocessing strategies × multiple PSM modes.
   * Uses Tesseract.createWorker for full control over OEM, DPI, etc.
   * Picks the result with the highest score = confidence × log(textLength).
   */
  async ocrWithBestStrategy(buffer) {
    const strategies = await this.advancedImagePreprocessing(buffer);

    // PSM modes worth trying on fax / scanned documents:
    //   3 = Fully automatic (default)
    //   6 = Assume a single uniform block of text (good for tables)
    //   4 = Assume a single column of text
    const psmModes = ['3', '6', '4'];

    let bestText = '';
    let bestScore = 0;

    // Create a reusable Tesseract worker (OEM 1 = LSTM only – best accuracy)
    const worker = await Tesseract.createWorker('eng', 1, {
      logger: () => {},
    });

    try {
      for (let si = 0; si < strategies.length; si++) {
        for (const psm of psmModes) {
          try {
            await worker.setParameters({
              tessedit_pageseg_mode: psm,
              preserve_interword_spaces: '1',
              user_defined_dpi: '300',
            });

            const { data } = await worker.recognize(strategies[si]);
            const text = (data.text || '').trim();
            const confidence = data.confidence || 0;
            // Score: prefer high confidence AND long text
            const score = confidence * Math.log2(text.length + 1);

            if (score > bestScore) {
              bestScore = score;
              bestText = data.text; // keep original whitespace
            }

            // Early exit if confidence is very high
            if (confidence >= 92) {
              console.log(`    🎯 High-confidence OCR hit (${confidence}%) on strategy ${si + 1} PSM ${psm}`);
              return bestText;
            }
          } catch (err) {
            // Silently skip failed combos
          }
        }
      }
    } finally {
      await worker.terminate();
    }

    return bestText;
  }

  /**
   * Extract text from fully image-based PDFs (scanned / fax).
   *
   * Uses the system pdftocairo (Homebrew poppler) at **600 DPI**
   * for the highest possible rendering quality, then runs
   * multi-strategy OCR on each page.
   */
  async extractFromImageBasedPdf(buffer) {
    const pageTexts = [];
    const tempId = `pdf_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const tempPdfPath = join(tmpdir(), `${tempId}.pdf`);
    const outputDir = join(tmpdir(), tempId);

    try {
      await mkdir(outputDir, { recursive: true });
      await writeFile(tempPdfPath, buffer);

      // Render every page at 600 DPI as PNG using system pdftocairo
      await new Promise((resolve, reject) => {
        const args = [
          '-png',         // output format
          '-r', '600',    // 600 DPI – maximum useful for OCR
          '-antialias', 'best',
          tempPdfPath,
          join(outputDir, 'page'),
        ];
        execFile('pdftocairo', args, { maxBuffer: 100 * 1024 * 1024 }, (err, stdout, stderr) => {
          if (err) return reject(new Error(`pdftocairo failed: ${err.message}\n${stderr}`));
          resolve(stdout);
        });
      });

      // Collect generated images (sorted by page number)
      const files = await readdir(outputDir);
      const imageFiles = files.filter(f => f.endsWith('.png')).sort();

      console.log(`  📄 Processing ${imageFiles.length} page(s) from image-based PDF at 600 DPI...`);

      for (const imageFile of imageFiles) {
        const imagePath = join(outputDir, imageFile);
        const imageBuffer = await fsReadFile(imagePath);

        const text = await this.ocrWithBestStrategy(imageBuffer);

        if (text && text.trim().length > 10) {
          pageTexts.push(text);
          console.log(`    ✅ Extracted text from ${imageFile} (${text.trim().length} chars)`);
        }

        await unlink(imagePath).catch(() => {});
      }
    } catch (error) {
      console.error('Image-based PDF extraction error:', error.message);
      throw error;
    } finally {
      await unlink(tempPdfPath).catch(() => {});
      try { rmSync(outputDir, { recursive: true, force: true }); } catch (_) {}
    }

    return pageTexts;
  }

 
  async optimizeImageForApi(buffer) {
    try {
      const metadata = await sharp(buffer).metadata();
      
      if (metadata.width > 2048 || metadata.height > 2048) {
        return await sharp(buffer)
          .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();
      }
      
      return buffer;
    } catch (error) {
      return buffer;
    }
  }


  stripHtml(html) {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
      .replace(/<\/?(br|p|div|h[1-6]|li|tr|td|th|blockquote|hr)[^>]*>/gi, '\n')
      .replace(/<\/?(ul|ol|table|tbody|thead)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
      .replace(/&#x([0-9A-Fa-f]+);/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s+/g, '\n')
      .replace(/\s+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }


  isImageFile(filename) {
    if (!filename) return false;
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.tiff', '.bmp'];
    const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    return imageExtensions.includes(ext);
  }

 async  parseExcelAttachment(data) {

  // 2. Read workbook
  const workbook = XLSX.read(data, { type: "buffer" });

 const result = {};

  workbook.SheetNames.forEach((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];

    result[sheetName] = XLSX.utils.sheet_to_json(worksheet, {
      defval: "",      // empty cells → ""
      raw: false,      // formatted text
      blankrows: false
    });
  });

  return JSON.stringify(result, null, 2);
};
}

export const contentExtractorService = new ContentExtractorService();
export default contentExtractorService;


