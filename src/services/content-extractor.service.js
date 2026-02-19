import pdf from 'pdf-parse/lib/pdf-parse.js';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import mammoth from 'mammoth';
import Tesseract from 'tesseract.js';
import sharp from 'sharp';
import XLSX from "xlsx";


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

    try {
      console.log('  🔍 Scanning PDF for embedded images...');
      imageTexts = await this.extractImagesFromPdf(buffer);
      if (imageTexts.length > 0) {
        console.log(`  📸 Found and processed ${imageTexts.length} embedded image(s) in PDF`);
      }
    } catch (error) {
      console.warn('PDF image extraction failed:', error.message);
    }

    const allContent = [textContent, ...imageTexts].filter(t => t && t.trim().length > 0);
    
    if (allContent.length === 0) {
      console.warn('Could not extract any content from PDF');
      return '';
    }

    return allContent.join('\n\n--- [Image Content] ---\n\n');
  }

  async extractImagesFromPdf(buffer) {
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
            
            if (fn === 85 || fn === 86) {
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
                        const ocrText = await this.extractFromImage(imageBuffer);
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

  
  async extractFromImage(buffer) {
    try {
      const optimizedBuffer = await this.optimizeImageForOcr(buffer);
      
      const { data: { text } } = await Tesseract.recognize(optimizedBuffer, 'eng', {
        logger: () => {}, 
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


